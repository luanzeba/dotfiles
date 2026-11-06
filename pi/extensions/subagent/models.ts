/**
 * Which model a child runs on: the call's choice, the active profile's, the top-level one, or the
 * parent's; README.md's "Models" section has the details. No pi imports, so `node --test` can run it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { agentDir } from "./store.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface ModelChoice {
	provider: string;
	id: string;
	thinking: string;
	/** Where the model came from, for error messages; undefined when it is the parent's. */
	from?: string;
}

interface Input {
	settings: Record<string, unknown>;
	/** The active profile's name (PI_PROFILE). */
	profile?: string;
	agent: string;
	parent: { provider: string; id: string; thinking: string };
	model?: string;
	thinking?: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function agentConfig(scope: Record<string, unknown> | undefined, agent: string): { model?: string; thinking?: string } {
	const config = object(object(scope?.subagents)?.[agent]);
	return {
		...(typeof config?.model === "string" && config.model.trim() ? { model: config.model.trim() } : {}),
		...(typeof config?.thinking === "string" ? { thinking: config.thinking } : {}),
	};
}

export function chooseModel(input: Input): ModelChoice {
	const profileScope = input.profile ? object(object(input.settings.profiles)?.[input.profile]) : undefined;
	const candidates = [
		{ from: "the tool call", ...(input.model ? { model: input.model } : {}), ...(input.thinking ? { thinking: input.thinking } : {}) },
		{ from: `profiles.${input.profile}.subagents.${input.agent}`, ...agentConfig(profileScope, input.agent) },
		{ from: `subagents.${input.agent}`, ...agentConfig(input.settings, input.agent) },
	];
	const picked = candidates.find((candidate) => candidate.model);
	// A thinking level goes with the model it was configured for; one configured alone applies to
	// the parent's model.
	const source = picked ?? candidates.slice(1).find((candidate) => candidate.thinking);
	const thinking = input.thinking ?? source?.thinking ?? input.parent.thinking;
	if (!(THINKING_LEVELS as readonly string[]).includes(thinking)) {
		throw new Error(`thinking level "${thinking}" is not one of ${THINKING_LEVELS.join(", ")}`);
	}
	if (!picked?.model) return { provider: input.parent.provider, id: input.parent.id, thinking };
	// A bare id means the parent's provider: the profile's account.
	const slash = picked.model.indexOf("/");
	const [provider, id] = slash > 0 ? [picked.model.slice(0, slash), picked.model.slice(slash + 1)] : [input.parent.provider, picked.model];
	return { provider, id, thinking, from: picked.from };
}

/** Catalog models close enough to a missing one to suggest. Compares the last dotted segment, so
 * "us.anthropic.claude-opus-5-5" still finds "claude-opus-5-5". */
export function nearMatches(id: string, catalog: { provider: string; id: string }[]): string[] {
	const tail = id.toLowerCase().split(".").pop() ?? id.toLowerCase();
	return catalog
		.filter((model) => model.id.toLowerCase().includes(tail) || tail.includes(model.id.toLowerCase()))
		.map((model) => `${model.provider}/${model.id}`)
		.slice(0, 8);
}

/** settings.json is machine-local and small; read it per call so edits apply without /reload. */
export function readSettings(): Record<string, unknown> {
	try {
		return object(JSON.parse(fs.readFileSync(path.join(agentDir(), "settings.json"), "utf8"))) ?? {};
	} catch {
		return {};
	}
}
