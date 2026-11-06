import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { readTranscript, renderPage } from "./transcript.ts";

const at = (minute: number) => Date.parse("2026-11-06T18:00:00.000Z") + minute * 60_000;
let parent: string | null = null;
let next = 0;
/** An entry chained onto the previous one, like pi appends them. */
function entry(fields: object, parentId: string | null = parent): object {
	const id = `e${++next}`;
	parent = id;
	return { id, parentId, timestamp: new Date(at(next)).toISOString(), ...fields };
}
const message = (message: object) => entry({ type: "message", message: { timestamp: at(next + 1), ...message } });

async function fixture(): Promise<string> {
	parent = null;
	next = 0;
	const lines = [
		{ type: "session", version: 3, id: "s1", timestamp: new Date(at(0)).toISOString(), cwd: "/repo" },
		message({ role: "system", content: "", sections: { preamble: "You are pi" } }),
		entry({ type: "model_change", provider: "openai", modelId: "gpt-6-sol" }),
		message({ role: "user", content: [{ type: "text", text: "Find why VID matching fails" }, { type: "image", data: "AAAA", mimeType: "image/png" }] }),
		message({
			role: "assistant",
			stopReason: "toolUse",
			content: [
				{ type: "thinking", thinking: "secret reasoning" },
				{ type: "text", text: "Looking at the matcher." },
				{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "rg -n vid src/", timeout: 30 } },
				{ type: "toolCall", id: "c2", name: "write", arguments: { path: "notes.md", content: "x".repeat(5000) } },
			],
		}),
		message({ role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: `src/a.ts:3: vid\n${"line\n".repeat(200)}` }], isError: false }),
		message({ role: "toolResult", toolCallId: "c2", toolName: "write", content: [{ type: "text", text: "EACCES" }], isError: true }),
		message({ role: "assistant", stopReason: "error", errorMessage: "503 Service Unavailable", content: [] }),
		entry({ type: "compaction", summary: "Earlier: looked at the VID matcher.", tokensBefore: 120000, firstKeptEntryId: "e4" }),
		entry({ type: "custom_message", customType: "session-message", content: "Message from pi session @@01a1b2eb", display: true }),
		message({ role: "bashExecution", command: "git status", output: "clean", exitCode: 0 }),
		entry({ type: "custom", customType: "session-info", data: { summary: "Fixes VID matching" } }),
	];
	// An abandoned /tree branch off the first user message, then the current branch continues.
	const branchPoint = "e3";
	lines.push(entry({ type: "message", message: { role: "user", content: "abandoned idea", timestamp: at(30) } }, branchPoint));
	const abandoned = parent;
	parent = "e11";
	lines.push(message({ role: "user", content: "Now fix it" }), message({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Fixed in a.ts." }] }));
	assert.ok(abandoned);
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "si-transcript-"));
	const file = path.join(dir, "s1.jsonl");
	await fs.writeFile(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
	return file;
}

test("a session reads as numbered items on its current branch", async () => {
	const transcript = await readTranscript(await fixture());
	assert.equal(transcript.offBranch, 1, "the abandoned branch is left out");
	assert.deepEqual(
		transcript.items.map((item) => item.kind),
		["model", "user", "assistant", "bash", "write", "error", "compaction", "message (session-message)", "user !", "user", "assistant"],
	);
	const [model, user, , bash, write, error] = transcript.items;
	assert.equal(model.body, "openai/gpt-6-sol");
	assert.equal(user.body, "Find why VID matching fails\n[1 image]");
	assert.equal(bash.head, 'rg -n vid src/');
	assert.match(bash.result ?? "", /^ok \(202 lines\): src\/a\.ts:3: vid line line/);
	assert.ok((bash.result ?? "").length < 400, "tool output is trimmed");
	assert.equal(write.head, "notes.md", "file contents stay out of the call line");
	assert.equal(write.result, "error: EACCES");
	assert.equal(error.body, "503 Service Unavailable");
	assert.ok(!JSON.stringify(transcript.items).includes("secret reasoning"), "thinking is left out");

	const full = await readTranscript(await fixture(), { full: true });
	assert.ok((full.items[3].result ?? "").includes("\nline\n"), "full keeps tool output's lines");
});

test("pages filter, take the last items, and continue where they stopped", async () => {
	const { items } = await readTranscript(await fixture());
	const hits = renderPage(items, { query: "vid" });
	assert.deepEqual(hits.shown.map((item) => item.n), [2, 4, 7]);
	assert.equal(hits.matched, 3);
	assert.match(hits.text, /^#2 user · 2026-11-06 \d\d:\d\d\nFind why VID/);

	assert.deepEqual(renderPage(items, { last: 2 }).shown.map((item) => item.n), [10, 11]);
	const first = renderPage(items, { budget: 200 });
	assert.ok(first.shown.length >= 1 && first.next);
	const rest = renderPage(items, { from: first.next });
	assert.equal(rest.shown[0].n, first.next);
	assert.equal(rest.shown.at(-1)?.n, 11);
	assert.equal(rest.next, undefined);
});
