/**
 * A session file as a compact, numbered transcript for `session_read`: user messages, assistant
 * text, one line per tool call with a trimmed result, compactions, errors, model changes, and
 * extension messages. Thinking and system prompts are left out. No pi imports, so `node --test`
 * can run this directly.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { textOf, userText } from "./refs.ts";

export interface Item {
	n: number;
	/** Shown as the item's heading, e.g. `user`, `assistant`, `bash`, `compaction`. */
	kind: string;
	time?: number;
	/** One line after the kind: a tool call's arguments, a compaction's size. */
	head?: string;
	body: string;
	/** A tool call's result, shown under it. */
	result?: string;
}

export interface Transcript {
	items: Item[];
	/** Entries on branches other than the one ending at the file's last entry. */
	offBranch: number;
}

export interface ReadOptions {
	/** Keep texts whole (tool output up to FULL_RESULT_CHARS). */
	full?: boolean;
}

const LIMITS = { text: 2_000, compaction: 3_000, call: 200, result: 300 };
const FULL_LIMITS = { text: Number.POSITIVE_INFINITY, compaction: Number.POSITIVE_INFINITY, call: 4_000, result: 4_000 };
/** Searched text per item; a query never needs a whole log. */
const SEARCH_CHARS = 50_000;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}… [${text.length - max} more chars]`;
}

/** What a tool call did, in one line: the command, path, or script, else its arguments as JSON. */
const BULKY_ARGS = new Set(["content", "oldText", "newText", "edits", "timeout"]);

function callSummary(args: any): string {
	if (!args || typeof args !== "object") return "";
	for (const key of ["command", "path", "code", "query", "url", "action"]) {
		if (typeof args[key] === "string") {
			const rest = Object.keys(args).filter((k) => k !== key && !BULKY_ARGS.has(k));
			return rest.length ? `${args[key]} ${JSON.stringify(Object.fromEntries(rest.map((k) => [k, args[k]])))}` : args[key];
		}
	}
	return JSON.stringify(args);
}

interface Entry {
	id?: string;
	parentId?: string | null;
	type: string;
	timestamp?: string;
	[key: string]: any;
}

/** Entries on the branch that ends at the last entry written. Old sessions without ids are linear. */
function currentBranch(entries: Entry[]): { branch: Entry[]; offBranch: number } {
	const byId = new Map<string, Entry>();
	for (const entry of entries) if (entry.id) byId.set(entry.id, entry);
	const leaf = entries.findLast((entry) => entry.id);
	if (!leaf) return { branch: entries, offBranch: 0 };
	const onPath = new Set<string>();
	for (let entry: Entry | undefined = leaf; entry?.id && !onPath.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
		onPath.add(entry.id);
	}
	const branch = entries.filter((entry) => !entry.id || onPath.has(entry.id));
	return { branch, offBranch: entries.length - branch.length };
}

export async function readTranscript(file: string, options: ReadOptions = {}): Promise<Transcript> {
	const limit = options.full ? FULL_LIMITS : LIMITS;
	const input = createReadStream(file, { encoding: "utf8" });
	const lines = createInterface({ input, crlfDelay: Infinity });
	const entries: Entry[] = [];
	try {
		for await (const line of lines) {
			let entry: Entry;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (entry.type === "session") continue;
			// Drop what's never shown before holding the whole session: system prompts, thinking. System
			// entries stay as links in the tree.
			else if (entry.type === "message" && entry.message?.role === "system") entries.push({ id: entry.id, parentId: entry.parentId, type: "system" });
			else if (entry.type === "message" && Array.isArray(entry.message?.content)) {
				const content = entry.message.content.filter((block: any) => block?.type !== "thinking");
				entries.push({ ...entry, message: { ...entry.message, content: shrinkBlocks(content) } });
			} else entries.push(entry);
		}
	} finally {
		lines.close();
		input.destroy();
	}

	const { branch, offBranch } = currentBranch(entries);
	const items: Item[] = [];
	const calls = new Map<string, Item>();
	const add = (item: Omit<Item, "n">) => {
		const full = { n: items.length + 1, ...item };
		items.push(full);
		return full;
	};
	const timeOf = (entry: Entry) => (typeof entry.message?.timestamp === "number" ? entry.message.timestamp : Date.parse(entry.timestamp ?? "") || undefined);

	for (const entry of branch) {
		const time = timeOf(entry);
		if (entry.type === "message") {
			const message = entry.message ?? {};
			if (message.role === "user") {
				const images = Array.isArray(message.content) ? message.content.filter((b: any) => b?.type === "image").length : 0;
				const text = userText(message.content).trim();
				add({ kind: "user", time, body: clip(text, limit.text) + (images ? `\n[${images} image${images > 1 ? "s" : ""}]` : "") });
			} else if (message.role === "assistant") {
				const text = textOf(message.content).trim();
				if (text) add({ kind: "assistant", time, body: clip(text, limit.text) });
				for (const block of Array.isArray(message.content) ? message.content : []) {
					if (block?.type !== "toolCall") continue;
					const item = add({ kind: String(block.name ?? "tool"), time, head: clip(oneLine(block.summary ?? ""), limit.call), body: "" });
					if (typeof block.id === "string") calls.set(block.id, item);
				}
				if (message.stopReason === "error") add({ kind: "error", time, body: clip(String(message.errorMessage ?? "request failed"), limit.text) });
				else if (message.stopReason === "aborted") add({ kind: "aborted", time, body: "the user stopped this response" });
				else if (message.stopReason === "length") add({ kind: "error", time, body: "the response hit the output token limit" });
			} else if (message.role === "toolResult") {
				const output = textOf(message.content);
				const images = Array.isArray(message.content) ? message.content.filter((b: any) => b?.type === "image").length : 0;
				const lineCount = output ? output.split("\n").length : 0;
				const shown = options.full ? clip(output.trim(), limit.result) : clip(oneLine(output), limit.result);
				const summary = [lineCount > 1 ? `${lineCount} lines` : "", images ? `${images} image${images > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ");
				const result = `${message.isError ? "error" : "ok"}${summary ? ` (${summary})` : ""}${shown ? `: ${shown}` : ""}`;
				const call = calls.get(message.toolCallId);
				if (call) call.result = result;
				else add({ kind: String(message.toolName ?? "tool result"), time, body: "", result });
			} else if (message.role === "bashExecution") {
				const output = String(message.output ?? "");
				const shown = options.full ? clip(output.trim(), limit.result) : clip(oneLine(output), limit.result);
				add({ kind: "user !", time, head: clip(oneLine(String(message.command ?? "")), limit.call), body: "", result: `exit ${message.exitCode ?? "?"}${shown ? `: ${shown}` : ""}` });
			}
		} else if (entry.type === "compaction") {
			const before = typeof entry.tokensBefore === "number" ? `${entry.tokensBefore.toLocaleString("en-US")} tokens before` : undefined;
			add({ kind: "compaction", time, head: before, body: clip(String(entry.summary ?? "").trim(), limit.compaction) });
		} else if (entry.type === "branch_summary") {
			add({ kind: "branch summary", time, body: clip(String(entry.summary ?? "").trim(), limit.compaction) });
		} else if (entry.type === "custom_message") {
			add({ kind: `message (${entry.customType ?? "extension"})`, time, body: clip(textOf(entry.content).trim(), limit.text) });
		} else if (entry.type === "model_change") {
			add({ kind: "model", time, body: `${entry.provider}/${entry.modelId}` });
		}
	}
	return { items, offBranch };
}

