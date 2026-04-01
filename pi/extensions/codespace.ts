import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile as writeFileFs } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type BashOperations,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@mariozechner/pi-coding-agent";

const DEFAULT_REMOTE_CWD = "/workspaces/github";
const STATUS_KEY = "codespace-mode";
const VERIFY_TOKEN = "__PI_CODESPACE_OK__";
const VERIFY_START_TIMEOUT_SECONDS = 180;

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

type CodespaceState = {
  enabled: boolean;
  codespaceName?: string;
  remoteCwd: string;
};

type LocalExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type CodespaceSummary = {
  name: string;
  repository: string;
  state: string;
  branch: string;
  lastUsedAt: string;
};

function quoteForShell(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeRemoteCwd(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_REMOTE_CWD;
  const withForwardSlashes = trimmed.replace(/\\/g, "/");
  if (withForwardSlashes.startsWith("/")) return path.posix.normalize(withForwardSlashes);
  return path.posix.join(DEFAULT_REMOTE_CWD, withForwardSlashes);
}

function mapLocalPathToRemote(localPath: string, localCwd: string, remoteCwd: string): string {
  const absolutePath = path.resolve(localPath);
  const absoluteLocalCwd = path.resolve(localCwd);

  if (absolutePath === remoteCwd || absolutePath.startsWith(`${remoteCwd}/`)) {
    return absolutePath;
  }

  if (absolutePath === absoluteLocalCwd) {
    return remoteCwd;
  }

  if (absolutePath.startsWith(`${absoluteLocalCwd}${path.sep}`)) {
    const relative = absolutePath.slice(absoluteLocalCwd.length + 1).split(path.sep).join("/");
    return path.posix.join(remoteCwd, relative);
  }

  if (path.isAbsolute(localPath)) {
    return localPath.replace(/\\/g, "/");
  }

  return path.posix.join(remoteCwd, localPath.split(path.sep).join("/"));
}

function extractResultError(action: string, result: LocalExecResult): Error {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const details = stderr || stdout || "no output";
  return new Error(`${action} failed: ${details}`);
}

async function runLocalCommand(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<LocalExecResult> {
  const result = await pi.exec(command, args, {
    timeout: options?.timeoutMs,
    signal: options?.signal,
  });

  return {
    code: result.code ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function buildCsdExecArgs(state: CodespaceState, options?: { cwd?: string; startTimeoutSeconds?: number }): string[] {
  const args = ["csd", "exec"];

  if (state.codespaceName) {
    args.push("-c", state.codespaceName);
  }

  if (options?.cwd) {
    args.push("-C", options.cwd);
  }

  if (options?.startTimeoutSeconds && options.startTimeoutSeconds > 0) {
    args.push("--start-timeout", String(options.startTimeoutSeconds));
  }

  return args;
}

async function runRemoteShell(
  pi: ExtensionAPI,
  state: CodespaceState,
  shellCommand: string,
  options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<LocalExecResult> {
  const args = [...buildCsdExecArgs(state, { cwd: options?.cwd }), "--", "bash", "-lc", shellCommand];
  return runLocalCommand(pi, "gh", args, options);
}

async function resolveCodespaceName(pi: ExtensionAPI, state: CodespaceState): Promise<string> {
  if (state.codespaceName) {
    return state.codespaceName;
  }

  const result = await runLocalCommand(pi, "gh", ["csd", "get"], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    throw extractResultError("Resolving current codespace", result);
  }

  const name = result.stdout.trim();
  if (!name) {
    throw new Error("No codespace selected. Use `gh csd select` or `/codespace on <name>`.");
  }

  return name;
}

async function copyFileToCodespace(
  pi: ExtensionAPI,
  state: CodespaceState,
  localPath: string,
  remotePath: string
): Promise<void> {
  const codespaceName = await resolveCodespaceName(pi, state);
  const remoteArg = `remote:${remotePath}`;

  const result = await runLocalCommand(pi, "gh", ["cs", "cp", "-e", "-c", codespaceName, localPath, remoteArg], {
    timeoutMs: 120_000,
  });

  if (result.code !== 0) {
    throw extractResultError(`Copying file to codespace (${codespaceName})`, result);
  }
}

async function verifyCodespaceConnection(
  pi: ExtensionAPI,
  state: CodespaceState,
  timeoutMs: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const args = [
    ...buildCsdExecArgs(state, { startTimeoutSeconds: VERIFY_START_TIMEOUT_SECONDS }),
    "--",
    "echo",
    VERIFY_TOKEN,
  ];

  const result = await runLocalCommand(pi, "gh", args, { timeoutMs });
  if (result.code !== 0) {
    const rawError = (result.stderr || result.stdout || "unknown error").trim();
    if (/unknown command\s+"?exec"?/i.test(rawError)) {
      return {
        ok: false,
        error: "`gh csd exec` is not available. Update gh-csd to a version that includes the exec command.",
      };
    }
    return { ok: false, error: rawError };
  }

  if (!result.stdout.includes(VERIFY_TOKEN)) {
    return { ok: false, error: "codespace health check returned unexpected output" };
  }

  return { ok: true };
}

function setStatus(ctx: ExtensionContext, state: CodespaceState): void {
  if (!ctx.hasUI) return;

  if (!state.enabled) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  const name = state.codespaceName ?? "(current)";
  ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `☁ ${name}:${state.remoteCwd}`));
}

function parseCommandArgs(args: string): string[] {
  const trimmed = args.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

async function getCurrentCodespaceSelection(pi: ExtensionAPI): Promise<string | undefined> {
  const result = await runLocalCommand(pi, "gh", ["csd", "get"], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    return undefined;
  }

  const name = result.stdout.trim();
  return name || undefined;
}

async function listCodespaces(pi: ExtensionAPI): Promise<CodespaceSummary[]> {
  const result = await runLocalCommand(
    pi,
    "gh",
    ["cs", "list", "--json", "name,repository,state,gitStatus,lastUsedAt", "--limit", "100"],
    { timeoutMs: 20_000 }
  );

  if (result.code !== 0) {
    throw extractResultError("Listing codespaces", result);
  }

  const parsed = JSON.parse(result.stdout) as Array<{
    name?: string;
    repository?: string;
    state?: string;
    lastUsedAt?: string;
    gitStatus?: { ref?: string };
  }>;

  return parsed
    .filter((item) => item.name)
    .map((item) => ({
      name: item.name ?? "",
      repository: item.repository ?? "",
      state: item.state ?? "",
      branch: item.gitStatus?.ref ?? "",
      lastUsedAt: item.lastUsedAt ?? "",
    }))
    .sort((a, b) => {
      if (a.state !== b.state) {
        if (a.state === "Available") return -1;
        if (b.state === "Available") return 1;
      }

      return b.lastUsedAt.localeCompare(a.lastUsedAt);
    });
}

function createCodespaceReadOps(pi: ExtensionAPI, state: CodespaceState, localCwd: string): ReadOperations {
  return {
    readFile: async (absolutePath) => {
      if (!state.enabled) {
        throw new Error("Codespace mode is disabled");
      }

      const remotePath = mapLocalPathToRemote(absolutePath, localCwd, state.remoteCwd);
      const command = `test -r ${quoteForShell(remotePath)} && base64 ${quoteForShell(remotePath)} | tr -d '\\n'`;
      const result = await runRemoteShell(pi, state, command, { timeoutMs: 120_000 });

      if (result.code !== 0) {
        throw extractResultError(`Reading ${remotePath}`, result);
      }

      const base64Content = result.stdout.trim();
      if (!base64Content) {
        return Buffer.alloc(0);
      }

      return Buffer.from(base64Content, "base64");
    },
    access: async (absolutePath) => {
      if (!state.enabled) {
        throw new Error("Codespace mode is disabled");
      }

      const remotePath = mapLocalPathToRemote(absolutePath, localCwd, state.remoteCwd);
      const result = await runRemoteShell(pi, state, `test -r ${quoteForShell(remotePath)}`, { timeoutMs: 30_000 });
      if (result.code !== 0) {
        throw extractResultError(`Access check for ${remotePath}`, result);
      }
    },
    detectImageMimeType: async (absolutePath) => {
      if (!state.enabled) {
        return null;
      }

      const remotePath = mapLocalPathToRemote(absolutePath, localCwd, state.remoteCwd);
      const result = await runRemoteShell(pi, state, `file --mime-type -b ${quoteForShell(remotePath)}`, {
        timeoutMs: 30_000,
      });

      if (result.code !== 0) {
        return null;
      }

      const mimeType = result.stdout.trim();
      return IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null;
    },
  };
}

function createCodespaceWriteOps(pi: ExtensionAPI, state: CodespaceState, localCwd: string): WriteOperations {
  return {
    mkdir: async (dir) => {
      if (!state.enabled) {
        throw new Error("Codespace mode is disabled");
      }

      const remoteDir = mapLocalPathToRemote(dir, localCwd, state.remoteCwd);
      const result = await runRemoteShell(pi, state, `mkdir -p ${quoteForShell(remoteDir)}`, { timeoutMs: 30_000 });

      if (result.code !== 0) {
        throw extractResultError(`Creating directory ${remoteDir}`, result);
      }
    },
    writeFile: async (absolutePath, content) => {
      if (!state.enabled) {
        throw new Error("Codespace mode is disabled");
      }

      const remotePath = mapLocalPathToRemote(absolutePath, localCwd, state.remoteCwd);
      const remoteDir = path.posix.dirname(remotePath);

      const mkdirResult = await runRemoteShell(pi, state, `mkdir -p ${quoteForShell(remoteDir)}`, { timeoutMs: 30_000 });
      if (mkdirResult.code !== 0) {
        throw extractResultError(`Creating directory ${remoteDir}`, mkdirResult);
      }

      const tempDir = await mkdtemp(path.join(tmpdir(), "pi-codespace-write-"));
      const tempFile = path.join(tempDir, "payload.txt");

      try {
        await writeFileFs(tempFile, content, "utf8");
        await copyFileToCodespace(pi, state, tempFile, remotePath);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  };
}

function createCodespaceEditOps(pi: ExtensionAPI, state: CodespaceState, localCwd: string): EditOperations {
  const readOps = createCodespaceReadOps(pi, state, localCwd);
  const writeOps = createCodespaceWriteOps(pi, state, localCwd);

  return {
    readFile: readOps.readFile,
    writeFile: writeOps.writeFile,
    access: async (absolutePath) => {
      if (!state.enabled) {
        throw new Error("Codespace mode is disabled");
      }

      const remotePath = mapLocalPathToRemote(absolutePath, localCwd, state.remoteCwd);
      const result = await runRemoteShell(
        pi,
        state,
        `test -r ${quoteForShell(remotePath)} && test -w ${quoteForShell(remotePath)}`,
        { timeoutMs: 30_000 }
      );

      if (result.code !== 0) {
        throw extractResultError(`Write access check for ${remotePath}`, result);
      }
    },
  };
}

function createCodespaceBashOps(state: CodespaceState, localCwd: string): BashOperations {
  return {
    exec: (command, cwd, { onData, signal, timeout }) =>
      new Promise((resolve, reject) => {
        if (!state.enabled) {
          reject(new Error("Codespace mode is disabled"));
          return;
        }

        const remoteCwd = mapLocalPathToRemote(cwd, localCwd, state.remoteCwd);
        const args = [...buildCsdExecArgs(state, { cwd: remoteCwd }), "--", "bash", "-lc", command];
        const child = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });

        let timedOut = false;
        const timeoutHandle =
          typeof timeout === "number" && timeout > 0
            ? setTimeout(() => {
                timedOut = true;
                child.kill();
              }, timeout * 1000)
            : undefined;

        const onAbort = () => child.kill();
        signal?.addEventListener("abort", onAbort, { once: true });

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("error", (error) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        });

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);

          if (signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }

          if (timedOut) {
            reject(new Error(`timeout:${timeout}`));
            return;
          }

          resolve({ exitCode: code });
        });
      }),
  };
}

