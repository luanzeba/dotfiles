/**
 * Run directories and the files a parent and its tab use to talk; README.md's "Files" section
 * describes them. No pi imports, so `node --test` can run it.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Set in every child's environment: marks it as a subagent and points at its run directory. */
export const CHILD_ENV = "PI_SUBAGENT_DIR";

/** A tab that hasn't started its task this long after it opened needs someone to look at it. */
export const START_TIMEOUT_MS = 90_000;

export interface Checkout {
	vcs: "jj" | "git";
	path: string;
	/** Root of the repository it was made from. */
	repo: string;
	/** The jj workspace name or the git branch. */
	ref: string;
}

/** A tab, as the parent recorded it at spawn and stop. */
export interface Meta {
	id: string;
	name: string;
	agent: string;
	cwd: string;
	/** provider/id */
	model: string;
	thinking: string;
	/** Session id of the pi that spawned it. */
	parent: string;
	/** The tab reports its answer after every turn (child.ts): to `reportTo`, or else to `parent`. */
	report?: boolean;
	/**
	 * The main agent's state repo (../agent-state), when the parent was the main agent. Reports go into
	 * its notes as files, so they reach whichever main-agent session runs next, and that session takes
	 * the tab on as its own.
	 */
	reportTo?: string;
	createdAt: string;
	rex?: { session: string; window: string; openedAt: string };
	checkout?: Checkout;
	stoppedAt?: string;
}

/** A tab, as its own pi reports it. */
export interface State {
	state: "busy" | "idle" | "exited";
	pid: number;
	/** It has started at least one prompt. */
	started: boolean;
	/** Its latest answer. */
	reply?: { text: string; error?: string };
	updatedAt: string;
}

export interface InboxMessage {
	message: string;
	delivery: "steer" | "followUp";
}

export type TabStatus = "starting" | "busy" | "idle" | "exited" | "stopped";

export function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

export function subagentsRoot(): string {
	return path.join(agentDir(), "subagents");
}

export function runFiles(dir: string) {
	return {
		meta: path.join(dir, "meta.json"),
		state: path.join(dir, "state.json"),
		session: path.join(dir, "session.jsonl"),
		scratch: path.join(dir, "scratch"),
		inbox: path.join(dir, "inbox"),
		checkout: path.join(dir, "checkout"),
	};
}

/** Write through a temporary file so a reader never sees half a document. */
export function writeJson(file: string, value: unknown): void {
	const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | undefined {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
}

/** Make a run directory, with its scratch directory, under a fresh short id. */
export function newRunDir(): { id: string; dir: string } {
	const root = subagentsRoot();
	fs.mkdirSync(root, { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 50; attempt++) {
		const id = randomBytes(3).toString("hex");
		const dir = path.join(root, id);
		try {
			fs.mkdirSync(dir, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
		fs.mkdirSync(runFiles(dir).scratch, { mode: 0o700 });
		return { id, dir };
	}
	throw new Error(`could not allocate a subagent id under ${root}`);
}

export function isRunId(id: string): boolean {
	return /^[0-9a-f]{6}$/.test(id);
}

export function runDir(id: string): string {
	if (!isRunId(id)) throw new Error(`not a subagent id: ${id}`);
	return path.join(subagentsRoot(), id);
}

export function readMeta(dir: string): Meta | undefined {
	return readJson<Meta>(runFiles(dir).meta);
}

export function writeMeta(dir: string, meta: Meta): void {
	writeJson(runFiles(dir).meta, meta);
}

export function updateMeta(dir: string, patch: Partial<Meta>): void {
	const meta = readMeta(dir);
	if (meta) writeMeta(dir, { ...meta, ...patch });
}

export function readState(dir: string): State | undefined {
	return readJson<State>(runFiles(dir).state);
}

export function writeState(dir: string, state: Omit<State, "updatedAt">): void {
	writeJson(runFiles(dir).state, { ...state, updatedAt: new Date().toISOString() });
}

export function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** What a tab is doing, from the parent's and the tab's files and whether its pi still runs. */
export function tabStatus(meta: Meta, state: State | undefined, alive: (pid: number) => boolean = pidAlive): TabStatus {
	if (meta.stoppedAt) return "stopped";
	// Until its pi checks in it may still be starting, or waiting at a prompt such as pi's trust prompt.
	if (!state?.pid) return "starting";
	if (state.state === "exited" || !alive(state.pid)) return "exited";
	return state.state === "busy" ? "busy" : "idle";
}

let enqueued = 0;

export function enqueue(dir: string, message: InboxMessage): void {
	const inbox = runFiles(dir).inbox;
	fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
	// Names sort in arrival order, also for two sends in the same millisecond.
	const sequence = String(enqueued++ % 1_000_000).padStart(6, "0");
	writeJson(path.join(inbox, `${Date.now()}-${sequence}-${randomBytes(3).toString("hex")}.json`), message);
}

export function pendingMessages(dir: string): { file: string; message: InboxMessage }[] {
	const inbox = runFiles(dir).inbox;
	let names: string[];
	try {
		names = fs.readdirSync(inbox).filter((name) => name.endsWith(".json")).sort();
	} catch {
		return [];
	}
	return names.flatMap((name) => {
		const file = path.join(inbox, name);
		const message = readJson<InboxMessage>(file);
		return message && typeof message.message === "string" ? [{ file, message }] : [];
	});
}

export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export function shortPath(file: string): string {
	const home = os.homedir();
	return file === home || file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

/**
 * Asked synchronously with `{ dir: undefined }`. A listener that sets `dir` is the main agent
 * (../agent-state), and `dir` its state repo: tabs spawned with `report: true` put their reports there
 * as notes, and every session that answers with the same `dir` takes those tabs on.
 */
export const REPORT_SINK_EVENT = "subagent:report-sink";
export interface ReportSinkRequest {
	dir?: string;
}

/** The first line of every report; the answer follows. */
export const REPORT_HEADER = /^Subagent tab ".*" \(subagent_tab id \S+\) finished a turn( with an error: .*)?\.$/;

/** A report carries this much of the answer; the parent's wait returns the rest. */
const REPORT_MAX_CHARS = 4_000;

/** The message a reporting tab sends its parent after a turn. */
export function reportText(name: string, id: string, reply: { text: string; error?: string }): string {
	const body = reply.text.length > REPORT_MAX_CHARS ? `${reply.text.slice(0, REPORT_MAX_CHARS)}\n[…trimmed; subagent_tab wait {id: "${id}"} returns all of it]` : reply.text;
	return [
		`Subagent tab "${name}" (subagent_tab id ${id}) finished a turn${reply.error ? ` with an error: ${reply.error}` : ""}.`,
		...(body ? ["", body] : []),
	].join("\n");
}
