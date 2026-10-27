import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyUrl, matchSession, notableRefs, parseQuery, RefCollector, type Ref, userText } from "./refs.ts";

const MR = "https://gitlab.example.org/software/operate/config-service/-/merge_requests/743";
const GITLAB = "https://gitlab.acme.dev/software/operate/config-service/-/merge_requests/743";

test("classifyUrl canonicalizes the links sessions are about", () => {
	assert.deepEqual(classifyUrl(`${GITLAB}/diffs#note_1).`), {
		kind: "mr",
		key: "gitlab.acme.dev/software/operate/config-service!743",
		label: "config-service!743",
		url: GITLAB,
		num: 743,
	});
	const ticket = classifyUrl("https://linear.app/acme/issue/cus-671/wo-page-on-siderail-duplicated");
	assert.equal(ticket?.key, "CUS-671");
	assert.equal(ticket?.url, "https://linear.app/acme/issue/CUS-671");
	assert.equal(ticket?.title, "wo page on siderail duplicated");
	assert.deepEqual(ticket?.team, ["CUS", "acme"]);
	assert.equal(classifyUrl("https://github.com/o/repo/pull/12/files")?.label, "repo#12");
	assert.equal(classifyUrl("https://acme.slack.com/archives/C0A4CGNM24/p1792745497003009")?.kind, "slack");
	assert.equal(classifyUrl("https://cus-1203.ground.config.localhost/sessions?x=1")?.url, "https://cus-1203.ground.config.localhost");
	assert.equal(classifyUrl("https://gitlab.acme.dev/g/p/-/jobs/7980506")?.label, "p job 7980506");
	// Placeholders from docs and fixtures, plain localhost, and static assets are not session links.
	assert.equal(classifyUrl(MR), undefined);
	assert.equal(classifyUrl("https://parts.example.test/x"), undefined);
	assert.equal(classifyUrl("http://localhost:5173"), undefined);
	assert.equal(classifyUrl("https://cdn.acme.dev/logo.png"), undefined);
});

function collect(messages: any[], cwd = ""): Ref[] {
	const collector = new RefCollector();
	collector.addWorkspace(cwd);
	for (const message of messages) collector.addMessage(message);
	return collector.list();
}

const user = (text: string) => ({ role: "user", content: text });
const call = (id: string, command: string) => ({ role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command } }] });
const result = (id: string, text: string) => ({ role: "toolResult", toolCallId: id, content: [{ type: "text", text }] });

test("merge requests the session created or pushed to are authored", () => {
	const refs = collect([
		user("Let's work on https://linear.app/acme/issue/CUS-1203/charge-target"),
		call("a", `cd x && GITLAB_HOST=h glab mr create --title 'feat(ground): charge target' --draft`),
		result("a", `${GITLAB}\n`),
		call("b", "cat > body.md <<'EOF'\nThe charger's cap\nEOF\nglab mr create -t \"fix: other\" --description \"$(cat body.md)\""),
		result("b", "Creating draft merge request for x into develop in g/p\n\nhttps://gitlab.acme.dev/g/p/-/merge_requests/9\n"),
		call("c", "git push -u origin HEAD"),
		result("c", "remote: View merge request for codex/x:\nremote:   https://gitlab.acme.dev/g/q/-/merge_requests/5   \n"),
		call("d", "glab mr view 1"),
		result("d", "https://gitlab.acme.dev/g/p/-/merge_requests/1"),
		// Searching old logs prints another session's create and push output; that is not authoring.
		call("e", "node scan.mjs 'glab mr create|gh pr create' && rg \"git push\" ~/.pi/agent/sessions"),
		result("e", "Creating merge request for y\n\nhttps://gitlab.acme.dev/g/r/-/merge_requests/7\nView merge request for y:\nremote: https://gitlab.acme.dev/g/r/-/merge_requests/8\n"),
	]);
	const byKey = Object.fromEntries(refs.map((ref) => [ref.label, ref]));
	assert.equal(byKey["config-service!743"].source, "authored");
	assert.equal(byKey["config-service!743"].title, "feat(ground): charge target");
	assert.equal(byKey["p!9"].source, "authored");
	assert.equal(byKey["p!9"].title, "fix: other");
	assert.equal(byKey["q!5"].source, "authored");
	assert.equal(byKey["p!1"].source, "tool");
	assert.equal(byKey["r!7"].source, "tool");
	assert.equal(byKey["r!8"].source, "tool");
	assert.equal(byKey["CUS-1203"].source, "prompt");
});

