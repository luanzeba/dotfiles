import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { enqueue, type Meta, newRunDir, pendingMessages, readMeta, runDir, runFiles, type State, tabStatus, updateMeta, writeMeta } from "./store.ts";

process.env.PI_CODING_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-store-"));

const meta = (id: string): Meta => ({ id, name: "impl", agent: "worker", cwd: "/repo", model: "openai/m", thinking: "high", parent: "p1", createdAt: new Date().toISOString() });

test("each run gets its own directory with a scratch directory, and a tab's meta round-trips", () => {
	const first = newRunDir();
	const second = newRunDir();
	assert.match(first.id, /^[0-9a-f]{6}$/);
	assert.notEqual(first.id, second.id);
	assert.equal(runDir(first.id), first.dir);
	assert.ok(fs.statSync(runFiles(first.dir).scratch).isDirectory());
	writeMeta(first.dir, meta(first.id));
	updateMeta(first.dir, { stoppedAt: "2026-01-01T00:00:00.000Z" });
	assert.equal(readMeta(first.dir)?.name, "impl", "an update keeps the other fields");
	assert.equal(readMeta(second.dir), undefined, "a headless run has no meta");
	assert.throws(() => runDir("../etc"), /not a subagent id/);
});

test("a tab's status comes from both sides and whether its pi still runs", () => {
	const tab = meta("abcdef");
	const state: State = { state: "busy", pid: 123, started: true, updatedAt: "" };
	const alive = () => true;
	assert.equal(tabStatus(tab, undefined, alive), "starting", "it may also be waiting at a prompt");
	assert.equal(tabStatus(tab, state, alive), "busy");
	assert.equal(tabStatus(tab, { ...state, state: "idle" }, alive), "idle");
	assert.equal(tabStatus(tab, state, () => false), "exited", "a pi that died without saying so");
	assert.equal(tabStatus(tab, { ...state, state: "exited" }, alive), "exited");
	assert.equal(tabStatus({ ...tab, stoppedAt: "now" }, state, alive), "stopped");
});

test("inbox messages come out in the order they went in, also within one millisecond", () => {
	const { dir } = newRunDir();
	const messages = Array.from({ length: 20 }, (_, index) => `message ${index}`);
	for (const message of messages) enqueue(dir, { message, delivery: "steer" });
	fs.writeFileSync(path.join(runFiles(dir).inbox, "junk.json.tmp"), "{");
	assert.deepEqual(pendingMessages(dir).map((pending) => pending.message.message), messages);
});
