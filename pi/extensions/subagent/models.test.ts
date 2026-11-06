import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseModel, nearMatches } from "./models.ts";

const parent = { provider: "openai", id: "us.anthropic.claude-opus-5-5", thinking: "xhigh" };
const settings = {
	subagents: { scout: { model: "openai/gpt-6-sol", thinking: "medium" }, worker: { thinking: "high" } },
	profiles: {
		work: { subagents: { scout: { model: "gpt-6-luna" } } },
		personal: { subagents: { scout: { model: "claude-code/claude-sonnet-5-5", thinking: "low" } } },
	},
};

test("with nothing configured a child runs on the parent's model and thinking level", () => {
	assert.deepEqual(chooseModel({ settings: {}, profile: "work", agent: "scout", parent }), { provider: "openai", id: parent.id, thinking: "xhigh" });
});

test("the active profile's choice wins over the top-level one, and the call wins over both", () => {
	assert.deepEqual(chooseModel({ settings, profile: "personal", agent: "scout", parent }), {
		provider: "claude-code",
		id: "claude-sonnet-5-5",
		thinking: "low",
		from: "profiles.personal.subagents.scout",
	});
	// A bare id is on the parent's provider; a model configured without a level runs at the parent's.
	assert.deepEqual(chooseModel({ settings, profile: "work", agent: "scout", parent }), {
		provider: "openai",
		id: "gpt-6-luna",
		thinking: "xhigh",
		from: "profiles.work.subagents.scout",
	});
	assert.deepEqual(chooseModel({ settings, profile: "other", agent: "scout", parent }), {
		provider: "openai",
		id: "gpt-6-sol",
		thinking: "medium",
		from: "subagents.scout",
	});
	assert.deepEqual(chooseModel({ settings, profile: "personal", agent: "scout", parent, model: "openai/gpt-6-astra" }), {
		provider: "openai",
		id: "gpt-6-astra",
		thinking: "xhigh",
		from: "the tool call",
	});
	assert.equal(chooseModel({ settings, profile: "personal", agent: "scout", parent, thinking: "max" }).thinking, "max");
});

test("a thinking level configured alone applies to the parent's model", () => {
	assert.deepEqual(chooseModel({ settings, profile: "work", agent: "worker", parent }), { provider: "openai", id: parent.id, thinking: "high" });
});

test("an unknown thinking level fails before anything spawns", () => {
	assert.throws(() => chooseModel({ settings: {}, agent: "scout", parent, thinking: "extreme" }), /not one of off, minimal/);
});

test("near matches compare the last dotted segment", () => {
	const catalog = [
		{ provider: "openai", id: "us.anthropic.claude-opus-5-5" },
		{ provider: "claude-code", id: "claude-opus-5-5" },
		{ provider: "openai", id: "gpt-6-luna" },
	];
	assert.deepEqual(nearMatches("eu.anthropic.claude-opus-5-5", catalog), ["openai/us.anthropic.claude-opus-5-5", "claude-code/claude-opus-5-5"]);
});
