import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

type TabctlTab = {
	tabId: number;
	windowId: number;
	title: string;
	url: string;
	active: boolean;
	pinned: boolean;
	groupTitle?: string | null;
	lastAccessedAt?: number | null;
};

type TabReviewAction = "archive" | "delete" | "keep" | "stop";

type ArchiveDecision = {
	noteTitle: string;
	summary: string;
	topics: string[];
	aliases: string[];
	questions: string[];
	tags: string[];
};

type ArchiveWriteResult = {
	notePath: string;
	created: boolean;
	alreadyPresent: boolean;
};

type CloseTabResult = {
	txid?: string;
};

type TabBackend = {
	name: string;
	listTabs: (signal?: AbortSignal) => Promise<TabctlTab[]>;
	closeTab: (tabId: number, signal?: AbortSignal) => Promise<CloseTabResult>;
};

const DEFAULT_PROFILE_NAME = "Work";
const DEFAULT_CHROMIUM_USER_DATA_DIR = path.join(os.homedir(), "Library/Application Support/Chromium");
const DEFAULT_OBSIDIAN_NOTES_DIR = path.join(os.homedir(), "Obsidian/Personal/Notes");
const DEFAULT_TABCTL_EXTENSION_DIR = path.join(os.homedir(), ".local/state/tabctl/extension");

const TABCTL_TIMEOUT_MS = 1000 * 30;
const QMD_TIMEOUT_MS = 1000 * 60 * 20;
const TAB_REVIEW_QUERY_LIMIT = 500;

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function truncateText(text: string, maxChars = 12_000, maxLines = 300): string {
	if (!text) return "";
	const lines = text.split("\n");
	const clippedLines = lines.slice(0, maxLines);
	let out = clippedLines.join("\n");

	if (out.length > maxChars) {
		out = `${out.slice(0, maxChars)}\n... [truncated]`;
	}

	if (lines.length > maxLines) {
		out += `\n... [${lines.length - maxLines} additional lines truncated]`;
	}

	return out;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function getChromiumUserDataDir(): string {
	const override = process.env.TAB_ARCHIVE_CHROMIUM_DIR?.trim();
	return override ? path.resolve(override) : DEFAULT_CHROMIUM_USER_DATA_DIR;
}

function getObsidianNotesDir(): string {
	const override = process.env.TAB_ARCHIVE_OBSIDIAN_NOTES_DIR?.trim();
	return override ? path.resolve(override) : DEFAULT_OBSIDIAN_NOTES_DIR;
}

function getTabctlExtensionDir(): string {
	const override = process.env.TABCTL_EXTENSION_DIR?.trim();
	return override ? path.resolve(override) : DEFAULT_TABCTL_EXTENSION_DIR;
}

function sanitizeNoteFileName(input: string): string {
	const cleaned = input
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned || `Tab Archive ${new Date().toISOString().slice(0, 10)}`;
}

function escapeMarkdownText(input: string): string {
	return input.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function splitCsvInput(input: string | undefined): string[] {
	if (!input) return [];
	return input
		.split(/[\n,]/g)
		.map((part) => normalizeWhitespace(part))
		.filter(Boolean);
}

function normalizeTag(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9_-]/g, "");
}

function mergeUniqueCaseInsensitive(values: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const normalized = normalizeWhitespace(value);
		if (!normalized) continue;
		const key = normalized.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(normalized);
	}
	return out;
}

