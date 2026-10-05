/**
 * Local git changes. The reviewer reads the user's actual checkout, so nothing is copied
 * and nothing is cleaned up.
 *
 * Three scopes:
 *   uncommitted  work since HEAD (staged + unstaged + untracked); `/review` default
 *   branch       commits since the merge base; `/review --branch`
 *   all          merge base to the working tree, untracked included; the agent tool's default,
 *                so commits between review rounds keep the same diff and review history
 */

import * as path from "node:path";
import { branchIssueIdentifier, linearIssueContext } from "./linear";
import { type ChangeSet, type ChangeSource, type ExecFn, type ResolveOptions, slug } from "./types";

async function gitRoot(cwd: string, exec: ExecFn): Promise<string | null> {
	const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	if (result.code !== 0) return null;
	const root = result.stdout.trim();
	return root || null;
}

async function currentBranch(root: string, exec: ExecFn): Promise<string> {
	const result = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
	const name = result.stdout.trim();
	return name && name !== "HEAD" ? name : "detached";
}

/**
 * Pick the branch this work forked from. Tries the upstream first, then the usual default
 * branch names. Returns null when nothing sensible exists, which makes the branch and all
 * scopes fall back to reviewing uncommitted work rather than diffing against an arbitrary ref.
 *
 * An upstream that is the branch's own remote copy (`git push -u`) is skipped: its merge base is
 * the last push, so pushed commits would silently drop out of the review.
 */
async function mergeBase(root: string, branchName: string, exec: ExecFn): Promise<string | null> {
	const upstream = await exec("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], { cwd: root });
	const upstreamName = upstream.code === 0 ? upstream.stdout.trim() : "";
	const isOwnRemote = upstreamName.slice(upstreamName.indexOf("/") + 1) === branchName;
	const candidates = [
		...(upstreamName && !isOwnRemote ? [upstreamName] : []),
		"origin/HEAD",
		"origin/develop",
		"origin/main",
		"origin/master",
		"develop",
		"main",
		"master",
	];

	for (const candidate of candidates) {
		const base = await exec("git", ["merge-base", "HEAD", candidate], { cwd: root });
		if (base.code === 0 && base.stdout.trim()) return base.stdout.trim();
	}
	return null;
}

function lines(output: string): string[] {
	return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * `git diff` alone hides untracked files, which is where new code usually lives while
 * you are still working. Add them explicitly with --no-index so a brand new file shows up
 * as a diff rather than silently not existing.
 */
async function untrackedDiff(root: string, exec: ExecFn): Promise<{ diff: string; files: string[] }> {
	const listed = await exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root });
	const files = lines(listed.stdout);
	if (files.length === 0) return { diff: "", files: [] };

	const chunks: string[] = [];
	for (const file of files) {
		const result = await exec("git", ["diff", "--no-color", "--no-index", "--", "/dev/null", file], {
			cwd: root,
		});
		if (result.stdout.trim()) chunks.push(result.stdout);
	}
	return { diff: chunks.join("\n"), files };
}

export const gitSource: ChangeSource = {
	kind: "git",

	async resolve(_arg, options: ResolveOptions): Promise<ChangeSet> {
		const { cwd, exec, scope = "uncommitted" } = options;
		const root = await gitRoot(cwd, exec);
		if (!root) throw new Error("not inside a git repository");

		const repo = path.basename(root);
		const branchName = await currentBranch(root, exec);
		const issue = branchIssueIdentifier(branchName);
		const intent = async () => {
			const linear = issue ? await linearIssueContext([issue], exec) : undefined;
			return linear ? { intent: linear.text } : {};
		};
		const base = scope === "uncommitted" ? null : await mergeBase(root, branchName, exec);

		if (base && scope === "branch") {
			const diff = await exec("git", ["diff", "--no-color", `${base}...HEAD`], { cwd: root });
			const names = await exec("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: root });
			if (!diff.stdout.trim()) throw new Error(`no commits on ${branchName} since ${base.slice(0, 8)}`);
			return {
				kind: "git",
				label: branchName,
				folder: root,
				diff: diff.stdout,
				changedFiles: lines(names.stdout),
				...(await intent()),
				reviewKey: slug(`${repo}-${branchName}-branch`),
			};
		}

		// `git diff <commit>` compares that commit with the working tree, so the merge base
		// covers committed and uncommitted work alike. HEAD covers only uncommitted work.
		const from = base ?? "HEAD";
		const tracked = await exec("git", ["diff", "--no-color", from], { cwd: root });
		const trackedNames = await exec("git", ["diff", "--name-only", from], { cwd: root });
		const untracked = await untrackedDiff(root, exec);

		const diff = [tracked.stdout, untracked.diff].filter((part) => part.trim()).join("\n");
		if (!diff.trim()) {
			throw new Error(base ? `no changes on ${branchName} since ${base.slice(0, 8)}` : "no local changes to review");
		}

		return {
			kind: "git",
			label: base ? `${branchName} (branch and working tree)` : `${branchName} (working tree)`,
			folder: root,
			diff,
			changedFiles: [...lines(trackedNames.stdout), ...untracked.files],
			...(await intent()),
			reviewKey: slug(`${repo}-${branchName}-${base ? "all" : "working-tree"}`),
		};
	},
};
