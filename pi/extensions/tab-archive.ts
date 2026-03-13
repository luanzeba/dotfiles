import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

type BookmarkRootKey = "bookmark_bar" | "other" | "synced";

type BookmarkNode = {
	type?: string;
	name?: string;
	url?: string;
	children?: BookmarkNode[];
};

type ProfileResolution = {
	profileDir: string;
	profileName: string;
	userDataDir: string;
};

type FolderStats = {
	path: string;
	root: BookmarkRootKey;
	depth: number;
	directUrlCount: number;
	totalUrlCount: number;
	subfolderCount: number;
};

type RemovedFolder = {
	path: string;
	totalUrlCount: number;
	subfolderCount: number;
};

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

const ROOT_LABELS: Record<BookmarkRootKey, string> = {
	bookmark_bar: "Bookmarks Bar",
	other: "Other Bookmarks",
	synced: "Mobile Bookmarks",
};

const DEFAULT_PROFILE_NAME = "Work";
const ARCHIVE_SCRIPT_CANDIDATES = [
	process.env.TAB_ARCHIVE_SCRIPT,
	path.join(os.homedir(), "dotfiles/skills/obsidian-tab-archive/scripts/archive_chromium_bookmark_folder.py"),
	path.join(os.homedir(), ".pi/agent/skills/obsidian-tab-archive/scripts/archive_chromium_bookmark_folder.py"),
].filter(Boolean) as string[];

const DEFAULT_CHROMIUM_DIR = path.join(os.homedir(), "Library/Application Support/Chromium");
const DEFAULT_OBSIDIAN_NOTES_DIR = path.join(os.homedir(), "Obsidian/Personal/Notes");
const ARCHIVE_TIMEOUT_MS = 1000 * 60 * 10;
const QMD_TIMEOUT_MS = 1000 * 60 * 20;
const OPEN_LINK_TIMEOUT_MS = 1000 * 10;
const TABCTL_TIMEOUT_MS = 1000 * 30;
const TAB_REVIEW_QUERY_LIMIT = 500;

function normalizeRoot(input?: string): BookmarkRootKey {
	if (!input) return "bookmark_bar";
	if (input === "other") return "other";
	if (input === "synced") return "synced";
	return "bookmark_bar";
}

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function normalizeSegments(rawPath: string): string[] {
	const parts = rawPath
		.split("/")
		.map((part) => normalizeWhitespace(part))
		.filter(Boolean);

	if (!parts.length) return [];

	const first = parts[0]?.toLowerCase();
	if (first === "bookmarks bar" || first === "other bookmarks" || first === "mobile bookmarks") {
		return parts.slice(1);
	}

	return parts;
}

function sameName(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	return normalizeWhitespace(a).toLowerCase() === normalizeWhitespace(b).toLowerCase();
}

function ensureFolderChildren(node: BookmarkNode): BookmarkNode[] {
	if (!Array.isArray(node.children)) node.children = [];
	return node.children;
}

function countDirectUrls(node: BookmarkNode): number {
	const children = node.children ?? [];
	return children.filter((child) => child?.type === "url" && typeof child.url === "string").length;
}

function countTotalUrls(node: BookmarkNode): number {
	if (node.type === "url" && typeof node.url === "string") return 1;
	const children = node.children ?? [];
	let count = 0;
	for (const child of children) count += countTotalUrls(child);
	return count;
}

function countSubfolders(node: BookmarkNode): number {
	const children = node.children ?? [];
	let count = 0;
	for (const child of children) {
		if (child?.type === "folder") {
			count += 1;
			count += countSubfolders(child);
		}
	}
	return count;
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

async function readJson<T = any>(filePath: string): Promise<T> {
	const raw = await fs.readFile(filePath, "utf8");
	return JSON.parse(raw) as T;
}

function getChromiumUserDataDir(): string {
	const override = process.env.TAB_ARCHIVE_CHROMIUM_DIR?.trim();
	return override ? path.resolve(override) : DEFAULT_CHROMIUM_DIR;
}

function getObsidianNotesDir(): string {
	const override = process.env.TAB_ARCHIVE_OBSIDIAN_NOTES_DIR?.trim();
	return override ? path.resolve(override) : DEFAULT_OBSIDIAN_NOTES_DIR;
}

function extractHttpLinks(markdown: string): string[] {
	const links: string[] = [];
	const seen = new Set<string>();
	const pattern = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(markdown)) !== null) {
		const url = match[1]?.trim();
		if (!url || seen.has(url)) continue;
		seen.add(url);
		links.push(url);
	}
	return links;
}

