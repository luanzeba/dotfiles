import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type ExtensionAPI, type ExtensionCommandContext, getPackageDir } from "@earendil-works/pi-coding-agent";

const PACKAGE = "@earendil-works/pi-coding-agent";
const UPDATE_ARGS = ["update", "--self", "--force"];
const TIMEOUT_MS = 1000 * 60 * 3;
/**
 * Holds the declarations of the pi version /update last replaced, which the extension check
 * diffs against the new ones, and the prompts it starts the check with.
 */
const CACHE_DIR = path.join(os.homedir(), ".cache", "pi-update");
/** ~/dotfiles/pi/check-extensions, found through this file's symlink. */
const CHECK_SCRIPT = path.join(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))), "..", "check-extensions");
const DOTFILES_DIR = path.resolve(path.dirname(CHECK_SCRIPT), "..");

function findPiBinary(): string {
  // process.argv[1] is the pi entrypoint script; the launcher is usually a sibling `pi` binary.
  return process.argv[1] ?? "pi";
}

/** The version on disk, which differs from the running one after an update. */
function installedVersion(): string {
  return JSON.parse(fs.readFileSync(path.join(getPackageDir(), "package.json"), "utf8")).version;
}

type PendingRestart = {
  cwd: string;
  sessionFile?: string;
};

function buildRestartExec(sessionFile?: string): { file: string; args: string[] } {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error("Unable to determine pi entrypoint for restart");
  }

  const sessionArgs = sessionFile ? ["--session", sessionFile] : [];
  return {
    file: process.execPath,
    args: [process.execPath, entrypoint, ...sessionArgs],
  };
}

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") clean[key] = value;
  }
  return clean;
}

function checkPrompt(from: string | undefined, to: string, snapshot: string | undefined): string {
  const root = getPackageDir();
  const since = from ? `after ${from}, up to and including ${to}` : `of ${to} and the few before it`;
  return `Pi was just updated${from ? ` from ${from}` : ""} to ${to}. Check that the extensions this machine loads still work with ${to}, and adapt them where they don't.

## What changed in pi

- Changelog: ${root}/CHANGELOG.md. Read every entry ${since}.
- ${to}'s docs and examples: ${root}/docs and ${root}/examples. Its type declarations: ${root}/dist/index.d.ts and what it re-exports.
${snapshot ? `- ${from}'s declarations and docs, saved before the update: ${snapshot}. Diff them against ${to}'s for API changes the changelog doesn't mention.\n` : ""}
## Extensions in scope

Everything pi loads from ~/.pi/agent/extensions. Follow the symlinks:

- ${DOTFILES_DIR}/pi/extensions is in the dotfiles repo.
- ${DOTFILES_DIR}/skills/external/private/pi/extensions is in the private-dotfiles repo, a separate jj repo.
- Files in ~/.pi/agent/extensions that aren't symlinks are not version controlled. Edit them in place and name them in your summary.

Leave installed packages (\`packages\` in ~/.pi/agent/settings.json, such as pi-claude-code and pi-radius) alone; their authors maintain them. Report it if one fails to load.

## Check and fix

Run \`${CHECK_SCRIPT}\`. It type-checks every extension against the installed pi and loads each one.${snapshot ? ` \`${CHECK_SCRIPT} --types ${snapshot}\` type-checks against ${from} instead, so you can tell what ${to} broke from what was already broken.` : ""} If the script itself no longer fits the new pi, fix it too.

Fix, in order:

1. Load failures and type errors that ${to} introduced.
2. Code the changelog says now behaves differently: renamed or removed APIs, changed event payloads or defaults, and deprecations that name a replacement.
3. Older type errors that point at a real mismatch with pi's API, such as importing something pi no longer exports.

Report without changing: workarounds ${to} makes unnecessary because pi now does the same thing, and type errors that are only typing noise. Change only what the update calls for; don't refactor or restyle.

## jj

The extensions run live from these repos: moving to another change would swap files under running pi sessions. In each repo you edit:

- Run \`jj status\` and \`jj log\` first.
- Put your edits in a new change on top of the current one: \`jj new -m "pi: adapt extensions to pi ${to}"\`. If @ is empty and has no description, \`jj describe -m\` it instead.
- Leave every other change alone: don't move @ elsewhere, abandon, squash, rebase, or push.

## Finish

Run the check again. Then summarize, per extension: what you changed and why (cite the changelog entry), what you checked and found fine, workarounds that can go, and anything you're unsure about. Stop there; Luan reviews before anything else happens.
`;
}

