/**
 * /review — have a reviewer model independently check simplification and correctness.
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
 * Findings come back as a user message. For a GitLab merge request, that message tells the
 * parent session to validate the findings and leave valid comments as pending drafts. The
 * reviewer process remains read-only and never writes to GitLab itself.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getSelectListTheme,
	keyHint,
	rawKeyHint,
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { parentReviewContext, REVIEW_HANDOFF_PREFIX } from "./context";
import { ReviewModelError, resolveReviewModel, setupCandidates, writeReviewModel } from "./model";
import { runReviewers } from "./runner";
import { gitSource } from "./sources/git";
import { gitlabSource } from "./sources/gitlab";
import type { ChangeSet, ExecFn } from "./sources/types";

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

export default function reviewExtension(pi: ExtensionAPI) {
	const exec: ExecFn = pi.exec;
	let activeReview: AbortController | undefined;
	const abandonedReviews = new WeakSet<AbortController>();
	pi.on("session_shutdown", () => {
		if (activeReview) {
			abandonedReviews.add(activeReview);
			activeReview.abort();
		}
	});
	pi.registerShortcut("ctrl+shift+r", {
		description: "Cancel the active /review without interrupting the parent session",
		handler: () => activeReview?.abort(),
	});

	pi.registerCommand("review", {
		description: "Run independent simplification and correctness reviews with a reviewer model",
		handler: async (raw, ctx) => {
			const args = await parseArgs(raw, ctx.cwd);

			if (args.setup) {
				await runSetup(ctx);
				return;
			}
			if (activeReview) {
				ctx.ui.notify("A review is already running", "warning");
				return;
			}

			let model: Awaited<ReturnType<typeof resolveReviewModel>>;
			try {
				model = await resolveReviewModel(ctx, args.model ? { override: args.model } : {});
			} catch (error) {
				// Configuration problems are for the user, not the LLM, and they are
				// actionable as written. Show them and stop before spawning anything.
				if (error instanceof ReviewModelError) {
					ctx.ui.notify(error.message, "error");
					return;
				}
				throw error;
			}

			const controller = new AbortController();
			activeReview = controller;
			const startedAt = Date.now();
			const stages = { simplification: "waiting", correctness: "waiting" };
			let collecting = true;
			const showProgress = () => {
				if (abandonedReviews.has(controller)) return;
				const seconds = Math.floor((Date.now() - startedAt) / 1_000);
				const elapsed = seconds < 60
					? `${seconds}s`
					: `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
				const phase = collecting
					? "collecting change"
					: `simplify: ${stages.simplification} | correct: ${stages.correctness}`;
				ctx.ui.setStatus("review", `Review ${elapsed} | ${phase} | Ctrl+Shift+R cancel`);
			};
			const timer = ctx.mode === "tui" ? setInterval(showProgress, 30_000) : undefined;
			let change: ChangeSet | undefined;
			try {
				showProgress();
				// URLs and MR numbers are remote; a directory selects local work somewhere
				// other than the parent session's cwd.
				const source = args.target ? gitlabSource : gitSource;
				change = await source.resolve(args.target, {
					cwd: args.directory ?? ctx.cwd,
					branch: args.branch,
					exec,
				});
				if (controller.signal.aborted) {
					if (!abandonedReviews.has(controller)) ctx.ui.notify("Review cancelled", "info");
					return;
				}

				collecting = false;
				showProgress();
				const parentContext = parentReviewContext(ctx, change);
				let findings: string;
				try {
					findings = await runReviewers({
						change,
						modelSpec: model.spec,
						...(model.thinking ? { thinking: model.thinking } : {}),
						...(parentContext ? { parentContext } : {}),
						...(args.focus ? { focus: args.focus } : {}),
						fresh: args.fresh,
						signal: controller.signal,
						onProgress: (kind, stage) => {
							stages[kind] = stage;
							showProgress();
						},
						exec,
					});
				} catch (error) {
					if (controller.signal.aborted) {
						if (!abandonedReviews.has(controller)) ctx.ui.notify("Review cancelled", "info");
						return;
					}
					throw error;
				}
				// A finished half is useful on user cancellation, but not after this session is gone.
				if (abandonedReviews.has(controller)) return;

				const header = [
					`${REVIEW_HANDOFF_PREFIX}${change.label} by ${model.spec}.`,
					change.kind === "gitlab"
						? [
							"This is someone else's merge request, reviewed from an isolated copy. It is unrelated to any local work in this session.",
							`Merge request URL: ${change.reviewUrl ?? change.label}`,
							"Do not change any local files. Verify each actionable finding against the current merge request, then use write_for_publication when available to write each valid, positionable comment before leaving it as a pending GitLab draft without asking first.",
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
				if (timer) clearInterval(timer);
				if (activeReview === controller) activeReview = undefined;
				ctx.ui.setStatus("review", undefined);
				await change?.cleanup?.();
			}
		},
	});
}
