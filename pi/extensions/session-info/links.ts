/**
 * Other sessions from inside this one: `@@` mentions in the editor, `session_list` and
 * `session_read` to find and read sessions, and `session_send` to message a live one over its
 * socket (see live.ts). See README.md.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { type Delivery, type Handler, listen, liveSessions, MAX_MESSAGE_CHARS, request, type Sender, type SendMode, socketPath, type Status } from "./live.ts";
import {
	aboutOf,
	ago,
	describeSession,
	dropdownItems,
	fileOf,
	findMentions,
	incomingText,
	type KnownSession,
	knownSessions,
	listEntry,
	type MentionRow,
	mentionNote,
	mentionProvider,
	place,
	searchSessions,
	sessionsForToken,
	shortToken,
} from "./mentions.ts";
import { textOf, userText } from "./refs.ts";
import { scanSessionFile, type SessionIndex, type SessionRecord, SUMMARY_TYPE } from "./store.ts";
import { readTranscript, renderPage } from "./transcript.ts";

/** Custom entry with the note for a prompt that mentions sessions; see the context_with_system hook. */
const MENTION_TYPE = "session-mention";
/** Custom message a session_send delivers. */
const MESSAGE_TYPE = "session-message";
const SOCKET_DIR = path.join(getAgentDir(), "session-sockets");
/** Reuse an index refresh this recent instead of statting every session file again. */
const INDEX_MAX_AGE_MS = 3_000;
/** The dropdown shows what's indexed so far rather than wait longer than this for a refresh. */
const DROPDOWN_WAIT_MS = 400;
/** A mention note waits this long for a refresh, so a first full index build can't hold up a turn. */
const NOTE_WAIT_MS = 2_000;
const LIVE_MAX_AGE_MS = 2_000;
/** Tools accept shorter id prefixes than mentions do; ambiguity is reported. */
const TOOL_MIN_PREFIX = 4;

interface MentionEntry {
	/** The user message's timestamp: notes are matched to messages by it. */
	timestamp: number;
	content: string;
	rows: MentionRow[];
}

interface MessageDetails {
	from?: Sender;
	delivery: Delivery;
	message: string;
}

interface SendDetails {
	token: string;
	delivery: Delivery;
}

