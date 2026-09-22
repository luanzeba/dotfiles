/**
 * Which model reviews.
 *
 * This is a per-machine setting, not a per-invocation question, because the same intent
 * ("Terra implements, Opus reviews") needs different text on different machines:
 *
 *   work machine (BETA proxy)  reviewer = the proxy's Bedrock-style Claude id
 *   personal machine           reviewer = anthropic/claude-opus-5
 *
 * It lives in pi's settings.json, which on this setup is a gitignored per-machine file, so
 * the work and personal machines keep their own answer.
 *
 * When nothing is configured we refuse rather than guess. Guessing "some model that is not
 * the active one" is exactly how you end up naming a model whose provider reports itself
 * ready but cannot serve it, and getting a 401 halfway through a review.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ResolvedReviewModel {
	/** "provider/id" as pi's --model expects. */
	spec: string;
	provider: string;
	id: string;
	thinking?: string;
}

const SETTINGS_KEY = "review";

function settingsPath(): string {
	return path.join(getAgentDir(), "settings.json");
}

/**
 * Read settings straight from disk. Extensions get no settings API on ExtensionContext,
 * and this file is small enough that reading it per invocation costs nothing.
 */
async function readSettings(): Promise<Record<string, unknown>> {
	try {
		const raw = await fs.readFile(settingsPath(), "utf8");
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export async function readReviewConfig(): Promise<{ model?: string; thinking?: string }> {
	const settings = await readSettings();
	const raw = settings[SETTINGS_KEY];
	if (!raw || typeof raw !== "object") return {};
	const config = raw as Record<string, unknown>;
	return {
		...(typeof config.model === "string" ? { model: config.model } : {}),
		...(typeof config.thinking === "string" ? { thinking: config.thinking } : {}),
	};
}

/**
 * Write only our key back, preserving everything else and the file's formatting style.
 * Writes through the symlink so the real per-machine file is updated in place.
 */
export async function writeReviewModel(spec: string): Promise<void> {
	const settings = await readSettings();
	const existing = (settings[SETTINGS_KEY] as Record<string, unknown> | undefined) ?? {};
	settings[SETTINGS_KEY] = { ...existing, model: spec };
	const target = await fs.realpath(settingsPath()).catch(() => settingsPath());
	await fs.writeFile(target, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

interface CatalogModel {
	provider: string;
	id: string;
}

function availableModels(ctx: ExtensionContext): CatalogModel[] {
	const available = ctx.modelRegistry?.getAvailable?.() ?? [];
	return available.map((model: { provider: string; id: string }) => ({
		provider: model.provider,
		id: model.id,
	}));
}

function splitSpec(spec: string): { provider?: string; id: string } {
	const slash = spec.indexOf("/");
	if (slash === -1) return { id: spec };
	return { provider: spec.slice(0, slash), id: spec.slice(slash + 1) };
}

function formatModel(model: CatalogModel): string {
	return `${model.provider}/${model.id}`;
}

/**
 * Models close enough to the requested one to be worth suggesting.
 *
 * Compares the last dotted segment so a proxy-style id like
 * "us.anthropic.claude-opus-5" still finds "claude-opus-5".
 */
function nearMatches(spec: string, catalog: CatalogModel[]): string[] {
	const { id } = splitSpec(spec);
	const needle = id.toLowerCase();
	const tail = needle.split(".").pop() ?? needle;
	return catalog
		.filter((model) => {
			const candidate = model.id.toLowerCase();
			return candidate.includes(tail) || tail.includes(candidate);
		})
		.map(formatModel)
		.slice(0, 8);
}

export class ReviewModelError extends Error {}

/**
 * Resolve the reviewer model, failing before anything is spawned.
 *
 * Checks, in order:
 *   1. configured at all
 *   2. present in this machine's catalog
 *   3. its provider authenticates
 *   4. different from the model doing the implementing
 */
export async function resolveReviewModel(
	ctx: ExtensionContext,
	options: { override?: string; force?: boolean } = {},
): Promise<ResolvedReviewModel> {
	const config = await readReviewConfig();
	const spec = options.override?.trim() || config.model?.trim();

	if (!spec) {
		throw new ReviewModelError(
			[
				"No reviewer model configured.",
				"",
				"The reviewer must be a different model from the one writing the code, and the",
				"right name differs per machine, so this is set once and remembered.",
				"",
				"Run:  /review --setup",
				`Or add to ${settingsPath()}:`,
				'  "review": { "model": "provider/model-id", "thinking": "high" }',
			].join("\n"),
		);
	}

	// The BETA proxy discovers its Bedrock-backed models dynamically, so they are absent from
	// Pi's startup catalog until the first refresh.
	await ctx.modelRegistry.refresh({ signal: AbortSignal.timeout(15_000) }).catch(() => {});
	const catalog = availableModels(ctx);
	const { provider, id } = splitSpec(spec);
	const match = catalog.find((model) =>
		provider ? model.provider === provider && model.id === id : model.id === id,
	);

	if (!match) {
		const suggestions = nearMatches(spec, catalog);
		throw new ReviewModelError(
			[
				`Reviewer model "${spec}" is not available on this machine.`,
				...(suggestions.length
					? ["", "Close matches:", ...suggestions.map((s) => `  ${s}`)]
					: ["", "Run `pi --list-models` to see what is available."]),
				"",
				"Fix with:  /review --setup",
			].join("\n"),
		);
	}

	const auth = await ctx.modelRegistry?.getProviderAuth?.(match.provider);
	if (!auth) {
		throw new ReviewModelError(
			[
				`Provider "${match.provider}" is not authenticated, so the review would fail partway through.`,
				"",
				`Check with:  pi auth check --provider ${match.provider}`,
			].join("\n"),
		);
	}

	const active = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	const resolved = formatModel(match);
	if (active && active === resolved && !options.force) {
		throw new ReviewModelError(
			[
				`Reviewer model is the same as the active model (${resolved}).`,
				"",
				"A model reviewing its own work does not find its own over-engineering, which is",
				"the entire point of this command.",
				"",
				"Pick another with /review --setup, or pass --force to proceed anyway.",
			].join("\n"),
		);
	}

	return {
		spec: resolved,
		provider: match.provider,
		id: match.id,
		...(config.thinking ? { thinking: config.thinking } : {}),
	};
}

/**
 * Models worth offering in --setup: the session's scoped models first (the same set Ctrl+P
 * cycles), then the rest of the catalog. The active model goes last because it is the least
 * useful choice for a reviewer.
 */
export function setupCandidates(ctx: ExtensionContext): string[] {
	const scoped = (ctx.scopedModels ?? []).map((entry: { model: CatalogModel }) => formatModel(entry.model));
	const catalog = availableModels(ctx).map(formatModel);
	const pool = [...new Set([...scoped, ...catalog])];
	const active = ctx.model ? formatModel(ctx.model) : undefined;
	return [...pool.filter((m) => m !== active), ...(active && pool.includes(active) ? [active] : [])];
}
