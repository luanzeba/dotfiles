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
	/** What the change is for: MR/PR description, linked issue text. Empty for local work. */
	intent?: string;
	/** Comments humans already left, so the reviewer does not repeat them. */
	priorComments?: PriorComment[];
	/**
	 * Stable identity for the reviewer's session, so repeat rounds on the same change
	 * continue the same conversation and different changes never share memory.
	 */
	reviewKey: string;
	/** Release any temporary worktree or clone this source created. */
	cleanup?: () => Promise<void>;
}

export interface ResolveOptions {
	cwd: string;
	/** Compare the whole branch against its merge base instead of just uncommitted work. */
	branch?: boolean;
	exec: ExecFn;
}

export interface ChangeSource {
	kind: ChangeSourceKind;
	resolve(arg: string, options: ResolveOptions): Promise<ChangeSet>;
}

export type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string; code: number }>;

/** Keep review keys filesystem- and session-id-safe. */
export function slug(value: string): string {
	return value
		.replace(/[^\w.-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
}
