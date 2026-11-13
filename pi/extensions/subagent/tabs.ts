/**
 * Children in Rex tabs: an isolated checkout to work in, the command that opens the tab, and
 * waiting for them to finish. No pi imports, so `node --test` can run it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Checkout, isRunId, type Meta, pendingMessages, readMeta, readState, runDir, START_TIMEOUT_MS, type State, subagentsRoot, type TabStatus, tabStatus } from "./store.ts";

export type Exec = (
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export function slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 30) || "task"
	);
}

/** Where `cwd`, somewhere in `repo`, is in a checkout of it. VCS tools report the root with symlinks
 * resolved (/private/var on macOS), so compare real paths. */
function within(checkout: string, repo: string, cwd: string): string {
	return path.join(checkout, path.relative(fs.realpathSync(repo), fs.realpathSync(cwd)));
}

/**
 * Give a writing child its own checkout of the repository `cwd` is in: a jj workspace when it is a
 * jj repo, a git worktree otherwise. Returns the checkout and where in it the child starts.
 */
export async function createCheckout(exec: Exec, cwd: string, dest: string, ref: string): Promise<{ checkout: Checkout; cwd: string }> {
	const jj = await exec("jj", ["--ignore-working-copy", "workspace", "root"], { cwd, timeout: 10_000 });
	if (jj.code === 0) {
		const repo = jj.stdout.trim();
		const added = await exec("jj", ["workspace", "add", "--name", ref, "-r", "@", dest], { cwd: repo, timeout: 60_000 });
		if (added.code !== 0) throw new Error(`jj workspace add failed: ${(added.stderr || added.stdout).trim()}`);
		return { checkout: { vcs: "jj", path: dest, repo, ref }, cwd: within(dest, repo, cwd) };
	}
	const git = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 10_000 });
	if (git.code !== 0) throw new Error(`${cwd} is not in a jj or git repository, so there is nothing to isolate`);
	const repo = git.stdout.trim();
	const added = await exec("git", ["worktree", "add", "-b", ref, dest, "HEAD"], { cwd: repo, timeout: 60_000 });
	if (added.code !== 0) throw new Error(`git worktree add failed: ${(added.stderr || added.stdout).trim()}`);
	return { checkout: { vcs: "git", path: dest, repo, ref }, cwd: within(dest, repo, cwd) };
}

/** What to tell the parent about a checkout a stopped child leaves behind. */
export function checkoutHelp(checkout: Checkout): string {
	return checkout.vcs === "jj"
		? `Its work is in jj workspace ${checkout.ref} at ${checkout.path}: \`jj log -r '${checkout.ref}@'\` from ${checkout.repo} shows it. When you're done with it: \`jj workspace forget ${checkout.ref} && rm -rf ${checkout.path}\`.`
		: `Its work is on branch ${checkout.ref} in worktree ${checkout.path}: \`git -C ${checkout.repo} log HEAD..${checkout.ref}\`. When you're done with it: \`git -C ${checkout.repo} worktree remove ${checkout.path}\`.`;
}

/** `rex window new` arguments that run `command` in a background tab of `session`. */
export function rexWindowArgs(options: {
	session: string;
	label: string;
	cwd: string;
	env: Record<string, string>;
	command: string[];
}): string[] {
	// Through the login shell with its interactive startup files, like a tab the user opens: that is
	// where PATH and provider keys (~/.zshrc sources the proxy's) come from.
	const shell = process.env.SHELL || "/bin/zsh";
	return [
		"window",
		"new",
		"-s",
		options.session,
		options.label,
		"-c",
		options.cwd,
		"--focus=false",
		"--shell",
		shell,
		"--interactive",
		"--json",
		"--",
		"env",
		...Object.entries(options.env).map(([name, value]) => `${name}=${value}`),
		...options.command,
	];
}

export interface TabReport {
	dir: string;
	meta: Meta;
	state: State | undefined;
	status: TabStatus;
	/** Done with everything it was given: idle after its first prompt with nothing queued, or gone. */
	finished: boolean;
	/** It hasn't started its task in time: its pi didn't check in, it waits at a prompt, or its first prompt failed. */
	failedToStart: boolean;
}

export function tabReport(dir: string, now = Date.now()): TabReport | undefined {
	// The inbox before the state: the tab marks itself busy before it takes a message out, so in
	// this order an idle state with an empty inbox can't miss a message in flight.
	const pending = pendingMessages(dir).length;
	const meta = readMeta(dir);
	if (!meta) return undefined;
	const state = readState(dir);
	const status = tabStatus(meta, state);
	// The clock starts when the tab opens: making an isolated checkout first can take a while.
	const opened = Date.parse(meta.rex?.openedAt ?? meta.createdAt);
	const failedToStart = !state?.started && status !== "stopped" && (status === "exited" || now - opened > START_TIMEOUT_MS);
	const finished =
		status === "exited" || status === "stopped" || failedToStart || (status === "idle" && !!state?.started && pending === 0);
	return { dir, meta, state, status, finished, failedToStart };
}

/**
 * The main agent's live tabs, whichever of its sessions spawned them: those reporting to `stateDir`
 * that are busy, idle, or still starting. Tabs that ended without a stop (closed by hand, a crash, a
 * reboot) are left out.
 */
export function tabsReportingTo(stateDir: string, now = Date.now()): string[] {
	let names: string[];
	try {
		names = fs.readdirSync(subagentsRoot());
	} catch {
		return [];
	}
	return names.filter(isRunId).flatMap((id) => {
		const tab = tabReport(runDir(id), now);
		const live = tab?.status === "busy" || tab?.status === "idle" || (tab?.status === "starting" && !tab.failedToStart);
		return tab && live && tab.meta.reportTo === stateDir ? [tab.dir] : [];
	});
}

/** Poll until every tab has finished, the time is up, or the wait is aborted. */
export async function waitForTabs(
	dirs: string[],
	options: { timeoutMs: number; signal?: AbortSignal; pollMs?: number; onTick?: (reports: TabReport[]) => void },
): Promise<{ reports: TabReport[]; timedOut: boolean }> {
	const deadline = Date.now() + options.timeoutMs;
	for (;;) {
		const reports = dirs.map((dir) => tabReport(dir)).filter((report): report is TabReport => !!report);
		options.onTick?.(reports);
		if (reports.every((report) => report.finished)) return { reports, timedOut: false };
		if (Date.now() >= deadline || options.signal?.aborted) return { reports, timedOut: true };
		await sleep(options.pollMs ?? 1_000, undefined, options.signal ? { signal: options.signal } : {}).catch(() => {});
	}
}
