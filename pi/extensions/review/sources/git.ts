/**
 * Local git changes. The reviewer reads the user's actual checkout, so nothing is copied
 * and nothing is cleaned up.
 *
 * Two modes:
 *   default    uncommitted work (staged + unstaged + untracked)
 *   --branch   the whole branch against its merge base
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
 * branch names. Returns null when nothing sensible exists, which makes --branch fall back
 * to reviewing uncommitted work rather than diffing against an arbitrary ref.
 */
async function mergeBase(root: string, exec: ExecFn): Promise<string | null> {
	const upstream = await exec("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], { cwd: root });
	const candidates = [
		...(upstream.code === 0 && upstream.stdout.trim() ? [upstream.stdout.trim()] : []),
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

/**
 * `git diff` alone hides untracked files, which is where new code usually lives while
 * you are still working. Add them explicitly with --no-index so a brand new file shows up
 * as a diff rather than silently not existing.
 */
async function untrackedDiff(root: string, exec: ExecFn): Promise<{ diff: string; files: string[] }> {
	const listed = await exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root });
	const files = listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
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
		const { cwd, exec, branch } = options;
		const root = await gitRoot(cwd, exec);
		if (!root) throw new Error("not inside a git repository");

		const repo = path.basename(root);
		const branchName = await currentBranch(root, exec);
		const issue = branchIssueIdentifier(branchName);

		if (branch) {
			const base = await mergeBase(root, exec);
			if (base) {
				const diff = await exec("git", ["diff", "--no-color", `${base}...HEAD`], { cwd: root });
				const names = await exec("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: root });
				const changedFiles = names.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
				if (!diff.stdout.trim()) throw new Error(`no commits on ${branchName} since ${base.slice(0, 8)}`);
				const linear = issue ? await linearIssueContext([issue], exec) : undefined;
				return {
					kind: "git",
					label: branchName,
					folder: root,
					diff: diff.stdout,
					changedFiles,
					...(linear ? { intent: linear.text } : {}),
					reviewKey: slug(`${repo}-${branchName}-branch`),
				};
			}
		}

		const tracked = await exec("git", ["diff", "--no-color", "HEAD"], { cwd: root });
		const trackedNames = await exec("git", ["diff", "--name-only", "HEAD"], { cwd: root });
		const untracked = await untrackedDiff(root, exec);

		const diff = [tracked.stdout, untracked.diff].filter((part) => part.trim()).join("\n");
		if (!diff.trim()) throw new Error("no local changes to review");
		const linear = issue ? await linearIssueContext([issue], exec) : undefined;

		const changedFiles = [
			...trackedNames.stdout.split("\n").map((l) => l.trim()).filter(Boolean),
			...untracked.files,
		];

		return {
			kind: "git",
			label: `${branchName} (working tree)`,
			folder: root,
			diff,
			changedFiles,
			...(linear ? { intent: linear.text } : {}),
			reviewKey: slug(`${repo}-${branchName}-working-tree`),
		};
	},
};
