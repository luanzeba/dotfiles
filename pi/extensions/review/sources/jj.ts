/**
 * Local jj changes, in any workspace: the default one colocated with git, or one made with
 * `jj workspace add`, which has no .git at all. Like the git source, the reviewer reads the
 * author's actual checkout, so nothing is copied and nothing is cleaned up.
 *
 * jj has no staging area and nothing uncommitted: the working copy is a change, `@`, that every
 * jj command snapshots. So the scopes are:
 *
 *   uncommitted  the working-copy change, or the one before it when `@` is empty (after `jj new`
 *                or `jj commit`), the same rule /hunk uses; `/review` default
 *   branch       every change since the fork point with trunk(), through `@-`; `/review --branch`
 *   all          the same through `@`; the agent tool's default
 *
 * or a revset the caller chose, for work stacked on changes that aren't part of it.
 */

import * as path from "node:path";
import { branchIssueIdentifier, issueIdentifiers, linearIssueContext } from "./linear.ts";
import { type ChangeSet, type ChangeSource, type ExecFn, type ResolveOptions, slug } from "./types.ts";

const FIELD = "\u001f";
const RECORD = "\u001e";
const CHANGE_TEMPLATE = ["change_id.short(8)", 'bookmarks.map(|b| b.name()).join(",")', "description"].join(` ++ "${FIELD}" ++ `) + ` ++ "${RECORD}"`;
/**
 * The working-copy change, or the one before it when it is empty, unless that one is immutable:
 * right after `jj new main` it is trunk's tip, someone else's work.
 */
const HEAD = "coalesce(@ ~ empty(), @- ~ immutable())";

async function root(command: string, args: string[], cwd: string, exec: ExecFn): Promise<string | null> {
	const result = await exec(command, args, { cwd });
	return (result.code === 0 && result.stdout.trim()) || null;
}

/**
 * Whether `cwd` is jj's to review. jj looks upward for the nearest `.jj` without stopping at a
 * `.git`, so a git worktree inside a colocated repo would resolve to the parent workspace: the
 * nearer root wins. In a colocated checkout, jj keeps git's HEAD detached; an attached HEAD means
 * the checkout is driven with git, where jj's snapshot would also add untracked files to the index.
 */
export async function jjOwns(cwd: string, exec: ExecFn): Promise<boolean> {
	const [jj, git] = await Promise.all([
		root("jj", ["--ignore-working-copy", "workspace", "root"], cwd, exec),
		root("git", ["rev-parse", "--show-toplevel"], cwd, exec),
	]);
	if (!jj) return false;
	if (!git) return true;
	if (git !== jj) return jj.startsWith(`${git}${path.sep}`);
	return (await exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd })).code !== 0;
}

/**
 * Run jj in the workspace. Only the first call snapshots the working copy; the rest read that
 * snapshot, so every part of the review sees the same files.
 */
function jjIn(cwd: string, exec: ExecFn) {
	let snapshotted = false;
	return async (args: string[]): Promise<string> => {
		const flags = snapshotted ? ["--ignore-working-copy"] : [];
		snapshotted = true;
		const result = await exec("jj", [...flags, "--no-pager", "--color", "never", ...args], { cwd });
		if (result.code !== 0) throw new Error(`jj ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
		return result.stdout;
	};
}

function lines(output: string): string[] {
	return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

export const jjSource: ChangeSource = {
	kind: "jj",

	async resolve(_arg, options: ResolveOptions): Promise<ChangeSet> {
		const { cwd, exec, scope = "uncommitted", revisions: chosen } = options;
		// Found without a snapshot, so that the first jj call below takes it.
		const workspace = await root("jj", ["--ignore-working-copy", "workspace", "root"], cwd, exec);
		if (!workspace) throw new Error("not inside a jj workspace");
		const jj = jjIn(workspace, exec);

		// Revisions the caller chose; otherwise the range since trunk, unless there is no trunk to fork
		// from (trunk() falls back to the root commit). Then review the working-copy change, as the
		// git source does without a base.
		const fork =
			chosen || scope === "uncommitted"
				? ""
				: (await jj(["log", "--no-graph", "-r", "fork_point(trunk() | @)", "-T", "if(!root, commit_id)"])).trim();
		const revisions = chosen ?? (fork ? `${fork}..${scope === "branch" ? "@-" : HEAD}` : HEAD);
		// Blank changes, empty and undescribed like `@` after `jj new`, are left out of the list but
		// not the diff: jj won't diff a revset with gaps. A described empty change stays, since in the
		// squash workflow it carries the work's description while the edits sit in `@`.
		const changes = (await jj(["log", "--no-graph", "-r", `(${revisions}) ~ (empty() & description(exact:""))`, "-T", CHANGE_TEMPLATE]))
			.split(RECORD)
			.filter((record) => record.includes(FIELD))
			.map((record) => {
				const [id = "", bookmarks = "", description = ""] = record.split(FIELD);
				return { id: id.trim(), bookmarks: bookmarks.split(",").filter(Boolean), description: description.trim() };
			});
		const diff = await jj(["diff", "--git", "-r", revisions]);
		const newest = changes[0];
		const oldest = changes.at(-1);
		if (!diff.trim() || !newest || !oldest) {
			throw new Error(
				chosen
					? `no changes in ${chosen}`
					: fork
						? `no changes since trunk() in ${revisions}`
						: "no changes in the working-copy change or, when it is empty, the one before it",
			);
		}
		const names = await jj(["diff", "--name-only", "-r", revisions]);

		// Descriptions are the author's own account of the change, the jj counterpart of commit messages.
		const titles = changes.map((change) => change.description.split("\n")[0]!);
		const described = changes.filter((change) => change.description).map((change) => `${change.id}: ${change.description}`);
		const linear = await linearIssueContext(
			[
				...changes.flatMap((change) => change.bookmarks.flatMap((name) => branchIssueIdentifier(name) ?? [])),
				...titles.flatMap((title) => issueIdentifiers(title, true)),
			],
			exec,
		);
		const intent = [described.length ? `Change descriptions:\n${described.join("\n")}` : "", linear?.text ?? ""].filter(Boolean).join("\n\n");

		// jj log lists newest first. Change ids survive rewrites, and a review is keyed by its oldest
		// change, so the history follows the work through edits and through changes stacked on top.
		// branch and chosen revisions cover a different diff than all from the same change, so they
		// keep their own history.
		const what =
			changes.length === 1
				? `jj change ${newest.id} ${titles[0] ? `"${titles[0]}"` : "(no description)"}`
				: `${changes.length} jj changes, ${oldest.id}..${newest.id}`;
		return {
			kind: "jj",
			label: fork ? `${what} since trunk` : what,
			folder: workspace,
			diff,
			changedFiles: lines(names),
			...(intent ? { intent } : {}),
			reviewKey: slug(`${path.basename(workspace)}-${oldest.id}${chosen ? "-revisions" : fork && scope === "branch" ? "-branch" : ""}`),
		};
	},
};
