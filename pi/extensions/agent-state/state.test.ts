import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { addNote, age, claimMain, commitMessage, frontMatter, group, isMainSession, LOCK_FILE, loadItems, mainHolder, memoryIndex, noteGist, notesText, readNotes, releaseMain, removeNotes, snapshot, stateDir, statusView } from "./state.ts";

function repo(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-state-"));
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	}
	return dir;
}

const item = (fields: Record<string, string>, body = "Why.\n") =>
	`---\n${Object.entries(fields)
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n")}\nlinks:\n  - https://example.com/mr/1\n---\n\n${body}`;

test("front matter: top-level fields only, comments and quotes stripped, no closing fence means none", () => {
	assert.deepEqual(frontMatter(item({ title: '"Fix: login"', status: "active   # comment", needs: "Review it" })), {
		title: "Fix: login",
		status: "active",
		needs: "Review it",
		links: "",
	});
	// As in YAML: a quoted value keeps its # and unescapes, an unquoted one ends at ` #`.
	assert.deepEqual(frontMatter('---\ntitle: "Fix #4512 \\"login\\""  # x\nneeds: \'Check Luan\'\'s draft\' # y\nwhat: Reply on issue #45\n---\n'), {
		title: 'Fix #4512 "login"',
		needs: "Check Luan's draft",
		what: "Reply on issue",
	});
	assert.deepEqual(frontMatter("---\ntitle: x\n"), {});
	assert.deepEqual(frontMatter("title: x\n"), {});
});

test("items load from work/*.md, defaulting the title to the slug and the status to active", () => {
	const dir = repo({
		"work/b-feature.md": item({ title: "B feature", status: "landed", updated: "2026-11-10" }),
		"work/a.md": "no front matter",
		"work/notes.txt": "ignored",
	});
	assert.deepEqual(loadItems(dir), [
		{ slug: "a", title: "a", status: "active" },
		{ slug: "b-feature", title: "B feature", status: "landed", updated: "2026-11-10" },
	]);
	assert.deepEqual(loadItems(path.join(dir, "missing")), []);
});

test("groups: needs first (landed ones too), open with active before waiting, landed, and a count of closed", () => {
	const groups = group([
		{ slug: "w", title: "Waiting", status: "waiting", updated: "2026-11-12" },
		{ slug: "a", title: "Active", status: "active", updated: "2026-11-01" },
		{ slug: "n", title: "Needs", status: "active", needs: "Approve" },
		{ slug: "l", title: "Landed review", status: "landed", needs: "Look at the demo" },
		{ slug: "l2", title: "Landed", status: "landed" },
		{ slug: "c", title: "Cleaned", status: "cleaned" },
		{ slug: "d", title: "Dropped", status: "dropped" },
	]);
	assert.deepEqual(groups.needs.map((i) => i.slug).sort(), ["l", "n"]);
	assert.deepEqual(groups.open.map((i) => i.slug), ["a", "w"]);
	assert.deepEqual(groups.landed.map((i) => i.slug), ["l2"]);
	assert.equal(groups.closed, 2);
});

test("age reads dates as local days", () => {
	const now = new Date("2026-11-13T15:00:00");
	assert.equal(age("2026-11-13", now), "today");
	assert.equal(age("2026-11-12", now), "yesterday");
	assert.equal(age("2026-11-03", now), "10d ago");
	assert.equal(age("2026-09-01", now), "2026-09-01");
	assert.equal(age("soon", now), "soon");
	assert.equal(age(undefined, now), undefined);
});

test("status view: sections, the needs line, notes, and an empty state", () => {
	const now = new Date("2026-11-13T15:00:00");
	const view = statusView(
		[
			{ slug: "n", title: "Ground caps", status: "active", updated: "2026-11-13", needs: "Review the MR" },
			{ slug: "w", title: "Trino access", status: "waiting", updated: "2026-11-11" },
			{ slug: "c", title: "Old", status: "cleaned" },
		],
		{ now, notes: [{ at: now.toISOString(), from: 'subagent tab "fix login"', message: 'Subagent tab "fix login" (subagent_tab id x) finished a turn.\n\nDone: fixed it.' }] },
	);
	assert.deepEqual(view, [
		"Needs you (1)",
		"  • Ground caps  (updated today)",
		"      → Review the MR",
		"In progress (1)",
		"  • Trino access  (updated 2d ago · waiting)",
		"Notes for your next message (1)",
		'  • subagent tab "fix login": Done: fixed it.',
		"1 done (cleaned or dropped) not shown",
	]);
	assert.deepEqual(statusView([]), ["Nothing tracked yet."]);
});

test("note gists skip a subagent report's header", () => {
	const gist = (message: string) => noteGist({ at: "", from: "x", message });
	assert.equal(gist('Subagent tab "x" (subagent_tab id 1a2b3c) finished a turn.\n\nThe build is green.'), "The build is green.");
	assert.equal(gist('Subagent tab "x" (subagent_tab id 1) finished a turn with an error: 429.'), 'Subagent tab "x" (subagent_tab id 1) finished a turn with an error: 429.');
	assert.equal(gist("Just one line"), "Just one line");
	assert.equal(gist("x".repeat(200)).length, 100);
});

