/**
 * /review — have a different model try to delete your code.
 *
 * Two jobs that never mix:
 *
 *   /review              review MY changes        -> findings land in my chat
 *   /review <mr-url>     review SOMEONE ELSE'S MR -> isolated copy, my work untouched
 *
 * The argument decides. No argument means local. A URL or !number means remote. There is
 * deliberately no mode that considers both: you are usually mid-change on your own work
 * when someone asks you to review their merge request.
 *
 * Findings come back as a user message. For a GitLab merge request, that message tells the
 * parent session to validate the findings and leave valid comments as pending drafts. The
 * reviewer process remains read-only and never writes to GitLab itself.
 */

import * as path from "node:path";
import { type ExtensionAPI, type ExtensionCommandContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { ReviewModelError, resolveReviewModel, setupCandidates, writeReviewModel } from "./model";
import { runReviewer } from "./runner";
import { gitSource } from "./sources/git";
import { gitlabSource } from "./sources/gitlab";
import type { ChangeSet, ExecFn } from "./sources/types";

const INSTRUCTIONS = path.join(getAgentDir(), "agents", "simplifier.md");

interface ParsedArgs {
	target: string;
	branch: boolean;
	fresh: boolean;
	force: boolean;
	setup: boolean;
	model?: string;
	focus?: string;
}

function parseArgs(raw: string): ParsedArgs {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const parsed: ParsedArgs = { target: "", branch: false, fresh: false, force: false, setup: false };
	const rest: string[] = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (token === "--branch") parsed.branch = true;
		else if (token === "--fresh") parsed.fresh = true;
		else if (token === "--force") parsed.force = true;
		else if (token === "--setup") parsed.setup = true;
		else if (token === "--model") {
			parsed.model = tokens[index + 1];
			index += 1;
		} else rest.push(token);
	}

	// A URL or !number is the review target; anything else is focus text.
	const targetIndex = rest.findIndex((token) => /^https?:\/\//.test(token) || /^!?\d+$/.test(token));
	if (targetIndex !== -1) {
		parsed.target = rest[targetIndex]!;
		rest.splice(targetIndex, 1);
	}
	if (rest.length > 0) parsed.focus = rest.join(" ");
	return parsed;
}

function summarize(change: ChangeSet): string {
	const parts = [`${change.label} · ${change.changedFiles.length} files`];
	if (change.priorComments?.length) parts.push(`${change.priorComments.length} existing comments`);
	return parts.join(" · ");
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

	const active = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	// ui.select works on plain strings, so annotate the active model inline and map back.
	const labels = candidates.map((spec) =>
		spec === active ? `${spec}  (same as current — not recommended)` : spec,
	);
	const chosenLabel = await ctx.ui.select("Which model should review your code?", labels);
	if (!chosenLabel) return;
	const choice = candidates[labels.indexOf(chosenLabel)];
	if (!choice) return;

	await writeReviewModel(choice);
	ctx.ui.notify(`Reviewer model set to ${choice}`, "info");
}

export default function reviewExtension(pi: ExtensionAPI) {
	const exec: ExecFn = (command, args, options) => pi.exec(command, args, options);

	pi.registerCommand("review", {
		description: "Have a different model review the change and try to delete code",
		handler: async (raw, ctx) => {
			const args = parseArgs(raw);

			if (args.setup) {
				await runSetup(ctx);
				return;
			}

			let model: Awaited<ReturnType<typeof resolveReviewModel>>;
			try {
				model = await resolveReviewModel(ctx, {
					...(args.model ? { override: args.model } : {}),
					force: args.force,
				});
			} catch (error) {
				// Configuration problems are for the user, not the LLM, and they are
				// actionable as written. Show them and stop before spawning anything.
				if (error instanceof ReviewModelError) {
					ctx.ui.notify(error.message, "error");
					return;
				}
				throw error;
			}

			let change: ChangeSet | undefined;
			try {
				ctx.ui.setStatus("review", "Collecting the change...");
				// An argument means a merge request; its absence means local work. That is the
				// whole routing rule, and parseArgs has already decided which one this is.
				const source = args.target ? gitlabSource : gitSource;
				change = await source.resolve(args.target, {
					cwd: ctx.cwd,
					branch: args.branch,
					exec,
				});

				ctx.ui.setStatus("review", `Reviewing ${summarize(change)} with ${model.id}...`);
				const result = await runReviewer({
					change,
					modelSpec: model.spec,
					...(model.thinking ? { thinking: model.thinking } : {}),
					instructionsPath: INSTRUCTIONS,
					...(args.focus ? { focus: args.focus } : {}),
					fresh: args.fresh,
					exec,
				});

				const header = [
					`Review of ${change.label} by ${model.spec}.`,
					change.kind === "gitlab"
						? [
							"This is someone else's merge request, reviewed from an isolated copy. It is unrelated to any local work in this session.",
							`Merge request URL: ${change.reviewUrl ?? change.label}`,
							"Do not change any local files. Verify each actionable finding against the current merge request, then leave each valid, positionable comment as a pending GitLab draft without asking first.",
							"Use the GitLab draft-note workflow and re-fetch the head before every mutation. Do not submit, publish, approve, resolve, or modify existing notes. Skip anything stale, duplicated, unverified, or not safely positionable.",
						].join(" ")
						: "Address what holds up and push back with evidence where the reviewer is wrong. Do not accept a finding you can disprove.",
				].join("\n\n");

				const message = `${header}\n\n---\n\n${result.findings}`;
				// Commands run even while the parent agent is streaming. Sending without a
				// delivery mode throws in that case, which would drop the findings entirely.
				if (ctx.isIdle()) pi.sendUserMessage(message);
				else pi.sendUserMessage(message, { deliverAs: "followUp" });
			} finally {
				ctx.ui.setStatus("review", undefined);
				await change?.cleanup?.();
			}
		},
	});
}
