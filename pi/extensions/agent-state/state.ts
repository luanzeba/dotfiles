/**
 * The main agent's state repo, read without pi: work items from work/*.md front matter, the memory
 * index, notes waiting for the next prompt, and which pi holds the main agent's role. README.md
 * describes the layout. No pi imports, so `node --test` can run it and other extensions can use it.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { REPORT_HEADER } from "../subagent/store.ts";

/** Where this machine's state repo lives: PI_AGENT_STATE_DIR, or ~/beta/luan-agent-state. */
export function stateDir(): string {
	const configured = process.env.PI_AGENT_STATE_DIR;
	return configured ? path.resolve(configured) : path.join(os.homedir(), "beta", "luan-agent-state");
}

/** A pi running in the state repo itself, not as a subagent, can be the main agent (see claimMain). */
export function isMainSession(cwd: string, dir: string, env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.PI_SUBAGENT_DIR) return false;
	try {
		return fs.realpathSync(cwd) === fs.realpathSync(dir);
	} catch {
		return false;
	}
}

export interface Item {
	/** work/<slug>.md */
	slug: string;
	title: string;
	/** active, waiting, landed, cleaned, or dropped (main.md); anything else counts as open. */
	status: string;
	/** As written, usually YYYY-MM-DD. */
	updated?: string;
	/** What Luan has to do, if anything. */
	needs?: string;
}

export interface WorkFile {
	/** Top-level `key: value` pairs of the front matter. */
	fields: Record<string, string>;
	/** Top-level keys holding a list: `- item` lines under an empty value, or `[a, b]`. */
	lists: Record<string, string[]>;
	/** The markdown after the front matter, or the whole text when there's none. */
	body: string;
}

/** A work file: a leading `---` block of top-level fields and lists, then markdown. Nested lines are skipped. */
export function parseWorkFile(text: string): WorkFile {
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	const none = { fields: {}, lists: {}, body: text };
	if (lines[0]?.trim() !== "---") return none;
	const fields: Record<string, string> = {};
	const lists: Record<string, string[]> = {};
	let list: string[] | undefined;
	for (const [index, line] of lines.entries()) {
		if (index === 0) continue;
		if (line.trim() === "---") return { fields, lists, body: lines.slice(index + 1).join("\n").replace(/^\s*\n/, "") };
		const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (field) {
			const key = field[1].toLowerCase();
			fields[key] = scalar(field[2]);
			const flow = /^\[(.*)\]$/.exec(fields[key]);
			list = fields[key] === "" || flow ? (lists[key] = []) : undefined;
			if (flow) list?.push(...flow[1].split(",").map((part) => scalar(part.trim())).filter(Boolean));
			continue;
		}
		const entry = /^\s*-\s+(.*)$/.exec(line);
		if (entry && list) list.push(scalar(entry[1]));
	}
	// No closing ---: not front matter.
	return none;
}

/** Top-level `key: value` pairs of a leading `---` block. List items and nested lines are skipped. */
export function frontMatter(text: string): Record<string, string> {
	return parseWorkFile(text).fields;
}

/**
 * A YAML scalar on one line: a quoted one keeps everything between its quotes, `#` included, with
 * `\"` and `\\` escapes in double quotes and `''` in single ones; otherwise ` #` starts a comment.
 */
function scalar(raw: string): string {
	const double = /^"((?:[^"\\]|\\.)*)"/.exec(raw);
	if (double) return double[1].replace(/\\(.)/g, "$1");
	const single = /^'((?:[^']|'')*)'/.exec(raw);
	if (single) return single[1].replace(/''/g, "'");
	return raw.replace(/(^|\s)#.*$/, "").trim();
}

export function loadItems(dir: string): Item[] {
	const work = path.join(dir, "work");
	let names: string[];
	try {
		names = fs.readdirSync(work).filter((name) => name.endsWith(".md") && !name.startsWith("."));
	} catch {
		return [];
	}
	return names.sort().map((name) => {
		const slug = name.slice(0, -3);
		let fields: Record<string, string> = {};
		try {
			fields = frontMatter(fs.readFileSync(path.join(work, name), "utf8"));
		} catch {
			// Unreadable: still listed, so it gets noticed.
		}
		return toItem(slug, fields);
	});
}

/** The title defaults to the slug, and the status to active. */
function toItem(slug: string, fields: Record<string, string>): Item {
	return {
		slug,
		title: fields.title || slug,
		status: (fields.status || "active").toLowerCase(),
		...(fields.updated ? { updated: fields.updated } : {}),
		...(fields.needs ? { needs: fields.needs } : {}),
	};
}

