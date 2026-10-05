/**
 * A GitLab merge request, reviewed in isolation.
 *
 * This never reads the user's working tree. You are usually mid-change on your own work
 * when someone asks you to review their MR, and their code must not be mixed with yours.
 * The head commit is downloaded from GitLab and cached separately from every checkout.
 *
 * Accepted arguments:
 *   https://gitlab.example.com/group/project/-/merge_requests/384
 *   !384        (needs a git remote in cwd to identify the project)
 *   384
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { branchIssueIdentifier, issueIdentifiers, linearIssueContext } from "./linear";
import { cachedSnapshot, unpackTarball } from "./materialize";
import {
	type ChangeSet,
	type ChangeSource,
	type ExecFn,
	type PriorComment,
	type ResolveOptions,
	slug,
} from "./types";

interface MrTarget {
	host: string;
	project: string;
	iid: string;
}

const URL_PATTERN = /^https?:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/;
const SHORT_PATTERN = /^!?(\d+)$/;

function parseUrl(arg: string): MrTarget | null {
	const match = URL_PATTERN.exec(arg.trim());
	if (!match) return null;
	return { host: match[1]!, project: match[2]!, iid: match[3]! };
}

/** Read host and project from the git remote so `!384` works inside a checkout. */
async function targetFromRemote(iid: string, cwd: string, exec: ExecFn): Promise<MrTarget | null> {
	const remote = await exec("git", ["remote", "get-url", "origin"], { cwd });
	if (remote.code !== 0) return null;
	const url = remote.stdout.trim();

	// git@host:group/project.git  or  https://host/group/project.git
	const ssh = /^[^@]+@([^:]+):(.+?)(?:\.git)?$/.exec(url);
	const https = /^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
	const parsed = ssh ?? https;
	if (!parsed) return null;

	const host = parsed[1]!;
	if (!/gitlab/i.test(host)) return null;
	return { host, project: parsed[2]!, iid };
}

function api(target: MrTarget, endpoint: string, paginate = false): string[] {
	const project = encodeURIComponent(target.project);
	return [
		"api",
		"--hostname",
		target.host,
		`projects/${project}/${endpoint}`,
		// glab's default `--paginate` output emits one JSON array per page (`[...][...]`), so
		// request NDJSON (one element per line) and reassemble the array in glabJson.
		...(paginate ? ["--paginate", "--output", "ndjson"] : []),
	];
}

async function glabJson<T>(target: MrTarget, endpoint: string, exec: ExecFn, paginate = false): Promise<T> {
	const result = await exec("glab", api(target, endpoint, paginate), { timeout: 120_000 });
	if (result.code !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim();
		throw new Error(`glab failed for ${endpoint}: ${detail || "unknown error"}`);
	}
	let parsed: unknown;
	try {
		parsed = paginate
			? result.stdout
					.split("\n")
					.filter((line) => line.trim())
					.map((line) => JSON.parse(line))
			: JSON.parse(result.stdout);
	} catch {
		throw new Error(`glab returned non-JSON for ${endpoint}`);
	}
	if (parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)) {
		throw new Error(`GitLab error for ${endpoint}: ${String((parsed as Record<string, unknown>).error)}`);
	}
	return parsed as T;
}

interface MrPayload {
	title?: string;
	description?: string;
	web_url?: string;
	source_branch?: string;
	target_branch?: string;
	diff_refs?: { base_sha?: string; head_sha?: string };
	sha?: string;
	head_pipeline?: { status?: string; web_url?: string };
}

interface CommitPayload {
	id?: string;
	title?: string;
}

interface ChangesPayload {
	changes?: Array<{
		new_path?: string;
		old_path?: string;
		diff?: string;
		deleted_file?: boolean;
		new_file?: boolean;
		renamed_file?: boolean;
		a_mode?: string;
		b_mode?: string;
	}>;
}

interface DiscussionsPayload
	extends Array<{
		notes?: Array<{
			body?: string;
			system?: boolean;
			author?: { username?: string };
			position?: { new_path?: string; new_line?: number };
		}>;
	}> {}

/**
 * Rebuild a unified diff from the API's per-file entries.
 *
 * GitLab returns each file's hunks without the `diff --git` / `+++` headers, so a reviewer
 * reading the raw text cannot tell which file a hunk belongs to. Add the headers back,
 * matching what git itself emits: a new file has no old side, a deleted file has no new
 * side. Getting this backwards makes a deletion look like an edit.
 */
function buildDiff(changes: NonNullable<ChangesPayload["changes"]>): string {
	const parts: string[] = [];
	for (const change of changes) {
		const newPath = change.new_path ?? change.old_path ?? "unknown";
		const oldPath = change.old_path ?? newPath;
		if (!change.diff) continue;
		parts.push(`diff --git a/${oldPath} b/${newPath}`);
		if (change.renamed_file && oldPath !== newPath) {
			parts.push(`rename from ${oldPath}`);
			parts.push(`rename to ${newPath}`);
		}
		// Modes make the metadata parseable by git rather than decorative: a bare "new file"
		// line without its mode is rejected.
		if (change.new_file) parts.push(`new file mode ${change.b_mode ?? "100644"}`);
		if (change.deleted_file) parts.push(`deleted file mode ${change.a_mode ?? "100644"}`);
		parts.push(`--- ${change.new_file ? "/dev/null" : `a/${oldPath}`}`);
		parts.push(`+++ ${change.deleted_file ? "/dev/null" : `b/${newPath}`}`);
		parts.push(change.diff.replace(/\n$/, ""));
	}
	return parts.join("\n");
}

