import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * The one shape everything downstream of "what am I reviewing?" consumes.
 *
 * Nothing past this point can tell a local working tree from a downloaded copy of
 * someone else's merge request. That is the point: adding a new kind of review means
 * adding one file next to this one, and changing nothing else.
 */

export type ChangeSourceKind = "git" | "gitlab";

export interface PriorComment {
	author: string;
	body: string;
	file?: string;
	line?: number;
}

export interface ChangeSet {
	kind: ChangeSourceKind;
	/** Short human label, e.g. "cus-718-operate-charge" or "!384". */
	label: string;
	/** Canonical remote review URL, when this is a merge request. */
	reviewUrl?: string;
	/** Absolute path the reviewer reads and greps. Never the user's tree for remote reviews. */
	folder: string;
	/** Unified diff, base..head. */
	diff: string;
	changedFiles: string[];
	/** What the change is for: MR description, linked ticket, or a ticket named by the local branch. */
	intent?: string;
	/** Stable MR or ticket identifiers that make parent-session context relevant. */
	references?: string[];
	/** Comments humans already left, so the reviewer does not repeat them. */
	priorComments?: PriorComment[];
	/**
	 * Stable identity for compact prior findings. Each round gets fresh reviewer sessions,
	 * while different changes never share review history.
	 */
	reviewKey: string;
	/** Release any temporary worktree or clone this source created. */
	cleanup?: () => Promise<void>;
}

export interface ResolveOptions {
	cwd: string;
	/**
	 * Local diff scope. `uncommitted` (default) is working-tree changes against HEAD, `branch` is
	 * commits since the merge base, and `all` is both: the merge base against the working tree.
	 */
	scope?: GitScope;
	exec: ExecFn;
}

export type GitScope = "uncommitted" | "branch" | "all";

export interface ChangeSource {
	kind: ChangeSourceKind;
	resolve(arg: string, options: ResolveOptions): Promise<ChangeSet>;
}

export type ExecFn = ExtensionAPI["exec"];

/** Keep review keys filesystem- and session-id-safe. */
export function slug(value: string): string {
	return value
		.replace(/[^\w.-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
}