export interface Groups {
	/** Open items with `needs`. */
	needs: Item[];
	/** Open items without `needs`, active first. */
	open: Item[];
	landed: Item[];
	/** Cleaned or dropped, newest first. */
	closed: Item[];
}

/** Newest first; an item without a date sorts last. */
const byUpdated = (a: Item, b: Item) => (b.updated ?? "").localeCompare(a.updated ?? "") || a.title.localeCompare(b.title);

export function group(items: Item[]): Groups {
	const closed = items.filter((item) => item.status === "cleaned" || item.status === "dropped");
	const landed = items.filter((item) => item.status === "landed");
	const rest = items.filter((item) => !closed.includes(item) && !landed.includes(item));
	return {
		needs: [...rest.filter((item) => item.needs), ...landed.filter((item) => item.needs)].sort(byUpdated),
		open: rest.filter((item) => !item.needs).sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || byUpdated(a, b)),
		landed: landed.filter((item) => !item.needs).sort(byUpdated),
		closed: closed.sort(byUpdated),
	};
}

/** Local days since `updated`, or undefined when it isn't a date. */
function daysAgo(updated: string | undefined, now: Date): number | undefined {
	if (!updated) return undefined;
	const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(updated) ? `${updated}T12:00:00` : updated);
	if (Number.isNaN(date.getTime())) return undefined;
	const day = (value: Date) => Math.floor(new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime() / 86_400_000);
	return day(now) - day(date);
}

/** "today", "yesterday", "3d ago", or the date itself for anything older than a few weeks. */
export function age(updated: string | undefined, now = new Date()): string | undefined {
	if (!updated) return undefined;
	const days = daysAgo(updated, now);
	if (days === undefined) return updated;
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 21) return `${days}d ago`;
	return updated.slice(0, 10);
}

/**
 * A note for the main agent: one JSON file in `.pending/notes/`, read and removed with the next prompt.
 * Anything can drop one (subagent reports, scripts, jobs) with addNote.
 */
export interface Note {
	at: string;
	/** Who sent it, in a few words: `subagent tab "fix login"`, `@@01a1b2eb (…)`. */
	from: string;
	message: string;
	/** A session id the main agent can answer with session_send. */
	replyTo?: string;
}

const notesDir = (dir: string) => path.join(dir, ".pending", "notes");

/** `.pending/` ignores itself, so notes and the lock stay out of git in any state repo. */
function ensurePending(dir: string): void {
	const pending = path.join(dir, ".pending");
	fs.mkdirSync(path.join(pending, "notes"), { recursive: true });
	const ignore = path.join(pending, ".gitignore");
	if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
}

/** Drop a note for the main agent of the state repo `dir`. */
export function addNote(dir: string, note: Note): void {
	ensurePending(dir);
	const name = `${note.at.replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
	const tmp = path.join(notesDir(dir), `.${name}.tmp`);
	fs.writeFileSync(tmp, `${JSON.stringify(note)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, path.join(notesDir(dir), `${name}.json`));
}

/** Oldest first, with the files they came from so exactly those can be removed. */
export function readNotes(dir: string): { file: string; note: Note }[] {
	const folder = notesDir(dir);
	let names: string[];
	try {
		names = fs.readdirSync(folder).filter((name) => name.endsWith(".json")).sort();
	} catch {
		return [];
	}
	return names.flatMap((name) => {
		const file = path.join(folder, name);
		try {
			const note = JSON.parse(fs.readFileSync(file, "utf8")) as Note;
			return typeof note.message === "string" ? [{ file, note }] : [];
		} catch {
			return [];
		}
	});
}

export function removeNotes(files: string[]): void {
	for (const file of files) fs.rmSync(file, { force: true });
}

/** One line of a note for /status: its first line, after a subagent report's header unless that's all there is. */
export function noteGist(note: Note, max = 100): string {
	const lines = note.message.split("\n").map((line) => line.trim()).filter(Boolean);
	const body = (lines.length > 1 && REPORT_HEADER.test(lines[0]) ? lines[1] : lines[0]) ?? "";
	return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}

/** The notes as the main agent reads them with the prompt that starts its next turn. */
export function notesText(notes: Note[]): string {
	return [
		`${notes.length === 1 ? "A note" : `${notes.length} notes`} from other sessions, which wait for Luan's next message instead of interrupting:`,
		...notes.map((note) =>
			[
				"",
				`### From ${note.from} (${note.at.slice(0, 16).replace("T", " ")} UTC)`,
				...(note.replyTo ? [`Answer with session_send to session "${note.replyTo}".`] : []),
				"",
				note.message,
			].join("\n"),
		),
	].join("\n");
}