async function resolveNotePath(noteTitle: string, notePathInput?: string): Promise<string> {
	const notesDir = getObsidianNotesDir();

	if (notePathInput?.trim()) {
		const resolved = notePathInput.trim().startsWith("/")
			? path.resolve(notePathInput.trim())
			: path.resolve(notesDir, notePathInput.trim());
		if (!(await fileExists(resolved))) {
			throw new Error(`Note file not found: ${resolved}`);
		}
		return resolved;
	}

	const exactPath = path.join(notesDir, `${noteTitle}.md`);
	if (await fileExists(exactPath)) return exactPath;

	const entries = await fs.readdir(notesDir);
	const target = noteTitle.trim().toLowerCase();
	const found = entries.find((entry) => {
		if (!entry.toLowerCase().endsWith(".md")) return false;
		const base = entry.slice(0, -3).toLowerCase();
		return base === target;
	});
	if (found) return path.join(notesDir, found);

	const partial = entries.find((entry) => {
		if (!entry.toLowerCase().endsWith(".md")) return false;
		return entry.toLowerCase().includes(target);
	});
	if (partial) return path.join(notesDir, partial);

	throw new Error(`Could not find note '${noteTitle}' in ${notesDir}`);
}

async function resolveProfile(
	profileNameInput?: string,
	profileDirInput?: string,
): Promise<ProfileResolution> {
	const userDataDir = getChromiumUserDataDir();
	if (!(await fileExists(userDataDir))) {
		throw new Error(`Chromium user data dir not found: ${userDataDir}`);
	}

	const localStatePath = path.join(userDataDir, "Local State");
	if (!(await fileExists(localStatePath))) {
		throw new Error(`Chromium Local State not found: ${localStatePath}`);
	}

	const localState = await readJson<any>(localStatePath);
	const infoCache = (localState?.profile?.info_cache ?? {}) as Record<string, any>;

	if (profileDirInput?.trim()) {
		const profileDir = profileDirInput.trim();
		const profileName = infoCache?.[profileDir]?.name || profileDir;
		return { profileDir, profileName, userDataDir };
	}

	const requestedName = (profileNameInput?.trim() || DEFAULT_PROFILE_NAME).toLowerCase();
	for (const [profileDir, metadata] of Object.entries(infoCache)) {
		const name = String((metadata as any)?.name ?? "");
		if (name.toLowerCase() === requestedName) {
			return { profileDir, profileName: name || profileDir, userDataDir };
		}
	}

	if (!profileNameInput?.trim()) {
		const fallbackDir = String(localState?.profile?.last_used ?? "").trim();
		if (fallbackDir && infoCache[fallbackDir]) {
			return {
				profileDir: fallbackDir,
				profileName: String(infoCache[fallbackDir]?.name || fallbackDir),
				userDataDir,
			};
		}
	}

	throw new Error(
		`Could not resolve Chromium profile '${profileNameInput || DEFAULT_PROFILE_NAME}'. ` +
			`Available profiles: ${Object.values(infoCache)
				.map((meta: any) => String(meta?.name || ""))
				.filter(Boolean)
				.join(", ")}`,
	);
}

async function loadBookmarks(profile: ProfileResolution): Promise<{ bookmarksPath: string; bookmarks: any }> {
	const bookmarksPath = path.join(profile.userDataDir, profile.profileDir, "Bookmarks");
	if (!(await fileExists(bookmarksPath))) {
		throw new Error(`Bookmarks file not found: ${bookmarksPath}`);
	}

	const bookmarks = await readJson<any>(bookmarksPath);
	return { bookmarksPath, bookmarks };
}

