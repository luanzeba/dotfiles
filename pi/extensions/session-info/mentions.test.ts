import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Status } from "./live.ts";
import { dropdownItems, findMentions, incomingText, knownSessions, mentionNote, mentionProvider, place, sessionsForToken, shortToken } from "./mentions.ts";
import { ticketRef } from "./refs.ts";
import type { SessionRecord } from "./store.ts";

const NOW = Date.parse("2026-11-06T18:00:00.000Z");
const minutes = (n: number) => NOW - n * 60_000;

function record(id: string, fields: Partial<SessionRecord> = {}): SessionRecord {
	return {
		path: `/sessions/--repo--/2026-11-06T00-00-00-000Z_${id}.jsonl`,
		mtimeMs: 0,
		size: 0,
		id,
		cwd: "/Users/me/dotfiles",
		modified: minutes(60),
		firstMessage: "first message",
		userWords: "",
		userMessages: 1,
		refs: [],
		teams: {},
		...fields,
	};
}

const status = (sessionId: string, idle = false): Status => ({ sessionId, cwd: "/Users/me/dotfiles-ws/subagents", idle, pid: 42 });

// Sessions started within the same minute share their first 8 hex digits.
const A = "01a1b345-a701-7743-93c5-ab2107d9a5b5";
const B = "01a1b345-a5f3-7858-a343-47ca95547352";
const C = "01a19be6-b94a-7000-8000-000000000000";

test("tokens are id prefixes of 8 or more characters, unique among known sessions", () => {
	assert.equal(shortToken(C, [A, B, C]), "01a19be6");
	assert.equal(shortToken(A, [A, B, C]), "01a1b345-a7", "a shared prefix grows past the dash, never ending on it");
	assert.equal(shortToken("short", ["short"]), "short");
	const sessions = knownSessions([record(A), record(B), record(C)], new Map());
	assert.deepEqual(sessionsForToken("01a1b345-a7", sessions).map((s) => s.id), [A]);
	assert.equal(sessionsForToken("01a1b345", sessions).length, 2);
	assert.equal(sessionsForToken("01a1", sessions).length, 0, "mentions need 8 characters");
	assert.equal(sessionsForToken("@@01a1", sessions, 4).length, 3, "tools accept shorter prefixes");
});

test("mentions are found in prose, not in emails, diffs, or code", () => {
	assert.deepEqual(findMentions("see @@01a1b345-a7, and (@@01a19be6). Not me@@example or @@ -1,3 +1,4 @@"), ["01a1b345-a7", "01a19be6"]);
});

test("the dropdown takes over at @@ and leaves everything else to pi", async () => {
	const calls: string[] = [];
	const current: AutocompleteProvider = {
		getSuggestions: async (lines, line, col) => {
			calls.push(lines[line].slice(0, col));
			return { prefix: "@src", items: [{ value: "@src/", label: "src/" }] };
		},
		applyCompletion: (lines) => ({ lines: [...lines, "built-in"], cursorLine: 0, cursorCol: 0 }),
		shouldTriggerFileCompletion: () => false,
	};
	const queries: string[] = [];
	const provider = mentionProvider(current, async (query) => {
		queries.push(query);
		return [{ value: "@@01a19be6", label: "● 5m  dotfiles", description: "Fixes VID matching" }];
	});
	const signal = new AbortController().signal;
	const get = (text: string) => provider.getSuggestions([text], 0, text.length, { signal });

	assert.equal((await get("look at @src"))?.prefix, "@src", "@file is pi's");
	assert.equal((await get("mail me@@x"))?.prefix, "@src", "@@ inside a word isn't a mention");
	assert.deepEqual(calls, ["look at @src", "mail me@@x"]);
	assert.deepEqual(await get("look at (@@vid"), { prefix: "@@vid", items: [{ value: "@@01a19be6", label: "● 5m  dotfiles", description: "Fixes VID matching" }] });
	assert.equal((await get("@@"))?.prefix, "@@");
	assert.deepEqual(queries, ["vid", ""]);
});

test("dropdown rows describe sessions in words, newest first, and filter like /resume-search", () => {
	const records = [
		record(A, { modified: minutes(2), summary: "Adds @@ session mentions" }),
		record(B, { modified: minutes(5), name: "subagents", cwd: "/Users/me/beta/config-service/.worktrees/cus-1203", refs: [{ ...ticketRef("CUS", 1203), source: "workspace" }] }),
		record(C, { modified: minutes(90), firstMessage: "Look   at the\nVID matcher", userWords: "look the vid matcher" }),
		record("01a00000-0000-7000-8000-000000000000", { userMessages: 0 }),
	];
	const sessions = knownSessions(records, new Map([[B, status(B)]]));
	const rows = dropdownItems(sessions, "", A, NOW);
	assert.deepEqual(rows, [
		{ value: "@@01a1b345-a5", label: "●  5m  subagents", description: "subagents" },
		{ value: "@@01a19be6", label: "   1h  dotfiles", description: "Look at the VID matcher" },
	]);
	assert.equal(place("/Users/me/beta/config-service/.worktrees/cus-1203"), "config-service ⎇ cus-1203");
	assert.deepEqual(dropdownItems(sessions, "cus-1203", A, NOW).map((row) => row.value), ["@@01a1b345-a5"]);
	assert.deepEqual(dropdownItems(sessions, "vid", A, NOW).map((row) => row.value), ["@@01a19be6"]);
	assert.deepEqual(dropdownItems(sessions, "01a19b", A, NOW).map((row) => row.value), ["@@01a19be6"]);
});

test("a mention tells the agent where the session is, without changing the message", () => {
	const sessions = knownSessions([record(C, { summary: "Fixes VID matching", modified: minutes(12) })], new Map([[C, { ...status(C, true), about: "Fixes VID matching for good" }]]));
	const note = mentionNote("do what @@01a19be6 did, and @@deadbeef1 too; not @@word", sessions, A, NOW);
	assert.ok(note);
	assert.match(note.content, /@@01a19be6 is\nsession 01a19be6-b94a-7000-8000-000000000000\n- file: \/sessions\/--repo--\/2026-11-06T00-00-00-000Z_01a19be6-b94a-7000-8000-000000000000\.jsonl\n- cwd: \/Users\/me\/dotfiles-ws\/subagents\n- about: Fixes VID matching for good\n- last activity: 2026-11-06 \d\d:48 \(12m ago\)\n- live: yes, idle; session_send can message it/);
	assert.match(note.content, /@@deadbeef1 matches no session/);
	assert.doesNotMatch(note.content, /@@word/);
	assert.deepEqual(note.rows.map((row) => [row.token, row.matches, row.live]), [["01a19be6", 1, true], ["deadbeef1", 0, undefined]]);
	assert.equal(mentionNote("no mentions here, just me@@host", sessions, A, NOW), undefined);
});

test("a delivered message names its sender and how to answer", () => {
	const text = incomingText("Can you rebase?", { sessionId: A, token: "01a1b345-a7", cwd: "/repo", about: "Adds mentions", listening: true });
	assert.equal(
		text,
		`Message from pi session @@01a1b345-a7 (${A}; cwd: /repo; about: Adds mentions), sent with session_send.\nIf it asks for an answer, reply with session_send to session "${A}".\n\nCan you rebase?`,
	);
	assert.match(incomingText("Deploy finished", { sessionId: A }), /can't be answered with session_send/, "a print-mode sender can't take a reply");
});