export const LOCK_FILE = path.join(".pending", "main.json");

/** The pi holding the main agent's role in this clone, if it's still running. */
export function mainHolder(dir: string): number | undefined {
	try {
		const { pid } = JSON.parse(fs.readFileSync(path.join(dir, LOCK_FILE), "utf8")) as { pid?: unknown };
		if (typeof pid !== "number") return undefined;
		// Throws for a pid that's gone, and for one another user's process took over (EPERM): the lock
		// is in this user's own repo, so its holder was this user's pi.
		process.kill(pid, 0);
		return pid;
	} catch {
		return undefined;
	}
}

/** Take the main agent's role unless another running pi holds it. Returns that pi's pid, or undefined when this one has it. */
export function claimMain(dir: string, pid = process.pid): number | undefined {
	const holder = mainHolder(dir);
	if (holder !== undefined && holder !== pid) return holder;
	ensurePending(dir);
	fs.writeFileSync(path.join(dir, LOCK_FILE), `${JSON.stringify({ pid, at: new Date().toISOString() })}\n`);
	return undefined;
}

export function releaseMain(dir: string, pid = process.pid): void {
	const file = path.join(dir, LOCK_FILE);
	try {
		if ((JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: unknown }).pid === pid) fs.rmSync(file, { force: true });
	} catch {
		// Not ours, or already gone.
	}
}

/** A row of /status that opens: a work item or a note. */
export interface StatusEntry {
	/** The work item's slug or the note's file: the selection follows it across refreshes. */
	key: string;
	/** One line: the title, when it was updated, and the status unless it's active or landed; or a note's gist. */
	text: string;
	/** What Luan has to do, shown in full under the text. */
	needs?: string;
	/** Opened from here rather than its file, which the main agent removes when it reads the note. */
	note?: Note;
}

export interface StatusList {
	/** Headings with their count, each with at least one entry. */
	sections: { title: string; entries: StatusEntry[] }[];
	/** What isn't listed: older done items. */
	more?: string;
}

/** /status lists what was cleaned or dropped this many days ago or less: work often goes straight to cleaned. */
export const RECENT_DAYS = 7;

/** What /status lists, newest first in each section. `notes` only for the main agent's session. */
export function statusList(items: Item[], options: { notes?: { file: string; note: Note }[]; now?: Date } = {}): StatusList {
	const now = options.now ?? new Date();
	const groups = group(items);
	const done = groups.closed.filter((item) => (daysAgo(item.updated, now) ?? Infinity) <= RECENT_DAYS);
	const older = groups.closed.length - done.length;
	const entry = (item: Item): StatusEntry => {
		const when = age(item.updated, now);
		const tail = [when ? `updated ${when}` : undefined, item.status !== "active" && item.status !== "landed" ? item.status : undefined].filter(Boolean).join(" · ");
		return { key: item.slug, text: `${item.title}${tail ? `  (${tail})` : ""}`, ...(item.needs ? { needs: item.needs } : {}) };
	};
	const notes = (options.notes ?? []).map(({ file, note }) => ({ key: file, text: `${note.from}: ${noteGist(note)}`, note }));
	const sections = [
		{ title: "Needs you", entries: groups.needs.map(entry) },
		{ title: "In progress", entries: groups.open.map(entry) },
		{ title: "Landed, awaiting cleanup", entries: groups.landed.map(entry) },
		{ title: "Notes for your next message", entries: notes },
		{ title: "Recently done", entries: done.map(entry) },
	]
		.filter((section) => section.entries.length > 0)
		.map((section) => ({ title: `${section.title} (${section.entries.length})`, entries: section.entries }));
	const more = older > 0 ? (done.length > 0 ? `${older} more done earlier, not shown` : `${older} done (cleaned or dropped) not shown`) : undefined;
	return { sections, ...(more ? { more } : {}) };
}

/** /status as text, for RPC and print mode: one heading (no leading space) or row per line. */
export function statusView(items: Item[], options: { notes?: { file: string; note: Note }[]; now?: Date } = {}): string[] {
	const list = statusList(items, options);
	const lines = list.sections.flatMap((section) => [
		section.title,
		...section.entries.flatMap((entry) => [`  • ${entry.text}`, ...(entry.needs ? [`      → ${entry.needs}`] : [])]),
	]);
	if (list.more) lines.push(list.more);
	return lines.length > 0 ? lines : ["Nothing tracked yet."];
}

/**
 * Where the selection goes after the list changed: the same key if it's still there, else the row that
 * took its place.
 */