function tryParseJson(text: string | undefined): any | null {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function extractTabctlError(raw: any): string {
	const errors = raw?.errors;
	if (!Array.isArray(errors) || !errors.length) return "Unknown tabctl GraphQL error";
	return errors
		.map((error) => {
			if (typeof error?.message === "string") return error.message;
			return JSON.stringify(error);
		})
		.join("; ");
}

function extractTabctlFailureText(result: { stdout?: string; stderr?: string }): string {
	const stdout = (result.stdout || "").trim();
	const stderr = (result.stderr || "").trim();
	const parsedStdout = tryParseJson(stdout);
	const parsedStderr = tryParseJson(stderr);
	const parsed = parsedStdout ?? parsedStderr;
	if (parsed) {
		if (typeof parsed?.error?.message === "string") return parsed.error.message;
		if (Array.isArray(parsed?.errors) && parsed.errors.length) return extractTabctlError(parsed);
	}
	return stderr || stdout;
}

const TABCTL_BIN_CANDIDATES = [
	process.env.TABCTL_BIN,
	"tabctl",
	path.join(os.homedir(), ".local/bin/tabctl"),
	path.join(os.homedir(), ".cargo/bin/tabctl"),
].filter(Boolean) as string[];

let resolvedTabctlBin: string | undefined;

function looksLikeCommandNotFound(result: { code: number; stdout?: string; stderr?: string }): boolean {
	if (result.code === 127) return true;
	const text = `${result.stderr || ""}\n${result.stdout || ""}`.toLowerCase();
	return text.includes("command not found") || text.includes("no such file") || text.includes("not recognized");
}

async function resolveTabctlBinary(pi: ExtensionAPI): Promise<string> {
	if (resolvedTabctlBin) return resolvedTabctlBin;

	let lastFailure = "";
	for (const candidate of TABCTL_BIN_CANDIDATES) {
		if (!candidate) continue;
		const result = await pi.exec(candidate, ["--version"], { timeout: TABCTL_TIMEOUT_MS });
		if (result.code === 0) {
			resolvedTabctlBin = candidate;
			return candidate;
		}
		if (!looksLikeCommandNotFound(result)) {
			lastFailure = extractTabctlFailureText(result) || `exit code ${result.code}`;
		}
	}

	throw new Error(
		[
			"tabctl binary not found or not executable.",
			"Install it with one of:",
			"- mise use -g github:ekroon/tabctl",
			"- or download a release binary to ~/.local/bin/tabctl",
			lastFailure ? `Last error: ${truncateText(lastFailure)}` : undefined,
		]
			.filter(Boolean)
			.join("\n"),
	);
}

async function runTabctlJson(
	pi: ExtensionAPI,
	args: string[],
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<any> {
	const tabctlBin = await resolveTabctlBinary(pi);
	const result = await pi.exec(tabctlBin, ["--json", ...args], { timeout: timeoutMs, signal });
	const rawStdout = (result.stdout || "").trim();

	if (result.code !== 0) {
		const failureText = extractTabctlFailureText(result);
		if (!failureText) {
			throw new Error(
				`tabctl command failed: ${args.join(" ")}\n` +
					"No output returned. tabctl may be missing from PATH or not configured.",
			);
		}
		throw new Error(`tabctl command failed: ${args.join(" ")}\n${truncateText(failureText)}`);
	}

	if (!rawStdout) return {};
	const parsed = tryParseJson(rawStdout);
	if (parsed == null) {
		throw new Error(`Could not parse tabctl JSON output: ${truncateText(rawStdout)}`);
	}
	return parsed;
}

async function listTabctlProfiles(pi: ExtensionAPI, signal?: AbortSignal): Promise<string[]> {
	const profileList = await runTabctlJson(pi, ["profile-list"], TABCTL_TIMEOUT_MS, signal);
	const profiles = Array.isArray(profileList?.profiles) ? profileList.profiles : [];
	return profiles.map((profile: any) => String(profile?.name ?? "").trim()).filter(Boolean);
}

function resolveRequestedTabctlProfile(requestedProfile: string | undefined, availableProfiles: string[]): string | undefined {
	const requested = normalizeWhitespace(requestedProfile || "");
	if (!requested || !availableProfiles.length) return undefined;

	const exact = availableProfiles.find((name) => name.toLowerCase() === requested.toLowerCase());
	if (exact) return exact;

	const partial = availableProfiles.find((name) => name.toLowerCase().includes(requested.toLowerCase()));
	if (partial) return partial;

	return undefined;
}

function withOptionalProfile(profileName: string | undefined, args: string[]): string[] {
	if (!profileName?.trim()) return args;
	return ["--profile", profileName.trim(), ...args];
}

async function pingTabctl(
	pi: ExtensionAPI,
	profileName: string | undefined,
	signal?: AbortSignal,
): Promise<any> {
	return runTabctlJson(pi, withOptionalProfile(profileName, ["ping"]), TABCTL_TIMEOUT_MS, signal);
}

async function runAppleScriptJson(pi: ExtensionAPI, script: string, signal?: AbortSignal): Promise<any> {
	if (process.platform !== "darwin") {
		throw new Error("AppleScript fallback is only supported on macOS.");
	}

	const result = await pi.exec("osascript", ["-l", "JavaScript", "-e", script], {
		timeout: TABCTL_TIMEOUT_MS,
		signal,
	});

	if (result.code !== 0) {
		throw new Error(`AppleScript failed: ${truncateText(result.stderr || result.stdout || "Unknown error")}`);
	}

	const parsed = tryParseJson((result.stdout || "").trim());
	if (!parsed) {
		throw new Error(`AppleScript produced invalid JSON: ${truncateText(result.stdout || "")}`);
	}
	if (parsed.ok === false) {
		throw new Error(String(parsed.error || "AppleScript returned an error."));
	}
	return parsed;
}

async function listOpenTabsViaAppleScript(pi: ExtensionAPI, signal?: AbortSignal): Promise<TabctlTab[]> {
	const script = `(() => {
  try {
    const app = Application("Chromium");
    const windows = app.windows();
    const tabs = [];
    for (let wi = 0; wi < windows.length; wi++) {
      const w = windows[wi];
      let activeId = null;
      try { activeId = Number(w.activeTab().id()); } catch (_e) {}
      const windowTabs = w.tabs();
      for (let ti = 0; ti < windowTabs.length; ti++) {
        const tab = windowTabs[ti];
        const tabId = Number(tab.id());
        const url = String(tab.url() || "").trim();
        if (!Number.isFinite(tabId) || !url) continue;
        tabs.push({
          tabId,
          windowId: wi + 1,
          title: String(tab.title() || ""),
          url,
          active: activeId != null && tabId === activeId,
          pinned: false,
          groupTitle: null,
          lastAccessedAt: null,
        });
      }
    }
    return JSON.stringify({ ok: true, tabs });
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error) });
  }
})();`;

	const parsed = await runAppleScriptJson(pi, script, signal);
	const tabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
	return mapTabctlTabs(tabs);
}

async function closeTabViaAppleScript(pi: ExtensionAPI, tabId: number, signal?: AbortSignal): Promise<void> {
	const script = `(() => {
  try {
    const targetId = Number(${JSON.stringify(tabId)});
    const app = Application("Chromium");
    const windows = app.windows();
    for (let wi = 0; wi < windows.length; wi++) {
      const windowTabs = windows[wi].tabs();
      for (let ti = 0; ti < windowTabs.length; ti++) {
        const tab = windowTabs[ti];
        if (Number(tab.id()) === targetId) {
          tab.close();
          return JSON.stringify({ ok: true, closed: true });
        }
      }
    }
    return JSON.stringify({ ok: true, closed: false });
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error) });
  }
})();`;

	const parsed = await runAppleScriptJson(pi, script, signal);
	if (parsed?.closed !== true) {
		throw new Error(`Could not close Chromium tab ${tabId}.`);
	}
}

function createTabctlBackend(pi: ExtensionAPI, profileName: string | undefined): TabBackend {
	return {
		name: profileName ? `tabctl (${profileName})` : "tabctl",
		listTabs: (signal) => listOpenTabsFromTabctl(pi, profileName, signal),
		closeTab: async (tabId, signal) => ({ txid: await closeTabWithTabctl(pi, profileName, tabId, signal) }),
	};
}

function createAppleScriptBackend(pi: ExtensionAPI): TabBackend {
	return {
		name: "AppleScript (Chromium)",
		listTabs: (signal) => listOpenTabsViaAppleScript(pi, signal),
		closeTab: async (tabId, signal) => {
			await closeTabViaAppleScript(pi, tabId, signal);
			return {};
		},
	};
}

async function chooseTabBackend(
	pi: ExtensionAPI,
	requestedProfileName: string,
	onWarning: (message: string) => void,
): Promise<TabBackend> {
	try {
		const availableProfiles = await listTabctlProfiles(pi);
		const matchedProfile = resolveRequestedTabctlProfile(requestedProfileName, availableProfiles);
		const tabctlProfile = matchedProfile ?? (availableProfiles.length === 1 ? availableProfiles[0] : undefined);

		if (requestedProfileName && availableProfiles.length && !matchedProfile) {
			onWarning(`No exact tabctl profile for '${requestedProfileName}'. Using tabctl default profile.`);
		}

		await pingTabctl(pi, tabctlProfile);
		return createTabctlBackend(pi, tabctlProfile);
	} catch (error: any) {
		onWarning(`tabctl unavailable (${String(error?.message || error)}). Falling back to AppleScript.`);
		return createAppleScriptBackend(pi);
	}
}

async function runTabctlGraphqlQuery(
	pi: ExtensionAPI,
	profileName: string | undefined,
	query: string,
	timeoutMs = TABCTL_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<any> {
	const response = await runTabctlJson(pi, withOptionalProfile(profileName, ["query", query]), timeoutMs, signal);

	if (response?.errors) {
		throw new Error(extractTabctlError(response));
	}

	if (response?.data !== undefined) return response.data;
	return response;
}

function mapTabctlTabs(rawItems: any[]): TabctlTab[] {
	const tabs: TabctlTab[] = [];
	for (const raw of rawItems) {
		if (!raw || typeof raw !== "object") continue;
		const tabId = Number(raw.tabId);
		const windowId = Number(raw.windowId);
		const url = String(raw.url ?? "").trim();
		if (!Number.isFinite(tabId) || !Number.isFinite(windowId) || !url) continue;

		tabs.push({
			tabId,
			windowId,
			title: String(raw.title ?? "").trim(),
			url,
			active: Boolean(raw.active),
			pinned: Boolean(raw.pinned),
			groupTitle: raw.groupTitle == null ? null : String(raw.groupTitle),
			lastAccessedAt: raw.lastAccessedAt == null ? null : Number(raw.lastAccessedAt),
		});
	}
	return tabs;
}

async function listOpenTabsFromTabctl(
	pi: ExtensionAPI,
	profileName?: string,
	signal?: AbortSignal,
): Promise<TabctlTab[]> {
	const query = `
	query OpenTabsForReview {
	  tabs(orderBy: LAST_ACCESSED_DESC, limit: ${TAB_REVIEW_QUERY_LIMIT}, offset: 0) {
	    total
	    items {
	      tabId
	      windowId
	      title
	      url
	      active
	      pinned
	      groupTitle
	      lastAccessedAt
	    }
	  }
	}
	`;

	const data = await runTabctlGraphqlQuery(pi, profileName, query, TABCTL_TIMEOUT_MS, signal);
	const items = Array.isArray(data?.tabs?.items) ? data.tabs.items : [];
	return mapTabctlTabs(items);
}

async function closeTabWithTabctl(
	pi: ExtensionAPI,
	profileName: string | undefined,
	tabId: number,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const mutation = `
	mutation CloseTabForReview {
	  closeTabs(tabIds: [${tabId}], confirm: true) {
	    txid
	    closedTabs
	  }
	}
	`;
	const data = await runTabctlGraphqlQuery(pi, profileName, mutation, TABCTL_TIMEOUT_MS, signal);
	const closed = Number(data?.closeTabs?.closedTabs ?? 0);
	if (!Number.isFinite(closed) || closed < 1) {
		throw new Error(`tabctl could not close tab ${tabId}`);
	}
	const txid = data?.closeTabs?.txid;
	return typeof txid === "string" ? txid : undefined;
}

function defaultNoteTitleForTab(tab: TabctlTab): string {
	const title = normalizeWhitespace(tab.title || "");
	if (title) return title;
	try {
		const parsed = new URL(tab.url);
		return parsed.hostname;
	} catch {
		return tab.url;
	}
}

function defaultSummaryForTab(tab: TabctlTab): string {
	const title = normalizeWhitespace(tab.title || "link");
	return `Reference link saved from end-of-day tab review: ${title}.`;
}

function renderTabReviewPrompt(tab: TabctlTab, index: number, total: number): string {
	const metadata = [
		tab.pinned ? "pinned" : undefined,
		tab.active ? "active" : undefined,
		tab.groupTitle ? `group: ${tab.groupTitle}` : "ungrouped",
		`window ${tab.windowId}`,
	]
		.filter(Boolean)
		.join(" • ");

	return [
		`Tab ${index + 1}/${total}`,
		normalizeWhitespace(tab.title || "(untitled tab)"),
		tab.url,
		metadata,
	].join("\n");
}

function formatYamlList(values: string[], quote = true): string[] {
	if (!values.length) return [];
	return values.map((value) => {
		if (quote) return `  - ${JSON.stringify(value)}`;
		return `  - ${value}`;
	});
}

function buildNewArchiveNote(decision: ArchiveDecision, tab: TabctlTab, profileName: string): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10);
	const capturedAt = now.toISOString();
	const linkTitle = escapeMarkdownText(normalizeWhitespace(tab.title || tab.url));
	const topicValues = mergeUniqueCaseInsensitive(decision.topics);
	const aliasValues = mergeUniqueCaseInsensitive(decision.aliases);
	const questionValues = mergeUniqueCaseInsensitive(decision.questions);
	const tagValues = mergeUniqueCaseInsensitive(
		[
			"links",
			"archive",
			"qmd",
			"tabs",
			"chromium",
			...decision.tags.map(normalizeTag).filter(Boolean),
		],
	).map(normalizeTag);

	const lines: string[] = [
		"---",
		"category:",
		'  - "[[Categories/GitHub|GitHub]]"',
		"type:",
		"  - Reference",
		"  - Link Archive",
		"org:",
		"  - GitHub",
		"status: archived",
		"source: Chromium tab review",
		`created: ${date}`,
		`updated: ${date}`,
	];

	if (tagValues.length) {
		lines.push("tags:");
		lines.push(...formatYamlList(tagValues, false));
	}
	if (topicValues.length) {
		lines.push("topics:");
		lines.push(...formatYamlList(topicValues));
	}
	if (aliasValues.length) {
		lines.push("aliases:");
		lines.push(...formatYamlList(aliasValues));
	}
	if (questionValues.length) {
		lines.push("questions:");
		lines.push(...formatYamlList(questionValues));
	}

	lines.push("---", "", `# ${decision.noteTitle}`, "", "## Summary", decision.summary, "");

	if (topicValues.length || aliasValues.length || questionValues.length) {
		lines.push("## Retrieval hints");
		if (topicValues.length) lines.push(`- Topics: ${topicValues.join(", ")}`);
		if (aliasValues.length) lines.push(`- Aliases: ${aliasValues.join(", ")}`);
		if (questionValues.length) {
			lines.push("- Example prompts:");
			for (const question of questionValues) lines.push(`  - ${question}`);
		}
		lines.push("");
	}

	lines.push(
		"## Saved links",
		`- [${linkTitle}](${tab.url}) _(captured ${capturedAt} from ${profileName})_`,
		"",
	);

	return `${lines.join("\n")}\n`;
}

async function upsertTabArchiveNote(
	decision: ArchiveDecision,
	tab: TabctlTab,
	profileName: string,
): Promise<ArchiveWriteResult> {
	const notesDir = getObsidianNotesDir();
	await fs.mkdir(notesDir, { recursive: true });

	const noteFile = `${sanitizeNoteFileName(decision.noteTitle)}.md`;
	const notePath = path.join(notesDir, noteFile);
	const linkTitle = escapeMarkdownText(normalizeWhitespace(tab.title || tab.url));
	const linkLine = `- [${linkTitle}](${tab.url}) _(captured ${new Date().toISOString()} from ${profileName})_`;

	if (!(await fileExists(notePath))) {
		const created = buildNewArchiveNote(decision, tab, profileName);
		await fs.writeFile(notePath, created, "utf8");
		return { notePath, created: true, alreadyPresent: false };
	}

	const current = await fs.readFile(notePath, "utf8");
	if (current.includes(`(${tab.url})`)) {
		return { notePath, created: false, alreadyPresent: true };
	}

	let updated = current;
	if (updated.includes("## Saved links")) {
		updated = `${updated.trimEnd()}\n${linkLine}\n`;
	} else {
		updated = `${updated.trimEnd()}\n\n## Saved links\n${linkLine}\n`;
	}

	await fs.writeFile(notePath, updated, "utf8");
	return { notePath, created: false, alreadyPresent: false };
}

async function reindexQmd(pi: ExtensionAPI, signal?: AbortSignal): Promise<void> {
	const update = await pi.exec("qmd", ["update"], { timeout: QMD_TIMEOUT_MS, signal });
	if (update.code !== 0) {
		throw new Error(`qmd update failed:\n${truncateText(update.stderr || update.stdout || "Unknown error")}`);
	}

	const embed = await pi.exec("qmd", ["embed"], { timeout: QMD_TIMEOUT_MS, signal });
	if (embed.code !== 0) {
		throw new Error(`qmd embed failed:\n${truncateText(embed.stderr || embed.stdout || "Unknown error")}`);
	}
}

async function promptArchiveDecision(ctx: ExtensionContext, tab: TabctlTab): Promise<ArchiveDecision | null> {
	if (!ctx.hasUI) return null;

	const suggestedTitle = defaultNoteTitleForTab(tab);
	const noteTitleRaw = await ctx.ui.input("Archive note title", suggestedTitle);
	if (noteTitleRaw == null) return null;
	const noteTitle = normalizeWhitespace(noteTitleRaw) || suggestedTitle;

	const suggestedSummary = defaultSummaryForTab(tab);
	const summaryRaw = await ctx.ui.input("Short summary", suggestedSummary);
	if (summaryRaw == null) return null;
	const summary = normalizeWhitespace(summaryRaw) || suggestedSummary;

	const topicsRaw = await ctx.ui.input("Topics (comma-separated, optional)", "");
	if (topicsRaw == null) return null;
	const aliasesRaw = await ctx.ui.input("Aliases (comma-separated, optional)", "");
	if (aliasesRaw == null) return null;
	const questionsRaw = await ctx.ui.input("Example prompts (comma-separated, optional)", "");
	if (questionsRaw == null) return null;
	const tagsRaw = await ctx.ui.input("Extra tags (comma-separated, optional)", "");
	if (tagsRaw == null) return null;

	return {
		noteTitle,
		summary,
		topics: splitCsvInput(topicsRaw),
		aliases: splitCsvInput(aliasesRaw),
		questions: splitCsvInput(questionsRaw),
		tags: splitCsvInput(tagsRaw),
	};
}

async function promptTabAction(
	ctx: ExtensionContext,
	tab: TabctlTab,
	index: number,
	total: number,
): Promise<TabReviewAction> {
	if (!ctx.hasUI) return "stop";
	const selected = await ctx.ui.select(renderTabReviewPrompt(tab, index, total), [
		"Archive to Obsidian (and close tab)",
		"Delete tab",
		"Keep tab",
		"Stop review",
	]);

	if (selected === "Archive to Obsidian (and close tab)") return "archive";
	if (selected === "Delete tab") return "delete";
	if (selected === "Keep tab") return "keep";
	return "stop";
}

async function runTabReviewSession(pi: ExtensionAPI, ctx: ExtensionContext, requestedProfile?: string): Promise<void> {
	if (!ctx.hasUI) {
		pi.sendUserMessage("tab-archive:review-tabs requires an interactive UI session.");
		return;
	}

	const requestedProfileName = normalizeWhitespace(requestedProfile || "") || DEFAULT_PROFILE_NAME;

	let backend: TabBackend;
	try {
		backend = await chooseTabBackend(pi, requestedProfileName, (message) => ctx.ui.notify(message, "warning"));
	} catch (error: any) {
		const details = String(error?.message || error || "Unknown error");
		ctx.ui.notify("Could not initialize tab backend", "error");
		pi.sendUserMessage(truncateText(details));
		return;
	}

	let tabs: TabctlTab[] = [];
	try {
		tabs = await backend.listTabs();
	} catch (error: any) {
		const details = String(error?.message || error || "Unknown error");
		ctx.ui.notify("Could not query open tabs", "error");
		pi.sendUserMessage(`Tab query failed (${backend.name}):\n${truncateText(details)}`);
		return;
	}

	if (!tabs.length) {
		ctx.ui.notify(`No open tabs found in profile ${requestedProfileName}`, "info");
		return;
	}

	let archived = 0;
	let deleted = 0;
	let kept = 0;
	let reviewed = 0;
	let reindexNeeded = false;
	const touchedNotes = new Set<string>();
	const closeTxIds: string[] = [];

	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		if (!tab) continue;

		const action = await promptTabAction(ctx, tab, index, tabs.length);
		if (action === "stop") break;

		if (action === "keep") {
			kept += 1;
			reviewed += 1;
			continue;
		}

		if (action === "archive") {
			const decision = await promptArchiveDecision(ctx, tab);
			if (!decision) {
				kept += 1;
				reviewed += 1;
				continue;
			}

			try {
				const note = await upsertTabArchiveNote(decision, tab, requestedProfileName);
				touchedNotes.add(note.notePath);
				if (!note.alreadyPresent) reindexNeeded = true;
				archived += 1;
				ctx.ui.notify(
					note.alreadyPresent
						? `Link already present in ${path.basename(note.notePath)}`
						: `Archived to ${path.basename(note.notePath)}`,
					"success",
				);
			} catch (error: any) {
				ctx.ui.notify(`Failed to archive tab: ${String(error?.message || error)}`, "error");
				reviewed += 1;
				continue;
			}
		}

		try {
			const closeResult = await backend.closeTab(tab.tabId);
			if (closeResult.txid) closeTxIds.push(closeResult.txid);
			if (action === "delete") deleted += 1;
		} catch (error: any) {
			ctx.ui.notify(`Failed to close tab ${tab.tabId}: ${String(error?.message || error)}`, "error");
			if (action === "delete") {
				kept += 1;
			}
		}

		reviewed += 1;
	}

	let qmdSummary: string | undefined;
	if (reindexNeeded) {
		try {
			await reindexQmd(pi);
			qmdSummary = "qmd update + embed complete";
			ctx.ui.notify("QMD index updated", "success");
		} catch (error: any) {
			qmdSummary = `qmd indexing failed: ${String(error?.message || error)}`;
			ctx.ui.notify("QMD indexing failed", "error");
		}
	}

	const summary = [
		`Tab review complete for profile "${requestedProfileName}".`,
		`Backend: ${backend.name}`,
		`Reviewed: ${reviewed}/${tabs.length}`,
		`Archived: ${archived}`,
		`Deleted: ${deleted}`,
		`Kept: ${kept}`,
		touchedNotes.size ? `Notes touched: ${Array.from(touchedNotes).join(", ")}` : undefined,
		closeTxIds.length ? `Undo txids: ${closeTxIds.join(", ")}` : undefined,
		qmdSummary,
	]
		.filter(Boolean)
		.join("\n");

	pi.sendUserMessage(summary, { deliverAs: "followUp" });
	ctx.ui.notify(`Reviewed ${reviewed} tab(s): ${archived} archived, ${deleted} deleted, ${kept} kept`, "info");
}