const DELIVERY_TEXT: Record<Delivery, string> = {
	started: "it was idle and started a turn on it",
	steered: "it was busy and gets it after its current tool calls",
	followUp: "it was busy and gets it when it finishes its current work",
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

function box(theme: Theme, outputPad: number, text: string): Box {
	const component = new Box(outputPad, 1, (line) => theme.bg("customMessageBg", line));
	component.addChild(new Text(text, 0, 0));
	return component;
}

export default function sessionLinks(pi: ExtensionAPI, indexFor: (ctx: ExtensionContext) => SessionIndex) {
	/** The live context, for socket requests that arrive outside any pi event. */
	let current: ExtensionContext | undefined;
	let server: { close: () => void } | undefined;
	/** Stops a warm-up refresh when the session goes away. */
	const shutdown = new AbortController();
	let lastRefresh: { at: number; records: SessionRecord[] } | undefined;
	let refreshing: Promise<SessionRecord[]> | undefined;
	let liveCache: { at: number; sessions: Promise<Map<string, Status>> } | undefined;
	/** Mention notes by the timestamp of the user message they belong to. */
	const notes = new Map<number, string>();
	const checked = new Set<number>();
	/** Messages from before this instance started were checked by an earlier one, if ever. */
	const startedAt = Date.now();

	/** Every indexed session, refreshed at most every few seconds. */
	function records(ctx: ExtensionContext): Promise<SessionRecord[]> {
		if (lastRefresh && Date.now() - lastRefresh.at < INDEX_MAX_AGE_MS) return Promise.resolve(lastRefresh.records);
		const index = indexFor(ctx);
		refreshing ??= index
			.refresh(undefined, shutdown.signal)
			.catch(() => index.list())
			.then((list) => {
				lastRefresh = { at: Date.now(), records: list };
				refreshing = undefined;
				return list;
			});
		return refreshing;
	}

	function live(maxAge = LIVE_MAX_AGE_MS): Promise<Map<string, Status>> {
		if (!liveCache || Date.now() - liveCache.at > maxAge) liveCache = { at: Date.now(), sessions: liveSessions(SOCKET_DIR) };
		return liveCache.sessions;
	}

	async function sessions(ctx: ExtensionContext, liveMaxAge?: number): Promise<KnownSession[]> {
		const [list, liveMap] = await Promise.all([records(ctx), live(liveMaxAge)]);
		return knownSessions(list, liveMap);
	}

	/** Like sessions(), but settles for what's indexed so far when a refresh takes longer than `waitMs`. */
	async function sessionsSoon(ctx: ExtensionContext, waitMs: number): Promise<KnownSession[]> {
		const index = indexFor(ctx);
		await index.load();
		const [list, liveMap] = await Promise.all([Promise.race([records(ctx), delay(waitMs).then(() => index.list())]), live()]);
		return knownSessions(list, liveMap);
	}

	/** This session in words, the way other sessions' dropdowns describe it. */
	function selfAbout(ctx: ExtensionContext): string | undefined {
		let summary: string | undefined;
		let first: string | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === SUMMARY_TYPE) summary = (entry.data as { summary?: string })?.summary ?? summary;
			else if (!first && entry.type === "message" && entry.message.role === "user") first = userText((entry.message as { content?: unknown }).content);
		}
		return (summary ?? pi.getSessionName() ?? first)?.replace(/\s+/g, " ").trim().slice(0, 300) || undefined;
	}

	function context(): ExtensionContext {
		if (!current) throw new Error("this session is shutting down");
		return current;
	}

	/** Messages that came while pi was busy with no run to steer into: compacting, summarizing a /tree branch. */
	const held: { message: string; mode: SendMode; from: Sender | undefined }[] = [];
	let holdTimer: NodeJS.Timeout | undefined;

	/**
	 * Hand a message to pi: start a turn when idle, steer or queue it while a run is going. Returns
	 * undefined when neither works yet. pi isn't idle during a compaction or a /tree summary either,
	 * but has no run then, and a triggered turn would start in the middle of it.
	 */
	function deliver(message: string, mode: SendMode, from: Sender | undefined): Delivery | undefined {
		const ctx = context();
		const delivery: Delivery | undefined = ctx.isIdle() ? "started" : ctx.signal ? (mode === "followUp" ? "followUp" : "steered") : undefined;
		if (!delivery) return undefined;
		const details: MessageDetails = { from, delivery, message };
		// pi only looks at deliverAs while a run is going; an idle session starts a turn.
		pi.sendMessage({ customType: MESSAGE_TYPE, content: incomingText(message, from), display: true, details }, { triggerTurn: true, deliverAs: mode });
		return delivery;
	}

	function deliverHeld(): void {
		while (held.length > 0 && current && deliver(held[0].message, held[0].mode, held[0].from)) held.shift();
		if (held.length === 0 && holdTimer) {
			clearInterval(holdTimer);
			holdTimer = undefined;
		}
	}

	const handler: Handler = {
		status() {
			const ctx = context();
			return {
				sessionId: ctx.sessionManager.getSessionId(),
				file: ctx.sessionManager.getSessionFile(),
				cwd: ctx.cwd,
				idle: ctx.isIdle() && !ctx.hasPendingMessages(),
				pid: process.pid,
				about: selfAbout(ctx),
			};
		},
		send(message, mode, from) {
			// Earlier held messages go first.
			const delivery = held.length === 0 ? deliver(message, mode, from) : undefined;
			if (delivery) return delivery;
			held.push({ message, mode, from });
			holdTimer ??= setInterval(deliverHeld, 500);
			return "followUp";
		},
	};

	async function startListening(ctx: ExtensionContext): Promise<void> {
		// `--no-session` sessions can't be read or found, so they don't listen either.
		if (!ctx.sessionManager.getSessionFile()) return;
		try {
			const listening = await listen(SOCKET_DIR, ctx.sessionManager.getSessionId(), handler);
			// The session may have been replaced while the socket was opening.
			if (!current) listening.close();
			else server = listening;
		} catch (error) {
			if (current) ctx.ui.notify(`Other sessions can't message this one: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	}

	pi.on("session_start", (_event, ctx) => {
		current = ctx;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== MENTION_TYPE) continue;
			const data = entry.data as MentionEntry | undefined;
			if (typeof data?.timestamp === "number" && typeof data.content === "string") notes.set(data.timestamp, data.content);
		}
		// Print-mode and RPC children (reviewers, subagents, helpers) don't listen or get the dropdown.
		if (ctx.mode !== "tui") return;
		void startListening(ctx);
		ctx.ui.addAutocompleteProvider((provider) => mentionProvider(provider, (query, signal) => dropdown(ctx, query, signal)));
		// Warm the index so the first `@@` shows sessions started since it was last refreshed.
		void records(ctx);
	});

	pi.on("session_shutdown", () => {
		shutdown.abort();
		// Closing removes the socket file right away, before the next session's session_start.
		server?.close();
		server = undefined;
		current = undefined;
		// Like steered messages pi hasn't delivered yet, held ones go with the session.
		if (holdTimer) clearInterval(holdTimer);
	});

	async function dropdown(ctx: ExtensionContext, query: string, signal: AbortSignal) {
		try {
			const known = await sessionsSoon(ctx, DROPDOWN_WAIT_MS);
			if (signal.aborted) return [];
			return dropdownItems(known, query, ctx.sessionManager.getSessionId());
		} catch {
			return [];
		}
	}

	/**
	 * Tell the agent about the sessions a prompt mentions, right after the prompt. Done per request
	 * rather than with a queued message: pi delivers steering one message at a time by default, so a
	 * note queued next to a steered prompt would get a turn of its own. The note is computed once,
	 * saved as a custom entry (shown in the TUI, never sent by itself), and inserted after its prompt
	 * in every request, so the request stays the same from turn to turn and keeps the prompt cache.
	 * This hook sees system messages in place; the plain `context` hook would fold them into the head.
	 */
	pi.on("context_with_system", async (event, ctx) => {
		for (const message of event.messages) {
			if (message.role !== "user" || typeof message.timestamp !== "number") continue;
			const { timestamp } = message;
			if (notes.has(timestamp) || checked.has(timestamp) || timestamp < startedAt) continue;
			checked.add(timestamp);
			const text = userText(message.content);
			if (!text.includes("@@") || findMentions(text).length === 0) continue;
			const note = mentionNote(text, await sessionsSoon(ctx, NOTE_WAIT_MS), ctx.sessionManager.getSessionId());
			if (!note) continue;
			notes.set(timestamp, note.content);
			pi.appendEntry<MentionEntry>(MENTION_TYPE, { timestamp, content: note.content, rows: note.rows });
		}
		const noted = (message: (typeof event.messages)[number]) => message.role === "user" && notes.has(message.timestamp);
		if (!event.messages.some(noted)) return;
		return {
			messages: event.messages.flatMap((message) =>
				noted(message)
					? [message, { role: "custom" as const, customType: MENTION_TYPE, content: notes.get(message.timestamp)!, display: false, timestamp: message.timestamp }]
					: [message],
			),
		};
	});

	pi.registerEntryRenderer<MentionEntry>(MENTION_TYPE, (entry, { expanded }, theme) => {
		if (expanded) return box(theme, 1, theme.fg("dim", entry.data?.content ?? ""));
		const lines = (entry.data?.rows ?? []).map((row) => {
			const token = theme.fg("accent", `@@${row.token}`);
			if (row.matches === 0) return `${token} ${theme.fg("warning", "matches no session")}`;
			const facts = [row.activity ? ago(row.activity) : "", row.cwd ? place(row.cwd) : "", row.matches > 1 ? `${row.matches} sessions match` : ""].filter(Boolean);
			const liveMark = row.live ? `${theme.fg("success", "●")} ` : "";
			return `${token} ${liveMark}${row.about || "(no messages yet)"} ${theme.fg("dim", `· ${facts.join(" · ")}`)}`;
		});
		return box(theme, 1, lines.join("\n"));
	});

	pi.registerMessageRenderer<MessageDetails>(MESSAGE_TYPE, (message, { expanded, outputPad }, theme) => {
		const details = message.details;
		const from = details?.from;
		const who = from ? `@@${from.token ?? from.sessionId.slice(0, 8)}${from.cwd ? ` (${place(from.cwd)})` : ""}` : "another session";
		const how = details ? { started: "started a turn", steered: "steered", followUp: "queued as a follow-up" }[details.delivery] : "";
		const head = `${theme.fg("accent", `✉ Message from ${who}`)}${how ? theme.fg("dim", ` · ${how}`) : ""}`;
		const lines = (details?.message ?? String(message.content)).split("\n");
		const body = expanded || lines.length <= 8 ? lines : [...lines.slice(0, 8), theme.fg("dim", `… ${lines.length - 8} more lines`)];
		return box(theme, outputPad, [head, ...(expanded && from?.about ? [theme.fg("dim", from.about)] : []), ...body].join("\n"));
	});

	/**
	 * The session a tool argument names (a file path, an `@@` token, an id, or an id prefix), its
	 * token, and every known id, for the sender's own token.
	 */
	async function resolve(ctx: ExtensionContext, input: string, liveMaxAge?: number): Promise<{ session: KnownSession; token: string; ids: string[] }> {
		const value = input.trim();
		const known = await sessions(ctx, liveMaxAge);
		const ids = known.map((session) => session.id);
		const found = (session: KnownSession) => ({ session, token: shortToken(session.id, ids), ids });
		if (value.includes("/") || value.endsWith(".jsonl")) {
			const file = path.resolve(ctx.cwd, value.replace(/^~(?=\/|$)/, os.homedir()));
			const indexed = known.find((session) => session.record?.path === file);
			if (indexed) return found(indexed);
			// A file outside the sessions dir, or a copy such as `.pre-recovery.jsonl`.
			const stat = await fs.promises.stat(file).catch(() => undefined);
			if (!stat) throw new Error(`No session file at ${file}`);
			const record = await scanSessionFile(file, stat);
			if (!record) throw new Error(`${file} isn't a pi session file`);
			return found({ id: record.id, record, live: known.find((session) => session.id === record.id)?.live });
		}
		const matches = sessionsForToken(value, known, TOOL_MIN_PREFIX);
		if (matches.length === 1) return found(matches[0]);
		if (matches.length === 0) throw new Error(`No session matches ${JSON.stringify(value)}. Find one with session_list.`);
		const now = Date.now();
		throw new Error(
			`${matches.length} sessions match ${JSON.stringify(value)}; use a longer prefix:\n\n${matches.map((session) => listEntry(session, shortToken(session.id, ids), now)).join("\n")}`,
		);
	}

	pi.registerTool({
		name: "session_list",
		label: "Session list",
		description:
			"List pi sessions, newest first: what each is about, its cwd, last activity, and whether it's live (open in a running pi, so session_send can reach it). A query matches the way /resume-search does: an MR or PR number, a Linear ticket, a URL, or words from the session's summary, messages, or cwd. Each session is listed with an @@ token that session_read and session_send accept.",
		promptSnippet: "List pi sessions, live ones or ones matching a query, to read or message one",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "MR or PR number, ticket, URL, or words; omit for the newest sessions" })),
			live: Type.Optional(Type.Boolean({ description: "Only sessions open in a running pi" })),
			limit: Type.Optional(Type.Number({ description: "Most sessions to list; default 15, at most 50" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const known = await sessions(ctx, 0);
			const self = ctx.sessionManager.getSessionId();
			const candidates = known.filter((session) => session.id !== self && (!params.live || session.live));
			const limit = Math.min(Math.max(Math.floor(params.limit ?? 15), 1), 50);
			const shown = searchSessions(candidates, params.query ?? "").slice(0, limit);
			const ids = known.map((session) => session.id);
			const now = Date.now();
			const what = `${params.live ? "live " : ""}session${shown.length === 1 ? "" : "s"}${params.query ? ` matching ${JSON.stringify(params.query)}` : ""}`;
			const text = shown.length
				? `${shown.length} ${what}, ${params.query ? "best match" : "newest"} first:\n\n${shown.map((session) => listEntry(session, shortToken(session.id, ids), now)).join("\n")}`
				: `No ${what}.`;
			return { content: [{ type: "text", text }], details: undefined };
		},
		renderCall(args, theme) {
			const filters = [args.live ? "live" : "", args.query ? JSON.stringify(args.query) : ""].filter(Boolean).join(" ");
			return new Text(`${theme.fg("toolTitle", theme.bold("session_list"))} ${theme.fg("muted", filters)}`, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const text = textOf(result.content);
			return new Text(expanded ? text : theme.fg("dim", text.split("\n")[0]), 0, 0);
		},
	});

	pi.registerTool({
		name: "session_read",
		label: "Session read",
		description:
			"Read another pi session's transcript, compactly: numbered items for user messages, assistant text, one line per tool call with a trimmed result, compactions, errors, and model changes. The header has the session's id, file, cwd, what it's about, last activity, and whether it's live. Pages at about 24,000 characters; continue with `from`. Filter with `query`, or take the `last` N items; `full` keeps long messages whole.",
		promptSnippet: "Read another pi session's transcript, filtered or paged, instead of parsing its .jsonl file",
		promptGuidelines: [
			"Use session_read, not find, jq, rg, or read on files under ~/.pi/agent/sessions, to look at another pi session.",
		],
		parameters: Type.Object({
			session: Type.String({ description: "An @@ token, a session id or id prefix, or the path of a session .jsonl file" }),
			query: Type.Optional(Type.String({ description: "Only items containing this text, case-insensitively" })),
			last: Type.Optional(Type.Number({ description: "Only the last N items (of the matches, with a query)" })),
			from: Type.Optional(Type.Number({ description: "Start at item number N, to read the next page" })),
			full: Type.Optional(Type.Boolean({ description: "Keep long messages whole, and tool output up to 4,000 characters" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { session, token } = await resolve(ctx, params.session);
			const file = fileOf(session);
			const self = ctx.sessionManager.getSessionId();
			const now = Date.now();
			const header = describeSession(session, now, self);
			if (!file || !fs.existsSync(file)) {
				return { content: [{ type: "text", text: `${header}\n\nNothing is on disk for it yet.` }], details: undefined };
			}
			const transcript = await readTranscript(file, { full: params.full });
			const page = renderPage(transcript.items, { query: params.query, from: params.from, last: params.last });
			const total = transcript.items.length;
			const compactions = transcript.items.filter((item) => item.kind === "compaction").length;
			const range = page.shown.length ? `items #${page.shown[0].n}–#${page.shown.at(-1)!.n}` : "no items";
			const facts = [
				params.query ? `${page.matched} of ${total} items contain ${JSON.stringify(params.query)}; showing ${range}` : `Showing ${range} of ${total}`,
				compactions ? `${compactions} compaction${compactions > 1 ? "s" : ""}` : "",
				transcript.offBranch ? `${transcript.offBranch} entries on other /tree branches left out` : "",
			].filter(Boolean);
			const next = page.next ? `\nMore: session_read with from: ${page.next}${params.query ? " and the same query" : ""}.` : "";
			const text = `@@${token} is ${header}\n\n${facts.join(". ")}.${next}\n\n${page.text || "(nothing to show)"}`;
			return { content: [{ type: "text", text }], details: undefined };
		},
		renderCall(args, theme) {
			const options = [args.query ? `query ${JSON.stringify(args.query)}` : "", args.last ? `last ${args.last}` : "", args.from ? `from #${args.from}` : "", args.full ? "full" : ""];
			return new Text(
				`${theme.fg("toolTitle", theme.bold("session_read"))} ${theme.fg("accent", args.session ?? "")} ${theme.fg("muted", options.filter(Boolean).join(", "))}`,
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme) {
			const text = textOf(result.content);
			if (expanded) return new Text(text, 0, 0);
			const summary = text.split("\n\n")[1] ?? text.split("\n")[0];
			return new Text(theme.fg("dim", summary.split("\n")[0]), 0, 0);
		},
	});

	pi.registerTool({
		name: "session_send",
		label: "Session send",
		description:
			"Send a message to another live pi session (one open in a running pi; session_list with live: true lists them). It arrives as a message from this session: an idle session starts working on it, a busy one gets it after its current tool calls (steer) or when it finishes (followUp). Both transcripts record it.",
		promptSnippet: "Send a message to another live pi session",
		promptGuidelines: [
			"Use session_send only when the user asks you to tell or ask another session something, or when a session message asks you for an answer.",
		],
		parameters: Type.Object({
			session: Type.String({ description: "An @@ token, a session id, or an id prefix" }),
			message: Type.String({ description: "The message, written for the other session's agent" }),
			mode: Type.Optional(
				StringEnum(["steer", "followUp"] as const, {
					description: "For a busy session: steer (default) delivers after its current tool calls; followUp waits until it finishes",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<{ content: { type: "text"; text: string }[]; details: SendDetails }> {
			if (!params.message.trim()) throw new Error("The message is empty");
			if (params.message.length > MAX_MESSAGE_CHARS) throw new Error(`The message is longer than ${MAX_MESSAGE_CHARS} characters`);
			const { session: target, token, ids } = await resolve(ctx, params.session, 0);
			const self = ctx.sessionManager.getSessionId();
			if (target.id === self) throw new Error("That's this session");
			if (!target.live) throw new Error(`@@${token} isn't live: no running pi has it open. session_list with live: true lists the ones that are.`);
			const from: Sender = {
				sessionId: self,
				token: shortToken(self, ids),
				cwd: ctx.cwd,
				about: selfAbout(ctx),
				listening: Boolean(server),
			};
			const response = await request(socketPath(SOCKET_DIR, target.id), { v: 1, type: "send", message: params.message, mode: params.mode, from });
			if (!response.ok) throw new Error(`@@${token} refused the message: ${response.error}`);
			const { delivery } = response;
			if (!delivery) throw new Error(`@@${token} gave an answer without a delivery`);
			const about = aboutOf(target);
			return {
				content: [{ type: "text", text: `Delivered to @@${token}${about ? ` (${about})` : ""}: ${DELIVERY_TEXT[delivery]}.` }],
				details: { token, delivery },
			};
		},
		renderCall(args, theme) {
			const lines = String(args.message ?? "").split("\n");
			const preview = lines.slice(0, 3).join("\n") + (lines.length > 3 ? theme.fg("dim", `\n… ${lines.length - 3} more lines`) : "");
			const mode = args.mode === "followUp" ? theme.fg("muted", " (follow-up)") : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("session_send → "))}${theme.fg("accent", args.session ?? "")}${mode}\n${theme.fg("dim", preview)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as SendDetails | undefined;
			if (!details) return new Text(theme.fg("error", textOf(result.content)), 0, 0);
			return new Text(`${theme.fg("success", "✓")} ${theme.fg("dim", `@@${details.token}: ${DELIVERY_TEXT[details.delivery]}`)}`, 0, 0);
		},
	});
}
