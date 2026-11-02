import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type ScopedModel,
} from "@earendil-works/pi-coding-agent";

/**
 * Switch a running pi between profiles: named sets of environment variables, scoped models, and
 * reviewer model, for a machine that reaches models through more than one account.
 *
 * Profiles live in the machine-local ~/.pi/agent/settings.json. Without a `profiles` key this
 * extension does nothing, so other machines are unaffected.
 *
 *   "profiles": {
 *     "work": {
 *       "enabledModels": ["openai/us.anthropic.claude-opus-5-5", "openai/gpt-6-sol"],
 *       "review": { "model": "openai/us.anthropic.claude-opus-5-5", "thinking": "xhigh" }
 *     },
 *     "personal": {
 *       "env": { "ANTHROPIC_AUTH_TOKEN": null, "ANTHROPIC_BASE_URL": null },
 *       "enabledModels": ["claude-code/claude-opus-5-5", "claude-code/claude-sonnet-5-5"],
 *       "review": { "model": "claude-code/claude-opus-5-5", "thinking": "xhigh" }
 *     }
 *   }
 *
 * - `env` applies on top of the environment pi started with: a string sets the variable, null
 *   unsets it. Switching to a profile that doesn't list a variable puts the original value back.
 *   Providers that read the environment per request (Claude Code does) and every child process,
 *   including /review's reviewers, see the change.
 * - `enabledModels` replaces this session's scoped models (Ctrl+P, /model) with exact
 *   provider/id specs. Settings are not changed. New sessions and switches select the first one
 *   unless the current model is in the list; after `pi --model` or `--models`, only switches do.
 * - `review` is read by /review and write_for_publication; /review --setup writes it while the
 *   profile is active.
 *
 * The first profile is the default; `PI_PROFILE=personal pi` starts in another. `/profile <name>`
 * or `/<name>` switches. The active profile stays in PI_PROFILE, so /new keeps it, and each session
 * records the profile it used, so resuming a session switches back to it.
 */

interface Profile {
	env?: Record<string, string | null>;
	enabledModels?: string[];
}

type Model = ScopedModel["model"];

/** The models a profile put in scope, and anything that went wrong. */
interface Scope {
	models: Model[];
	problems: string[];
}

/** The active profile's name. The review extension reads it to pick the profile's reviewer. */
const ACTIVE_ENV = "PI_PROFILE";
const ENTRY_TYPE = "profile";
/** `pi --model` or `--models` picks the session's models; profiles change them only on a switch. */
const CLI_CHOOSES_MODELS = process.argv.some((arg) => /^--models?(=|$)/.test(arg));
/** Values from before any profile changed them, kept for the life of the process across reloads. */
const ORIGINAL_ENV = Symbol.for("dotfiles.pi.profiles.original-env");

function originalEnv(): Map<string, string | undefined> {
	const store = globalThis as { [ORIGINAL_ENV]?: Map<string, string | undefined> };
	store[ORIGINAL_ENV] ??= new Map();
	return store[ORIGINAL_ENV];
}

function setEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

function restoreEnv(): void {
	for (const [name, value] of originalEnv()) setEnv(name, value);
}

function applyEnv(env: Profile["env"] = {}): void {
	restoreEnv();
	const original = originalEnv();
	for (const [name, value] of Object.entries(env)) {
		if (!original.has(name)) original.set(name, process.env[name]);
		setEnv(name, typeof value === "string" ? value : undefined);
	}
}

async function readProfiles(): Promise<Record<string, Profile>> {
	try {
		const settings = JSON.parse(await fs.readFile(path.join(getAgentDir(), "settings.json"), "utf8"));
		const profiles: unknown = settings?.profiles;
		if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) return {};
		return Object.fromEntries(Object.entries(profiles).filter(([, profile]) => profile && typeof profile === "object"));
	} catch {
		return {};
	}
}

function storedProfile(ctx: ExtensionContext): string | undefined {
	let name: string | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
			const data = entry.data as { name?: unknown } | undefined;
			if (typeof data?.name === "string") name = data.name;
		}
	}
	return name;
}