test("notes are one file each in a self-ignoring folder, read oldest first and removed by file", () => {
	const dir = repo({});
	assert.deepEqual(readNotes(dir), []);
	addNote(dir, { at: "2026-11-13T10:00:00.000Z", from: "a", message: "one" });
	addNote(dir, { at: "2026-11-13T09:00:00.000Z", from: "b", message: "two", replyTo: "s1" });
	fs.writeFileSync(path.join(dir, ".pending", "notes", "broken.json"), "not json");
	fs.writeFileSync(path.join(dir, ".pending", "notes", ".half.tmp"), "{");
	assert.equal(fs.readFileSync(path.join(dir, ".pending", ".gitignore"), "utf8"), "*\n");
	const notes = readNotes(dir);
	assert.deepEqual(notes.map(({ note }) => note.message), ["two", "one"]);
	removeNotes([notes[0].file]);
	assert.deepEqual(readNotes(dir).map(({ note }) => note.message), ["one"]);
	const text = notesText(notes.map(({ note }) => note));
	assert.match(text, /^2 notes from other sessions/);
	assert.match(text, /### From b \(2026-11-13 09:00 UTC\)\nAnswer with session_send to session "s1"\.\n\ntwo/);
});

test("one main agent per clone: a running holder keeps the role, a gone one gives it up", () => {
	const dir = repo({});
	assert.equal(mainHolder(dir), undefined);
	assert.equal(claimMain(dir), undefined);
	assert.equal(mainHolder(dir), process.pid);
	assert.equal(claimMain(dir), undefined, "the holder can claim again, as after /new");
	assert.equal(claimMain(dir, 99_999_999), process.pid, "another pi is refused while the holder runs");
	releaseMain(dir, 99_999_999);
	assert.equal(mainHolder(dir), process.pid, "only the holder releases");
	releaseMain(dir);
	assert.equal(mainHolder(dir), undefined);
	fs.writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ pid: 99_999_999 }));
	assert.equal(claimMain(dir), undefined, "a holder that's gone loses the role");
	fs.writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ pid: 1 }));
	assert.equal(mainHolder(dir), undefined, "a pid another user's process took over isn't a holder");
});

test("the memory index loads capped, and the snapshot lists work by section", () => {
	const dir = repo({
		"memory/MEMORY.md": `${Array.from({ length: 250 }, (_, i) => `- note ${i}`).join("\n")}\n`,
		"work/x.md": item({ title: "X", status: "active", updated: "2026-11-13", needs: "Decide" }),
		"work/y.md": item({ title: "Y", status: "cleaned" }),
	});
	const memory = memoryIndex(dir) ?? "";
	assert.equal(memory.split("\n").length, 201);
	assert.match(memory, /isn't loaded; keep the index short/);
	const text = snapshot(dir, new Date("2026-11-13T15:00:00Z"));
	assert.match(text, /Needs Luan:\n- work\/x\.md: X \(active, updated 2026-11-13\): Decide/);
	assert.match(text, /1 more are cleaned or dropped\./);
	assert.match(text, /## Memory index \(memory\/MEMORY\.md\)\n- note 0/);
	assert.match(snapshot(repo({})), /No work files yet\.[\s\S]*## Memory index \(memory\/MEMORY\.md\)\nEmpty\./);
});

test("main session: the state repo itself, never a subagent", () => {
	const dir = repo({ "work/.keep": "" });
	assert.equal(isMainSession(dir, dir, {}), true);
	assert.equal(isMainSession(path.join(dir, "work"), dir, {}), false);
	assert.equal(isMainSession(dir, dir, { PI_SUBAGENT_DIR: "/x" }), false);
	assert.equal(isMainSession("/nope", dir, {}), false);
	const link = `${dir}-link`;
	fs.symlinkSync(dir, link);
	assert.equal(isMainSession(link, dir, {}), true);
});

test("state dir comes from PI_AGENT_STATE_DIR", () => {
	const saved = process.env.PI_AGENT_STATE_DIR;
	try {
		process.env.PI_AGENT_STATE_DIR = "/srv/state/";
		assert.equal(stateDir(), "/srv/state");
		delete process.env.PI_AGENT_STATE_DIR;
		assert.equal(stateDir(), path.join(os.homedir(), "luan-agent-state"));
	} finally {
		if (saved === undefined) delete process.env.PI_AGENT_STATE_DIR;
		else process.env.PI_AGENT_STATE_DIR = saved;
	}
});

test("commit messages name the changed paths", () => {
	const paths = ["work/a.md", "work/b.md", "memory/new.md"];
	assert.equal(commitMessage(paths), "Update work/a.md, work/b.md, memory/new.md");
	assert.equal(commitMessage([...paths, "x", "y"]), "Update work/a.md, work/b.md, memory/new.md and 2 more");
});
