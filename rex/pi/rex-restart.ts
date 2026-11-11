import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Records which session this pi has open in its Rex pane, so `rex-restart` can reopen it with
 * `pi --session FILE` after the Rex server restarts. Nothing outside pi can see the session file.
 *
 * One file per pane, named after the pane's block ID and rewritten whenever a session starts,
 * switches, or is reloaded. Quitting pi (Ctrl+D, Ctrl+C, /quit) deletes it, so a record outlives
 * its pi only when something else ended it: a signal from Rex or macOS, or a crash. That's what
 * `rex-restart reopen` reopens. rex-restart trusts a record only while its pid is still this pi.
 */

const recordsDir = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "rex-restart", "pi");
const SIGNALS = ["SIGHUP", "SIGTERM"] as const;

export default function (pi: ExtensionAPI) {
	let file: string | undefined;
	let signaled = false;
	const onSignal = () => {
		signaled = true;
	};

	pi.on("session_start", (_event, ctx) => {
		const block = process.env.REX_BLOCK;
		// Print-mode and RPC children (reviewers, helpers) inherit REX_BLOCK but don't own the pane. A
		// subagent tab does, but `pi --session` alone would reopen it without what made it one (see
		// pi/extensions/subagent), so its tab comes back as a saved screen instead.
		if (!block || ctx.mode !== "tui" || process.env.PI_SUBAGENT_DIR) return;
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) return;

		file = join(recordsDir, `${block}.json`);
		for (const signal of SIGNALS) process.on(signal, onSignal);
		const record = {
			pid: process.pid,
			session_file: sessionFile,
			session_name: ctx.sessionManager.getSessionName() ?? null,
			updated_at: new Date().toISOString(),
		};
		try {
			mkdirSync(recordsDir, { recursive: true, mode: 0o700 });
			const tmp = `${file}.${process.pid}.tmp`;
			writeFileSync(tmp, `${JSON.stringify(record)}\n`);
			renameSync(tmp, file);
		} catch (error) {
			ctx.ui.notify(`rex-restart could not record this session: ${error}`, "warning");
		}
	});

	pi.on("session_shutdown", async (event) => {
		if (!file) return;
		// pi's own signal listener runs first and starts this shutdown, so wait for the signal to
		// reach onSignal before telling a quit from a kill.
		await new Promise((resolve) => setImmediate(resolve));
		for (const signal of SIGNALS) process.off(signal, onSignal);
		if (event.reason !== "quit" || signaled) return;
		try {
			// Another pi may have taken the pane over since (one suspended behind the other).
			if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid) rmSync(file);
		} catch {
			// No record, or unreadable: nothing to delete.
		}
	});
}
