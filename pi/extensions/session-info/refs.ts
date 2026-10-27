/**
 * Pulls the links a session is about (merge requests, Linear tickets, dev servers, ...) out of
 * its messages, and matches them against search queries. No pi imports, so `node --test` can run
 * these helpers directly.
 */

export type RefKind = "ticket" | "mr" | "github" | "dev" | "slack" | "link";

/**
 * Where a ref was seen, strongest first. `authored` means the session created or pushed to the
 * merge request; `prompt` is the first user message; `workspace` is the session's cwd.
 */
export const SOURCES = ["authored", "prompt", "user", "workspace", "assistant", "tool"] as const;
export type RefSource = (typeof SOURCES)[number];

export interface Ref {
	kind: RefKind;
	/** Canonical identity used for de-duplication and exact query matches. */
	key: string;
	label: string;
	/** Missing for bare ticket ids until a Linear workspace is known for their team. */
	url?: string;
	title?: string;
	/** MR, PR, issue, or ticket number. */
	num?: number;
	source: RefSource;
}

/** Linear team key -> workspace slug, learned from linear.app URLs. */
export type Teams = Record<string, string>;

type Classified = Omit<Ref, "source"> & { team?: [string, string] };

export const rank = (source: RefSource): number => SOURCES.indexOf(source);

const URL_RE = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?*_~]+$/;
const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
// Worktree directory names are lowercase: `.worktrees/cus-1203`, `.worktrees/cus-718-rpc-cleanup`.
const WORKSPACE_TICKET_RE = /(?:^|[/._-])([a-z][a-z0-9]{1,9})-(\d{1,6})(?=$|[/._-])/gi;
// A session authored an MR when its own command created it or pushed to its branch. Output alone
// is not enough: searching old session logs prints the same text for other sessions' MRs. The
// command must also run the tool, not mention it, as in `rg 'glab mr create'`: outside quotes and
// heredocs, it has to start a line or follow `&&`, `;`, `|`, `$(`, or env assignments.
const atCommandStart = (command: string) =>
	new RegExp(String.raw`(?:^|[;&|({\n]|\bthen|\bdo)\s*(?:\w+=\S*\s+)*${command}`);
// Heredoc bodies go first: an MR description saying "charger's" would otherwise open a quote.
const HEREDOC_RE = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
const QUOTED_RE = /'[^']*'|"(?:[^"\\]|\\.)*"/g;
const runs = (pattern: RegExp, command: string) => pattern.test(command.replace(HEREDOC_RE, "").replace(QUOTED_RE, "''"));
const CREATE_COMMAND_RE = atCommandStart(String.raw`(?:glab\s+mr|gh\s+pr)\s+create\b`);
const PUSH_COMMAND_RE = atCommandStart(String.raw`(?:jj\s+)?git\s+(?:-[Cc]\s+\S+\s+)*push\b`);
const PUSHED_MR_RE = /View merge request for [^\n]*\n(?:remote:)?\s*(https?:\/\/\S+?\/-\/merge_requests\/\d+)/g;
const TITLE_FLAG_RE = /(?:--title|-t)[= ]\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/;
// Directories a command works in: `cd <dir>` and `git -C <dir>`. Quotes may precede `cd` because
// codemode scripts pass commands as JS strings.
const PATH_ARG = String.raw`("[^"]+"|'[^']+'|[^\s;&|)"'\u0060]+)`;
const CD_RE = new RegExp(String.raw`(?:^|[;&|({\n"'\u0060]|\bthen|\bdo)\s*cd\s+${PATH_ARG}`, "g");
const GIT_DIR_RE = new RegExp(String.raw`\bgit\s+-C\s+${PATH_ARG}`, "g");
const ASSET_PATH_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|m?js|map|woff2?|ttf)$/i;

const basename = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

// `/skill:name args` is stored with the skill's whole body inlined ahead of the args. The body is
// not what the user wrote, and its example links are not the session's, so keep just the name.
const SKILL_BLOCK_RE = /<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>/g;

/** A user message as the user wrote it: inlined skill bodies reduced to `/skill:name`. */
export function userText(content: unknown): string {
	return textOf(content).replace(SKILL_BLOCK_RE, "/skill:$1");
}

export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

function isPlaceholderHost(host: string): boolean {
	return /(^|\.)example\./.test(host) || /\.(test|example|invalid)$/.test(host) || host === "example";
}

function decodeSlug(slug: string): string {
	try {
		return decodeURIComponent(slug).replace(/-/g, " ");
	} catch {
		return slug.replace(/-/g, " "); // A malformed % escape.
	}
}