export default function codespaceExtension(pi: ExtensionAPI): void {
  const localCwd = process.cwd();
  const state: CodespaceState = {
    enabled: false,
    codespaceName: undefined,
    remoteCwd: DEFAULT_REMOTE_CWD,
  };

  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);

  const remoteRead = createReadTool(localCwd, { operations: createCodespaceReadOps(pi, state, localCwd) });
  const remoteWrite = createWriteTool(localCwd, { operations: createCodespaceWriteOps(pi, state, localCwd) });
  const remoteEdit = createEditTool(localCwd, { operations: createCodespaceEditOps(pi, state, localCwd) });
  const remoteBash = createBashTool(localCwd, { operations: createCodespaceBashOps(state, localCwd) });

  pi.registerFlag("codespace", {
    description: "Enable Codespace mode for read/write/edit/bash tools",
    type: "boolean",
    default: false,
  });


  async function enableMode(ctx: ExtensionContext, source: "flag" | "command"): Promise<boolean> {
    state.enabled = true;
    setStatus(ctx, state);

    if (!ctx.hasUI) return true;

    ctx.ui.setStatus("codespace-connect", ctx.ui.theme.fg("warning", "☁ connecting..."));
    const result = await verifyCodespaceConnection(pi, state, 120_000);
    ctx.ui.setStatus("codespace-connect", undefined);

    if (!result.ok) {
      state.enabled = false;
      setStatus(ctx, state);
      ctx.ui.notify(`Codespace mode failed (${source}): ${result.error}`, "error");
      return false;
    }

    const label = state.codespaceName ?? "current";
    ctx.ui.notify(`Codespace mode enabled (${label})`, "info");
    setStatus(ctx, state);
    return true;
  }

  function disableMode(ctx: ExtensionContext): void {
    state.enabled = false;
    setStatus(ctx, state);
    if (ctx.hasUI) {
      ctx.ui.notify("Codespace mode disabled", "info");
    }
  }

  async function showStatus(ctx: ExtensionContext): Promise<void> {
    const selected = state.codespaceName ?? (await getCurrentCodespaceSelection(pi)) ?? "(none selected)";
    const message = state.enabled
      ? `Codespace mode: ON\nCodespace: ${selected}\nRemote cwd: ${state.remoteCwd}`
      : `Codespace mode: OFF\nSelected codespace: ${selected}`;

    if (ctx.hasUI) {
      ctx.ui.notify(message, "info");
    }
  }

  async function pickExistingCodespace(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;

    const items = await listCodespaces(pi);
    if (items.length === 0) {
      ctx.ui.notify("No codespaces found.", "warning");
      return;
    }

    const labels = items.map((item) => {
      const branch = item.branch ? ` · ${item.branch}` : "";
      return `${item.name} · ${item.repository} · ${item.state}${branch}`;
    });

    const selectedLabel = await ctx.ui.select("Pick a codespace", labels);
    if (!selectedLabel) return;

    const index = labels.indexOf(selectedLabel);
    if (index < 0) return;

    state.codespaceName = items[index].name;
    await enableMode(ctx, "command");
  }

  async function createCodespaceAndConnect(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;

    const repo = await ctx.ui.input("Create codespace", "Repo alias or owner/repo (example: gh)");
    if (!repo?.trim()) return;

    ctx.ui.setStatus("codespace-create", ctx.ui.theme.fg("warning", "☁ creating codespace..."));
    const result = await runLocalCommand(pi, "gh", ["csd", "create", repo.trim(), "--no-ssh", "--no-notify"], {
      timeoutMs: 1000 * 60 * 20,
    });
    ctx.ui.setStatus("codespace-create", undefined);

    if (result.code !== 0) {
      ctx.ui.notify(extractResultError("Creating codespace", result).message, "error");
      return;
    }

    state.codespaceName = await getCurrentCodespaceSelection(pi);
    await enableMode(ctx, "command");
  }

  async function runInteractiveCodespaceMenu(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      await showStatus(ctx);
      return;
    }

    const current = state.codespaceName ?? (await getCurrentCodespaceSelection(pi)) ?? "none";

    const action = await ctx.ui.select("Codespace", [
      `Connect to current (${current})`,
      "Pick existing codespace",
      "Create new codespace",
      "Turn codespace mode off",
      "Show status",
      "Cancel",
    ]);

    if (!action || action === "Cancel") return;

    if (action.startsWith("Connect to current")) {
      state.codespaceName = undefined;
      await enableMode(ctx, "command");
      return;
    }

    if (action === "Pick existing codespace") {
      await pickExistingCodespace(ctx);
      return;
    }

    if (action === "Create new codespace") {
      await createCodespaceAndConnect(ctx);
      return;
    }

    if (action === "Turn codespace mode off") {
      disableMode(ctx);
      return;
    }

    if (action === "Show status") {
      await showStatus(ctx);
    }
  }

  pi.registerCommand("codespace", {
    description: "Manage codespace mode. No args opens an interactive menu.",
    handler: async (args, ctx) => {
      const tokens = parseCommandArgs(args);
      const command = tokens[0];

      if (!command) {
        await runInteractiveCodespaceMenu(ctx);
        return;
      }

      if (command === "status") {
        await showStatus(ctx);
        return;
      }

      if (command === "on") {
        state.codespaceName = undefined;

        if (tokens[1]) {
          if (tokens[1].startsWith("/")) {
            state.remoteCwd = normalizeRemoteCwd(tokens.slice(1).join(" "));
          } else {
            state.codespaceName = tokens[1];
            if (tokens[2]) {
              state.remoteCwd = normalizeRemoteCwd(tokens.slice(2).join(" "));
            }
          }
        }

        await enableMode(ctx, "command");
        return;
      }

      if (command === "off") {
        disableMode(ctx);
        return;
      }

      if (command === "use") {
        if (!tokens[1]) {
          if (ctx.hasUI) ctx.ui.notify("Usage: /codespace use <codespace-name>", "warning");
          return;
        }
        state.codespaceName = tokens[1];
        setStatus(ctx, state);
        if (ctx.hasUI) ctx.ui.notify(`Codespace target set to ${state.codespaceName}`, "info");
        return;
      }

      if (command === "cwd") {
        if (!tokens[1]) {
          if (ctx.hasUI) ctx.ui.notify(`Current remote cwd: ${state.remoteCwd}`, "info");
          return;
        }

        state.remoteCwd = normalizeRemoteCwd(tokens.slice(1).join(" "));
        setStatus(ctx, state);
        if (ctx.hasUI) ctx.ui.notify(`Remote cwd set to ${state.remoteCwd}`, "info");
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify("Unknown subcommand. Use: on | off | status | use | cwd", "warning");
      }
    },
  });

  pi.registerTool({
    ...localRead,
    async execute(id, params, signal, onUpdate, ctx) {
      if (!state.enabled) return localRead.execute(id, params, signal, onUpdate, ctx);
      return remoteRead.execute(id, params, signal, onUpdate, ctx);
    },
  });

  pi.registerTool({
    ...localWrite,
    async execute(id, params, signal, onUpdate, ctx) {
      if (!state.enabled) return localWrite.execute(id, params, signal, onUpdate, ctx);
      return remoteWrite.execute(id, params, signal, onUpdate, ctx);
    },
  });

  pi.registerTool({
    ...localEdit,
    async execute(id, params, signal, onUpdate, ctx) {
      if (!state.enabled) return localEdit.execute(id, params, signal, onUpdate, ctx);
      return remoteEdit.execute(id, params, signal, onUpdate, ctx);
    },
  });

  pi.registerTool({
    ...localBash,
    async execute(id, params, signal, onUpdate, ctx) {
      if (!state.enabled) return localBash.execute(id, params, signal, onUpdate, ctx);
      return remoteBash.execute(id, params, signal, onUpdate, ctx);
    },
  });

  pi.on("user_bash", () => {
    if (!state.enabled) return;
    return { operations: createCodespaceBashOps(state, localCwd) };
  });

  pi.on("before_agent_start", async (event) => {
    if (!state.enabled) return;

    const codespaceLabel = state.codespaceName ? `codespace ${state.codespaceName}` : "current selected codespace";
    const replacement = `Current working directory: ${state.remoteCwd} (via ${codespaceLabel})`;

    if (event.systemPrompt.includes(`Current working directory: ${localCwd}`)) {
      return {
        systemPrompt: event.systemPrompt.replace(`Current working directory: ${localCwd}`, replacement),
      };
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${replacement}`,
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    const flagCodespace = Boolean(pi.getFlag("codespace"));

    if (flagCodespace) {
      await enableMode(ctx, "flag");
      return;
    }

    setStatus(ctx, state);
  });
}