/** Spawn a terminal that outlives this process; resolves once it started. */
function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export default function (pi: ExtensionAPI) {
  let pendingRestart: PendingRestart | undefined;

  /** Save the declarations of the version about to be replaced, dropping older ones. */
  async function saveSnapshot(version: string): Promise<string | undefined> {
    const dir = path.join(CACHE_DIR, version);
    if (fs.existsSync(dir)) return dir;
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    const result = await pi.exec("env", [`PI_PACKAGE_DIR=${getPackageDir()}`, CHECK_SCRIPT, "--snapshot", dir], {
      timeout: 60_000,
    });
    return result.code === 0 ? dir : undefined;
  }

  /**
   * Start an agent session in a new terminal that checks the extensions against the installed pi.
   * It uses this session's model and profile. Returns a message saying where, or what to run.
   */
  async function startExtensionCheck(ctx: ExtensionCommandContext, from: string | undefined, to: string): Promise<string> {
    const snapshot = from && fs.existsSync(path.join(CACHE_DIR, from)) ? path.join(CACHE_DIR, from) : undefined;
    const promptFile = path.join(CACHE_DIR, `check-${to}.md`);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(promptFile, checkPrompt(from, to, snapshot));

    const model = ctx.model ? ["--model", `${ctx.model.provider}/${ctx.model.id}`, "--thinking", pi.getThinkingLevel()] : [];
    const piCommand = [
      ...(process.env.PI_PROFILE ? ["env", `PI_PROFILE=${process.env.PI_PROFILE}`] : []),
      "pi",
      "--name",
      `pi ${to} extension check`,
      ...model,
      `@${promptFile}`,
      "Follow the instructions in the attached file.",
    ];
    // An interactive shell sets up the environment a new terminal would have, such as API keys
    // from shell startup files, and passes the arguments through unquoted.
    const shell = process.env.SHELL || "/bin/bash";
    const command = [shell, "-ic", 'exec "$@"', "pi-check", ...piCommand];
    const label = `pi ${to} check`;

    if (process.env.REX_SESSION) {
      const result = await pi.exec("rex", [
        "window", "new", "-s", process.env.REX_SESSION, label, "-c", DOTFILES_DIR, "--keep-open", "--focus=false", "--", ...command,
      ]);
      if (result.code === 0) return `Checking extensions against pi ${to} in the Rex tab "${label}".`;
    } else if (process.platform === "linux") {
      const started = await spawnDetached("ghostty", [
        `--working-directory=${DOTFILES_DIR}`, "--wait-after-command=true", "-e", ...command,
      ]).then(() => true, () => false);
      if (started) return `Checking extensions against pi ${to} in a new Ghostty window.`;
    }
    return `Couldn't open a terminal. To check extensions against pi ${to}, run: cd ${DOTFILES_DIR} && pi @${promptFile}`;
  }

  pi.on("session_shutdown", async () => {
    if (!pendingRestart) return;

    const restart = pendingRestart;
    pendingRestart = undefined;

    try {
      process.chdir(restart.cwd);
      const { file, args } = buildRestartExec(restart.sessionFile);
      process.execve(file, args, sanitizeEnv(process.env));
    } catch (error) {
      console.error("[self-update] Failed to restart pi:", error);
    }
  });

  pi.registerCommand("update", {
    description: `Update ${PACKAGE} via 'pi update --self', check extensions against it, and restart pi. --check only checks.`,
    handler: async (args, ctx) => {
      const piBin = findPiBinary();

      if (!ctx.hasUI) {
        const result = await pi.exec(piBin, UPDATE_ARGS, { timeout: TIMEOUT_MS });
        if (result.code !== 0) {
          throw new Error(result.stderr || result.stdout || "pi update failed");
        }
        return;
      }

      if (args.trim() === "--check") {
        const installed = installedVersion();
        const saved = fs.existsSync(CACHE_DIR)
          ? fs.readdirSync(CACHE_DIR).find((name) => name !== installed && fs.statSync(path.join(CACHE_DIR, name)).isDirectory())
          : undefined;
        ctx.ui.notify(await startExtensionCheck(ctx, saved, installed), "info");
        return;
      }

      ctx.ui.setStatus("pi-update", "Updating pi...");
      try {
        const before = installedVersion();
        if (!(await saveSnapshot(before))) {
          ctx.ui.notify(`Couldn't save pi ${before}'s declarations; the extension check won't diff against them.`, "warning");
        }

        const result = await pi.exec(piBin, UPDATE_ARGS, { timeout: TIMEOUT_MS });

        if (result.code !== 0) {
          ctx.ui.notify(result.stderr || result.stdout || "pi update failed", "error");
          return;
        }

        const after = installedVersion();
        if (after !== before) {
          ctx.ui.notify(`pi ${before} → ${after}. ${await startExtensionCheck(ctx, before, after)}`, "info");
        }

        const canAutoRestart = Boolean(process.stdin.isTTY && process.stdout.isTTY);
        if (!canAutoRestart) {
          ctx.ui.notify(
            "pi updated. Restart manually to use the new core version.",
            "warning"
          );
          return;
        }

        pendingRestart = {
          cwd: ctx.cwd,
          sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
        };

        ctx.ui.notify("pi updated. Restarting...", "info");
        ctx.shutdown();
      } finally {
        ctx.ui.setStatus("pi-update", undefined);
      }
    },
  });
}