export default async function (pi: ExtensionAPI) {
	const profiles = await readProfiles();
	const names = Object.keys(profiles);
	if (names.length === 0) return;

	let active = names[0];
	/** The profile this session's branch last recorded. */
	let recorded: string | undefined;

	function findModels(ctx: ExtensionContext, specs: string[]) {
		return specs.map((spec) => {
			const slash = spec.indexOf("/");
			return slash > 0 ? ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1)) : undefined;
		});
	}

	/** Switch the environment, and record the profile and show it when the session has a UI. */
	function apply(name: string, ctx: ExtensionContext): void {
		active = name;
		process.env[ACTIVE_ENV] = name;
		applyEnv(profiles[name].env);
		// Reviewers and other print-mode children inherit the environment; the rest is for the
		// interactive session.
		if (!ctx.hasUI) return;
		// Resuming the session restores this. Pi holds entries in memory until the session has a
		// conversation, so recording never leaves an empty session file behind.
		if (recorded !== name) {
			pi.appendEntry(ENTRY_TYPE, { name });
			recorded = name;
		}
		ctx.ui.setStatus(ENTRY_TYPE, name);
	}

	/**
	 * Replace the session's scoped models. Extensions only get a read-only view, but it is the
	 * session's live list, so it is replaced in place.
	 */
	async function applyScope(name: string, ctx: ExtensionContext): Promise<Scope> {
		const specs = profiles[name].enabledModels;
		if (!Array.isArray(specs) || specs.length === 0) return { models: [], problems: [] };
		let found = findModels(ctx, specs);
		// Some providers discover their models after startup.
		if (found.includes(undefined)) {
			await ctx.modelRegistry.refresh({ signal: AbortSignal.timeout(15_000) }).catch(() => {});
			// Another switch happened while this one waited; it owns the scope now.
			if (active !== name) return { models: [], problems: [] };
			found = findModels(ctx, specs);
		}
		const models = found.filter((model) => model !== undefined);
		const missing = specs.filter((_, index) => !found[index]);
		const problems = missing.length ? [`Not available: ${missing.join(", ")}`] : [];
		if (models.length === 0) return { models, problems };

		const scope = ctx.scopedModels as ScopedModel[];
		scope.splice(0, scope.length, ...models.map((model) => ({ model })));
		if (ctx.scopedModels.length !== models.length || ctx.scopedModels.some((scoped, index) => scoped.model !== models[index])) {
			problems.push("pi did not accept the new scoped models; Ctrl+P still cycles the previous ones.");
		}
		return { models, problems };
	}

	/** Select the first scoped model unless the current one is in scope. Returns what happened. */
	async function selectInScope(models: Model[], ctx: ExtensionContext): Promise<string | undefined> {
		const current = ctx.model;
		const [first] = models;
		if (!first || models.some((model) => model.provider === current?.provider && model.id === current?.id)) return undefined;
		return (await pi.setModel(first))
			? `Model: ${first.provider}/${first.id}`
			: `Could not select ${first.provider}/${first.id}: its provider is not authenticated.`;
	}

	async function switchTo(name: string, ctx: ExtensionContext): Promise<void> {
		if (!profiles[name]) {
			ctx.ui.notify(`Unknown profile "${name}". Profiles: ${names.join(", ")}`, "error");
			return;
		}
		apply(name, ctx);
		const { models, problems } = await applyScope(name, ctx);
		const selected = await selectInScope(models, ctx);
		const lines = [`Profile: ${name}`, ...(selected ? [selected] : []), ...problems];
		ctx.ui.notify(lines.join("\n"), problems.length ? "warning" : "info");
	}

	pi.on("session_start", (_event, ctx) => {
		const stored = storedProfile(ctx);
		recorded = stored;
		const requested = process.env[ACTIVE_ENV];
		const name = [stored, requested].find((candidate) => candidate && profiles[candidate]) ?? names[0];
		if (requested && !profiles[requested] && ctx.hasUI) {
			ctx.ui.notify(`Unknown ${ACTIVE_ENV} "${requested}"; using the ${name} profile.`, "warning");
		}
		apply(name, ctx);
		if (!ctx.hasUI || CLI_CHOOSES_MODELS) return;

		// A fresh session starts on the profile's first model, as pi starts on the first scoped
		// model; a resumed one keeps its own. Don't hold up startup on a catalog refresh.
		const fresh = !ctx.sessionManager.getBranch().some((entry) => entry.type === "message");
		void applyScope(name, ctx)
			.then(async ({ models, problems }) => {
				const selected = fresh ? await selectInScope(models, ctx) : undefined;
				if (problems.length || selected?.startsWith("Could not")) {
					ctx.ui.notify([`Profile ${name}:`, ...(selected ? [selected] : []), ...problems].join("\n"), "warning");
				}
			})
			// The session can be replaced before this finishes, which invalidates ctx.
			.catch(() => {});
	});

	// Extensions loaded after a reload or session switch, such as provider registrations that read
	// API keys at load time, should see the environment pi started with. session_start reapplies.
	pi.on("session_shutdown", () => restoreEnv());

	pi.registerCommand("profile", {
		description: `Switch profile (${names.join(", ")})`,
		getArgumentCompletions: (prefix) =>
			names.filter((name) => name.startsWith(prefix.trim())).map((name) => ({ value: name, label: name })),
		handler: async (args, ctx) => {
			let name = args.trim();
			if (!name) {
				if (!ctx.hasUI) {
					ctx.ui.notify(`Profile: ${active}`, "info");
					return;
				}
				const choice = await ctx.ui.select(`Profile (current: ${active})`, names);
				if (!choice) return;
				name = choice;
			}
			await switchTo(name, ctx);
		},
	});

	for (const name of names) {
		pi.registerCommand(name, {
			description: `Switch to the ${name} profile`,
			handler: (_args, ctx) => switchTo(name, ctx),
		});
	}
}
