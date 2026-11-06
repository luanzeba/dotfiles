import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { jjOwns, jjSource } from "./jj.ts";
import type { ExecFn } from "./types.ts";

const exec = ((command: string, args: string[], options?: { cwd?: string }) =>
	new Promise((resolve) => {
		execFile(command, args, { cwd: options?.cwd }, (error, stdout, stderr) => {
			resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr, killed: false, truncated: false });
		});
	})) as ExecFn;

function hasJj(): boolean {
	try {
		execFileSync("jj", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

test("a jj workspace without .git reviews its own change, its stack since trunk, or the committed part", { skip: !hasJj() && "jj is not installed" }, async () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "review-jj-")));
	// Keep the user's jj config out, and make trunk() a local bookmark: there is no remote here.
	const config = path.join(dir, "jj.toml");
	fs.writeFileSync(config, `user.name = "t"\nuser.email = "t@t"\n[revset-aliases]\n"trunk()" = "latest(present(main) | root())"\n`);
	Object.assign(process.env, { JJ_CONFIG: config, GIT_CONFIG_GLOBAL: "/dev/null" });
	const sh = (cwd: string, command: string) => execFileSync("sh", ["-c", command], { cwd, stdio: "pipe" }).toString();

	const repo = path.join(dir, "repo");
	fs.mkdirSync(repo);
	assert.equal((await jjSource.resolve("", { cwd: repo, exec, scope: "all" }).catch((error) => error.message)), "not inside a jj workspace");
	sh(repo, "jj git init >/dev/null 2>&1 && echo base > a && jj commit -m base >/dev/null 2>&1 && jj bookmark create main -r @- >/dev/null 2>&1");
	// Someone else's unpushed change, and a workspace stacked on it: this repo's own setup.
	sh(repo, "echo wip > w && jj commit -m 'wip: their base' >/dev/null 2>&1");
	const ws = path.join(dir, "ws");
	sh(repo, `jj workspace add ${ws} --name ws -r @- >/dev/null 2>&1`);
	sh(ws, "mkdir -p src && echo mine > src/m && jj describe -m 'feat: mine' -m 'Why it exists.' >/dev/null 2>&1");
	assert.equal(fs.existsSync(path.join(ws, ".git")), false);
	assert.equal(await jjOwns(path.join(ws, "src"), exec), true);

	const own = await jjSource.resolve("", { cwd: path.join(ws, "src"), exec, scope: "uncommitted" });
	assert.equal(own.kind, "jj");
	assert.equal(own.folder, ws);
	assert.deepEqual(own.changedFiles, ["src/m"]);
	assert.match(own.diff, /^diff --git a\/src\/m b\/src\/m/m);
	assert.match(own.label, /^jj change \w{8} "feat: mine"$/);
	assert.match(own.intent ?? "", /: feat: mine\n\nWhy it exists\./);

	const all = await jjSource.resolve("", { cwd: ws, exec, scope: "all" });
	assert.deepEqual(all.changedFiles.sort(), ["src/m", "w"]);
	assert.match(all.label, /^2 jj changes, \w{8}\.\.\w{8} since trunk$/);
	assert.match(all.intent ?? "", /wip: their base/);

	const committed = await jjSource.resolve("", { cwd: ws, exec, scope: "branch" });
	assert.deepEqual(committed.changedFiles, ["w"], "branch stops before the working-copy change");
	assert.notEqual(committed.reviewKey, all.reviewKey, "a different diff from the same change keeps its own history");

	// After `jj new` the work is in @-: the review follows the change, with the same history key,
	// and changes stacked on top keep the key of the oldest one.
	sh(ws, "jj new >/dev/null 2>&1");
	const after = await jjSource.resolve("", { cwd: ws, exec, scope: "uncommitted" });
	assert.equal(after.reviewKey, own.reviewKey);
	assert.deepEqual(after.changedFiles, ["src/m"]);
	sh(ws, "echo more > n && jj describe -m 'feat: more' >/dev/null 2>&1");
	assert.equal((await jjSource.resolve("", { cwd: ws, exec, scope: "all" })).reviewKey, all.reviewKey);
	assert.notEqual(all.reviewKey, own.reviewKey);

	// Revisions pick out the work when it sits on someone else's change.
	const mine = await jjSource.resolve("", { cwd: ws, exec, scope: "all", revisions: "description(substring:'feat: mine')" });
	assert.deepEqual(mine.changedFiles, ["src/m"]);
	const stack = await jjSource.resolve("", { cwd: ws, exec, revisions: "description(substring:'feat: mine')::@" });
	assert.deepEqual(stack.changedFiles.sort(), ["n", "src/m"]);
	assert.equal(stack.reviewKey, mine.reviewKey, "one change growing into a stack keeps its history");
	await assert.rejects(jjSource.resolve("", { cwd: ws, exec, revisions: "nosuchrev" }), /jj log failed/);

	// Squash workflow: the described change is empty while the edits sit in an undescribed `@`.
	sh(ws, "jj new -m 'feat: squashed later' >/dev/null 2>&1 && jj new >/dev/null 2>&1 && echo s > s");
	const before = await jjSource.resolve("", { cwd: ws, exec, revisions: "description(substring:'feat: squashed later')::@" });
	assert.match(before.intent ?? "", /feat: squashed later/);
	sh(ws, "jj squash >/dev/null 2>&1");
	const squashed = await jjSource.resolve("", { cwd: ws, exec, revisions: "description(substring:'feat: squashed later')::@" });
	assert.equal(squashed.reviewKey, before.reviewKey, "squashing keeps the history");
	assert.deepEqual(squashed.changedFiles, ["s"]);

	// Right after `jj new main` there is nothing of ours to review, not trunk's tip.
	sh(ws, "jj new main >/dev/null 2>&1");
	await assert.rejects(jjSource.resolve("", { cwd: ws, exec, scope: "uncommitted" }), /no changes in the working-copy change/);

	// Without a trunk to fork from, every scope falls back to the working-copy change.
	const lone = path.join(dir, "lone");
	fs.mkdirSync(lone);
	sh(lone, "jj git init --colocate >/dev/null 2>&1 && echo x > x && jj describe -m 'only change' >/dev/null 2>&1");
	const fallback = await jjSource.resolve("", { cwd: lone, exec, scope: "all" });
	assert.match(fallback.label, /^jj change \w{8} "only change"$/);
	sh(lone, "jj new >/dev/null 2>&1 && jj new >/dev/null 2>&1");
	await assert.rejects(jjSource.resolve("", { cwd: lone, exec, scope: "uncommitted" }), /no changes in the working-copy change/);

	// The nearer root wins, and an attached HEAD means git drives the colocated checkout.
	assert.equal(await jjOwns(lone, exec), true, "jj keeps HEAD detached in a colocated repo");
	sh(lone, "git worktree add -q .worktrees/x HEAD");
	assert.equal(await jjOwns(path.join(lone, ".worktrees", "x"), exec), false, "a git worktree inside a jj repo is git's");
	sh(lone, "git checkout -q -b feature");
	assert.equal(await jjOwns(lone, exec), false, "a branch checked out means git drives it");
	const plain = path.join(dir, "plain");
	fs.mkdirSync(plain);
	sh(plain, "git init -q");
	assert.equal(await jjOwns(plain, exec), false);
	assert.equal(await jjOwns(dir, exec), false, "neither");
});