export function ticketRef(team: string, num: string | number): Classified {
	const key = `${team.toUpperCase()}-${Number(num)}`;
	return { kind: "ticket", key, label: key, num: Number(num) };
}

export function classifyUrl(raw: string): Classified | undefined {
	let url: URL;
	try {
		url = new URL(raw.replace(TRAILING_PUNCTUATION, ""));
	} catch {
		return undefined;
	}
	const host = url.hostname.toLowerCase();
	// Placeholders from docs and fixtures, and patterns such as `*.ground.config.localhost`.
	if (isPlaceholderHost(host) || !/^[a-z0-9.-]+$/.test(host)) return undefined;
	const path = url.pathname;

	let m = path.match(/^\/(.+?)\/-\/merge_requests\/(\d+)/);
	if (m) {
		const [, project, num] = m;
		return {
			kind: "mr",
			key: `${host}/${project}!${num}`.toLowerCase(),
			label: `${basename(project)}!${num}`,
			url: `${url.origin}/${project}/-/merge_requests/${num}`,
			num: Number(num),
		};
	}
	m = path.match(/^\/(.+?)\/-\/(issues|pipelines|jobs)\/(\d+)/);
	if (m) {
		const [, project, type, num] = m;
		return {
			kind: "link",
			key: `${host}/${project}/${type}/${num}`.toLowerCase(),
			label: type === "issues" ? `${basename(project)}#${num}` : `${basename(project)} ${type.slice(0, -1)} ${num}`,
			url: `${url.origin}/${project}/-/${type}/${num}`,
		};
	}
	if (host === "github.com") {
		m = path.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/);
		if (m) {
			const [, owner, repo, type, num] = m;
			return {
				kind: "github",
				key: `github.com/${owner}/${repo}#${num}`.toLowerCase(),
				label: `${repo}#${num}`,
				url: `https://github.com/${owner}/${repo}/${type}/${num}`,
				num: Number(num),
			};
		}
	}
	if (host === "linear.app") {
		m = path.match(/^\/([^/]+)\/issue\/([a-z][a-z0-9]*)-(\d+)(?:\/([^/]+))?/i);
		if (m) {
			const [, workspace, team, num, slug] = m;
			const ref = ticketRef(team, num);
			return {
				...ref,
				url: `https://linear.app/${workspace}/issue/${ref.key}`,
				title: slug ? decodeSlug(slug) : undefined,
				team: [team.toUpperCase(), workspace],
			};
		}
		return undefined;
	}
	if (host.endsWith(".slack.com")) {
		m = path.match(/^\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/);
		if (m) {
			const [, channel, seconds, micros] = m;
			const date = new Date(Number(seconds) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
			return {
				kind: "slack",
				key: `${host}/${channel}/${seconds}.${micros}`,
				label: `thread ${date}`,
				url: `${url.origin}/archives/${channel}/p${seconds}${micros}`,
			};
		}
	}
	// portless names dev servers `<worktree>.<app>.localhost`; plain localhost:port is too generic.
	if (host.endsWith(".localhost")) {
		return { kind: "dev", key: host, label: host, url: `${url.protocol}//${url.host}` };
	}
	if (host === "localhost" || /^[\d.]+$/.test(host) || ASSET_PATH_RE.test(path)) return undefined;
	const display = `${host}${path === "/" ? "" : path}`;
	return {
		kind: "link",
		key: display.replace(/\/$/, "").toLowerCase(),
		label: display.length > 60 ? `${display.slice(0, 59)}…` : display,
		url: url.href.replace(/#.*$/, ""),
	};
}

function commandOf(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const { command, code } = args as { command?: unknown; code?: unknown };
	if (typeof command === "string") return command;
	if (typeof code === "string") return code;
	return JSON.stringify(args);
}

function titleFlag(command: string): string | undefined {
	// With several creates in one command we cannot tell which title belongs to which URL.
	const parts = command.split(CREATE_COMMAND_RE);
	if (parts.length !== 2) return undefined;
	const m = parts[1].match(TITLE_FLAG_RE);
	return m ? (m[1] ?? m[2]?.replace(/\\(.)/g, "$1")) : undefined;
}

/** Accumulates refs from session messages in order. Feed it the whole session, then call list(). */
export class RefCollector {
	readonly teams: Teams = {};
	/**
	 * Directories the session worked in, as written (may be relative or start with `~`), with how
	 * often: `cd` and `git -C` targets, and the folders of files it edited or wrote. Ties dev servers
	 * to the session.
	 */
	readonly places = new Map<string, number>();
	private readonly refs = new Map<string, Ref>();
	private readonly commands = new Map<string, string>();
	private sawUser = false;

	add(found: Classified, source: RefSource, title?: string): void {
		const { team, ...ref } = found;
		if (team) this.teams[team[0]] = team[1];
		const existing = this.refs.get(ref.key);
		if (!existing) {
			this.refs.set(ref.key, { ...ref, title: title ?? ref.title, source });
			return;
		}
		if (rank(source) < rank(existing.source)) existing.source = source;
		existing.url ??= ref.url;
		if (title) existing.title = title;
		else existing.title ??= ref.title;
	}

	scanText(text: string, source: RefSource): void {
		for (const m of text.matchAll(URL_RE)) {
			const found = classifyUrl(m[0]);
			if (found) this.add(found, source);
		}
		// Bare ids in tool output are mostly noise (UTF-8, SHA-256, log lines); tickets that matter
		// there show up as linear.app URLs.
		if (source === "tool") return;
		for (const m of text.matchAll(TICKET_RE)) this.add(ticketRef(m[1], m[2]), source);
	}

	/** The session's cwd: `.worktrees/cus-1203` names the ticket the session works on. */
	addWorkspace(path: string): void {
		for (const m of path.matchAll(WORKSPACE_TICKET_RE)) this.add(ticketRef(m[1], m[2]), "workspace");
	}

	addMessage(message: any): void {
		switch (message?.role) {
			case "user": {
				this.scanText(userText(message.content), this.sawUser ? "user" : "prompt");
				this.sawUser = true;
				break;
			}
			case "assistant":
				for (const block of Array.isArray(message.content) ? message.content : []) {
					if (block?.type === "text") this.scanText(block.text ?? "", "assistant");
					else if (block?.type === "toolCall") {
						const command = commandOf(block.arguments);
						this.commands.set(block.id, command);
						this.scanText(command, "tool");
						this.addPlaces(block.name, block.arguments);
					}
				}
				break;
			case "toolResult":
				this.scanToolOutput(textOf(message.content), this.commands.get(message.toolCallId) ?? "");
				break;
			case "bashExecution":
				this.scanToolOutput(String(message.output ?? ""), String(message.command ?? ""));
				break;
			case "custom":
				this.scanText(textOf(message.content), "tool");
				break;
		}
	}

	private addPlaces(tool: unknown, args: any): void {
		if ((tool === "edit" || tool === "write") && typeof args?.path === "string") {
			this.addPlace(args.path.replace(/\/[^/]*$/, "") || "/");
		}
		// Only shell commands and codemode scripts, since a file being written can mention `cd` too. In
		// shell, heredoc bodies and single-quoted strings are data (file contents, `node -e` scripts).
		const shell =
			typeof args?.command === "string"
				? args.command.replace(HEREDOC_RE, "").replace(/'[^']*'/g, "''")
				: typeof args?.code === "string"
					? args.code
					: "";
		for (const re of [CD_RE, GIT_DIR_RE]) {
			for (const m of shell.matchAll(re)) this.addPlace(m[1].replace(/^(["'])(.*)\1$/, "$2"));
		}
	}

	private addPlace(place: string): void {
		this.places.set(place, (this.places.get(place) ?? 0) + 1);
	}

	/** A session entry: messages, and extension messages that reach the model. */
	addEntry(entry: { type: string; message?: unknown; content?: unknown }): void {
		if (entry.type === "message") this.addMessage(entry.message);
		else if (entry.type === "custom_message") this.addMessage({ role: "custom", content: entry.content });
	}

	private scanToolOutput(output: string, command: string): void {
		if (runs(CREATE_COMMAND_RE, command)) {
			const title = titleFlag(command);
			for (const m of output.matchAll(URL_RE)) {
				const found = classifyUrl(m[0]);
				if (found?.kind === "mr" || found?.kind === "github") this.add(found, "authored", title);
			}
		}
		if (runs(PUSH_COMMAND_RE, command)) {
			for (const m of output.matchAll(PUSHED_MR_RE)) {
				const found = classifyUrl(m[1]);
				if (found) this.add(found, "authored");
			}
		}
		this.scanText(output, "tool");
	}

	/** Strongest source first, then first-seen order. */
	list(): Ref[] {
		return [...this.refs.values()].sort((a, b) => rank(a.source) - rank(b.source));
	}
}

/**
 * Bare ticket ids only count once a linear.app URL has taught us the team; that also gives us the
 * workspace to link them to. Returns undefined for ids such as UTF-8 that are not tickets.
 */
export function resolveTicket(ref: Ref, teams: Teams): Ref | undefined {
	if (ref.kind !== "ticket" || ref.url) return ref;
	const workspace = teams[ref.key.split("-")[0]];
	return workspace ? { ...ref, url: `https://linear.app/${workspace}/issue/${ref.key}` } : undefined;
}

/**
 * The refs worth showing for a session: what it worked on, not every link a tool printed. The
 * assistant mentions plenty of related tickets and MRs in passing, so its mentions only count for
 * a kind when nothing stronger names one.
 */
export function notableRefs(refs: Ref[], teams: Teams): Ref[] {
	const candidates: Ref[] = [];
	for (const ref of refs) {
		const limit = ref.kind === "link" ? rank("user") : rank("assistant");
		if (ref.kind === "dev" || rank(ref.source) > limit) continue;
		const resolved = resolveTicket(ref, teams);
		if (resolved) candidates.push(resolved);
	}
	const strongKinds = new Set(candidates.filter((ref) => ref.source !== "assistant").map((ref) => ref.kind));
	return candidates.filter((ref) => ref.source !== "assistant" || !strongKinds.has(ref.kind));
}

export type QueryToken =
	| { type: "ref"; key: string }
	| { type: "num"; num: number }
	| { type: "project"; label: string }
	| { type: "ticket"; key: string }
	| { type: "text"; value: string };

/**
 * `!1235`, `#1235`, and `1235` match MR and PR numbers exactly; `CUS-718` matches the
 * ticket; `config-service!743` matches that MR; URLs match the ref they point at. Anything else is
 * a case-insensitive substring of the session's summary, name, user messages, cwd, and links.
 */
export function parseQuery(query: string): QueryToken[] {
	return query
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((raw): QueryToken => {
			if (/^https?:\/\//i.test(raw)) {
				const found = classifyUrl(raw);
				if (found && found.kind !== "link") return { type: "ref", key: found.key };
				return { type: "text", value: (found?.key ?? raw).toLowerCase() };
			}
			let m = raw.match(/^[!#]?(\d+)$/);
			if (m) return { type: "num", num: Number(m[1]) };
			m = raw.match(/^([\w.-]+)[!#](\d+)$/);
			if (m) return { type: "project", label: `${m[1]}!${Number(m[2])}`.toLowerCase() };
			m = raw.match(/^([a-z][a-z0-9]{1,9})-(\d{1,6})$/i);
			if (m) return { type: "ticket", key: ticketRef(m[1], m[2]).key };
			return { type: "text", value: raw.toLowerCase() };
		});
}

function refMatches(ref: Ref, token: QueryToken): boolean {
	switch (token.type) {
		case "ref":
			return ref.key === token.key;
		case "num":
			// People name MRs and PRs by number and tickets by key, so `743` is never CUS-743.
			return (ref.kind === "mr" || ref.kind === "github") && ref.num === token.num;
		case "project":
			return (ref.kind === "mr" || ref.kind === "github") && ref.label.toLowerCase().replace("#", "!") === token.label;
		case "ticket":
			return ref.kind === "ticket" && ref.key === token.key;
		case "text":
			return false;
	}
}

export interface Match {
	/** Lower is better: the sum of the strongest source of each matched ref. */
	score: number;
	matched: Set<string>;
}

/** `haystack` must be lowercase. Every token has to match. */
export function matchSession(refs: Ref[], haystack: string, tokens: QueryToken[]): Match | undefined {
	let score = 0;
	const matched = new Set<string>();
	for (const token of tokens) {
		if (token.type === "text") {
			if (!haystack.includes(token.value)) return undefined;
			continue;
		}
		const hits = refs.filter((ref) => refMatches(ref, token));
		if (hits.length === 0) {
			// A ticket from a team we have never seen a Linear URL for can still be in the text, as a
			// whole id: CUS-12 must not match cus-1203.
			if (token.type === "ticket" && new RegExp(`(?<![a-z0-9])${token.key.toLowerCase()}(?!\\d)`).test(haystack)) {
				score += SOURCES.length;
				continue;
			}
			return undefined;
		}
		score += Math.min(...hits.map((ref) => rank(ref.source)));
		for (const ref of hits) matched.add(ref.key);
	}
	return { score, matched };
}