function getRootNode(bookmarks: any, rootKey: BookmarkRootKey): BookmarkNode {
	const root = bookmarks?.roots?.[rootKey] as BookmarkNode | undefined;
	if (!root || root.type !== "folder") {
		throw new Error(`Bookmarks root '${rootKey}' not found`);
	}
	return root;
}

function collectFolders(
	rootKey: BookmarkRootKey,
	node: BookmarkNode,
	segments: string[],
	maxDepth: number,
): FolderStats[] {
	const depth = segments.length;
	if (depth > maxDepth) return [];

	const pathText = segments.join("/");
	const stats: FolderStats[] = [
		{
			path: pathText,
			root: rootKey,
			depth,
			directUrlCount: countDirectUrls(node),
			totalUrlCount: countTotalUrls(node),
			subfolderCount: countSubfolders(node),
		},
	];

	const children = node.children ?? [];
	for (const child of children) {
		if (child?.type !== "folder") continue;
		const childName = normalizeWhitespace(child.name || "Untitled folder");
		stats.push(...collectFolders(rootKey, child, [...segments, childName], maxDepth));
	}

	return stats;
}

function listFolderStats(bookmarks: any, rootKey: BookmarkRootKey, maxDepth: number): FolderStats[] {
	const rootNode = getRootNode(bookmarks, rootKey);
	const children = rootNode.children ?? [];
	const all: FolderStats[] = [];

	for (const child of children) {
		if (child?.type !== "folder") continue;
		const name = normalizeWhitespace(child.name || "Untitled folder");
		all.push(...collectFolders(rootKey, child, [name], maxDepth));
	}

	return all.sort((a, b) => {
		if (a.depth !== b.depth) return a.depth - b.depth;
		return a.path.localeCompare(b.path);
	});
}

function removeFolderPath(rootNode: BookmarkNode, folderPath: string): BookmarkNode | null {
	const segments = normalizeSegments(folderPath);
	if (!segments.length) return null;

	let children = ensureFolderChildren(rootNode);
	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i];
		const idx = children.findIndex((child) => child?.type === "folder" && sameName(child.name, segment));
		if (idx === -1) return null;

		if (i === segments.length - 1) {
			const [removed] = children.splice(idx, 1);
			return removed ?? null;
		}

		const next = children[idx];
		if (!next) return null;
		children = ensureFolderChildren(next);
	}

	return null;
}

async function findArchiveScriptPath(): Promise<string> {
	for (const candidate of ARCHIVE_SCRIPT_CANDIDATES) {
		if (!candidate) continue;
		const resolved = path.resolve(candidate);
		if (await fileExists(resolved)) return resolved;
	}
	throw new Error(
		"Could not find archive_chromium_bookmark_folder.py. " +
			"Expected at ~/dotfiles/skills/obsidian-tab-archive/scripts/ or ~/.pi/agent/skills/obsidian-tab-archive/scripts/",
	);
}

function parseNotePathFromOutput(output: string): string | undefined {
	const lines = output.split("\n");
	for (const line of lines) {
		const match = line.match(/^Wrote:\s+(.+)$/);
		if (match?.[1]) return match[1].trim();
	}
	return undefined;
}

