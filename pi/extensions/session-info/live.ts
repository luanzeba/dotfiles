/**
 * Live sessions: every interactive pi listens on `<dir>/<session id>.sock`, so other sessions can
 * see that it's open and send it messages. No pi imports, so `node --test` can run this directly.
 *
 * Protocol: one JSON line in, one JSON line out, then the connection closes. Requests carry
 * `v: 1` and a `type`; unknown types get an error, so new requests can be added without breaking
 * old peers.
 *
 *   { v: 1, type: "status" }  ->  { ok: true, status: { sessionId, file, cwd, idle, pid, about } }
 *   { v: 1, type: "send", message, mode?: "steer" | "followUp", from?: Sender }
 *                             ->  { ok: true, delivery: "started" | "steered" | "followUp" | "noted" }
 *   failures                  ->  { ok: false, error }
 *
 * Only the user who owns the directory can connect: it's 0700 and each socket is 0600. Node has no
 * way to read a peer's uid, so the directory is the boundary, as for ssh-agent sockets.
 */
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

const PROTOCOL_VERSION = 1;
/** Largest request or response line. */
export const MAX_LINE_BYTES = 256 * 1024;
/** Fits in a line even when every character takes 4 bytes of UTF-8. */
export const MAX_MESSAGE_CHARS = 50_000;
/** A peer gets this long to send its request; clients wait this long for an answer. */
const REQUEST_TIMEOUT_MS = 5_000;
/** Local sockets answer in milliseconds; a pi that takes longer is suspended or stuck. */
const PROBE_TIMEOUT_MS = 500;
const MAX_CONNECTIONS = 16;
/** macOS allows 104 bytes for a socket path, including the terminating NUL. */
const MAX_SOCKET_PATH_BYTES = 103;
const SOCKET_SUFFIX = ".sock";
/** Session ids are UUIDs; `--session-id` allows others, but nothing that could leave the directory. */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type SendMode = "steer" | "followUp";
/** `noted`: the session takes messages as notes for its next prompt and started nothing (see links.ts). */
export type Delivery = "started" | "steered" | "followUp" | "noted";

/** Who sent a message, as the sender describes itself. Same-user peers are trusted to be honest. */
export interface Sender {
	sessionId: string;
	/** Short `@@` token the sender's index says is unique. */
	token?: string;
	cwd?: string;
	about?: string;
	/** Whether the sender has a socket, so a reply can reach it. Print-mode pis don't. */
	listening?: boolean;
}

export interface Status {
	sessionId: string;
	file?: string;
	cwd: string;
	/** Not running a turn and nothing queued. */
	idle: boolean;
	pid: number;
	/** The session's summary, name, or first message, as the live session knows it. */
	about?: string;
}

export type Request = { v: 1; type: "status" } | { v: 1; type: "send"; message: string; mode?: SendMode; from?: Sender };
export type Response = { ok: true; status?: Status; delivery?: Delivery } | { ok: false; error: string };

export interface Handler {
	status(): Status;
	send(message: string, mode: SendMode, from: Sender | undefined): Delivery;
}

export const socketPath = (dir: string, sessionId: string) => path.join(dir, `${sessionId}${SOCKET_SUFFIX}`);

/**
 * Create the socket directory, or check an existing one: a real directory owned by this user and
 * closed to everyone else. A loose mode is tightened; anything else is refused.
 */
