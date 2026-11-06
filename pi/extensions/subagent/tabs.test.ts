import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { loadAgents, parseAgent } from "./agents.ts";
import { systemPrompt, taskPrompt } from "./prompt.ts";
import { enqueue, type Meta, newRunDir, runFiles, START_TIMEOUT_MS, updateMeta, writeMeta, writeState } from "./store.ts";
import { checkoutHelp, createCheckout, type Exec, slug, tabReport, waitForTabs } from "./tabs.ts";

process.env.PI_CODING_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-tabs-"));
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const exec: Exec = (command, args, options) =>
	new Promise((resolve) => {
		execFile(command, args, { cwd: options?.cwd, timeout: options?.timeout }, (error, stdout, stderr) => {
			const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
			resolve({ code, stdout, stderr });
		});
	});

function newTab(): string {
	const { id, dir } = newRunDir();
	const meta: Meta = { id, name: "impl", agent: "worker", cwd: "/", model: "m", thinking: "high", parent: "p", createdAt: new Date().toISOString() };
	writeMeta(dir, meta);
	return dir;
}

test("every bundled agent parses (a broken frontmatter would drop it without a word)", () => {
	const agents = loadAgents(new URL("./agents", import.meta.url).pathname);
	assert.deepEqual(agents.map((agent) => agent.name), ["scout", "worker"]);
	const [scout, worker] = agents;
	assert.deepEqual(scout?.tools, ["read", "grep", "find", "ls"]);
	assert.equal(scout?.skills, false);
	assert.equal(worker?.tools, undefined);
	assert.equal(worker?.skills, true);
	assert.match(systemPrompt(worker!, true), /Rex tab/);
	assert.doesNotMatch(systemPrompt(worker!, false), /Rex tab/);
	assert.equal(parseAgent("no frontmatter"), undefined);
	assert.equal(parseAgent("---\nname: Bad Name\ndescription: x\n---\n"), undefined);
});

test("a task prompt carries the brief, the scratch directory, and the swarm copy", () => {
	const prompt = taskPrompt({ brief: "Return exactly: 1) x", task: "Feature doc: features/a.md", scratch: "/s", copy: { index: 2, count: 5 } });
	assert.ok(prompt.startsWith("Return exactly: 1) x\n\nFeature doc: features/a.md\n\n---\n"));
	assert.match(prompt, /Scratch directory .*: \/s/);
	assert.match(prompt, /copy 2 of 5/);
	assert.equal(slug("Implement X, then verify!"), "implement-x-then-verify");
});

test("wait finishes a tab once it went idle after its first prompt with nothing queued", async () => {
	const dir = newTab();
	const live = process.pid;
	writeState(dir, { state: "idle", pid: live, started: false });
	assert.equal(tabReport(dir)?.finished, false, "not started yet");
	writeState(dir, { state: "idle", pid: live, started: true, reply: { text: "done" } });
	enqueue(dir, { message: "next", delivery: "steer" });
	assert.equal(tabReport(dir)?.finished, false, "a message is still waiting");
	fs.rmSync(runFiles(dir).inbox, { recursive: true });
	assert.equal(tabReport(dir)?.finished, true);
	assert.equal(tabReport(dir)?.state?.reply?.text, "done");

	writeState(dir, { state: "busy", pid: live, started: true });
	const timedOut = await waitForTabs([dir], { timeoutMs: 30, pollMs: 10 });
	assert.equal(timedOut.timedOut, true);
	setTimeout(() => writeState(dir, { state: "idle", pid: live, started: true }), 30);
	const done = await waitForTabs([dir], { timeoutMs: 2_000, pollMs: 10 });
	assert.equal(done.timedOut, false);
	assert.equal(done.reports[0]?.status, "idle");

	const controller = new AbortController();
	writeState(dir, { state: "busy", pid: live, started: true });
	setTimeout(() => controller.abort(), 20);
	assert.equal((await waitForTabs([dir], { timeoutMs: 60_000, pollMs: 10_000, signal: controller.signal })).timedOut, true, "an abort ends the wait");
});

test("a tab that doesn't start its task finishes the wait instead of holding it, counting from when it opened", () => {
	const later = Date.now() + START_TIMEOUT_MS + 60_000;
	const silent = newTab();
	assert.equal(tabReport(silent)?.failedToStart, false, "still within the grace period");
	assert.deepEqual(
		[tabReport(silent, later)?.status, tabReport(silent, later)?.failedToStart, tabReport(silent, later)?.finished],
		["starting", true, true],
		"its pi never checked in, or waits at a prompt",
	);
	updateMeta(silent, { rex: { session: "s", window: "w", openedAt: new Date(later).toISOString() } });
	assert.equal(tabReport(silent, later)?.failedToStart, false, "a slow checkout before the tab opened doesn't count");
	const failed = newTab();
	writeState(failed, { state: "idle", pid: process.pid, started: false });
	assert.deepEqual([tabReport(failed, later)?.status, tabReport(failed, later)?.failedToStart], ["idle", true], "its first prompt failed");
	updateMeta(failed, { stoppedAt: "now" });
	assert.equal(tabReport(failed, later)?.failedToStart, false, "a stopped tab is just stopped");
});

test("an isolated checkout is a git worktree on its own branch, or a jj workspace on top of @", async (t) => {
	Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", JJ_CONFIG: "/dev/null", JJ_USER: "t", JJ_EMAIL: "t@t" });
	const sh = (cwd: string, command: string) => execFileSync("sh", ["-c", command], { cwd, stdio: "pipe" }).toString();
	const repo = tmp("subagent-git-");
	sh(repo, "git init -q -b main && mkdir -p src && echo a > src/a && git add . && git commit -qm base");
	const dest = path.join(tmp("subagent-run-"), "checkout");
	const git = await createCheckout(exec, path.join(repo, "src"), dest, "subagent-impl-abc123");
	assert.equal(git.checkout.vcs, "git");
	assert.equal(fs.realpathSync(git.cwd), fs.realpathSync(path.join(dest, "src")), "the child starts where the parent's cwd is");
	assert.equal(sh(dest, "git branch --show-current").trim(), "subagent-impl-abc123");
	assert.match(checkoutHelp(git.checkout), /worktree remove/);
	await assert.rejects(createCheckout(exec, tmp("subagent-plain-"), path.join(tmp("subagent-run-"), "checkout"), "x"), /not in a jj or git repository/);

	try {
		execFileSync("jj", ["--version"], { stdio: "ignore" });
	} catch {
		t.skip("jj is not installed");
		return;
	}
	const jj = tmp("subagent-jj-");
	sh(jj, "jj git init >/dev/null 2>&1 && echo a > a && jj describe -m 'parent work' >/dev/null 2>&1");
	const jjDest = path.join(tmp("subagent-run-"), "checkout");
	const workspace = await createCheckout(exec, jj, jjDest, "subagent-impl-def456");
	assert.equal(workspace.checkout.vcs, "jj");
	assert.equal(fs.readFileSync(path.join(jjDest, "a"), "utf8"), "a\n", "the child sees the parent's working-copy change");
	assert.match(sh(jj, "jj workspace list"), /subagent-impl-def456/);
});
