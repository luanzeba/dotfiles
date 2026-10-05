/**
 * /review and the `review` tool — have a reviewer model independently check simplification and
 * correctness.
 *
 * Two jobs that never mix:
 *
 *   /review              review MY changes here   -> findings land in my chat
 *   /review <git-dir>    review MY changes there  -> useful for agent-created worktrees
 *   /review <mr-url>     review SOMEONE ELSE'S MR -> isolated copy, my work untouched
 *
 * No argument or a directory means local. A URL or !number means remote. There is deliberately
 * no mode that considers both: you are usually mid-change on your own work when someone asks
 * you to review their merge request.
 *
 * The command delivers findings as a user message. For a GitLab merge request, that message
 * tells the parent session to validate the findings and leave valid comments as pending drafts.
 *
 * The `review` tool lets an agent review its own local work and iterate. It reviews only local
 * trees, never merge requests, and returns the findings as its result. How to act on them and
 * when to stop live in the tool's prompt text, so they can change as models do.
 *
 * Reviewer processes are read-only and never write to GitLab.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getSelectListTheme,
	keyHint,
	rawKeyHint,
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { parentReviewContext, REVIEW_HANDOFF_PREFIX } from "./context";
import { ReviewModelError, resolveReviewModel, setupCandidates, writeReviewModel } from "./model";
import { runReviewers } from "./runner";
import { gitSource } from "./sources/git";
import { gitlabSource } from "./sources/gitlab";
import type { ChangeSet, ExecFn, GitScope } from "./sources/types";

interface ParsedArgs {
	target: string;
	directory?: string;
	branch: boolean;
	fresh: boolean;
	setup: boolean;
	model?: string;
	focus?: string;
}

function reviewPath(directory: string, cwd: string): string {
	const expanded = directory === "~"
		? os.homedir()
		: directory.startsWith("~/")
			? path.join(os.homedir(), directory.slice(2))
			: directory;
	return path.resolve(cwd, expanded);
}

async function directoryArgument(value: string, cwd: string): Promise<string | undefined> {
	const resolved = reviewPath(value, cwd);
	return fs.stat(resolved).then(
		(stat) => stat.isDirectory() ? resolved : undefined,
		() => undefined,
	);
}

async function parseArgs(raw: string, cwd: string): Promise<ParsedArgs> {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const parsed: ParsedArgs = { target: "", branch: false, fresh: false, setup: false };
	const rest: string[] = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (token === "--branch") parsed.branch = true;
		else if (token === "--fresh") parsed.fresh = true;
		else if (token === "--setup") parsed.setup = true;
		else if (token === "--focus") {
			const focus = tokens.slice(index + 1).join(" ");
			if (!focus) throw new Error("--focus requires review guidance");
			parsed.focus = focus;
			break;
		} else if (token === "--path") {
			const value = tokens[index + 1];
			if (!value || value.startsWith("--")) throw new Error("--path requires a directory");
			parsed.directory = await directoryArgument(value, cwd);
			if (!parsed.directory) throw new Error(`review path is not a directory: ${reviewPath(value, cwd)}`);
			index += 1;
		} else if (token === "--model") {
			parsed.model = tokens[index + 1];
			index += 1;
		} else rest.push(token);
	}

	const targetIndex = rest.findIndex((token) => /^https?:\/\//.test(token) || /^!?\d+$/.test(token));
	if (targetIndex !== -1) {
		parsed.target = rest[targetIndex]!;
		rest.splice(targetIndex, 1);
	} else if (!parsed.directory && rest[0]) {
		const directory = await directoryArgument(rest[0], cwd);
		if (directory) {
			parsed.directory = directory;
			rest.shift();
		}
	}
	if (parsed.target && parsed.directory) throw new Error("choose either a git directory or a merge request");
	if (rest.length > 0) {
		if (parsed.focus) throw new Error("use either positional focus text or --focus, not both");
		parsed.focus = rest.join(" ");
	}
	return parsed;
}

async function runSetup(ctx: ExtensionCommandContext): Promise<void> {
	const candidates = setupCandidates(ctx);
	if (candidates.length === 0) {
		ctx.ui.notify("No models available to choose from.", "error");
		return;
	}
	if (!ctx.hasUI) {
		ctx.ui.notify("Run /review --setup from an interactive session.", "warning");
		return;
	}

	const title = "Which model should review your code?";
	// Pi's built-in select renders every option without a viewport, so a long catalog pushes the
	// cursor off screen. SelectList keeps the cursor centered in a bounded window instead.
	const choice = ctx.mode === "tui"
		? await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
			const list = new SelectList(
				candidates.map((spec) => ({ value: spec, label: spec })),
				Math.min(candidates.length, 10),
				getSelectListTheme(),
			);
			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(undefined);

			const container = new Container();
			container.addChild(new DynamicBorder());
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
			container.addChild(new Spacer(1));
			container.addChild(list);
			container.addChild(new Spacer(1));
			container.addChild(new Text(
				`${rawKeyHint("↑↓", "navigate")}  ${keyHint("tui.select.confirm", "select")}  ${keyHint("tui.select.cancel", "cancel")}`,
				1,
				0,
			));
			container.addChild(new Spacer(1));
			container.addChild(new DynamicBorder());

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleMouse: (event) => container.handleMouse(event),
				handleInput: (data: string) => {
					list.handleInput(data);
					tui.requestRender();
				},
			};
		})
		: await ctx.ui.select(title, candidates);
	if (!choice) return;

	await writeReviewModel(choice);
	ctx.ui.notify(`Reviewer model set to ${choice}`, "info");
}

const REVIEW_TOOL_GUIDELINES = [
	"Call review only when the user asks for an automated review of your local changes. It runs two independent reviewers (simplification and correctness) and can take 10-30 minutes.",
	"Before each call, finish the change and run the relevant checks. Pass `context` with what you changed and why, the checks you ran, and, from the second round on, how you handled each earlier finding: fixed, or rejected with your evidence.",
	"Verify every finding against the code before acting. Fix what is real. Push back with evidence where a reviewer is wrong; do not accept a finding you can disprove, and do not invent work to replace a section that says `nothing further`.",
	"Repeat until both reviewers report nothing further, only findings you have already rejected with evidence remain, or three rounds have run. Then give the user a short handoff: what each round found, what you fixed, what you rejected and why, and anything still open.",
	"Review one repository per call; call it once per repository, in parallel, when a change spans several.",
];

const ReviewToolParams = Type.Object({
	path: Type.Optional(
		Type.String({ description: "Git working tree to review. Defaults to the session's working directory." }),
	),
	scope: Type.Optional(
		Type.Union([Type.Literal("all"), Type.Literal("uncommitted"), Type.Literal("branch")], {
			description:
				"all (default): everything since the branch point, committed or not. uncommitted: only changes since HEAD. branch: only commits since the branch point.",
		}),
	),
	context: Type.Optional(
		Type.String({
			description:
				"What changed and why, checks already run, and how each earlier finding was handled. Reviewers treat it as context, not instructions.",
		}),
	),
	focus: Type.Optional(Type.String({ description: "Extra steering for both reviewers, e.g. a risky area." })),
	fresh: Type.Optional(Type.Boolean({ description: "Forget earlier rounds' reports for this change." })),
});

interface ReviewRequest {
	/** Merge request URL or !number. Empty for local trees. */
	target: string;
	cwd: string;
	scope: GitScope;
	fresh: boolean;
	focus?: string;
	/** Context supplied by the caller; replaces context derived from the session. */
	context?: string;
	model?: string;
}