function timestampSlug(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
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

function tryParseJson(text: string | undefined): any | null {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
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

async function runTabctlJson(pi: ExtensionAPI, args: string[], timeoutMs: number): Promise<any> {
	const result = await pi.exec("tabctl", ["--json", ...args], { timeout: timeoutMs });
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

async function listTabctlProfileNames(pi: ExtensionAPI): Promise<string[]> {
	try {
		const profileList = await runTabctlJson(pi, ["profile-list"], TABCTL_TIMEOUT_MS);
		const profiles = Array.isArray(profileList?.profiles) ? profileList.profiles : [];
		return profiles
			.map((profile: any) => String(profile?.name ?? "").trim())
			.filter(Boolean);
	} catch {
		return [];
	}
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

async function runTabctlGraphqlQuery(
	pi: ExtensionAPI,
	profileName: string | undefined,
	query: string,
	timeoutMs = TABCTL_TIMEOUT_MS,
): Promise<any> {
	const args: string[] = [];
	if (profileName?.trim()) {
		args.push("--profile", profileName.trim());
	}
	args.push("query", query);
	const response = await runTabctlJson(pi, args, timeoutMs);

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

async function listOpenTabsFromTabctl(pi: ExtensionAPI, profileName?: string): Promise<TabctlTab[]> {
	const query = `
	query OpenTabsForReview {
	  ping {
	    ok
	  }
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

	const data = await runTabctlGraphqlQuery(pi, profileName, query, TABCTL_TIMEOUT_MS);
	const pingOk = Boolean(data?.ping?.ok);
	if (!pingOk) {
		throw new Error("tabctl ping failed. Is the tabctl browser extension connected?");
	}

	const items = Array.isArray(data?.tabs?.items) ? data.tabs.items : [];
	return mapTabctlTabs(items);
}

async function closeTabWithTabctl(pi: ExtensionAPI, profileName: string | undefined, tabId: number): Promise<string | undefined> {
	const mutation = `
	mutation CloseTabForReview {
	  closeTabs(tabIds: [${tabId}], confirm: true) {
	    txid
	    closedTabs
	  }
	}
	`;
	const data = await runTabctlGraphqlQuery(pi, profileName, mutation, TABCTL_TIMEOUT_MS);
	const closed = Number(data?.closeTabs?.closedTabs ?? 0);
	if (!Number.isFinite(closed) || closed < 1) {
		throw new Error(`tabctl could not close tab ${tabId}`);
	}
	const txid = data?.closeTabs?.txid;
	return typeof txid === "string" ? txid : undefined;
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
		const totalLine = updated.match(/\n_Total links:.*$/m)?.[0];
		if (totalLine) {
			updated = updated.replace(totalLine, `${linkLine}\n${totalLine}`);
		} else {
			updated = `${updated.trimEnd()}\n${linkLine}\n`;
		}
	} else {
		updated = `${updated.trimEnd()}\n\n## Saved links\n${linkLine}\n`;
	}

	await fs.writeFile(notePath, updated, "utf8");
	return { notePath, created: false, alreadyPresent: false };
}

async function reindexQmd(pi: ExtensionAPI): Promise<{ update: string; embed: string }> {
	const update = await pi.exec("qmd", ["update"], { timeout: QMD_TIMEOUT_MS });
	if (update.code !== 0) {
		throw new Error(`qmd update failed:\n${truncateText(update.stderr || update.stdout || "Unknown error")}`);
	}

	const embed = await pi.exec("qmd", ["embed"], { timeout: QMD_TIMEOUT_MS });
	if (embed.code !== 0) {
		throw new Error(`qmd embed failed:\n${truncateText(embed.stderr || embed.stdout || "Unknown error")}`);
	}

	return {
		update: truncateText(update.stdout || "qmd update completed"),
		embed: truncateText(embed.stdout || "qmd embed completed"),
	};
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
	const availableTabctlProfiles = await listTabctlProfileNames(pi);
	const matchedProfile = resolveRequestedTabctlProfile(requestedProfileName, availableTabctlProfiles);
	const tabctlProfile = matchedProfile ?? (availableTabctlProfiles.length === 1 ? availableTabctlProfiles[0] : undefined);

	if (requestedProfileName && availableTabctlProfiles.length && !matchedProfile) {
		ctx.ui.notify(
			`No tabctl profile named '${requestedProfileName}'. Using tabctl default profile.`,
			"warning",
		);
	}

	let tabs: TabctlTab[] = [];
	try {
		tabs = await listOpenTabsFromTabctl(pi, tabctlProfile);
	} catch (error: any) {
		const details = String(error?.message || error || "Unknown error");
		ctx.ui.notify("Could not load tabs from tabctl", "error");
		pi.sendUserMessage(
			[
				`I couldn't read open tabs from tabctl for profile \"${requestedProfileName}\".`,
				"",
				truncateText(details),
				"",
				"Setup checklist:",
				"1. Install tabctl: https://github.com/ekroon/tabctl",
				"2. Run: tabctl setup",
				"3. Ensure Chromium has the tabctl extension enabled for this profile",
				"4. Retry /tab-archive:review-tabs Work",
			].join("\n"),
		);
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
			const txid = await closeTabWithTabctl(pi, tabctlProfile, tab.tabId);
			if (txid) closeTxIds.push(txid);
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
			const qmd = await reindexQmd(pi);
			qmdSummary = "qmd update + embed complete";
			ctx.ui.notify("QMD index updated", "success");
			void qmd;
		} catch (error: any) {
			qmdSummary = `qmd indexing failed: ${String(error?.message || error)}`;
			ctx.ui.notify("QMD indexing failed", "error");
		}
	}

	const summary = [
		`Tab review complete for profile \"${requestedProfileName}\".`,
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

export default function tabArchiveExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "list_chromium_bookmark_folders",
		label: "List Chromium Bookmark Folders",
		description: "List bookmark folders for a Chromium profile with URL/folder counts to plan archival.",
		promptSnippet: "Inspect Chromium bookmark folders before archival",
		promptGuidelines: [
			"Use this tool first in end-of-day archival workflows to identify candidate folders.",
		],
		parameters: Type.Object({
			profileName: Type.Optional(Type.String({ description: "Chromium profile display name (for example: Work)" })),
			profileDir: Type.Optional(Type.String({ description: "Chromium profile directory basename (for example: Default)" })),
			root: Type.Optional(StringEnum(["bookmark_bar", "other", "synced"] as const)),
			maxDepth: Type.Optional(Type.Number({ description: "Max folder depth to include", minimum: 1, maximum: 8 })),
		}),
		async execute(_toolCallId, params) {
			const profile = await resolveProfile(params.profileName, params.profileDir);
			const { bookmarksPath, bookmarks } = await loadBookmarks(profile);
			const root = normalizeRoot(params.root);
			const maxDepth = Math.max(1, Math.min(8, Math.floor(params.maxDepth ?? 4)));

			const folders = listFolderStats(bookmarks, root, maxDepth).map((folder) => ({
				...folder,
				path: `${ROOT_LABELS[folder.root]}/${folder.path}`,
			}));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								profileName: profile.profileName,
								profileDir: profile.profileDir,
								root,
								bookmarksPath,
								folders,
							},
							null,
							2,
						),
					},
				],
				details: {
					profile,
					root,
					folders,
				},
			};
		},
	});

	pi.registerTool({
		name: "archive_chromium_bookmark_folders_to_obsidian",
		label: "Archive Chromium Bookmark Folders",
		description: "Archive Chromium bookmark folders into an Obsidian note using intent-first metadata for future retrieval.",
		promptSnippet: "Archive selected Chromium bookmark folders into an Obsidian reference note",
		promptGuidelines: [
			"Use intent-first note titles and summaries (project/topic focus) rather than migration history.",
			"Include topics, aliases, and example prompts so QMD retrieval matches future user phrasing.",
		],
		parameters: Type.Object({
			profileName: Type.Optional(Type.String({ description: "Chromium profile display name (for example: Work)" })),
			profileDir: Type.Optional(Type.String({ description: "Chromium profile directory basename (for example: Default)" })),
			folderPaths: Type.Array(Type.String({ description: "Bookmark folder path (supports paths with or without root prefix)" })),
			noteTitle: Type.String({ description: "Obsidian note title" }),
			summary: Type.String({ description: "Short summary for the note" }),
			topics: Type.Optional(Type.Array(Type.String({ description: "Topic keyword for retrieval" }))),
			aliases: Type.Optional(Type.Array(Type.String({ description: "Alternate phrasing users may ask" }))),
			questions: Type.Optional(Type.Array(Type.String({ description: "Example prompts this note should answer" }))),
			tags: Type.Optional(Type.Array(Type.String({ description: "Additional tags" }))),
			categories: Type.Optional(Type.Array(Type.String({ description: "Frontmatter category wikilink" }))),
			noteTypes: Type.Optional(Type.Array(Type.String({ description: "Frontmatter type value" }))),
			orgs: Type.Optional(Type.Array(Type.String({ description: "Frontmatter org value" }))),
			status: Type.Optional(Type.String({ description: "Frontmatter status" })),
			source: Type.Optional(Type.String({ description: "Frontmatter source" })),
			apply: Type.Optional(Type.Boolean({ description: "Write note to disk (default true)" })),
			reindexQmd: Type.Optional(Type.Boolean({ description: "Run qmd update/embed after writing (default true)" })),
		}),
		async execute(_toolCallId, params, signal) {
			if (!params.folderPaths.length) {
				throw new Error("folderPaths cannot be empty");
			}

			const profile = await resolveProfile(params.profileName, params.profileDir);
			const archiveScript = await findArchiveScriptPath();
			const apply = params.apply !== false;
			const reindexQmd = params.reindexQmd !== false;

			const scriptArgs = [
				archiveScript,
				"--chromium-user-data-dir",
				profile.userDataDir,
				"--profile-dir",
				profile.profileDir,
				"--note-title",
				params.noteTitle,
				"--summary",
				params.summary,
			];

			for (const folderPath of params.folderPaths) {
				scriptArgs.push("--folder-path", folderPath);
			}
			for (const topic of params.topics ?? []) scriptArgs.push("--topic", topic);
			for (const alias of params.aliases ?? []) scriptArgs.push("--alias", alias);
			for (const question of params.questions ?? []) scriptArgs.push("--question", question);
			for (const tag of params.tags ?? []) scriptArgs.push("--tag", tag);
			for (const category of params.categories ?? []) scriptArgs.push("--category", category);
			for (const typeValue of params.noteTypes ?? []) scriptArgs.push("--type", typeValue);
			for (const org of params.orgs ?? []) scriptArgs.push("--org", org);
			if (params.status) scriptArgs.push("--status", params.status);
			if (params.source) scriptArgs.push("--source", params.source);
			if (apply) scriptArgs.push("--apply");

			const archiveResult = await pi.exec("python3", scriptArgs, {
				timeout: ARCHIVE_TIMEOUT_MS,
				signal,
			});

			if (archiveResult.code !== 0) {
				throw new Error(`Archive script failed:\n${truncateText(archiveResult.stderr || archiveResult.stdout || "Unknown error")}`);
			}

			let qmdUpdateResult: string | undefined;
			let qmdEmbedResult: string | undefined;
			if (apply && reindexQmd) {
				const update = await pi.exec("qmd", ["update"], {
					timeout: QMD_TIMEOUT_MS,
					signal,
				});
				if (update.code !== 0) {
					throw new Error(`qmd update failed:\n${truncateText(update.stderr || update.stdout || "Unknown error")}`);
				}
				qmdUpdateResult = truncateText(update.stdout || "qmd update completed");

				const embed = await pi.exec("qmd", ["embed"], {
					timeout: QMD_TIMEOUT_MS,
					signal,
				});
				if (embed.code !== 0) {
					throw new Error(`qmd embed failed:\n${truncateText(embed.stderr || embed.stdout || "Unknown error")}`);
				}
				qmdEmbedResult = truncateText(embed.stdout || "qmd embed completed");
			}

			const archiveOutput = truncateText(archiveResult.stdout || "Archive completed");
			const notePath = parseNotePathFromOutput(archiveResult.stdout || "");

			const summaryLines = [
				`Archived ${params.folderPaths.length} folder(s) from Chromium profile '${profile.profileName}'.`,
				notePath ? `Note: ${notePath}` : undefined,
				apply ? "Mode: apply" : "Mode: dry-run",
				apply && reindexQmd ? "qmd: update + embed complete" : undefined,
			]
				.filter(Boolean)
				.join("\n");

			return {
				content: [{ type: "text", text: summaryLines }],
				details: {
					profile,
					folderPaths: params.folderPaths,
					noteTitle: params.noteTitle,
					notePath,
					archiveOutput,
					qmdUpdateResult,
					qmdEmbedResult,
				},
			};
		},
	});

	pi.registerTool({
		name: "delete_chromium_bookmark_folders",
		label: "Delete Chromium Bookmark Folders",
		description: "Delete bookmark folders from Chromium after archival, with backup and optional confirmation.",
		promptSnippet: "Delete archived Chromium bookmark folders",
		promptGuidelines: [
			"Only delete folders after the user confirms archival succeeded.",
			"Keep backups enabled unless the user explicitly asks otherwise.",
		],
		parameters: Type.Object({
			profileName: Type.Optional(Type.String({ description: "Chromium profile display name (for example: Work)" })),
			profileDir: Type.Optional(Type.String({ description: "Chromium profile directory basename (for example: Default)" })),
			root: Type.Optional(StringEnum(["bookmark_bar", "other", "synced"] as const)),
			folderPaths: Type.Array(Type.String({ description: "Bookmark folder paths to delete" })),
			createBackup: Type.Optional(Type.Boolean({ description: "Create Bookmarks backup before deletion (default true)" })),
			requireConfirm: Type.Optional(Type.Boolean({ description: "Ask for confirmation in interactive mode (default true)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!params.folderPaths.length) {
				throw new Error("folderPaths cannot be empty");
			}

			const profile = await resolveProfile(params.profileName, params.profileDir);
			const { bookmarksPath, bookmarks } = await loadBookmarks(profile);
			const root = normalizeRoot(params.root);
			const rootNode = getRootNode(bookmarks, root);
			const createBackup = params.createBackup !== false;
			const requireConfirm = params.requireConfirm !== false;

			if (requireConfirm) {
				if (!ctx.hasUI) {
					throw new Error("Confirmation required but UI is not available. Set requireConfirm=false to continue.");
				}
				const ok = await ctx.ui.confirm(
					"Delete bookmark folders?",
					`Delete ${params.folderPaths.length} folder(s) from ${profile.profileName}/${ROOT_LABELS[root]}?`,
				);
				if (!ok) {
					return {
						content: [{ type: "text", text: "Deletion cancelled by user." }],
						details: {
							cancelled: true,
							profile,
							root,
						},
					};
				}
			}

			let backupPath: string | undefined;
			if (createBackup) {
				backupPath = `${bookmarksPath}.bak-${timestampSlug()}`;
				await fs.copyFile(bookmarksPath, backupPath);
			}

			const removed: RemovedFolder[] = [];
			const missing: string[] = [];
			for (const folderPath of params.folderPaths) {
				if (signal?.aborted) throw new Error("Operation cancelled");
				const removedNode = removeFolderPath(rootNode, folderPath);
				if (!removedNode) {
					missing.push(folderPath);
					continue;
				}
				removed.push({
					path: folderPath,
					totalUrlCount: countTotalUrls(removedNode),
					subfolderCount: countSubfolders(removedNode),
				});
			}

			if (!removed.length) {
				return {
					content: [{ type: "text", text: "No folders were deleted (none matched the provided paths)." }],
					details: {
						profile,
						root,
						removed,
						missing,
						backupPath,
					},
				};
			}

			await fs.writeFile(bookmarksPath, JSON.stringify(bookmarks), "utf8");

			const summary = [
				`Deleted ${removed.length} folder(s) from ${profile.profileName}/${ROOT_LABELS[root]}.`,
				backupPath ? `Backup: ${backupPath}` : undefined,
				missing.length ? `Missing: ${missing.join(", ")}` : undefined,
			]
				.filter(Boolean)
				.join("\n");

			return {
				content: [{ type: "text", text: summary }],
				details: {
					profile,
					root,
					removed,
					missing,
					backupPath,
				},
			};
		},
	});

	pi.registerTool({
		name: "open_obsidian_note_links_in_browser",
		label: "Open Obsidian Note Links",
		description: "Open HTTP links from an Obsidian note in the default browser (with optional confirmation and dry-run).",
		promptSnippet: "Open archived links from an Obsidian note",
		promptGuidelines: [
			"Use this when the user asks to open all links from an archived project note.",
			"Run with dryRun=true first if the note might contain many links.",
		],
		parameters: Type.Object({
			noteTitle: Type.String({ description: "Obsidian note title (without .md)" }),
			notePath: Type.Optional(Type.String({ description: "Optional absolute or Notes-relative note path" })),
			maxLinks: Type.Optional(Type.Number({ description: "Maximum links to open", minimum: 1, maximum: 100 })),
			dryRun: Type.Optional(Type.Boolean({ description: "If true, only list links without opening them" })),
			requireConfirm: Type.Optional(Type.Boolean({ description: "Ask before opening links in interactive mode (default true)" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const notePath = await resolveNotePath(params.noteTitle, params.notePath);
			const markdown = await fs.readFile(notePath, "utf8");
			const links = extractHttpLinks(markdown);
			if (!links.length) {
				return {
					content: [{ type: "text", text: `No HTTP links found in ${notePath}.` }],
					details: { notePath, links: [] },
				};
			}

			const maxLinks = Math.max(1, Math.min(100, Math.floor(params.maxLinks ?? links.length)));
			const selected = links.slice(0, maxLinks);
			const dryRun = params.dryRun === true;
			const requireConfirm = params.requireConfirm !== false;

			if (!dryRun && requireConfirm) {
				if (!ctx.hasUI) {
					throw new Error("Confirmation required but UI is not available. Set requireConfirm=false to continue.");
				}
				const ok = await ctx.ui.confirm(
					"Open links in browser?",
					`Open ${selected.length} link(s) from '${params.noteTitle}'?`,
				);
				if (!ok) {
					return {
						content: [{ type: "text", text: "Open links cancelled by user." }],
						details: { cancelled: true, notePath, links: selected },
					};
				}
			}

			if (!dryRun) {
				const opener = process.platform === "darwin" ? "open" : "xdg-open";
				for (const link of selected) {
					if (signal?.aborted) throw new Error("Operation cancelled");
					const result = await pi.exec(opener, [link], {
						timeout: OPEN_LINK_TIMEOUT_MS,
						signal,
					});
					if (result.code !== 0) {
						throw new Error(`Failed to open link '${link}': ${truncateText(result.stderr || result.stdout || "Unknown error")}`);
					}
				}
			}

			const summary = [
				dryRun ? `Dry-run: found ${selected.length} link(s).` : `Opened ${selected.length} link(s) in browser.`,
				`Note: ${notePath}`,
				selected.length < links.length ? `Skipped ${links.length - selected.length} link(s) due to maxLinks.` : undefined,
			].filter(Boolean).join("\n");

			return {
				content: [{ type: "text", text: summary }],
				details: {
					notePath,
					opened: dryRun ? 0 : selected.length,
					links: selected,
					totalLinksInNote: links.length,
					dryRun,
				},
			};
		},
	});

	pi.registerCommand("tab-archive:eod", {
		description: "Kick off end-of-day bookmark archival workflow",
		handler: async (args, ctx) => {
			const profile = normalizeWhitespace(args || "") || DEFAULT_PROFILE_NAME;
			const prompt = [
				`Let's run end-of-day link archival for Chromium profile "${profile}".`,
				"Use list_chromium_bookmark_folders first (root: bookmark_bar) and show me candidate folders.",
				"Ask which folders I want to archive.",
				"For each selected folder, call archive_chromium_bookmark_folders_to_obsidian with intent-first note title/summary/topics/aliases/questions.",
				"After each successful archive, ask if I want to delete the original bookmark folder, then call delete_chromium_bookmark_folders only if I confirm.",
				"Finish by confirming qmd indexing was updated.",
			].join("\n");

			if (ctx.hasPendingMessages()) {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
			} else {
				pi.sendUserMessage(prompt);
			}

			if (ctx.hasUI) {
				ctx.ui.notify(`Queued end-of-day archive workflow for ${profile}`, "info");
			}
		},
	});

	pi.registerCommand("tab-archive:review-tabs", {
		description: "Review open Chromium tabs one-by-one (archive/delete/keep) using tabctl",
		handler: async (args, ctx) => {
			await runTabReviewSession(pi, ctx, args);
		},
	});
}
