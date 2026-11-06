/**
 * `@@` session mentions: the tokens the editor dropdown inserts, the dropdown itself, and the note
 * the agent gets about each mentioned session. No pi runtime imports, so `node --test` can run
 * this directly.
 */
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import * as os from "node:os";
import * as path from "node:path";
import type { Sender, Status } from "./live.ts";
import { searchRecords, type SessionRecord, uniqueSessions } from "./store.ts";

/**
 * Session ids are UUIDv7, so their first 8 hex digits change only every ~65 seconds and sessions
 * started together share them. Tokens start at 8 and grow until no other session shares them.
 */
export const MIN_TOKEN = 8;
/** `@@` and what was typed after it, right before the cursor. Same boundaries as pi's `@file`. */
const QUERY_RE = /(?:^|[\s([{<`])@@([^\s@]*)$/;
/** `@@<session id or prefix>` in a message. */
const MENTION_RE = /(?<![\w@])@@([A-Za-z0-9][\w.-]*)/g;
const MAX_ROWS = 50;

/** What we know about one session: its index record, its socket, or both. */
export interface KnownSession {
	id: string;
	record?: SessionRecord;
	live?: Status;
}

export function knownSessions(records: SessionRecord[], live: Map<string, Status>): KnownSession[] {
	const byId = new Map<string, KnownSession>();
	for (const record of uniqueSessions(records)) byId.set(record.id, { id: record.id, record });
	for (const [id, status] of live) byId.set(id, { ...byId.get(id), id, live: status });
	return [...byId.values()];
}

/** Distinct `@@` tokens in a message, without trailing punctuation. */
export function findMentions(text: string): string[] {
	const tokens = new Set<string>();
	for (const m of text.matchAll(MENTION_RE)) {
		const token = m[1].replace(/[.-]+$/, "");
		if (token) tokens.add(token);
	}
	return [...tokens];
}

/** Sessions a token names: an exact id, or a prefix of at least `minLength` characters. */
export function sessionsForToken(token: string, sessions: KnownSession[], minLength = MIN_TOKEN): KnownSession[] {
	const wanted = token.replace(/^@@/, "").toLowerCase();
	const exact = sessions.filter((session) => session.id.toLowerCase() === wanted);
	if (exact.length > 0 || wanted.length < minLength) return exact;
	return sessions.filter((session) => session.id.toLowerCase().startsWith(wanted));
}

/** The shortest prefix of `id`, at least MIN_TOKEN long, that no other id starts with. */
export function shortToken(id: string, ids: Iterable<string>): string {
	const others = [...ids].filter((other) => other !== id);
	let length = Math.min(MIN_TOKEN, id.length);
	while (length < id.length && others.some((other) => other.startsWith(id.slice(0, length)))) length++;
	// `01a1b345-` reads as a typo; take the next character too.
	if (id[length - 1] === "-" && length < id.length) length++;
	return id.slice(0, length);
}

/** In words, what the session is about: its summary, name, or first message. */
export function aboutOf(session: KnownSession): string {
	const record = session.record;
	return (session.live?.about ?? record?.summary ?? record?.name ?? record?.firstMessage ?? "").replace(/\s+/g, " ").trim();
}

export const cwdOf = (session: KnownSession) => session.live?.cwd ?? session.record?.cwd ?? "";
export const fileOf = (session: KnownSession) => session.record?.path ?? session.live?.file;
const activityOf = (session: KnownSession, now: number) => session.record?.modified ?? (session.live ? now : 0);

/** `~/beta/config-service/.worktrees/cus-1203` -> `config-service ⎇ cus-1203`; otherwise the folder name. */
export function place(cwd: string): string {
	const worktree = /^(.*)\/\.worktrees\/([^/]+)/.exec(cwd);
	if (worktree) return `${path.basename(worktree[1])} ⎇ ${worktree[2]}`;
	if (cwd === os.homedir()) return "~";
	return path.basename(cwd) || cwd;
}

/** `5m`, `3h`, `2d`, `6w`, `4mo`, `1y`. */
export function ago(ms: number, now = Date.now()): string {
	const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 14) return `${days}d`;
	if (days < 60) return `${Math.floor(days / 7)}w`;
	if (days < 365) return `${Math.floor(days / 30)}mo`;
	return `${Math.floor(days / 365)}y`;
}

function when(ms: number, now: number): string {
	const date = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
	return `${stamp} (${ago(ms, now)} ago)`;
}

const liveText = (status: Status | undefined) => (status ? `yes, ${status.idle ? "idle" : "busy"}` : "no");

/**
 * Sessions matching a query the way /resume-search does, best first; newest first without one.
 * Live sessions that haven't written a file yet aren't indexed, so they come first and match only on
 * what their socket says.
 */
export function searchSessions(sessions: KnownSession[], query: string): KnownSession[] {
	const byId = new Map(sessions.map((session) => [session.id, session]));
	const wanted = query.trim().toLowerCase();
	const unindexed = sessions.filter(
		(session) => !session.record && (!wanted || `${session.id} ${aboutOf(session)} ${cwdOf(session)}`.toLowerCase().includes(wanted)),
	);
	const records = sessions.flatMap((session) => (session.record ? [session.record] : []));
	return [...unindexed, ...searchRecords(records, query).map((hit) => byId.get(hit.record.id)!)];
}

/**
 * Dropdown rows for `@@<query>`. The current session and sessions without a user message (unless
 * live) are left out.
 */
export function dropdownItems(sessions: KnownSession[], query: string, currentId: string | undefined, now = Date.now()): AutocompleteItem[] {
	const candidates = sessions.filter((session) => session.id !== currentId && ((session.record?.userMessages ?? 0) > 0 || session.live));
	const ids = sessions.map((session) => session.id);
	return searchSessions(candidates, query)
		.slice(0, MAX_ROWS)
		.map((session) => {
			const token = shortToken(session.id, ids);
			const activity = activityOf(session, now);
			return {
				value: `@@${token}`,
				label: `${session.live ? "●" : " "} ${(activity ? ago(activity, now) : "").padStart(3)}  ${place(cwdOf(session))}`,
				description: aboutOf(session) || "(no messages yet)",
			};
		});
}

/**
 * Stack the `@@` dropdown on pi's provider. Everything that isn't `@@`, `@file` included, passes
 * through. Pi's provider also inserts the picked token, as it does any `@` completion: the value and
 * a space.
 */
export function mentionProvider(
	current: AutocompleteProvider,
	suggest: (query: string, signal: AbortSignal) => Promise<AutocompleteItem[]>,
): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const match = QUERY_RE.exec((lines[cursorLine] ?? "").slice(0, cursorCol));
			if (!match) return current.getSuggestions(lines, cursorLine, cursorCol, options);
			const items = await suggest(match[1], options.signal);
			if (options.signal.aborted || items.length === 0) return null;
			return { prefix: `@@${match[1]}`, items };
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

/** One mention as the TUI shows it. */
export interface MentionRow {
	token: string;
	matches: number;
	about?: string;
	cwd?: string;
	activity?: number;
	live?: boolean;
}

export interface MentionNote {
	content: string;
	rows: MentionRow[];
}

/** How the agent sees one session: everything it needs to read it or message it without searching. */
export function describeSession(session: KnownSession, now: number, currentId?: string): string {
	const file = fileOf(session);
	const activity = activityOf(session, now);
	const about = aboutOf(session);
	return [
		`session ${session.id}${session.id === currentId ? " (this session)" : ""}`,
		`- file: ${file ?? "none on disk yet"}`,
		`- cwd: ${cwdOf(session) || "unknown"}`,
		...(about ? [`- about: ${about}`] : []),
		...(activity ? [`- last activity: ${when(activity, now)}`] : []),
		`- live: ${liveText(session.live)}${session.live && session.id !== currentId ? "; session_send can message it" : ""}`,
	].join("\n");
}

/**
 * The note added after a message that mentions sessions, or undefined when nothing in it looks
 * like a mention. Tokens that aren't hex id prefixes and match nothing are left alone: `@@` shows
 * up in diffs and code too.
 */
export function mentionNote(text: string, sessions: KnownSession[], currentId: string | undefined, now = Date.now()): MentionNote | undefined {
	const blocks: string[] = [];
	const rows: MentionRow[] = [];
	for (const token of findMentions(text)) {
		const matches = sessionsForToken(token, sessions);
		if (matches.length === 0) {
			if (!/^[0-9a-f]{8}/i.test(token)) continue;
			blocks.push(`@@${token} matches no session pi knows about.`);
			rows.push({ token, matches: 0 });
			continue;
		}
		const head = matches.length > 1 ? `@@${token} matches ${matches.length} sessions:` : `@@${token} is`;
		blocks.push([head, ...matches.map((session) => describeSession(session, now, currentId))].join("\n"));
		const [first] = matches;
		rows.push({
			token,
			matches: matches.length,
			about: aboutOf(first),
			cwd: cwdOf(first),
			activity: activityOf(first, now) || undefined,
			live: Boolean(first.live),
		});
	}
	if (blocks.length === 0) return undefined;
	const content = [
		"The user's message mentions pi sessions with @@ (session id prefixes). Here is where they are, so you don't have to search for them:",
		...blocks,
		"Read a session with session_read rather than parsing its file.",
	].join("\n\n");
	return { content, rows };
}

/** One session in session_list's output. */
export function listEntry(session: KnownSession, token: string, now: number): string {
	const activity = activityOf(session, now);
	const facts = [session.live ? `live, ${session.live.idle ? "idle" : "busy"}` : "", activity ? `${ago(activity, now)} ago` : "", cwdOf(session)];
	return `@@${token}  ${facts.filter(Boolean).join(" · ")}\n  ${aboutOf(session) || "(no messages yet)"}`;
}

/** What a session_send message looks like to the agent that receives it. */
export function incomingText(message: string, from: Sender | undefined): string {
	if (!from) return `Message from another pi session, sent with session_send:\n\n${message}`;
	const facts = [from.cwd ? `cwd: ${from.cwd}` : "", from.about ? `about: ${from.about}` : ""].filter(Boolean).join("; ");
	return [
		`Message from pi session @@${from.token ?? from.sessionId.slice(0, MIN_TOKEN)} (${from.sessionId}${facts ? `; ${facts}` : ""}), sent with session_send.`,
		from.listening
			? `If it asks for an answer, reply with session_send to session "${from.sessionId}".`
			: "It came from a pi that isn't listening, such as a script, so it can't be answered with session_send.",
		"",
		message,
	].join("\n");
}