async function runTabArchiveDoctor(pi: ExtensionAPI, ctx: ExtensionContext, requestedProfile?: string): Promise<void> {
	const requestedProfileName = normalizeWhitespace(requestedProfile || "") || DEFAULT_PROFILE_NAME;
	const diagnostics: string[] = [];

	try {
		const tabctlBin = await resolveTabctlBinary(pi);
		diagnostics.push(`tabctl binary: ${tabctlBin}`);
	} catch (error: any) {
		diagnostics.push(`tabctl binary: ERROR - ${String(error?.message || error)}`);
	}

	try {
		const profiles = await listTabctlProfiles(pi);
		diagnostics.push(`tabctl profiles: ${profiles.length ? profiles.join(", ") : "(none)"}`);
	} catch (error: any) {
		diagnostics.push(`tabctl profiles: ERROR - ${String(error?.message || error)}`);
	}

	try {
		await pingTabctl(pi, requestedProfileName);
		diagnostics.push(`tabctl ping (${requestedProfileName}): ok`);
	} catch (error: any) {
		diagnostics.push(`tabctl ping (${requestedProfileName}): ERROR - ${String(error?.message || error)}`);
	}

	try {
		const tabs = await listOpenTabsViaAppleScript(pi);
		diagnostics.push(`appleScript tabs: ok (${tabs.length} tab(s) visible)`);
	} catch (error: any) {
		diagnostics.push(`appleScript tabs: ERROR - ${String(error?.message || error)}`);
	}

	diagnostics.push(`chromium user data dir: ${getChromiumUserDataDir()}`);
	diagnostics.push(`tabctl extension dir: ${getTabctlExtensionDir()}`);
	diagnostics.push(`obsidian notes dir: ${getObsidianNotesDir()}`);

	pi.sendUserMessage(diagnostics.join("\n"), { deliverAs: "followUp" });
	if (ctx.hasUI) ctx.ui.notify("tab-archive diagnostics complete", "info");
}

export default function tabArchiveExtension(pi: ExtensionAPI) {
	pi.registerCommand("tab-archive:review-tabs", {
		description: "Review open Chromium tabs one-by-one (archive/delete/keep) using tabctl with AppleScript fallback",
		handler: async (args, ctx) => {
			await runTabReviewSession(pi, ctx, args);
		},
	});

	pi.registerCommand("tab-archive:eod", {
		description: "Alias for /tab-archive:review-tabs",
		handler: async (args, ctx) => {
			await runTabReviewSession(pi, ctx, args);
		},
	});

	pi.registerCommand("tab-archive:doctor", {
		description: "Diagnose tabctl + Chromium tab-archive setup",
		handler: async (args, ctx) => {
			await runTabArchiveDoctor(pi, ctx, args);
		},
	});
}