function collectPriorComments(discussions: DiscussionsPayload): PriorComment[] {
	const comments: PriorComment[] = [];
	for (const discussion of discussions) {
		for (const note of discussion.notes ?? []) {
			if (note.system) continue;
			const body = (note.body ?? "").trim();
			if (!body) continue;
			comments.push({
				author: note.author?.username ?? "unknown",
				body,
				...(note.position?.new_path ? { file: note.position.new_path } : {}),
				...(note.position?.new_line ? { line: note.position.new_line } : {}),
			});
		}
	}
	return comments;
}

/**
 * Download a file by streaming a command's stdout straight to disk.
 *
 * Not pi.exec: that captures stdout as a string, which corrupts gzip bytes. Writing the
 * stream to a file keeps the archive intact.
 */
async function downloadTo(destination: string, command: string, args: string[]): Promise<void> {
	const handle = await fs.open(destination, "w");
	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
			const stream = handle.createWriteStream();
			let stderr = "";
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.stdout.pipe(stream);
			child.on("error", reject);
			child.on("close", (code) => {
				stream.end();
				if (code === 0) resolve();
				else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
			});
		});
	} finally {
		await handle.close();
	}
}

/** Download and unpack the head commit, reusing a cached snapshot when one exists. */
async function snapshot(
	target: MrTarget,
	headSha: string,
	exec: ExecFn,
): Promise<{ folder: string; cleanup?: () => Promise<void> }> {
	const cached = await cachedSnapshot(target.host, target.project, headSha);
	if (cached) return cached;

	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-review-tar-"));
	const tarball = path.join(tmp, "snapshot.tar.gz");
	const project = encodeURIComponent(target.project);
	try {
		await downloadTo(tarball, "glab", [
			"api",
			"--hostname",
			target.host,
			`projects/${project}/repository/archive.tar.gz?sha=${headSha}`,
		]);
		return await unpackTarball(tarball, target.host, target.project, headSha, exec);
	} catch (error) {
		throw new Error(
			`could not download a snapshot of the merge request: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		await fs.rm(tmp, { recursive: true, force: true });
	}
}

export const gitlabSource: ChangeSource = {
	kind: "gitlab",

	async resolve(arg, options: ResolveOptions): Promise<ChangeSet> {
		const { cwd, exec } = options;
		const trimmed = arg.trim();

		const short = SHORT_PATTERN.exec(trimmed);
		const target = parseUrl(trimmed) ?? (short ? await targetFromRemote(short[1]!, cwd, exec) : null);
		if (!target) {
			throw new Error(
				`could not tell which GitLab project "${trimmed}" belongs to. Pass the full merge request URL.`,
			);
		}

		const mr = await glabJson<MrPayload>(target, `merge_requests/${target.iid}`, exec);
		const headSha = mr.diff_refs?.head_sha ?? mr.sha;
		const baseSha = mr.diff_refs?.base_sha;
		const reviewUrl =
			mr.web_url ?? `https://${target.host}/${target.project}/-/merge_requests/${target.iid}`;
		if (!headSha) throw new Error(`merge request !${target.iid} has no head commit`);

		const branchIssue = branchIssueIdentifier(mr.source_branch ?? "");
		const explicitIssues = issueIdentifiers([mr.title, mr.description].filter(Boolean).join("\n"));
		const issueCandidates = [
			...explicitIssues,
			...(branchIssue ? [branchIssue] : []),
			...issueIdentifiers(mr.title ?? "", true),
		];
		const [changes, discussions, commits] = await Promise.all([
			glabJson<ChangesPayload>(target, `merge_requests/${target.iid}/changes`, exec),
			glabJson<DiscussionsPayload>(target, `merge_requests/${target.iid}/discussions`, exec),
			glabJson<CommitPayload[]>(target, `merge_requests/${target.iid}/commits`, exec, true),
		]);
		const changeList = changes.changes ?? [];
		const diff = buildDiff(changeList);
		if (!diff.trim()) throw new Error(`merge request !${target.iid} has no changes to review`);

		const [folderInfo, linearContext] = await Promise.all([
			snapshot(target, headSha, exec),
			linearIssueContext(issueCandidates, exec),
		]);
		const references = [...explicitIssues, ...(linearContext?.identifiers ?? [])];
		const commitSummary = commits
			.filter((commit) => commit.id || commit.title)
			.map((commit) => `- ${commit.id?.slice(0, 8) ?? "????????"} ${commit.title ?? "(untitled)"}`)
			.join("\n");
		const pipeline = mr.head_pipeline?.status
			? `CI pipeline: ${mr.head_pipeline.status}${mr.head_pipeline.web_url ? ` (${mr.head_pipeline.web_url})` : ""}`
			: "";
		const intentParts = [
			`Merge request !${target.iid}: ${mr.title ?? "(untitled)"}`,
			`URL: ${reviewUrl}`,
			mr.source_branch && mr.target_branch ? `Branch: ${mr.source_branch} -> ${mr.target_branch}` : "",
			baseSha && headSha ? `Commits: ${baseSha.slice(0, 8)}..${headSha.slice(0, 8)}` : "",
			pipeline,
			mr.description?.trim() ? `\nDescription:\n${mr.description.trim()}` : "",
			commitSummary ? `\nCommit messages:\n${commitSummary}` : "",
			linearContext ? `\nLinked ticket:\n${linearContext.text}` : "",
		].filter(Boolean);

		return {
			kind: "gitlab",
			label: `!${target.iid}`,
			reviewUrl,
			folder: folderInfo.folder,
			diff,
			changedFiles: changeList.map((c) => c.new_path ?? c.old_path ?? "unknown"),
			intent: intentParts.join("\n"),
			...(references.length > 0 ? { references } : {}),
			priorComments: collectPriorComments(discussions),
			reviewKey: slug(`${target.host}-${target.project}-mr-${target.iid}`),
			...(folderInfo.cleanup ? { cleanup: folderInfo.cleanup } : {}),
		};
	},
};
