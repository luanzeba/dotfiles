import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PACKAGE = "@mariozechner/pi-coding-agent";
const INSTALL_ARGS = ["install", "-g", PACKAGE];
const TIMEOUT_MS = 1000 * 60 * 3;

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

export default function (pi: ExtensionAPI) {
  let pendingRestart: PendingRestart | undefined;

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
    description: `Update ${PACKAGE} via npm and restart pi`,
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        const result = await pi.exec("npm", INSTALL_ARGS, { timeout: TIMEOUT_MS });
        if (result.code !== 0) {
          throw new Error(result.stderr || "npm update failed");
        }
        return;
      }

      ctx.ui.setStatus("pi-update", "Updating pi...");
      try {
        const result = await pi.exec("npm", INSTALL_ARGS, { timeout: TIMEOUT_MS });

        if (result.code !== 0) {
          ctx.ui.notify(result.stderr || "npm update failed", "error");
          return;
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
