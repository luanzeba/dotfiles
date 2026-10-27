/**
 * Session-file index for /resume-search, and the dev servers portless is running right now.
 *
 * Built to stay cheap as sessions pile up:
 * - A refresh rescans only files whose mtime or size changed, newest first.
 * - Records are stored in one shard per month of session creation. Old months rarely change, so a
 *   refresh rewrites only the current month's shard rather than one ever-growing file.
 * - Records keep only what search and display need: capped refs and the distinct words of the
 *   user's messages, not the transcript.
 */
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { classifyUrl, RefCollector, type Ref, type Teams, userText } from "./refs.ts";

/** Custom entry type holding the generated one-sentence summary. */
export const SUMMARY_TYPE = "session-info";

export interface SummaryData {
	summary: string;
	/** User messages in the session when the summary was written, to know when it is stale. */
	userMessages: number;
	/** `provider/id` that wrote it. */
	model?: string;
}

export interface SessionRecord {
	path: string;
	mtimeMs: number;
	size: number;
	id: string;
	cwd: string;
	name?: string;
	summary?: string;
	modified: number;
	firstMessage: string;
	/** Distinct lowercase words from the user's messages, for word searches. */
	userWords: string;
	userMessages: number;
	refs: Ref[];
	teams: Teams;
}

/** Bump whenever extraction changes, so old shards are ignored and rebuilt. */
const INDEX_VERSION = 4;
const MAX_REFS = 150;
const FIRST_MESSAGE_CHARS = 300;
const USER_WORDS_CHARS = 8000;
/**
 * New words one message may add, so a pasted log can't use up the budget. 96% of real user
 * messages fit; the rest are mostly pastes and briefs.
 */
const MESSAGE_WORDS_CHARS = 2000;

/** Tool output names many links in passing; keep only the kinds people search for. */
function compactRefs(refs: Ref[]): Ref[] {
	return refs
		.filter((ref) => ref.source !== "tool" || ref.kind === "mr" || ref.kind === "github" || ref.kind === "ticket")
		.slice(0, MAX_REFS);
}

/** Collects distinct words, so a long session's later messages stay searchable within the cap. */
class WordSet {
	private readonly words = new Set<string>();
	private chars = 0;

	add(text: string): void {
		const limit = Math.min(this.chars + MESSAGE_WORDS_CHARS, USER_WORDS_CHARS);
		for (const raw of text.toLowerCase().split(/\s+/)) {
			if (this.chars >= limit) return;
			const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
			const url = word.includes("://");
			if (word.length < 3 || word.length > (url ? 200 : 60) || this.words.has(word)) continue;
			// URLs that became refs are searchable through them; keep the rest, like localhost pages.
			if (url && classifyUrl(word)) continue;
			this.words.add(word);
			this.chars += word.length + 1;
		}
	}

	toString(): string {
		return [...this.words].join(" ");
	}
}

export async function scanSessionFile(file: string, stat: { mtimeMs: number; size: number }): Promise<SessionRecord | undefined> {
	const input = createReadStream(file, { encoding: "utf8" });
	const lines = createInterface({ input, crlfDelay: Infinity });
	const collector = new RefCollector();
	const words = new WordSet();
	let header: { id: string; cwd: string; timestamp?: string } | undefined;
	let name: string | undefined;
	let summary: string | undefined;
	let firstMessage = "";
	let userMessages = 0;
	let modified = 0;
	try {
		for await (const line of lines) {
			let entry: any;
			try {
				entry = JSON.parse(line);
			} catch {
				// Blank, or a last line still being written; the size change rescans it next time.
				continue;
			}
			if (!header) {
				if (entry.type !== "session" || typeof entry.id !== "string") return undefined;
				header = { id: entry.id, cwd: typeof entry.cwd === "string" ? entry.cwd : "", timestamp: entry.timestamp };
				collector.addWorkspace(header.cwd);
				continue;
			}
			if (entry.type === "session_info") name = entry.name?.trim() || undefined;
			else if (entry.type === "custom" && entry.customType === SUMMARY_TYPE) summary = entry.data?.summary ?? summary;
			else {
				collector.addEntry(entry);
				if (entry.type !== "message") continue;
				const message = entry.message;
				if (message?.role === "user" || message?.role === "assistant") {
					const at = typeof message.timestamp === "number" ? message.timestamp : Date.parse(entry.timestamp);
					if (at > modified) modified = at;
				}
				if (message?.role === "user") {
					userMessages++;
					const text = userText(message.content);
					if (!firstMessage) firstMessage = text.replace(/\s+/g, " ").trim().slice(0, FIRST_MESSAGE_CHARS);
					words.add(text);
				}
			}
		}
	} finally {
		lines.close();
		input.destroy();
	}
	if (!header) return undefined;
	return {
		path: file,
		mtimeMs: stat.mtimeMs,
		size: stat.size,
		id: header.id,
		cwd: header.cwd,
		name,
		summary,
		modified: modified || Date.parse(header.timestamp ?? "") || stat.mtimeMs,
		firstMessage,
		userWords: words.toString(),
		userMessages,
		refs: compactRefs(collector.list()),
		teams: collector.teams,
	};
}

