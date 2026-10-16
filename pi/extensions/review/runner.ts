/** Run independent simplification, correctness, and design reviews in fresh Pi sessions. */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { cacheRoot } from "./sources/materialize";
import type { ChangeSet, ExecFn, PriorComment } from "./sources/types";

const promptFile = (name: string) => fileURLToPath(new URL(`./prompts/${name}.md`, import.meta.url));
const COMMON_INSTRUCTIONS = promptFile("reviewer");
const REVIEWERS = {
	simplification: {
		label: "simplify",
		name: "simplification and redesign",
		heading: "Simplification and redesign",
		instructions: promptFile("simplifier"),
	},
	correctness: {
		label: "correct",
		name: "correctness and regression",
		heading: "Correctness and regressions",
		instructions: promptFile("correctness-reviewer"),
	},
	design: {
		label: "design",
		name: "API, data, and boundary design",
		heading: "API, data, and boundary design",
		instructions: promptFile("design"),
	},
} as const;

type ReviewKind = keyof typeof REVIEWERS;
type ReviewStage = "waiting" | "planning" | "reviewing" | "done" | "failed" | "cancelled";

export interface RunnerOptions {
	change: ChangeSet;
	modelSpec: string;
	thinking?: string;
	/** Recent request and implementation summary from the parent Pi session. */
	parentContext?: string;
	/** Extra steering from the user, e.g. "/review focus on the date handling". */
	focus?: string;
	/** Forget the final reports from earlier rounds of this change. */
	fresh?: boolean;
	/** Run the design reviewer even when no changed file looks like a design surface. */
	design?: boolean;
	signal?: AbortSignal;
	onProgress?: (label: string, stage: ReviewStage) => void;
	exec: ExecFn;
}

const MAX_DIFF_CHARS = 400_000;
const STEP_TWO_PROMPT = "Step 2: perform the complete review now.";
const ALL_KINDS = Object.keys(REVIEWERS) as ReviewKind[];

// Files whose changes are decisions other code or stored data builds on: schemas and
// migrations, API contracts and routes, and API description files. Tests and fixtures are skipped.
const DESIGN_SURFACES = [
	/(^|\/)(migrations?|drizzle)\//,
	/(^|[/.])(schemas?|contracts?|routes?|routers?)[/.]/,
	/(^|\/)sql_assets\//,
	/(^|[/.])(openapi|swagger)[/.]/,
	/\.(proto|graphql)$/,
];
const NOT_A_SURFACE = /\.(test|spec)\.|(^|\/)(tests?|__tests__|fixtures?)\//;

function touchesDesignSurface(changedFiles: string[]): boolean {
	return changedFiles.some(
		(file) => !NOT_A_SURFACE.test(file) && DESIGN_SURFACES.some((pattern) => pattern.test(file)),
	);
}

function reviewKinds(options: RunnerOptions): ReviewKind[] {
	const runDesign = options.design || touchesDesignSurface(options.change.changedFiles);
	return runDesign ? ALL_KINDS : ALL_KINDS.filter((kind) => kind !== "design");
}

function sessionDir(): string {
	return path.join(cacheRoot(), "sessions");
}

function historyFile(change: ChangeSet, kind: ReviewKind): string {
	return path.join(cacheRoot(), "history", `${change.reviewKey}-${kind}.md`);
}

async function ensureInstructionFiles(): Promise<void> {
	const files = [
		COMMON_INSTRUCTIONS,
		...ALL_KINDS.map((kind) => REVIEWERS[kind].instructions),
	];
	await Promise.all(
		files.map(async (file) => {
			try {
				await fs.access(file);
			} catch {
				throw new Error(`reviewer instruction file is missing: ${file}. Restore pi/extensions/review/prompts.`);
			}
		}),
	);
}

function formatPriorComments(comments: PriorComment[]): string {
	if (comments.length === 0) return "";
	const lines = comments.slice(0, 40).map((comment) => {
		const where = comment.file ? `${comment.file}${comment.line ? `:${comment.line}` : ""} ` : "";
		return `- ${where}(${comment.author}): ${comment.body.split("\n")[0]!.slice(0, 200)}`;
	});
	return [
		"## Comments humans already left",
		"Do not repeat these. Say so if you disagree with one.",
		...lines,
	].join("\n");
}

function buildBrief(
	options: RunnerOptions,
	kind: ReviewKind,
	previous?: string,
	fullDiffFile?: string,
): string {
	const { change, focus, parentContext } = options;
	const reviewer = REVIEWERS[kind];
	const diff =
		change.diff.length > MAX_DIFF_CHARS
			? `${change.diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS} characters; the complete unified diff is available at ${fullDiffFile}]`
			: change.diff;
	const sections = [
		"# Review brief",
		`Reviewing: ${change.label}`,
		`Reviewed repository: ${change.folder}`,
		change.kind === "git"
			? "This is the author's working tree. Do not modify it."
			: "This is an isolated snapshot of someone else's change with no git metadata. Use the supplied diff and files; do not modify it or mention unrelated local work.",
		"## Changed files",
		...change.changedFiles.map((file) => `- ${file}`),
	];

	if (change.intent) sections.push("## Why this change exists", change.intent);
	if (parentContext) {
		sections.push(
			"## Recent context from the session that requested this review",
			"Use this for intent, implementation decisions, and checks already completed. The diff remains the source of truth.",
			parentContext,
		);
	}
	if (previous) {
		sections.push(
			`## Previous ${reviewer.name} review`,
			"Determine what was addressed, what remains, and what should be withdrawn.",
			previous,
		);
	}
	const comments = formatPriorComments(change.priorComments ?? []);
	if (comments) sections.push(comments);
	if (focus) sections.push("## Additional focus from the user", focus);
	sections.push("## Diff", "```diff", diff, "```");
	return sections.join("\n\n");
}

