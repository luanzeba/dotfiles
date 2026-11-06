/** The prompts a child starts with. No pi imports, so `node --test` can run it. */

import type { Agent } from "./agents.ts";
import type { Checkout } from "./store.ts";

const PREAMBLE = `You are a subagent: another pi agent, the parent, delegated the task in the first message to you. You can't see the parent's conversation, so work with what the task gives you and state any assumption you had to make. Your final message is returned to the parent as your result, so make it complete and self-contained. You can't start subagents of your own.`;

const TAB_NOTE = `You run in a Rex tab that the user can watch. The user or the parent may send you more messages; treat them as part of your task. When you're done, stop: the parent reads your last message.`;

export function systemPrompt(agent: Agent, inTab: boolean): string {
	return [PREAMBLE, inTab ? TAB_NOTE : "", agent.prompt].filter(Boolean).join("\n\n");
}

export interface TaskInput {
	task: string;
	brief?: string;
	scratch: string;
	/** This child's place among identical copies of the task, for swarms of two or more. */
	copy?: { index: number; count: number };
	checkout?: Checkout;
}

function checkoutNote(checkout: Checkout): string {
	return checkout.vcs === "jj"
		? `You work in your own jj workspace, "${checkout.ref}", made on top of the parent's working-copy change; the parent's checkout is ${checkout.repo}. Describe your change with \`jj describe\` when you're done. If jj says the working copy is stale, run \`jj workspace update-stale\`.`
		: `You work in your own git worktree on branch ${checkout.ref}, made from the parent's HEAD; uncommitted changes in the parent's checkout (${checkout.repo}) are not in it. Commit your work on that branch when you're done; never push it.`;
}

export function taskPrompt(input: TaskInput): string {
	const notes = [
		`Scratch directory for any files you create that aren't part of the task's output: ${input.scratch}`,
		...(input.copy
			? [`You are copy ${input.copy.index} of ${input.copy.count} running this same task; the others work independently, so don't coordinate with them.`]
			: []),
		...(input.checkout ? [checkoutNote(input.checkout)] : []),
	];
	return [input.brief?.trim(), input.task.trim(), `---\n${notes.join("\n")}`].filter(Boolean).join("\n\n");
}
