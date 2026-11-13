/**
 * The child side of a subagent in a Rex tab. The parent loads this into the tab's pi with `-e`;
 * it does nothing without PI_SUBAGENT_DIR. It records whether the child is busy or idle, and its
 * latest answer, for the parent's `wait`, and turns messages the parent leaves in the inbox into
 * prompts: a new turn when idle, steering or a follow-up while busy. With `report` in its meta.json,
 * it also sends each new answer on: as a note in `reportTo`, the main agent's state repo, when the
 * parent was the main agent (../agent-state), else over the parent's session socket (../session-info),
 * retrying until the parent takes it.
 */

import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { addNote } from "../agent-state/state.ts";
import { SOCKET_DIR } from "../session-info/links.ts";
import { request, socketPath } from "../session-info/live.ts";
import { CHILD_ENV, pendingMessages, readMeta, readState, reportText, type State, textOf, writeState } from "./store.ts";

const POLL_MS = 500;
/** A message delivered to an idle tab that starts no run by now was a command, or failed. */
const SETTLE_MS = 3_000;
/** How often an undelivered report to a parent session is tried again. */
const REPORT_RETRY_MS = 10_000;

export default function subagentChild(pi: ExtensionAPI) {
	const found = process.env[CHILD_ENV];
	if (!found) return;
	const dir: string = found;
	let ctx: ExtensionContext | undefined;
	let timer: NodeJS.Timeout | undefined;
	// Kept across /reload, which loads this extension again.
	const previous = readState(dir);
	// Written at spawn, before the tab opened; later updates only add the Rex tab, checkout, and stop time.
	const meta = readMeta(dir);
	let started = previous?.started ?? false;
	let reply = previous?.reply;
	/** When a message went to an idle tab, until its run starts. */
	let deliveredAt: number | undefined;
	/** pi rejects prompts while compacting, so messages wait in the inbox. */
	let compacting = false;
	/** The answer the parent last took, so a turn with nothing new sends nothing. */
	let reported = previous?.reply;
	let reporting = false;
	let lastAttempt = 0;

	const record = (state: State["state"]) => writeState(dir, { state, pid: process.pid, started, ...(reply ? { reply } : {}) });

	function drain(): void {
		// The task from the command line goes first; anything sent before it starts waits for it.
		if (!ctx || !started || compacting) return;
		if (ctx.isIdle()) void report();
		// A prompt pi rejects before its run starts leaves nothing else to record that the tab is
		// idle again.
		if (deliveredAt !== undefined && ctx.isIdle() && Date.now() - deliveredAt > SETTLE_MS) {
			deliveredAt = undefined;
			record("idle");
		}
		for (const { file, message } of pendingMessages(dir)) {
			// Busy before the message leaves the inbox, so the parent's wait never sees idle and an
			// empty inbox in between and takes the previous answer for this one's.
			record("busy");
			const idle = ctx.isIdle();
			if (idle) deliveredAt = Date.now();
			// Skills and prompt templates expand as if typed into the tab. An extension command such as
			// /review would run in the tab with no event telling this bridge when it ends, so it goes to
			// the model as text; the tab has the same tools.
			const name = /^\/(\S+)/.exec(message.message)?.[1];
			const command = !!name && pi.getCommands().some((entry) => entry.source === "extension" && entry.name === name);
			try {
				// deliverAs only matters while busy, and keeps a run that starts meanwhile from rejecting
				// the message.
				pi.sendUserMessage(message.message, { deliverAs: message.delivery, expandPromptTemplates: !command });
			} finally {
				fs.rmSync(file, { force: true });
			}
			// A new run may not count as started yet; later messages wait for the next poll.
			if (idle) return;
		}
	}

	// session_start never fires during a run.
	pi.on("session_start", (_event, context) => {
		ctx = context;
		record("idle");
		timer = setInterval(drain, POLL_MS);
		timer.unref();
	});

	pi.on("agent_start", () => {
		started = true;
		deliveredAt = undefined;
		record("busy");
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		const text = textOf(event.message.content);
		const error = (event.message as { errorMessage?: string }).errorMessage;
		// Turns that only call tools keep the last answer that said something.
		if (!text && !error) return;
		reply = { text, ...(error ? { error } : {}) };
		record("busy");
	});

	/** Send the latest answer on if the parent hasn't taken it yet. Called after each turn and on every poll. */
	async function report(): Promise<void> {
		if (!meta?.report || !ctx || !reply || reply === reported || reporting || Date.now() - lastAttempt < REPORT_RETRY_MS) return;
		const sending = reply;
		const message = reportText(meta.name, meta.id, sending);
		const about = `subagent tab "${meta.name}"`;
		reporting = true;
		lastAttempt = Date.now();
		try {
			if (meta.reportTo) {
				addNote(meta.reportTo, { at: new Date().toISOString(), from: about, message });
				reported = sending;
			} else {
				const from = { sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, about, listening: true };
				// A parent that quit, or is between sessions, refuses or isn't there: try again later.
				const response = await request(socketPath(SOCKET_DIR, meta.parent), { v: 1, type: "send", message, mode: "followUp", from }).catch(() => undefined);
				if (response?.ok) reported = sending;
			}
		} catch {
			// The notes folder isn't writable right now; the next poll tries again.
		} finally {
			reporting = false;
		}
	}

	pi.on("agent_settled", () => {
		record("idle");
		lastAttempt = 0;
		void report();
	});

	pi.on("session_before_compact", () => {
		compacting = true;
	});
	pi.on("session_compact", () => {
		compacting = false;
	});
	pi.on("session_compact_failed", () => {
		compacting = false;
	});

	pi.on("session_shutdown", (event) => {
		if (timer) clearInterval(timer);
		timer = undefined;
		ctx = undefined;
		if (event.reason === "quit") record("exited");
	});
}
