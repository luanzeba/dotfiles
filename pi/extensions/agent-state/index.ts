/**
 * The main agent: a pi started in the state repo (default ~/beta/luan-agent-state, or PI_AGENT_STATE_DIR)
 * coordinates Luan's work through subagents and keeps it in that repo. README.md has the details.
 *
 * In that session this extension
 * - adds the main agent's instructions (main.md) to the system prompt,
 * - takes over messages from other sessions (../session-info) and subagent reports (../subagent) as
 *   note files, so nothing interrupts him and nothing is lost when the main agent restarts or starts a
 *   new session. They start a turn of their own once it's idle, or go with Luan's next prompt,
 * - gives the first prompt of every session the work overview and the memory index,
 * - commits and pushes the repo after every turn.
 *
 * `/status` works in every session: it shows the state repo's work full screen, to move through and open,
 * pulling it first unless the main agent runs in this very clone, so another machine sees what the main
 * agent wrote.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { INCOMING_EVENT, type IncomingRequest } from "../session-info/links.ts";
import { REPORT_SINK_EVENT, type ReportSinkRequest, shortPath } from "../subagent/store.ts";
import {
	addNote,
	claimMain,
	commitMessage,
	entryDetail,
	holdNotes,
	isMainSession,
	LOCK_FILE,
	loadItems,
	mainHolder,
	type Note,
	NOTE_TURN_TEXT,
	notesHeld,
	notesText,
	noteTurnDue,
	readNotes,
	releaseMain,
	removeNotes,
	snapshot,
	stateDir,
	statusList,
	statusView,
} from "./state.ts";
import { FULL_SCREEN, StatusScreen, type StatusSource } from "./ui.ts";

const MAIN_PROMPT = fs.readFileSync(fileURLToPath(new URL("./main.md", import.meta.url)), "utf8");
const SECTION = "agent-state";
const NOTES_TYPE = "agent-state-notes";
const NOTE_TURN_TYPE = "agent-state-note-turn";
const SNAPSHOT_TYPE = "agent-state-snapshot";
const GIT_TIMEOUT_MS = 20_000;
const PUSH_TIMEOUT_MS = 60_000;
const PULL_TIMEOUT_MS = 8_000;
/** Subagent tabs drop notes as files, so they're looked for this often: for the footer, and to start a turn. */
const NOTES_POLL_MS = 5_000;

