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

/** Where this machine's state repo lives: PI_AGENT_STATE_DIR, or ~/luan-agent-state. */
export function stateDir(): string {
	const configured = process.env.PI_AGENT_STATE_DIR;
	return configured ? path.resolve(configured) : path.join(os.homedir(), "luan-agent-state");
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

/** Top-level `key: value` pairs of a leading `---` block. List items and nested lines are skipped. */
export function frontMatter(text: string): Record<string, string> {
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return {};
	const fields: Record<string, string> = {};
	for (const line of lines.slice(1)) {
		if (line.trim() === "---") return fields;
		const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (!match) continue;
		fields[match[1].toLowerCase()] = scalar(match[2]);
	}
	// No closing ---: not front matter.
	return {};
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
		return {
			slug,
			title: fields.title || slug,
			status: (fields.status || "active").toLowerCase(),
			...(fields.updated ? { updated: fields.updated } : {}),
			...(fields.needs ? { needs: fields.needs } : {}),
		};
	});
}

export interface Groups {
	/** Open items with `needs`. */
	needs: Item[];
	/** Open items without `needs`, active first. */
	open: Item[];
	landed: Item[];
	/** Cleaned or dropped. */
	closed: number;
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
		closed: closed.length,
	};
}

/** "today", "yesterday", "3d ago", or the date itself for anything older than a few weeks. */
export function age(updated: string | undefined, now = new Date()): string | undefined {
	if (!updated) return undefined;
	const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(updated) ? `${updated}T12:00:00` : updated);
	if (Number.isNaN(date.getTime())) return updated;
	const day = (value: Date) => Math.floor(new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime() / 86_400_000);
	const days = day(now) - day(date);
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

/** What /status shows, one heading (no leading space) or row per line. `notes` only for the main agent's session. */
export function statusView(items: Item[], options: { notes?: Note[]; now?: Date } = {}): string[] {
	const now = options.now ?? new Date();
	const groups = group(items);
	const lines: string[] = [];
	const row = (item: Item, extra?: string) => {
		const when = age(item.updated, now);
		const tail = [extra, when ? `updated ${when}` : undefined, item.status !== "active" && item.status !== "landed" ? item.status : undefined].filter(Boolean).join(" · ");
		return `  • ${item.title}${tail ? `  (${tail})` : ""}`;
	};
	if (groups.needs.length > 0) {
		lines.push(`Needs you (${groups.needs.length})`);
		for (const item of groups.needs) lines.push(`${row(item)}`, `      → ${item.needs}`);
	}
	if (groups.open.length > 0) {
		lines.push(`In progress (${groups.open.length})`);
		for (const item of groups.open) lines.push(row(item));
	}
	if (groups.landed.length > 0) {
		lines.push(`Landed, awaiting cleanup (${groups.landed.length})`);
		for (const item of groups.landed) lines.push(row(item));
	}
	const notes = options.notes ?? [];
	if (notes.length > 0) {
		lines.push(`Notes for your next message (${notes.length})`);
		for (const note of notes) lines.push(`  • ${note.from}: ${noteGist(note)}`);
	}
	if (groups.closed > 0) lines.push(`${groups.closed} done (cleaned or dropped) not shown`);
	return lines.length > 0 ? lines : ["Nothing tracked yet."];
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
		...(groups.closed > 0 ? [`${groups.closed} more are cleaned or dropped.`, ""] : []),
		"## Memory index (memory/MEMORY.md)",
		memory ?? "Empty.",
	].join("\n");
}

export function commitMessage(paths: string[]): string {
	const shown = paths.slice(0, 3).join(", ");
	return paths.length > 3 ? `Update ${shown} and ${paths.length - 3} more` : `Update ${shown}`;
}