/** Keep the parts of content blocks the transcript uses, capped, so a huge log line isn't held whole. */
function shrinkBlocks(blocks: any[]): any[] {
	return blocks.map((block) => {
		if (block?.type === "toolCall") return { type: "toolCall", id: block.id, name: block.name, summary: callSummary(block.arguments).slice(0, SEARCH_CHARS) };
		if (block?.type === "text" && typeof block.text === "string" && block.text.length > SEARCH_CHARS) {
			return { type: "text", text: `${block.text.slice(0, SEARCH_CHARS)}… [${block.text.length - SEARCH_CHARS} more chars]` };
		}
		if (block?.type === "image") return { type: "image" };
		return block;
	});
}

export interface RenderOptions {
	/** Only items containing this text, case-insensitively. */
	query?: string;
	/** First item number to show. */
	from?: number;
	/** Show only the last N items (of the matches, with a query). */
	last?: number;
	/** Characters of output per page. */
	budget?: number;
}

export interface Page {
	text: string;
	/** Items that matched, before paging. */
	matched: number;
	shown: Item[];
	/** Item number to continue from, when the page filled up. */
	next?: number;
}

const DEFAULT_BUDGET = 24_000;

function formatTime(ms: number | undefined, previous: number | undefined): string {
	if (!ms) return "";
	const date = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	const previousDay = previous ? new Date(previous).toDateString() : "";
	return previousDay === date.toDateString() ? time : `${day} ${time}`;
}

/** Around the first match when the text is longer than `max`, so a query hit deep in a message shows. */
function excerpt(text: string, query: string | undefined, max = 600): string {
	if (!query || text.length <= max) return text;
	const at = text.toLowerCase().indexOf(query.toLowerCase());
	if (at < 0 || at + query.length < max) return text;
	const start = Math.max(0, at - Math.floor(max / 3));
	return `…${text.slice(start, start + max)}…`;
}

function formatItem(item: Item, previousTime: number | undefined, query: string | undefined): string {
	const when = formatTime(item.time, previousTime);
	const title = [`#${item.n} ${item.kind}`, item.head, when ? `· ${when}` : ""].filter(Boolean).join(" ");
	const lines = [title];
	if (item.body) lines.push(excerpt(item.body, query));
	if (item.result) lines.push(`  → ${excerpt(item.result, query)}`);
	return lines.join("\n");
}

const searchText = (item: Item) => [item.kind, item.head, item.body, item.result].filter(Boolean).join("\n").toLowerCase();

export function renderPage(items: Item[], options: RenderOptions = {}): Page {
	const query = options.query?.trim() || undefined;
	let matches = query ? items.filter((item) => searchText(item).includes(query.toLowerCase())) : items;
	const matched = matches.length;
	if (options.last && options.last > 0) matches = matches.slice(-options.last);
	if (options.from && options.from > 1) matches = matches.filter((item) => item.n >= options.from!);
	const budget = options.budget ?? DEFAULT_BUDGET;
	const blocks: string[] = [];
	const shown: Item[] = [];
	let used = 0;
	let next: number | undefined;
	for (const [i, item] of matches.entries()) {
		const block = formatItem(item, i > 0 ? matches[i - 1].time : undefined, query);
		// Always show at least one item, cut to the page if it alone is bigger.
		if (shown.length > 0 && used + block.length > budget) {
			next = item.n;
			break;
		}
		blocks.push(shown.length === 0 && block.length > budget ? clip(block, budget) : block);
		shown.push(item);
		used += block.length + 2;
	}
	return { text: blocks.join("\n\n"), matched, shown, next };
}