export function ensurePrivateDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const stat = fs.lstatSync(dir);
	if (!stat.isDirectory()) throw new Error(`${dir} is not a directory`);
	if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error(`${dir} belongs to another user`);
	if ((stat.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}

function clipString(value: unknown, max: number): string | undefined {
	return typeof value === "string" && value ? value.slice(0, max) : undefined;
}

/** Validate a request line from a peer. Returns an error string for anything malformed. */
function parseRequest(line: string): Request | string {
	let data: any;
	try {
		data = JSON.parse(line);
	} catch {
		return "request is not JSON";
	}
	if (!data || typeof data !== "object") return "request is not an object";
	if (data.v !== PROTOCOL_VERSION) return `unsupported protocol version ${JSON.stringify(data.v)}; this pi speaks ${PROTOCOL_VERSION}`;
	if (data.type === "status") return { v: 1, type: "status" };
	if (data.type !== "send") return `unknown request type ${JSON.stringify(data.type)}`;
	if (typeof data.message !== "string" || !data.message.trim()) return "send needs a non-empty message";
	if (data.message.length > MAX_MESSAGE_CHARS) return `message is longer than ${MAX_MESSAGE_CHARS} characters`;
	if (data.mode !== undefined && data.mode !== "steer" && data.mode !== "followUp") return "mode must be steer or followUp";
	const from = data.from && typeof data.from === "object" ? data.from : undefined;
	const sessionId = clipString(from?.sessionId, 128);
	return {
		v: 1,
		type: "send",
		message: data.message,
		...(data.mode ? { mode: data.mode } : {}),
		...(sessionId
			? {
					from: {
						sessionId,
						token: clipString(from.token, 40),
						cwd: clipString(from.cwd, 1024),
						about: clipString(from.about, 500),
						listening: from.listening === true,
					},
				}
			: {}),
	};
}

function serve(socket: net.Socket, handler: Handler, timeoutMs: number): void {
	let buffer = "";
	let answered = false;
	const reply = (response: Response) => {
		answered = true;
		socket.end(`${JSON.stringify(response)}\n`);
	};
	socket.setEncoding("utf8");
	socket.setTimeout(timeoutMs, () => socket.destroy());
	socket.on("error", () => {});
	socket.on("data", (chunk: string) => {
		if (answered) return;
		buffer += chunk;
		const newline = buffer.indexOf("\n");
		if (newline === -1) {
			if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) reply({ ok: false, error: `request is larger than ${MAX_LINE_BYTES} bytes` });
			return;
		}
		const request = parseRequest(buffer.slice(0, newline));
		if (typeof request === "string") return reply({ ok: false, error: request });
		try {
			if (request.type === "status") reply({ ok: true, status: handler.status() });
			else reply({ ok: true, delivery: handler.send(request.message, request.mode ?? "steer", request.from) });
		} catch (error) {
			reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	});
}

/** Send one request and wait for its answer. Rejects with the socket error (`code` ECONNREFUSED, ENOENT, ...) or a timeout. */
export function request(file: string, body: Request, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(file);
		let buffer = "";
		const fail = (error: Error) => {
			socket.destroy();
			reject(error);
		};
		const timer = setTimeout(() => fail(Object.assign(new Error(`no answer from ${path.basename(file)} within ${timeoutMs} ms`), { code: "ETIMEDOUT" })), timeoutMs);
		socket.setEncoding("utf8");
		socket.on("connect", () => socket.write(`${JSON.stringify(body)}\n`));
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline === -1) {
				if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) fail(new Error("answer is too large"));
				return;
			}
			clearTimeout(timer);
			socket.destroy();
			try {
				resolve(JSON.parse(buffer.slice(0, newline)));
			} catch {
				reject(new Error("answer is not JSON"));
			}
		});
		socket.on("error", (error) => {
			clearTimeout(timer);
			fail(error);
		});
		socket.on("close", () => {
			clearTimeout(timer);
			reject(new Error("connection closed without an answer"));
		});
	});
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

/**
 * Remove a socket nobody listens on, unless it was replaced in the meantime: a pi that just
 * started also clears a stale file before listening at the same path.
 */
function removeStale(file: string, inode: number): void {
	try {
		if (fs.lstatSync(file).ino === inode) fs.unlinkSync(file);
	} catch {
		// Already gone.
	}
}

/**
 * The status of the pi listening at `file`, or undefined. Clears the file when nothing listens.
 * A suspended or stuck pi doesn't answer within the timeout; it counts as not live, and its socket
 * stays.
 */
async function probe(file: string): Promise<Status | undefined> {
	let inode: number;
	try {
		const stat = fs.lstatSync(file);
		if (!stat.isSocket()) return undefined;
		inode = stat.ino;
	} catch {
		return undefined;
	}
	try {
		const response = await request(file, { v: 1, type: "status" }, PROBE_TIMEOUT_MS);
		return response.ok ? response.status : undefined;
	} catch (error) {
		if (errorCode(error) === "ECONNREFUSED") removeStale(file, inode);
		return undefined;
	}
}

/** Every live session in `dir`, by session id. Stale sockets are removed on the way. */
export async function liveSessions(dir: string): Promise<Map<string, Status>> {
	const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
	const found = await Promise.all(
		names
			.filter((name) => name.endsWith(SOCKET_SUFFIX))
			.map(async (name) => [name.slice(0, -SOCKET_SUFFIX.length), await probe(path.join(dir, name))] as const),
	);
	const live = new Map<string, Status>();
	for (const [id, status] of found) if (status && status.sessionId === id) live.set(id, status);
	return live;
}

/**
 * Listen for this session, or throw saying why not. Another pi that already has the same session
 * open keeps its socket; a leftover from a crash is cleared. Closing the server removes the socket
 * file, so a session switch or reload can listen again right after.
 */
export async function listen(dir: string, sessionId: string, handler: Handler, options: { requestTimeoutMs?: number } = {}): Promise<{ close: () => void }> {
	if (!SESSION_ID_RE.test(sessionId)) throw new Error(`session id ${JSON.stringify(sessionId)} can't name a socket`);
	const file = socketPath(dir, sessionId);
	if (Buffer.byteLength(file) > MAX_SOCKET_PATH_BYTES) throw new Error(`${file} is too long for a socket path`);
	ensurePrivateDir(dir);
	const existing = await probe(file);
	if (existing) throw new Error(`it's also open in pi ${existing.pid}, which gets them`);
	// probe() removed a socket nobody listens on. Anything still there belongs to a pi that didn't
	// answer in time, which may still be alive: leave it.
	if (fs.existsSync(file)) throw new Error(`another pi holds ${path.basename(file)} but didn't answer`);
	const server = net.createServer((socket) => serve(socket, handler, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS));
	server.maxConnections = MAX_CONNECTIONS;
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(file, () => {
			server.off("error", reject);
			resolve();
		});
	});
	fs.chmodSync(file, 0o600);
	server.on("error", () => {});
	return { close: () => server.close() };
}
