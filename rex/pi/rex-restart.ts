import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Records which session this pi has open in its Rex pane, so `rex-restart` can reopen it with
 * `pi --session FILE` after the Rex server restarts. Nothing outside pi can see the session file.
 *
 * One file per pane, named after the pane's block ID and rewritten whenever a session starts,
 * switches, or is reloaded. rex-restart trusts a record only while its pid is still this pi.
 */

const recordsDir = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "rex-restart", "pi");

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		const block = process.env.REX_BLOCK;
		// Print-mode and RPC children (reviewers, helpers) inherit REX_BLOCK but don't own the pane. A
		// subagent tab does, but `pi --session` alone would reopen it without what made it one (see
		// pi/extensions/subagent), so its tab comes back as a saved screen instead.
		if (!block || ctx.mode !== "tui" || process.env.PI_SUBAGENT_DIR) return;
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) return;

		const record = {
			pid: process.pid,
			session_file: sessionFile,
			session_name: ctx.sessionManager.getSessionName() ?? null,
			updated_at: new Date().toISOString(),
		};
		try {
			mkdirSync(recordsDir, { recursive: true, mode: 0o700 });
			const file = join(recordsDir, `${block}.json`);
			const tmp = `${file}.${process.pid}.tmp`;
			writeFileSync(tmp, `${JSON.stringify(record)}\n`);
			renameSync(tmp, file);
		} catch (error) {
			ctx.ui.notify(`rex-restart could not record this session: ${error}`, "warning");
		}
	});
}