test("tickets come from text and the cwd, and keep their strongest source", () => {
	const refs = collect(
		[
			user("first"),
			user("also CUS-12, see SHA-256"),
			{ role: "assistant", content: [{ type: "text", text: "CUS-12 and CUS-99 relate" }] },
			call("a", "linear issue get CUS-77"),
			result("a", "CUS-77 OPS-1 https://linear.app/acme/issue/CUS-5/slug"),
		],
		"/repo/.worktrees/cus-1203-ground",
	);
	const sources = Object.fromEntries(refs.map((ref) => [ref.key, ref.source]));
	assert.equal(sources["CUS-1203"], "workspace");
	assert.equal(sources["CUS-12"], "user");
	assert.equal(sources["CUS-99"], "assistant");
	assert.equal(sources["CUS-5"], "tool");
	// Bare ids in tool calls and output are ignored; links are not.
	assert.equal(sources["CUS-77"], undefined);
	assert.equal(sources["OPS-1"], undefined);

	const notable = notableRefs(refs, { CUS: "acme" }).map((ref) => ref.key);
	// SHA-256 is not a known Linear team; assistant-only tickets yield to stronger ones.
	assert.deepEqual(notable, ["CUS-12", "CUS-1203"]);
	assert.equal(notableRefs(refs, { CUS: "acme" })[0].url, "https://linear.app/acme/issue/CUS-12");
});

test("queries match refs exactly and rank by how strongly the session is tied to them", () => {
	const refs = collect([user(`review ${GITLAB} for CUS-718`), call("a", "glab mr create"), result("a", "https://gitlab.acme.dev/g/maintenance/-/merge_requests/1235")]);
	const haystack = "charge caps for ground";
	const score = (query: string) => matchSession(refs, haystack, parseQuery(query))?.score;
	assert.equal(score("1235"), 0);
	assert.equal(score("!743"), 1);
	assert.equal(score("config-service!743"), 1);
	assert.equal(score(`${GITLAB}/diffs`), 1);
	assert.equal(score("cus-718"), 1);
	assert.equal(score("743 charge ground"), 1);
	// Numbers never fall back to fuzzy text matching.
	assert.equal(score("74"), undefined);
	assert.equal(score("718"), undefined);
	assert.equal(score("maintenance!743"), undefined);
	assert.equal(score("throttle"), undefined);
});

test("wildcard hosts are patterns, not dev servers", () => {
	assert.equal(classifyUrl("https://*.ground.config.localhost"), undefined);
});

test("inlined skill bodies are not the user's words or links", () => {
	const message = user('<skill name="simplest-solution" location="/s/SKILL.md">\nSee https://github.com/o/ponytail/pull/1\n</skill>\n\nfix CUS-77');
	assert.equal(userText(message.content), "/skill:simplest-solution\n\nfix CUS-77");
	assert.deepEqual(collect([message]).map((ref) => ref.key), ["CUS-77"]);
});

test("review regressions: malformed slugs, git -C pushes, and whole-id ticket fallback", () => {
	assert.equal(classifyUrl("https://linear.app/acme/issue/CUS-1/100%-done")?.title, "100% done");

	const refs = collect([
		user("go"),
		call("a", "git -C /repo/.worktrees/cus-1 push -u origin HEAD"),
		result("a", "remote: View merge request for x:\nremote:   https://gitlab.acme.dev/g/p/-/merge_requests/4\n"),
	]);
	assert.equal(refs.find((ref) => ref.label === "p!4")?.source, "authored");

	// No ticket refs, so the fallback searches the text, and only for the whole id.
	assert.ok(matchSession([], "~/repo/.worktrees/cus-12-fix", parseQuery("CUS-12")));
	assert.equal(matchSession([], "~/repo/.worktrees/cus-1203", parseQuery("CUS-12")), undefined);
	assert.equal(matchSession([], "acus-12", parseQuery("CUS-12")), undefined);
});

test("places record where the session worked, not paths it only mentioned", () => {
	const collector = new RefCollector();
	const tool = (name: string, args: object) => ({ role: "assistant", content: [{ type: "toolCall", id: name, name, arguments: args }] });
	collector.addMessage(tool("bash", { command: "cd ~/beta/config-service/.worktrees/cus-1403 && pnpm dev" }));
	collector.addMessage(tool("bash", { command: 'git -C "/r/.worktrees/y z" push' }));
	collector.addMessage(tool("codemode", { code: 'await tools.bash({ command: "cd maintenance/.worktrees/x && ls" })' }));
	collector.addMessage(tool("edit", { path: "/r/.worktrees/w/apps/ground/a.ts", edits: [] }));
	collector.addMessage(tool("read", { path: "/r/.worktrees/other/README.md" }));
	collector.addMessage(tool("write", { path: "/r/.worktrees/w/t.ts", content: 'run({ command: "cd /r/.worktrees/other" })' }));
	collector.addMessage(tool("bash", { command: "rg -n 'abcd' /r/.worktrees/other" }));
	collector.addMessage(tool("bash", { command: "cat > t.ts <<'EOF'\nrun({ command: \"cd /r/.worktrees/other\" })\nEOF\nnode -e 'run(\"cd /r/.worktrees/other\")'" }));
	assert.deepEqual([...collector.places.keys()], [
		"~/beta/config-service/.worktrees/cus-1403",
		"/r/.worktrees/y z",
		"maintenance/.worktrees/x",
		"/r/.worktrees/w/apps/ground",
		"/r/.worktrees/w",
	]);
});
