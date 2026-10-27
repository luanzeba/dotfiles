import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { scanSessionFile, SessionIndex, SUMMARY_TYPE } from "./store.ts";

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
