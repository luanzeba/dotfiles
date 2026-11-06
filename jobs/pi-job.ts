/**
 * Budget for unattended `pi -p` runs started by dotfiles jobs (jobs/jobs.mjs loads this with -e).
 *
 * Adds up what each model response cost and stops the run before it continues past PI_JOB_MAX_COST
 * dollars or PI_JOB_MAX_TURNS responses. Writes the session file, cost, tokens, and turns to
 * PI_JOB_RECORD, which `dot jobs <job>` shows. Does nothing outside a job.
 */

import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Usage {
	totalTokens?: number;
	cost?: { total?: number };
}

export default function (pi: ExtensionAPI) {
	const recordFile = process.env.PI_JOB_RECORD;
	if (!recordFile) return;
	// The runner always sets both (jobs.json validates them as positive).
	const maxCost = Number(process.env.PI_JOB_MAX_COST);
	const maxTurns = Number(process.env.PI_JOB_MAX_TURNS);
	const record: { session?: string; cost: number; tokens: number; turns: number; stopped?: string } = {
		cost: 0,
		tokens: 0,
		turns: 0,
	};
	const save = () => writeFileSync(recordFile, JSON.stringify(record));

	pi.on("session_start", (_event, ctx) => {
		record.session = ctx.sessionManager.getSessionFile();
		save();
	});

	pi.on("message_end", (event, ctx) => {
		const message = event.message as { role: string; usage?: Usage; stopReason?: string };
		// Tool results carry usage when the tool did its own model work.
		record.cost += message.usage?.cost?.total ?? 0;
		record.tokens += message.usage?.totalTokens ?? 0;
		if (message.role === "assistant") record.turns++;
		// Only a response that asks for tools continues the run; stop it before those tools run.
		if (message.role === "assistant" && message.stopReason === "toolUse" && !record.stopped) {
			if (record.cost >= maxCost) {
				record.stopped = `spent $${record.cost.toFixed(2)} of its $${maxCost} budget`;
			} else if (record.turns >= maxTurns) {
				record.stopped = `reached its turn limit (${maxTurns})`;
			}
		}
		save();
		if (record.stopped) ctx.abort();
	});
}