interface FileStat {
	path: string;
	mtimeMs: number;
	size: number;
}

/** Session files directly in `root` (custom session dirs) or one level down (the default layout). */
async function listSessionFiles(root: string): Promise<FileStat[]> {
	const files: string[] = [];
	for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
		const full = path.join(root, entry.name);
		if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
		else if (entry.isDirectory() || entry.isSymbolicLink()) {
			for (const name of await fs.readdir(full).catch(() => [])) {
				if (name.endsWith(".jsonl")) files.push(path.join(full, name));
			}
		}
	}
	const stats = await Promise.all(
		files.map((file) =>
			fs.stat(file).then(
				(s): FileStat => ({ path: file, mtimeMs: s.mtimeMs, size: s.size }),
				() => undefined,
			),
		),
	);
	return stats.filter((s) => s !== undefined);
}

/** Session files are named `<ISO timestamp>_<id>.jsonl`; shard them by the month they started. */
const shardOf = (file: string) => /^(\d{4}-\d{2})/.exec(path.basename(file))?.[1] ?? "other";
const SHARD_FILE_RE = /^index-(.+)\.json$/;
const TEAMS_FILE = "teams.json";

async function writeAtomic(file: string, text: string): Promise<void> {
	const tmp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(tmp, text);
	await fs.rename(tmp, file);
}

/** Linear teams seen in any indexed session, kept apart from the index so the card can read it cheaply. */
export async function readTeams(dir: string): Promise<Teams> {
	try {
		return JSON.parse(await fs.readFile(path.join(dir, TEAMS_FILE), "utf8"));
	} catch {
		return {};
	}
}

/**
 * One record per session file, invalidated by mtime and size. A refresh rescans changed files,
 * newest first, and persists only the shards it touched. Several pi processes may refresh at once;
 * the last write wins, and any record it dropped is rescanned on the next refresh.
 */
export class SessionIndex {
	private readonly records = new Map<string, SessionRecord>();
	private readonly dirty = new Set<string>();
	private readonly dir: string;
	private readonly root: string;
	private loaded?: Promise<void>;

	constructor(dir: string, root: string) {
		this.dir = dir;
		this.root = root;
	}

	async load(): Promise<SessionRecord[]> {
		this.loaded ??= (async () => {
			const names = await fs.readdir(this.dir).catch(() => []);
			await Promise.all(
				names.filter((name) => SHARD_FILE_RE.test(name)).map(async (name) => {
					try {
						const data = JSON.parse(await fs.readFile(path.join(this.dir, name), "utf8"));
						if (data?.version !== INDEX_VERSION || !Array.isArray(data.sessions)) return;
						for (const record of data.sessions) this.records.set(record.path, record);
					} catch {
						// A corrupt shard is rebuilt by the next refresh.
					}
				}),
			);
		})();
		await this.loaded;
		return this.list();
	}

