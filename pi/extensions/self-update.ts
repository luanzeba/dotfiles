import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PACKAGE = "@mariozechner/pi-coding-agent";
const INSTALL_ARGS = ["install", "-g", PACKAGE];
const TIMEOUT_MS = 1000 * 60 * 3;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("update", {
    description: `Update ${PACKAGE} via npm and reload extensions`,
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        const result = await pi.exec("npm", INSTALL_ARGS, { timeout: TIMEOUT_MS });
        if (result.code !== 0) {
          throw new Error(result.stderr || "npm update failed");
        }
        await ctx.reload();
        return;
      }

      const ok = await ctx.ui.confirm(
        "Update pi?",
        `This will run: npm ${INSTALL_ARGS.join(" ")}`
      );
      if (!ok) return;

      ctx.ui.setStatus("pi-update", "Updating pi...");
      try {
        const result = await pi.exec("npm", INSTALL_ARGS, { timeout: TIMEOUT_MS });

        if (result.code !== 0) {
          ctx.ui.notify(result.stderr || "npm update failed", "error");
          return;
        }

        if (result.stdout) {
          ctx.ui.notify("pi updated. Reloading extensions...", "info");
        }

        await ctx.reload();

        ctx.ui.notify(
          "Update complete. Restart pi to use the new core version.",
          "info"
        );
      } finally {
        ctx.ui.setStatus("pi-update", undefined);
      }
    },
  });
}