export default function agentState(pi: ExtensionAPI) {
	const dir = stateDir();
	let main = false;
	let ctx: ExtensionContext | undefined;
	let syncError: string | undefined;
	let syncing: Promise<void> = Promise.resolve();
	let pollTimer: NodeJS.Timeout | undefined;
	/**
	 * A notes turn, from asking for it until it goes through or Luan prompts, with the notes it read.
	 * Meanwhile no other starts. If it fails or is stopped, notes are held (notesHeld) and, should the
	 * session or branch go away first, what it read goes back to files.
	 */
	let noteTurn: Note[] | undefined;

	/** ok only for a clean exit: pi.exec reports a timed-out command as exit code 0 with `killed`. */
	async function git(args: string[], timeout = GIT_TIMEOUT_MS): Promise<{ ok: boolean; out: string; error: string }> {
		const result = await pi.exec("git", ["-C", dir, ...args], { timeout });
		const ok = result.code === 0 && !result.killed;
		const error = ok ? "" : result.killed ? "timed out" : (result.stderr || result.stdout).trim().split("\n")[0] || `exit ${result.code}`;
		return { ok, out: result.stdout, error };
	}

	function footer(): void {
		if (!ctx?.hasUI || !main) return;
		const notes = readNotes(dir).length;
		const parts = ["main agent", ...(notes > 0 ? [`✉ ${notes} note${notes === 1 ? "" : "s"}${notesHeld(dir) ? " for your next message" : ""}`] : [])];
		if (syncError) parts.push(ctx.ui.theme.fg("warning", `state not pushed: ${syncError}`));
		ctx.ui.setStatus(SECTION, parts.join(" · "));
	}

	/**
	 * Start a turn for the waiting notes while nothing else goes on: the main agent is idle, Luan's editor
	 * is empty, and no note came in for a few seconds, so reports that land together make one turn. The
	 * notes go with it the way they go with a prompt (before_agent_start).
	 */
	function startNoteTurn(): void {
		if (!main || !ctx || noteTurn || notesHeld(dir) || !ctx.isIdle() || ctx.ui.getEditorText().trim()) return;
		if (!noteTurnDue(readNotes(dir).map(({ note }) => note))) return;
		noteTurn = [];
		pi.sendMessage({ customType: NOTE_TURN_TYPE, content: NOTE_TURN_TEXT, display: false }, { triggerTurn: true });
	}

	/** Commit whatever changed and push what's unpushed. One at a time. */
	function sync(): Promise<void> {
		syncing = syncing
			.then(async () => {
				const added = await git(["add", "-A"]);
				if (!added.ok) return void (syncError = added.error);
				const staged = await git(["diff", "--cached", "--name-only"]);
				const paths = staged.out.split("\n").filter(Boolean);
				if (paths.length > 0) {
					const committed = await git(["commit", "-q", "-m", commitMessage(paths)]);
					if (!committed.ok) return void (syncError = `commit failed: ${committed.error}`);
				}
				const ahead = await git(["rev-list", "--count", "@{upstream}..HEAD"]);
				if (!ahead.ok) return void (syncError = "no upstream to push to");
				if (Number(ahead.out.trim()) > 0) {
					const pushed = await git(["push", "-q"], PUSH_TIMEOUT_MS);
					syncError = pushed.ok ? undefined : `push failed: ${pushed.error}`;
				} else syncError = undefined;
			})
			.catch((error) => {
				syncError = error instanceof Error ? error.message : String(error);
			})
			.finally(footer);
		return syncing;
	}

	pi.events.on(INCOMING_EVENT, (event) => {
		if (!main) return;
		const request = event as IncomingRequest;
		const from = request.from;
		const who = from ? `@@${from.token ?? from.sessionId.slice(0, 8)}${from.about ? ` (${from.about.slice(0, 80)})` : ""}` : "a script";
		addNote(dir, { at: new Date().toISOString(), from: who, message: request.message, ...(from?.listening ? { replyTo: from.sessionId } : {}) });
		// Only once the note is on disk: if writing it threw, the message goes the usual way.
		request.taken = true;
		footer();
	});

	pi.events.on(REPORT_SINK_EVENT, (event) => {
		if (main) (event as ReportSinkRequest).dir = dir;
	});

	pi.on("session_start", (event, context) => {
		ctx = context;
		main = false;
		if (context.mode !== "tui" || !isMainSession(context.cwd, dir)) {
			// This pi may have been the main agent before switching to a session elsewhere (/resume).
			releaseMain(dir);
			return;
		}
		const holder = claimMain(dir);
		if (holder !== undefined) {
			context.ui.notify(`The main agent already runs in ${shortPath(dir)} (pid ${holder}), so this pi is an ordinary session. If that's wrong, delete ${LOCK_FILE} there.`, "warning");
			return;
		}
		main = true;
		// pi keeps queued messages across a reload, so the snapshot from before it is still waiting.
		if (event.reason !== "reload") pi.sendMessage({ customType: SNAPSHOT_TYPE, content: snapshot(dir), display: false }, { deliverAs: "nextTurn" });
		footer();
		pollTimer ??= setInterval(() => {
			footer();
			startNoteTurn();
		}, NOTES_POLL_MS);
		pollTimer.unref();
	});

	pi.on("before_agent_start", (event) => {
		if (!main) return;
		event.systemPromptOptions.sections[SECTION] = MAIN_PROMPT;
		const notes = readNotes(dir);
		// Exactly the files read here: a note that lands meanwhile waits for the next turn.
		removeNotes(notes.map(({ file }) => file));
		// Luan's prompt goes on in this session, which has what a stopped notes turn read.
		if (event.messageType === "user") {
			noteTurn = undefined;
			holdNotes(dir, false);
		} else if (event.message.customType === NOTE_TURN_TYPE) noteTurn = notes.map(({ note }) => note);
		footer();
		if (notes.length > 0) return { message: { customType: NOTES_TYPE, content: notesText(notes.map(({ note }) => note)), display: true } };
	});

	// pi skips this for an aborted run, and the outcome is the last response's, after any retries.
	pi.on("agent_before_settle", (event) => {
		if (event.outcome === "completed") noteTurn = undefined;
	});

	pi.on("agent_settled", () => {
		if (!main) return;
		// A notes turn that failed or that Luan stopped: the next would do the same, without him.
		if (noteTurn) holdNotes(dir, true);
		void sync();
	});

	/** A stopped notes turn's notes go back to files, so none is lost with the session or branch that read it. */
	function giveBack(): void {
		for (const note of noteTurn ?? []) addNote(dir, note);
		noteTurn = undefined;
	}

	pi.on("session_tree", (_event, context) => {
		if (!main || !noteTurn?.length) return;
		const text = notesText(noteTurn);
		// Only if the move left them behind: otherwise Luan's next prompt would bring them twice.
		if (!context.sessionManager.getBranch().some((entry) => entry.type === "custom_message" && entry.customType === NOTES_TYPE && entry.content === text)) giveBack();
	});

	pi.on("session_shutdown", async (event) => {
		// First: a notes turn that started now would take notes into a session that's ending.
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = undefined;
		if (main) {
			// A reload goes on in this session. After quitting, the next one may be new (`agent --new`); a
			// resumed one gets these twice with Luan's next prompt, which beats never.
			if (event.reason !== "reload") giveBack();
			await Promise.race([sync(), new Promise((resolve) => setTimeout(resolve, 15_000).unref())]);
			// A new, resumed, or forked session in this pi claims it again.
			if (event.reason === "quit") releaseMain(dir);
		}
		main = false;
		ctx = undefined;
	});

	pi.registerCommand("status", {
		description: "Show the work the main agent is tracking (what needs you, what's in progress, what's landed or done) and read each work file",
		handler: async (_args, context) => {
			if (!fs.existsSync(path.join(dir, "work")) && !fs.existsSync(path.join(dir, ".git"))) {
				context.ui.notify(`No agent state at ${dir}. Clone luan-agent-state there, or set PI_AGENT_STATE_DIR.`, "warning");
				return;
			}
			let freshness: string;
			if (main) freshness = syncError ? `not pushed: ${syncError}` : "this is the main agent";
			else if (mainHolder(dir) !== undefined) freshness = "the main agent runs in this clone";
			else {
				const pulled = await git(["pull", "--ff-only", "-q"], PULL_TIMEOUT_MS);
				// A time rather than "just now": the list stays open, and only the main agent's clone changes under it.
				freshness = pulled.ok ? `pulled at ${new Date().toTimeString().slice(0, 5)}` : `couldn't pull (${pulled.error}); showing the local copy`;
				const last = await git(["log", "-1", "--format=%cr"], 3_000);
				if (last.ok && last.out.trim()) freshness += `, last change ${last.out.trim()}`;
			}
			const notes = () => (main ? readNotes(dir) : []);
			const title = `Work · ${shortPath(dir)} · ${freshness}`;
			if (context.mode !== "tui") {
				// RPC has no overlays and its stdout is the protocol; print mode has neither problem.
				const lines = statusView(loadItems(dir), { notes: notes() });
				if (context.hasUI) context.ui.notify([title, ...lines].join("\n"), "info");
				else console.log(lines.join("\n"));
				return;
			}
			const source: StatusSource = { title, load: () => statusList(loadItems(dir), { notes: notes() }), open: (entry) => entryDetail(dir, entry) };
			await context.ui.custom<void>((tui, theme, keys, done) => new StatusScreen(tui, theme, keys, source, done), { overlay: true, overlayOptions: FULL_SCREEN });
		},
	});
}