export function keepSelection(keys: string[], key: string | undefined, index: number): number {
	const found = key === undefined ? -1 : keys.indexOf(key);
	return found >= 0 ? found : Math.max(0, Math.min(index, keys.length - 1));
}

/** What /status shows for one entry: a title, a compact header, and markdown. */
export interface Detail {
	title: string;
	/** A label with its values, one per line. */
	header: { label: string; values: string[] }[];
	body: string;
}

/** What Enter on an entry shows. */
export function entryDetail(dir: string, entry: StatusEntry, now = new Date()): Detail {
	return entry.note ? noteDetail(entry.note) : workDetail(dir, entry.key, now);
}

/** A note in full, a subagent's whole report say. Showing it leaves it for the main agent to read. */
export function noteDetail(note: Note): Detail {
	const at = new Date(note.at);
	const pad = (value: number) => String(value).padStart(2, "0");
	const sent = Number.isNaN(at.getTime()) ? note.at : `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
	const header = [
		{ label: "from", values: [note.from] },
		{ label: "sent", values: [sent] },
		...(note.replyTo ? [{ label: "reply to", values: [`session ${note.replyTo}`] }] : []),
	];
	return { title: `Note from ${note.from}`, header, body: note.message.trim() };
}

/** A work file opened in /status: its front matter as a header (needs in full), then its body. */
export function workDetail(dir: string, slug: string, now = new Date()): Detail {
	const file = path.join("work", `${slug}.md`);
	let text: string;
	try {
		text = fs.readFileSync(path.join(dir, file), "utf8");
	} catch (error) {
		return { title: slug, header: [{ label: "file", values: [file] }], body: `Can't read it: ${error instanceof Error ? error.message : String(error)}` };
	}
	const { fields, lists, body } = parseWorkFile(text);
	const item = toItem(slug, fields);
	const when = age(item.updated, now);
	const header = [
		{ label: "status", values: [item.status] },
		{ label: "updated", values: item.updated ? [when !== item.updated ? `${item.updated} (${when})` : item.updated] : [] },
		...["needs", "links", "sessions", "artifacts"].map((label) => ({ label, values: lists[label] ?? (fields[label] ? [fields[label]] : []) })),
		{ label: "file", values: [file] },
	].filter((row) => row.values.length > 0);
	return { title: item.title, header, body: body.trim() || "(no notes in this file)" };
}

const MEMORY_MAX_LINES = 200;
const MEMORY_MAX_CHARS = 25_000;

/** The memory index as loaded into a session: its first 200 lines or 25,000 characters. */
export function memoryIndex(dir: string): string | undefined {
	let text: string;
	try {
		text = fs.readFileSync(path.join(dir, "memory", "MEMORY.md"), "utf8").trim();
	} catch {
		return undefined;
	}
	if (!text) return undefined;
	const lines = text.split("\n");
	let out = lines.slice(0, MEMORY_MAX_LINES).join("\n");
	if (out.length > MEMORY_MAX_CHARS) out = out.slice(0, MEMORY_MAX_CHARS);
	return out.length < text.length ? `${out}\n[…the rest of memory/MEMORY.md isn't loaded; keep the index short]` : out;
}

/** What the main agent reads with its first prompt in a session: the work overview and the memory index. */
export function snapshot(dir: string, now = new Date()): string {
	const items = loadItems(dir);
	const groups = group(items);
	const list = (title: string, entries: Item[], line: (item: Item) => string) => (entries.length > 0 ? [title, ...entries.map(line), ""] : []);
	const what = (item: Item) => `- work/${item.slug}.md: ${item.title} (${item.status}${item.updated ? `, updated ${item.updated}` : ""})`;
	const memory = memoryIndex(dir);
	return [
		`State repo ${dir}, loaded by the agent-state extension when this session started (${now.toISOString().slice(0, 16).replace("T", " ")}).`,
		"",
		"## Work",
		...(items.length === 0 ? ["No work files yet.", ""] : []),
		...list("Needs Luan:", groups.needs, (item) => `${what(item)}: ${item.needs}`),
		...list("In progress:", groups.open, what),
		...list("Landed, awaiting cleanup:", groups.landed, what),
		...(groups.closed.length > 0 ? [`${groups.closed.length} more are cleaned or dropped.`, ""] : []),
		"## Memory index (memory/MEMORY.md)",
		memory ?? "Empty.",
	].join("\n");
}

export function commitMessage(paths: string[]): string {
	const shown = paths.slice(0, 3).join(", ");
	return paths.length > 3 ? `Update ${shown} and ${paths.length - 3} more` : `Update ${shown}`;
}
