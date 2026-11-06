import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Pi counterpart of the SessionStart hook that `rex skill setup` installs for Claude Code.
 * Rex reports Pi's hook as unsupported, so without this the agent only learns to name its Rex
 * session when it happens to load the rex skill.
 *
 * The text comes from the installed rex CLI, which prints nothing outside a Rex terminal and
 * keeps the wording current across Rex upgrades.
 */

const SECTION = "rex";
const TIMEOUT_MS = 5_000;

export default function (pi: ExtensionAPI) {
	let context = "";

	pi.on("session_start", async (_event, ctx) => {
		// Child pi processes (reviewers, print-mode helpers) inherit REX_SESSION. Only the
		// interactive agent should rename the user's Rex session, and a subagent in a tab of that
		// session (PI_SUBAGENT_DIR, see subagent/) isn't it.
		if (ctx.mode !== "tui" || process.env.PI_SUBAGENT_DIR) return;
		// exec resolves rather than rejects when rex is missing (code 1). A timeout kill can
		// resolve with code 0, so check `killed` too.
		const result = await pi.exec("rex", ["__internal", "session-start", "--agent", "pi"], {
			timeout: TIMEOUT_MS,
		});
		if (result.code === 0 && !result.killed) context = result.stdout.trim();
	});

	pi.on("before_agent_start", (event) => {
		if (context) event.systemPromptOptions.sections[SECTION] = context;
	});
}