	list(): SessionRecord[] {
		return [...this.records.values()];
	}

	async refresh(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<SessionRecord[]> {
		await this.load();
		const files = await listSessionFiles(this.root);
		const present = new Set(files.map((file) => file.path));
		for (const file of this.records.keys()) {
			if (present.has(file)) continue;
			this.records.delete(file);
			this.dirty.add(shardOf(file));
		}
		const stale = files
			.filter((file) => {
				const record = this.records.get(file.path);
				return !record || record.mtimeMs !== file.mtimeMs || record.size !== file.size;
			})
			.sort((a, b) => b.mtimeMs - a.mtimeMs);
		try {
			for (const [done, file] of stale.entries()) {
				if (signal?.aborted) break;
				const record = await scanSessionFile(file.path, file).catch(() => undefined);
				if (record) this.records.set(file.path, record);
				else this.records.delete(file.path);
				this.dirty.add(shardOf(file.path));
				onProgress?.(done + 1, stale.length);
			}
		} finally {
			// Keep partial progress when the picker closes mid-scan.
			await this.save().catch(() => {});
		}
		return this.list();
	}

	/** Linear teams learned from every indexed session. */
	teams(): Teams {
		const teams: Teams = {};
		for (const record of this.records.values()) Object.assign(teams, record.teams);
		return teams;
	}

	private async save(): Promise<void> {
		if (this.dirty.size === 0) return;
		await fs.mkdir(this.dir, { recursive: true });
		const shards = [...this.dirty];
		this.dirty.clear();
		await Promise.all(
			shards.map((shard) => {
				const sessions = this.list().filter((record) => shardOf(record.path) === shard);
				return writeAtomic(path.join(this.dir, `index-${shard}.json`), JSON.stringify({ version: INDEX_VERSION, sessions }));
			}),
		);
		await writeAtomic(path.join(this.dir, TEAMS_FILE), JSON.stringify(this.teams()));
	}
}

export interface DevRoute {
	host: string;
	url: string;
	/** Checkout root of the dev server process, to tie it to the session's checkout. */
	root?: string;
}

const execFileAsync = promisify(execFile);

const exists = (file: string) => fs.stat(file).then(() => true, () => false);

/**
 * The nearest ancestor that is a checkout: it holds `.git` (a directory in a clone, a file in a git
 * worktree) or `.jj` (a jj repo or workspace).
 */
export async function repoRoot(dir: string): Promise<string | undefined> {
	for (let current = path.resolve(dir); ; current = path.dirname(current)) {
		if ((await exists(path.join(current, ".git"))) || (await exists(path.join(current, ".jj")))) return current;
		if (path.dirname(current) === current) return undefined;
	}
}

export interface Review {
	/** Arguments for `hunk`. */
	args: string[];
	/** What they show, for a status message. */
	what: string;
}

/** Long-lived branches; work on one is reviewed against its own remote copy. */
const TRUNK_RE = /^(develop|main|master)$|^release\//;
/** Branches work forks from. Personal and stacked branches are left out on purpose. */
const BASE_RE = /^(develop|main|master)$|^(release|feature)\//;

/**
 * Pick what to review in a checkout:
 * - jj: the working-copy change, or the previous change when `@` is empty.
 * - git with uncommitted work: everything against HEAD. Plain `hunk diff` leaves out staged changes.
 * - git with several commits since the nearest integration branch: those commits as one diff.
 * - otherwise: the last commit.
 */
export async function reviewCommand(root: string): Promise<Review> {
	const run = (command: string, args: string[]) =>
		execFileAsync(command, args, { cwd: root, timeout: 5000 }).then(
			({ stdout }) => stdout,
			() => undefined,
		);
	if (await exists(path.join(root, ".jj"))) {
		const state = await run("jj", ["log", "-r", "@", "--no-graph", "-T", 'if(empty, "empty", "changed")']);
		return state?.trim() === "empty"
			? { args: ["show", "@-"], what: "the previous jj change (@ is empty)" }
			: { args: ["diff"], what: "the working-copy jj change" };
	}
	if ((await run("git", ["status", "--porcelain"]))?.trim()) return { args: ["diff", "HEAD"], what: "uncommitted changes" };
	// One call for every remote branch: how many of HEAD's commits each one lacks. The nearest
	// integration branch is the fork point; ties give the same diff, so prefer the shorter name.
	const [branch, refs] = await Promise.all([
		run("git", ["branch", "--show-current"]),
		run("git", ["for-each-ref", "--format=%(refname) %(ahead-behind:HEAD)", "refs/remotes"]),
	]);
	const current = branch?.trim() ?? "";
	let base: { ref: string; commits: number } | undefined;
	for (const line of refs?.split("\n") ?? []) {
		const [refname, , headOnly] = line.split(" ");
		const name = refname?.replace(/^refs\/remotes\/[^/]+\//, "");
		if (!name || !BASE_RE.test(name)) continue;
		// A feature branch's own pushed copy would hide its unpushed commits; develop's is its base.
		if (name === current && !TRUNK_RE.test(current)) continue;
		const ref = refname.replace(/^refs\/remotes\//, "");
		const commits = Number(headOnly);
		if (!base || commits < base.commits || (commits === base.commits && ref.length < base.ref.length)) base = { ref, commits };
	}
	if (base && base.commits > 1) return { args: ["diff", `${base.ref}...HEAD`], what: `the branch's ${base.commits} commits since ${base.ref}` };
	return { args: ["show"], what: "the last commit" };
}

async function processCwds(pids: number[]): Promise<Map<number, string>> {
	const cwds = new Map<number, string>();
	if (pids.length === 0) return cwds;
	if (process.platform === "linux") {
		await Promise.all(
			pids.map(async (pid) => {
				const cwd = await fs.readlink(`/proc/${pid}/cwd`).catch(() => undefined);
				if (cwd) cwds.set(pid, cwd);
			}),
		);
		return cwds;
	}
	// `lsof -F pn` prints `p<pid>` then `n<path>` for each process.
	const { stdout } = await execFileAsync("lsof", ["-a", "-d", "cwd", "-F", "pn", "-p", pids.join(",")], { timeout: 3000 }).catch(
		(error) => ({ stdout: String(error?.stdout ?? "") }),
	);
	let pid = 0;
	for (const line of stdout.split("\n")) {
		if (line.startsWith("p")) pid = Number(line.slice(1));
		else if (line.startsWith("n") && pid) cwds.set(pid, line.slice(1));
	}
	return cwds;
}

/** Routes in portless's state directory whose process is still alive. */
export async function liveDevRoutes(): Promise<DevRoute[]> {
	const dir = process.env.PORTLESS_STATE_DIR || path.join(os.homedir(), ".portless");
	const read = (name: string) => fs.readFile(path.join(dir, name), "utf8").catch(() => "");
	let routes: unknown;
	try {
		routes = JSON.parse(await read("routes.json"));
	} catch {
		return [];
	}
	if (!Array.isArray(routes)) return [];
	const tls = (await read("proxy.tls")).trim() === "1";
	const port = Number((await read("proxy.port")).trim()) || (tls ? 443 : 80);
	const suffix = port === (tls ? 443 : 80) ? "" : `:${port}`;
	const alive = routes.filter((route: any): route is { hostname: string; pid: number } => {
		if (typeof route?.hostname !== "string" || typeof route?.pid !== "number") return false;
		try {
			process.kill(route.pid, 0);
			return true;
		} catch (error: any) {
			return error?.code === "EPERM";
		}
	});
	const cwds = await processCwds([...new Set(alive.map((route) => route.pid))]);
	const roots = new Map<string, string | undefined>();
	for (const cwd of new Set(cwds.values())) roots.set(cwd, await repoRoot(cwd));
	return alive.map((route) => {
		const cwd = cwds.get(route.pid);
		return {
			host: route.hostname.toLowerCase(),
			url: `${tls ? "https" : "http"}://${route.hostname}${suffix}`,
			root: cwd ? roots.get(cwd) : undefined,
		};
	});
}
