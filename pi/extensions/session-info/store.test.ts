import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { reviewCommand, scanSessionFile, searchRecords, SessionIndex, type SessionRecord, SUMMARY_TYPE, uniqueSessions } from "./store.ts";

const line = (entry: object) => `${JSON.stringify(entry)}\n`;
const header = line({ type: "session", version: 3, id: "s1", timestamp: "2026-10-01T00:00:00.000Z", cwd: "/repo/.worktrees/cus-9" });
const at = (seconds: number) => Date.parse("2026-10-01T00:00:00.000Z") + seconds * 1000;
const message = (role: string, text: string, timestamp: number) => line({ type: "message", message: { role, content: [{ type: "text", text }], timestamp } });

async function tmpdir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "session-info-"));
}

test("a session file scans into a record, leaving a half-written last line for later", async () => {
	const dir = await tmpdir();
	const file = path.join(dir, "2026-10-01T00-00-00-000Z_s1.jsonl");
	// A big paste up front: repeated words count once, and one message only gets a slice of the budget.
	const paste = `${"filler ".repeat(2000)}${Array.from({ length: 3000 }, (_, i) => `word${i}`).join(" ")}`;
	await fs.writeFile(file, header + message("user", `work on https://linear.app/acme/issue/CUS-9/x ${paste}`, at(1)));
	const rest =
		message("user", "later the throttle question on http://localhost:5173/settings/billing", at(4)) +
		message("assistant", "opened https://gitlab.acme.dev/g/p/-/merge_requests/3", at(5)) +
		line({ type: "custom", customType: SUMMARY_TYPE, data: { summary: "Fixes CUS-9", userMessages: 2 } });
	await fs.appendFile(file, rest.slice(0, 20));
	const partial = await scanSessionFile(file, await fs.stat(file));
	assert.equal(partial?.userMessages, 1);

	await fs.appendFile(file, rest.slice(20));
	const full = await scanSessionFile(file, await fs.stat(file));
	assert.equal(full?.userMessages, 2);
	assert.equal(full?.summary, "Fixes CUS-9");
	assert.equal(full?.modified, at(5));
	assert.deepEqual(full?.refs.map((ref) => ref.label), ["CUS-9", "p!3"]);
	assert.ok(full?.firstMessage.startsWith("work on https://linear.app/acme/issue/CUS-9/x filler filler"));
	const words = full?.userWords ?? "";
	assert.ok(words.length < 2500, `paste took ${words.length} chars`);
	assert.match(words, /\bword0\b/);
	assert.match(words, /\bthrottle\b/);
	// URLs that became refs are left out; others stay searchable.
	assert.doesNotMatch(words, /linear\.app/);
	assert.match(words, /localhost:5173\/settings\/billing/);
});

test("the index rewrites only the shards whose sessions changed", async () => {
	const root = await tmpdir();
	const indexDir = path.join(await tmpdir(), "index");
	await fs.mkdir(path.join(root, "--repo--"));
	const old = path.join(root, "--repo--", "2026-09-01T00-00-00-000Z_a.jsonl");
	const recent = path.join(root, "--repo--", "2026-10-01T00-00-00-000Z_b.jsonl");
	await fs.writeFile(old, header.replace("s1", "a") + message("user", "old", 1));
	await fs.writeFile(recent, header.replace("s1", "b") + message("user", "recent", 2));

	assert.equal((await new SessionIndex(indexDir, root).refresh()).length, 2);
	const septemberShard = path.join(indexDir, "index-2026-09.json");
	const before = (await fs.stat(septemberShard)).mtimeMs;

	await new Promise((resolve) => setTimeout(resolve, 20));
	await fs.appendFile(recent, message("user", "more", 3));
	const index = new SessionIndex(indexDir, root);
	const records = await index.refresh();
	assert.equal(records.find((record) => record.id === "b")?.userMessages, 2);
	assert.equal((await fs.stat(septemberShard)).mtimeMs, before);

	await fs.rm(old);
	assert.deepEqual((await index.refresh()).map((record) => record.id), ["b"]);
	assert.deepEqual(JSON.parse(await fs.readFile(septemberShard, "utf8")).sessions, []);
});

