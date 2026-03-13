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
}
