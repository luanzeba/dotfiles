/**
 * Run the reviewer as a separate pi process.
 *
 * Separate process, not an in-process sub-agent, for three reasons:
 *   - it runs a different model with its own provider auth
 *   - it gets its own context window, so a long review does not crowd the parent session
 *   - it keeps its own session across rounds, which is what lets round 3 say
 *     "this is the third copy of this code" and "I was wrong last round"
 *
 * Verified: two `-p` runs sharing one --session-id continue the same conversation; the
 * second does not start fresh and the session file contains both turns.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { cacheRoot } from "./sources/materialize";
import type { ChangeSet, PriorComment } from "./sources/types";

export interface RunnerOptions {
	change: ChangeSet;
	modelSpec: string;
	thinking?: string;
	instructionsPath: string;
	/** Extra steering from the user, e.g. "/review focus on the date handling". */
	focus?: string;
	fresh?: boolean;
	signal?: AbortSignal;
	exec: (
		command: string,
		args: string[],
		options?: { cwd?: string; timeout?: number; signal?: AbortSignal },
	) => Promise<{ stdout: string; stderr: string; code: number }>;
}

export interface RunnerResult {
	findings: string;
	sessionId: string;
}

const REVIEW_TIMEOUT_MS = 1000 * 60 * 30;
const MAX_DIFF_CHARS = 400_000;

function sessionDir(): string {
	return path.join(cacheRoot(), "sessions");
}

function baseSessionId(change: ChangeSet): string {
	return `pi-review-${change.reviewKey}`;
}

/**
 * Which session later rounds should resume.
 *
 * `--fresh` has to change what the *next* invocation picks up, not just skip history for one
 * process, otherwise the following plain `/review` silently returns to the old transcript.
 * A pointer file keeps that decision durable: `--fresh` writes a new generation, and every
 * later round reads it.
 */
async function currentSessionId(change: ChangeSet, fresh: boolean): Promise<string> {
	const base = baseSessionId(change);
	const pointer = path.join(sessionDir(), `${base}.current`);

	if (fresh) {
		const rotated = `${base}-${Date.now()}`;
		await fs.mkdir(sessionDir(), { recursive: true });
		await fs.writeFile(pointer, rotated, "utf8");
		return rotated;
	}

	try {
		const stored = (await fs.readFile(pointer, "utf8")).trim();
		if (stored) return stored;
	} catch {
		// No pointer yet: this change has only ever used the base session.
	}
	return base;
}

function formatPriorComments(comments: PriorComment[]): string {
	if (comments.length === 0) return "";
	const lines = comments.slice(0, 40).map((comment) => {
		const where = comment.file ? `${comment.file}${comment.line ? `:${comment.line}` : ""} ` : "";
		return `- ${where}(${comment.author}): ${comment.body.split("\n")[0]!.slice(0, 200)}`;
	});
	return [
		"",
		"## Comments humans already left",
		"Do not repeat these. Say so if you disagree with one.",
		...lines,
	].join("\n");
}

function buildPrompt(options: RunnerOptions): string {
	const { change, focus } = options;
	const diff = change.diff.length > MAX_DIFF_CHARS
		? `${change.diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS} characters; read the files in the folder for the rest]`
		: change.diff;

	return [
		"# Review",
		"",
		`Reviewing: ${change.label}`,
		`Read the code here: ${change.folder}`,
		change.kind === "git"
			? "This is the author's own working tree. Do not modify anything in it."
			: "This is an isolated copy of someone else's change. The user's own work is unrelated and must not be mentioned.",
		"",
		`Changed files (${change.changedFiles.length}):`,
		...change.changedFiles.slice(0, 100).map((file) => `  ${file}`),
		change.changedFiles.length > 100 ? `  ... and ${change.changedFiles.length - 100} more` : "",
		change.intent ? `\n## What this change is for\n${change.intent}` : "",
		formatPriorComments(change.priorComments ?? []),
		focus ? `\n## The user specifically asked you to focus on\n${focus}` : "",
		"",
		"## Diff",
		"```diff",
		diff,
		"```",
	]
		.filter((line) => line !== "")
		.join("\n");
}

/** Reuse pi's own launcher so the reviewer runs the same build as the parent. */
function piInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	const isBunVirtual = script?.startsWith("/$bunfs/root/");
	if (script && !isBunVirtual) {
		return { command: process.execPath, args: [script, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

export async function runReviewer(options: RunnerOptions): Promise<RunnerResult> {
	const dir = sessionDir();
	await fs.mkdir(dir, { recursive: true });

	const id = await currentSessionId(options.change, options.fresh ?? false);

	const promptDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-review-prompt-"));
	const promptFile = path.join(promptDir, "task.md");
	await fs.writeFile(promptFile, buildPrompt(options), { mode: 0o600 });

	const args = [
		"--session-id",
		id,
		"--session-dir",
		dir,
		"--model",
		options.modelSpec,
		...(options.thinking ? ["--thinking", options.thinking] : []),
		"--tools",
		"read,grep,find,ls,bash",
		// Skills and project context files carry their own instructions, including how to post
		// review comments. Keep them out so this reviewer stays read-only; the parent session
		// validates findings and creates pending drafts after the reviewer returns.
		//
		// Extension discovery stays on deliberately. Provider registration lives in an
		// extension on this setup (the proxy that supplies the reviewer's own model), so
		// --no-extensions makes the child unable to authenticate at all. The read-only rule is
		// enforced by --tools and the mandate rather than by starving the child of providers.
		"--no-skills",
		"--no-context-files",
		"--append-system-prompt",
		options.instructionsPath,
		// Text mode writes just the final assistant message to stdout; tool chatter goes to
		// stderr. That is exactly the findings text, so there is no event stream to parse.
		"--mode",
		"text",
		"-p",
		`@${promptFile}`,
	];

	try {
		const invocation = piInvocation(args);
		const result = await options.exec(invocation.command, invocation.args, {
			cwd: options.change.folder,
			timeout: REVIEW_TIMEOUT_MS,
			...(options.signal ? { signal: options.signal } : {}),
		});

		const findings = result.stdout.trim();
		if (!findings) {
			const detail = result.stderr.trim().slice(-500);
			throw new Error(`the reviewer produced no output${detail ? `:\n${detail}` : ""}`);
		}
		return { findings, sessionId: id };
	} finally {
		await fs.rm(promptDir, { recursive: true, force: true });
	}
}