test("one record per session, found by id prefix, ticket, or words", () => {
	const base = { mtimeMs: 0, size: 0, cwd: "/repo", firstMessage: "", userMessages: 1, refs: [], teams: {} };
	const id = "01a0c5bd-2b77-779d-b8a5-978d57a02d9c";
	const records: SessionRecord[] = [
		{ ...base, id, path: `/s/2026-09-21T20-51-44-119Z_${id}.pre-recovery.jsonl`, modified: 9, userWords: "" },
		{ ...base, id, path: `/s/2026-09-21T20-51-44-119Z_${id}.jsonl`, modified: 5, userWords: "" },
		{ ...base, id: "02aa", path: "/s/b.jsonl", modified: 7, userWords: "charger 01a0c5bd", summary: "Charge caps" },
	];
	const unique = uniqueSessions(records);
	assert.deepEqual(unique.map((record) => record.path), [`/s/2026-09-21T20-51-44-119Z_${id}.jsonl`, "/s/b.jsonl"], "the canonical file wins over a backup copy");
	const ids = (query: string) => searchRecords(unique, query).map((hit) => hit.record.id);
	assert.deepEqual(ids(""), ["02aa", id], "newest first");
	assert.deepEqual(ids("01a0c5bd"), [id, "02aa"], "an id prefix comes before a text match");
	assert.deepEqual(ids("charge"), ["02aa"]);

	// A Slack thread URL ranks the session where you pasted it above one whose tool output printed it.
	const thread = "https://acme.slack.com/archives/C0123ABC/p1700000000123456";
	const slack = (source: "user" | "tool", modified: number): SessionRecord => ({
		...base,
		id: source,
		path: `/s/${source}.jsonl`,
		modified,
		userWords: "",
		refs: [{ kind: "slack", key: "acme.slack.com/C0123ABC/1700000000.123456", label: "thread", source }],
	});
	assert.deepEqual(searchRecords([slack("user", 1), slack("tool", 2)], thread).map((hit) => hit.record.id), ["user", "tool"]);
});

test("the review command follows the checkout's state", async (t) => {
	// Keep the user's git and jj config (hooks, signing, aliases) out of the throwaway repos.
	Object.assign(process.env, {
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "t",
		GIT_AUTHOR_EMAIL: "t@t",
		GIT_COMMITTER_NAME: "t",
		GIT_COMMITTER_EMAIL: "t@t",
		JJ_CONFIG: "/dev/null",
		JJ_USER: "t",
		JJ_EMAIL: "t@t",
	});
	const sh = (cwd: string, command: string) => execFileSync("sh", ["-c", command], { cwd, stdio: "pipe" });
	const origin = await tmpdir();
	const repo = await tmpdir();
	sh(origin, "git init -q --bare -b develop");
	sh(repo, `git init -q -b develop && git remote add origin ${origin} && echo a > a && git add a && git commit -qm base && git push -q origin develop`);

	sh(repo, "echo b >> a && git add a");
	assert.deepEqual((await reviewCommand(repo)).args, ["diff", "HEAD"], "staged-only changes count as uncommitted");

	sh(repo, "git commit -qm one && git checkout -qb feature-x");
	sh(repo, "echo c > c && git add c && git commit -qm two && git push -q origin feature-x");
	// Someone's branch stacked on ours, and our own pushed copy behind an unpushed commit.
	sh(repo, "git push -q origin HEAD:refs/heads/lvieira/stacked && echo d > d && git add d && git commit -qm three");
	assert.deepEqual((await reviewCommand(repo)).args, ["diff", "origin/develop...HEAD"]);

	sh(repo, "git checkout -q develop && git reset -q --hard origin/develop && echo e > e && git add e && git commit -qm only");
	assert.deepEqual((await reviewCommand(repo)).args, ["show"], "one commit past the base is just the last commit");

	// On develop itself, the base is origin/develop, not an older main.
	sh(repo, "git push -q origin develop && git push -q origin $(git rev-parse HEAD~1):refs/heads/main && echo f > f && git add f && git commit -qm unpushed1 && echo g > g && git add g && git commit -qm unpushed2");
	assert.deepEqual((await reviewCommand(repo)).args, ["diff", "origin/develop...HEAD"]);

	try {
		execFileSync("jj", ["--version"], { stdio: "ignore" });
	} catch {
		t.skip("jj is not installed");
		return;
	}
	const jj = await tmpdir();
	sh(jj, "jj git init --colocate >/dev/null 2>&1 && echo a > a && jj describe -m one >/dev/null 2>&1 && jj new >/dev/null 2>&1");
	assert.deepEqual((await reviewCommand(jj)).args, ["show", "@-"], "an empty @ shows the change before it");
	sh(jj, "echo b > b");
	assert.deepEqual((await reviewCommand(jj)).args, ["diff"]);
});
