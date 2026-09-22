import type { ExecFn } from "./types";

interface LinearIssue {
	identifier?: string;
	title?: string;
	description?: string | null;
	url?: string;
}

interface LinearTeam {
	key?: string;
}

export interface LinearContext {
	text: string;
	identifiers: string[];
}

const BARE_ISSUE_PATTERN = /\b[A-Z][A-Z0-9]{0,9}-\d+\b/g;
const LINEAR_URL_PATTERN =
	/https?:\/\/linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]{0,9}-\d+)/gi;
const BRANCH_ISSUE_PATTERN =
	/(?:^|\/)([A-Za-z][A-Za-z0-9]{0,9}-\d+)(?=$|[-_/])/;
const LINEAR_ENV = "LINEAR_EXISTING_BROWSER_ONLY=1";
const MAX_ISSUES = 3;
let cachedTeamKeys: Set<string> | undefined;

/** Find explicit Linear URLs and, for short fields such as titles, uppercase ticket identifiers. */
export function issueIdentifiers(text: string, includeBare = false): string[] {
	const urls = [...text.matchAll(LINEAR_URL_PATTERN)].map((match) => match[1]!.toUpperCase());
	const bare = includeBare ? (text.match(BARE_ISSUE_PATTERN) ?? []) : [];
	return [...new Set([...urls, ...bare])];
}

/** Branches conventionally start with a ticket, optionally after an agent/worktree prefix. */
export function branchIssueIdentifier(branch: string): string | undefined {
	return BRANCH_ISSUE_PATTERN.exec(branch)?.[1]?.toUpperCase();
}

async function teamKeys(exec: ExecFn): Promise<Set<string> | undefined> {
	if (cachedTeamKeys) return cachedTeamKeys;
	const result = await exec("env", [LINEAR_ENV, "linear", "teams"], { timeout: 30_000 });
	if (result.code !== 0) return undefined;
	try {
		const teams = JSON.parse(result.stdout) as LinearTeam[];
		const keys = new Set(
			teams
				.map((team) => team.key?.toUpperCase())
				.filter((key): key is string => Boolean(key)),
		);
		if (keys.size > 0) cachedTeamKeys = keys;
		return keys.size > 0 ? keys : undefined;
	} catch {
		return undefined;
	}
}

/** Fetch concise ticket context for identifiers selected by the source-specific parsers. */
export async function linearIssueContext(
	identifiers: string[],
	exec: ExecFn,
): Promise<LinearContext | undefined> {
	if (identifiers.length === 0) return undefined;
	const keys = await teamKeys(exec);
	if (!keys) return undefined;
	const credible = [...new Set(identifiers)]
		.filter((identifier) => keys.has(identifier.split("-")[0]!))
		.slice(0, MAX_ISSUES);
	const issues: Array<{ identifier: string; issue: LinearIssue }> = [];

	for (const identifier of credible) {
		const result = await exec(
			"env",
			[LINEAR_ENV, "linear", "issue", "get", identifier],
			{ timeout: 30_000 },
		);
		if (result.code !== 0) continue;
		try {
			const issue = JSON.parse(result.stdout) as LinearIssue;
			if (issue.title || issue.description) issues.push({ identifier, issue });
		} catch {
			// A missing CLI, authentication problem, or non-JSON response should not block a review.
		}
	}
	if (issues.length === 0) return undefined;

	return {
		text: issues
			.map(({ issue }) =>
				[
					`Linear ${issue.identifier ?? "issue"}: ${issue.title ?? "(untitled)"}`,
					issue.url ? `URL: ${issue.url}` : "",
					issue.description?.trim() ? `\n${issue.description.trim()}` : "",
				]
					.filter(Boolean)
					.join("\n"),
			)
			.join("\n\n"),
		identifiers: [
			...new Set(issues.map(({ identifier, issue }) => (issue.identifier ?? identifier).toUpperCase())),
		],
	};
}
