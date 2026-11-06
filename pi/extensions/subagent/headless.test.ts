import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { clip, limiter, runChild } from "./headless.ts";
import { pidAlive } from "./store.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-headless-"));

/** A stand-in for `pi --mode json`: runs `body` with an `emit(event)` helper. */
function fakePi(name: string, body: string): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
	const script = path.join(dir, `${name}.mjs`);
	fs.writeFileSync(script, `const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");\n${body}\n`);
	return { command: process.execPath, args: [script], cwd: dir, env: process.env };
}

const assistant = (text: string, extra = {}) => ({
	type: "message_end",
	message: { role: "assistant", content: [{ type: "text", text }], usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.01 } }, ...extra },
});

test("a child's stream gives its progress, last answer, and usage", async () => {
	const updates: string[] = [];
	const child = fakePi(
		"ok",
		[
			`emit({ type: "session", id: "s" });`,
			`emit({ type: "tool_execution_start", toolName: "read", args: { path: "src/app.ts" } });`,
			`emit(${JSON.stringify(assistant("looking"))});`,
			// A record split across writes, with a multi-byte character and a line separator inside a string.
			`const last = JSON.stringify(${JSON.stringify(assistant("done: café\u2028next"))}) + "\\n";`,
			`process.stdout.write(last.slice(0, 40)); setTimeout(() => process.stdout.write(last.slice(40)), 20);`,
		].join("\n"),
	);
	const outcome = await runChild(child, undefined, (progress) => updates.push(progress.activity ?? `turn ${progress.turns}`));
	assert.equal(outcome.error, undefined);
	assert.equal(outcome.output, "done: café\u2028next");
	assert.equal(outcome.turns, 2);
	assert.equal(outcome.usage.totalTokens, 30);
	assert.equal(outcome.usage.cost.total, 0.02);
	assert.deepEqual(updates, ["read src/app.ts", "turn 1", "turn 2"]);
});

test("a failing child reports why", async () => {
	const crashed = await runChild(fakePi("crash", `console.error("No API key found for openai"); process.exit(1);`));
	assert.match(crashed.error ?? "", /code 1: No API key found for openai/);

	const modelError = await runChild(fakePi("model-error", `emit(${JSON.stringify(assistant("", { stopReason: "error", errorMessage: "429 rate limited" }))});`));
	assert.equal(modelError.error, "429 rate limited");

	const silent = await runChild(fakePi("silent", ""));
	assert.equal(silent.error, "no answer");
});

test("aborting kills the child and whatever its tools started", async () => {
	const pidFile = path.join(dir, "grandchild.pid");
	const child = fakePi(
		"hang",
		[
			`import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";`,
			`const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });`,
			`writeFileSync(${JSON.stringify(pidFile)}, String(sleeper.pid));`,
			`emit({ type: "tool_execution_start", toolName: "bash", args: { command: "sleep 30" } });`,
			`setInterval(() => {}, 1000);`,
		].join("\n"),
	);
	const controller = new AbortController();
	const running = runChild(child, controller.signal, () => controller.abort());
	const outcome = await running;
	assert.equal(outcome.error, "cancelled");
	const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
	for (let i = 0; i < 20 && pidAlive(grandchild); i++) await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(pidAlive(grandchild), false);
});

test("the limiter never runs more than its cap, even as slots change hands", async () => {
	const run = limiter(2);
	let active = 0;
	let peak = 0;
	const job = (ms: number) =>
		run(async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, ms));
			active--;
			return ms;
		});
	const first = Promise.all([job(20), job(5), job(10), job(1)]);
	// A newcomer arriving just as a slot frees up must queue, not squeeze in.
	await new Promise((resolve) => setTimeout(resolve, 6));
	const results = await Promise.all([first, job(1), job(1)]);
	assert.deepEqual(results[0], [20, 5, 10, 1]);
	assert.equal(peak, 2);
	assert.equal(active, 0);
});

test("clip says where the rest is", () => {
	assert.equal(clip("short", 10, "x"), "short");
	assert.equal(clip("0123456789abc", 10, "the transcript"), "0123456789\n\n[3 more characters in the transcript]");
});