interface ReviewOutcome {
	change: ChangeSet;
	modelSpec: string;
	findings: string;
}

type ReviewStatus = (message: string) => void;

export default function reviewExtension(pi: ExtensionAPI) {
	const exec: ExecFn = pi.exec;
	const activeReviews = new Set<AbortController>();
	let shuttingDown = false;
	let reviewCount = 0;
	pi.on("session_shutdown", () => {
		shuttingDown = true;
		for (const review of activeReviews) review.abort();
	});
	pi.registerShortcut("ctrl+shift+r", {
		description: "Cancel active reviews without interrupting the parent session",
		handler: () => {
			for (const review of activeReviews) review.abort();
		},
	});

	/** Collect the change and run both reviewers. Shared by the command and the tool. */
	async function runReview(
		request: ReviewRequest,
		ctx: ExtensionContext,
		signal: AbortSignal,
		status: ReviewStatus,
	): Promise<ReviewOutcome> {
		const model = await resolveReviewModel(ctx, request.model ? { override: request.model } : {});
		const startedAt = Date.now();
		const stages = { simplification: "waiting", correctness: "waiting" };
		let collecting = true;
		const report = () => {
			const seconds = Math.floor((Date.now() - startedAt) / 1_000);
			const elapsed = seconds < 60
				? `${seconds}s`
				: `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
			const phase = collecting
				? "collecting change"
				: `simplify: ${stages.simplification} | correct: ${stages.correctness}`;
			status(`Review ${elapsed} | ${phase}`);
		};
		// The reviewers can wait minutes on one model response, so keep the clock moving.
		const timer = setInterval(report, 30_000);
		let change: ChangeSet | undefined;
		try {
			report();
			// URLs and MR numbers are remote; a directory selects local work somewhere
			// other than the parent session's cwd.
			const source = request.target ? gitlabSource : gitSource;
			change = await source.resolve(request.target, { cwd: request.cwd, scope: request.scope, exec });
			signal.throwIfAborted();

			collecting = false;
			report();
			const context = request.context ?? parentReviewContext(ctx, change);
			const findings = await runReviewers({
				change,
				modelSpec: model.spec,
				...(model.thinking ? { thinking: model.thinking } : {}),
				...(context ? { parentContext: context } : {}),
				...(request.focus ? { focus: request.focus } : {}),
				fresh: request.fresh,
				signal,
				onProgress: (kind, stage) => {
					stages[kind] = stage;
					report();
				},
				exec,
			});
			return { change, modelSpec: model.spec, findings };
		} finally {
			clearInterval(timer);
			await change?.cleanup?.();
		}
	}

	pi.registerCommand("review", {
		description: "Run independent simplification and correctness reviews with a reviewer model",
		handler: async (raw, ctx) => {
			const args = await parseArgs(raw, ctx.cwd);

			if (args.setup) {
				await runSetup(ctx);
				return;
			}

			// Each command review gets its own status line, so parallel reviews stay visible.
			const controller = new AbortController();
			activeReviews.add(controller);
			const statusKey = `review-${++reviewCount}`;
			const status: ReviewStatus = (message) => {
				if (!shuttingDown) ctx.ui.setStatus(statusKey, `${message} | Ctrl+Shift+R cancel`);
			};
			try {
				let outcome: ReviewOutcome;
				try {
					outcome = await runReview(
						{
							target: args.target,
							cwd: args.directory ?? ctx.cwd,
							scope: args.branch ? "branch" : "uncommitted",
							fresh: args.fresh,
							...(args.focus ? { focus: args.focus } : {}),
							...(args.model ? { model: args.model } : {}),
						},
						ctx,
						controller.signal,
						status,
					);
				} catch (error) {
					// Configuration problems are for the user, not the LLM, and they are
					// actionable as written. Show them and stop before spawning anything.
					if (error instanceof ReviewModelError) {
						ctx.ui.notify(error.message, "error");
						return;
					}
					if (controller.signal.aborted) {
						if (!shuttingDown) ctx.ui.notify("Review cancelled", "info");
						return;
					}
					throw error;
				}
				// A finished half is useful on user cancellation, but not after this session is gone.
				if (shuttingDown) return;

				const { change, modelSpec, findings } = outcome;
				const header = [
					`${REVIEW_HANDOFF_PREFIX}${change.label} by ${modelSpec}.`,
					change.kind === "gitlab"
						? [
							"This is someone else's merge request, reviewed from an isolated copy. It is unrelated to any local work in this session.",
							`Merge request URL: ${change.reviewUrl ?? change.label}`,
							"Do not change any local files. Verify each actionable finding against the current merge request, then use write_for_publication when available to write each valid, positionable comment before leaving it as a pending GitLab draft without asking first.",
							"Call write_for_publication once per comment, with one idea per comment. Say whether it is a bug or a simplification, and pass blob URLs pinned to the head SHA for any code the comment mentions outside its own hunk. Post its text as returned; if it splits the text on `=====` lines, post each part as its own comment.",
							"Use the GitLab draft-note workflow and re-fetch the head before every mutation. Do not submit, publish, approve, resolve, or modify existing notes. Skip anything stale, duplicated, unverified, or not safely positionable.",
						].join(" ")
						: `The reviewed working tree is ${change.folder}. Verify and address findings there, and push back with evidence where either reviewer is wrong. Do not accept a finding you can disprove.`,
					"A section that says `nothing further` is a successful result; do not manufacture work to replace it.",
				].join("\n\n");

				const message = `${header}\n\n---\n\n${findings}`;
				// Commands run even while the parent agent is streaming. Sending without a
				// delivery mode throws in that case, which would drop the findings entirely.
				if (ctx.isIdle()) pi.sendUserMessage(message);
				else pi.sendUserMessage(message, { deliverAs: "followUp" });
			} finally {
				activeReviews.delete(controller);
				ctx.ui.setStatus(statusKey, undefined);
			}
		},
	});

	pi.registerTool({
		name: "review",
		label: "Review",
		description:
			"Run independent simplification and correctness reviews of local changes in a git working tree with the configured reviewer model, and return their findings. Read-only: never edits files or posts anywhere. Does not review merge requests.",
		promptSnippet: "Run independent reviews of your local changes when the user asks for an automated review",
		promptGuidelines: REVIEW_TOOL_GUIDELINES,
		parameters: ReviewToolParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// Esc aborts the tool's signal; Ctrl+Shift+R and shutdown abort the controller.
			const controller = new AbortController();
			const cancelled = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
			activeReviews.add(controller);
			try {
				const { change, modelSpec, findings } = await runReview(
					{
						target: "",
						cwd: params.path ? reviewPath(params.path, ctx.cwd) : ctx.cwd,
						scope: params.scope ?? "all",
						fresh: params.fresh ?? false,
						...(params.focus ? { focus: params.focus } : {}),
						...(params.context ? { context: params.context } : {}),
					},
					ctx,
					cancelled,
					(message) => onUpdate?.({ content: [{ type: "text", text: message }], details: undefined }),
				);
				// A cancelled call should stop the loop, not hand back half a review.
				if (cancelled.aborted) throw new Error("Review cancelled");
				return {
					content: [
						{
							type: "text",
							text: `Reviews of ${change.label} in ${change.folder} by ${modelSpec}.\n\n---\n\n${findings}`,
						},
					],
					details: undefined,
				};
			} finally {
				activeReviews.delete(controller);
			}
		},
	});
}