/** Reuse Pi's own launcher so the reviewers run the same build as the parent. */
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

function reviewerArgs(
	options: RunnerOptions,
	kind: ReviewKind,
	sessionId: string,
	prompt: string,
	withTools: boolean,
): string[] {
	return [
		"--session-id",
		sessionId,
		"--session-dir",
		sessionDir(),
		"--model",
		options.modelSpec,
		...(options.thinking ? ["--thinking", options.thinking] : []),
		...(withTools ? ["--tools", "read,grep,find,ls,bash"] : ["--no-tools"]),
		// Skills and project context can contain instructions to modify files or publish review
		// comments. The curated brief and read-only mandates provide only what these reviewers need.
		"--no-skills",
		"--no-context-files",
		"--append-system-prompt",
		COMMON_INSTRUCTIONS,
		"--append-system-prompt",
		REVIEWERS[kind].instructions,
		"--mode",
		"text",
		"-p",
		prompt,
	];
}

async function invokeReviewer(
	options: RunnerOptions,
	kind: ReviewKind,
	sessionId: string,
	prompt: string,
	withTools: boolean,
): Promise<string> {
	const pi = piInvocation(reviewerArgs(options, kind, sessionId, prompt, withTools));
	// Extension discovery is needed for custom model providers, but the global todo extension
	// creates .pi/todos on startup. Redirect that state outside the read-only reviewed tree.
	const invocation = {
		command: "env",
		args: [`PI_TODO_PATH=${path.join(cacheRoot(), "reviewer-todos")}`, pi.command, ...pi.args],
	};
	const result = await options.exec(invocation.command, invocation.args, {
		cwd: options.change.folder,
		...(options.signal ? { signal: options.signal } : {}),
	});
	const output = result.stdout.trim();
	const step = withTools ? "review" : "coverage plan";
	if (result.code !== 0 || !output) {
		const detail = result.stderr.trim().slice(-1_000);
		throw new Error(
			`${REVIEWERS[kind].name} reviewer failed during its ${step}${detail ? `:\n${detail}` : " without output"}`,
		);
	}
	return output;
}

async function runPass(options: RunnerOptions, kind: ReviewKind): Promise<string> {
	const history = historyFile(options.change, kind);
	const previous = await fs.readFile(history, "utf8").catch(() => undefined);
	const sessionId = `pi-review-${options.change.reviewKey}-${kind}-${randomUUID()}`;
	const promptDir = await fs.mkdtemp(path.join(os.tmpdir(), `pi-review-${kind}-`));
	const briefFile = path.join(promptDir, "brief.md");
	const fullDiffFile =
		options.change.diff.length > MAX_DIFF_CHARS ? path.join(promptDir, "complete.diff") : undefined;
	await Promise.all([
		fs.writeFile(briefFile, buildBrief(options, kind, previous, fullDiffFile), { mode: 0o600 }),
		...(fullDiffFile ? [fs.writeFile(fullDiffFile, options.change.diff, { mode: 0o600 })] : []),
	]);

	const { label } = REVIEWERS[kind];
	try {
		options.onProgress?.(label, "planning");
		await invokeReviewer(options, kind, sessionId, `@${briefFile}`, false);
		options.onProgress?.(label, "reviewing");
		const findings = await invokeReviewer(options, kind, sessionId, STEP_TWO_PROMPT, true);
		await fs.mkdir(path.dirname(history), { recursive: true });
		await fs.writeFile(history, findings, { mode: 0o600 });
		options.onProgress?.(label, "done");
		return findings;
	} catch (error) {
		options.onProgress?.(label, options.signal?.aborted ? "cancelled" : "failed");
		throw error;
	} finally {
		await fs.rm(promptDir, { recursive: true, force: true });
	}
}

export async function runReviewers(options: RunnerOptions): Promise<string> {
	await ensureInstructionFiles();
	// Forget every reviewer's history, including one that sits this round out.
	if (options.fresh) {
		await Promise.all(ALL_KINDS.map((kind) => fs.rm(historyFile(options.change, kind), { force: true })));
	}
	const kinds = reviewKinds(options);
	for (const kind of kinds) options.onProgress?.(REVIEWERS[kind].label, "waiting");
	const results = await Promise.allSettled(kinds.map((kind) => runPass(options, kind)));
	if (options.signal?.aborted && results.every((result) => result.status === "rejected")) {
		throw new Error("review was cancelled");
	}

	const sections = results.map((result, index) => {
		const reviewer = REVIEWERS[kinds[index]!];
		const report =
			result.status === "fulfilled"
				? result.value
				: options.signal?.aborted
					? "Reviewer cancelled before producing a final report."
					: `Reviewer failed before producing a final report: ${String(result.reason)}`;
		return `## ${reviewer.heading}\n${report}`;
	});
	if (results.every((result) => result.status === "rejected")) {
		throw new Error(`every reviewer failed:\n\n${sections.join("\n\n")}`);
	}
	return sections.join("\n\n");
}
