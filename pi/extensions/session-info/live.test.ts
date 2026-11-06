import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { ensurePrivateDir, type Handler, listen, liveSessions, MAX_LINE_BYTES, request, socketPath } from "./live.ts";

// Short paths: macOS caps socket paths at 104 bytes, and os.tmpdir() is long there.
const tmpdir = () => fs.mkdtempSync("/tmp/si-live-");

function handler(log: unknown[] = []): Handler {
	return {
		status: () => ({ sessionId: "s1", cwd: "/repo", idle: true, pid: process.pid, about: "Fixes the thing" }),
		send: (message, mode, from) => {
			log.push({ message, mode, from });
			return mode === "followUp" ? "followUp" : "steered";
		},
	};
}

/** Write raw bytes and collect whatever comes back until the server closes the connection. */
function raw(file: string, data: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(file);
		let out = "";
		socket.setEncoding("utf8");
		socket.on("connect", () => socket.write(data));
		socket.on("data", (chunk: string) => (out += chunk));
		socket.on("close", () => resolve(out));
		socket.on("error", (error: NodeJS.ErrnoException) => (error.code === "EPIPE" || error.code === "ECONNRESET" ? resolve(out) : reject(error)));
	});
}

test("a session answers status and send requests on a private socket", async () => {
	const dir = path.join(tmpdir(), "sockets");
	const log: unknown[] = [];
	const listening = await listen(dir, "s1", handler(log));
	const file = socketPath(dir, "s1");
	assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
	assert.equal(fs.statSync(file).mode & 0o777, 0o600);

	assert.deepEqual(await request(file, { v: 1, type: "status" }), {
		ok: true,
		status: { sessionId: "s1", cwd: "/repo", idle: true, pid: process.pid, about: "Fixes the thing" },
	});
	const sent = await request(file, { v: 1, type: "send", message: "hi", mode: "followUp", from: { sessionId: "s2", cwd: "/other", about: "x".repeat(900) } });
	assert.deepEqual(sent, { ok: true, delivery: "followUp" });
	// Sender details are clipped, and unknown fields don't pass through.
	assert.equal((log[0] as any).from.about.length, 500);
	assert.equal((log[0] as any).mode, "followUp");

	assert.deepEqual(await liveSessions(dir), new Map([["s1", { sessionId: "s1", cwd: "/repo", idle: true, pid: process.pid, about: "Fixes the thing" }]]));
	listening.close();
	assert.equal(fs.existsSync(file), false, "closing removes the socket, so the next session can listen at once");
});

test("malformed, oversized, and silent requests are turned away", async () => {
	const dir = tmpdir();
	const listening = await listen(dir, "s1", handler(), { requestTimeoutMs: 200 });
	const file = socketPath(dir, "s1");
	const answer = async (data: string) => JSON.parse((await raw(file, data)).split("\n")[0]);
	assert.match((await answer("nope\n")).error, /not JSON/);
	assert.match((await answer('{"v":2,"type":"status"}\n')).error, /version 2/);
	assert.match((await answer('{"v":1,"type":"clear"}\n')).error, /unknown request type "clear"/);
	assert.match((await answer('{"v":1,"type":"send","message":"  "}\n')).error, /non-empty/);
	assert.match((await answer('{"v":1,"type":"send","message":"x","mode":"now"}\n')).error, /steer or followUp/);
	assert.match((await answer(`{"v":1,"type":"send","message":"${"x".repeat(MAX_LINE_BYTES)}`)).error, /larger than/);
	// A peer that connects and says nothing is dropped.
	const started = Date.now();
	assert.equal(await raw(file, ""), "");
	assert.ok(Date.now() - started < 2_000);
	listening.close();
});

test("a crashed session's socket is cleared, and a live one is never taken over", async () => {
	const dir = tmpdir();
	ensurePrivateDir(dir);
	const stale = socketPath(dir, "dead");
	// A process that exits without closing its server leaves the socket file behind.
	spawnSync(process.execPath, ["-e", `require("net").createServer().listen(${JSON.stringify(stale)}, () => process.exit(0))`]);
	assert.ok(fs.existsSync(stale));
	assert.equal((await liveSessions(dir)).size, 0);
	assert.equal(fs.existsSync(stale), false);

	spawnSync(process.execPath, ["-e", `require("net").createServer().listen(${JSON.stringify(socketPath(dir, "s1"))}, () => process.exit(0))`]);
	// A leftover socket for the same session is replaced, but a live one is kept.
	const first = await listen(dir, "s1", handler());
	await assert.rejects(listen(dir, "s1", handler()), new RegExp(`also open in pi ${process.pid}`));
	first.close();

	// A pi that's alive but doesn't answer (suspended, stuck) keeps its socket.
	const silent = net.createServer(() => {});
	await new Promise<void>((resolve) => silent.listen(socketPath(dir, "s2"), resolve));
	await assert.rejects(listen(dir, "s2", handler()), /didn't answer/);
	assert.ok(fs.existsSync(socketPath(dir, "s2")));
	silent.close();

	await assert.rejects(listen(dir, "../escape", handler()), /can't name a socket/);
	await assert.rejects(listen(path.join(dir, "x".repeat(80)), "s1", handler()), /too long for a socket path/);
});

test("the socket directory must be private and really a directory", () => {
	const base = tmpdir();
	const loose = path.join(base, "loose");
	fs.mkdirSync(loose, { mode: 0o755 });
	ensurePrivateDir(loose);
	assert.equal(fs.statSync(loose).mode & 0o777, 0o700);
	const link = path.join(base, "link");
	fs.symlinkSync(os.tmpdir(), link);
	assert.throws(() => ensurePrivateDir(link), /not a directory/);
});
