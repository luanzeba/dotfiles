/**
 * Run one headless child (`pi --mode json -p`) and follow its event stream, and share a cap on how
 * many run at once. No pi imports, so `node --test` can run it.
 */

import type { Usage } from "@earendil-works/pi-ai";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { textOf } from "./store.ts";

export function emptyUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

export function addUsage(total: Usage, usage: Partial<Usage> | undefined): void {
	if (!usage) return;
	total.input += usage.input ?? 0;
	total.output += usage.output ?? 0;
	total.cacheRead += usage.cacheRead ?? 0;
	total.cacheWrite += usage.cacheWrite ?? 0;
	total.totalTokens += usage.totalTokens ?? 0;
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) total.cost[key] += usage.cost?.[key] ?? 0;
}

export interface Progress {
	turns: number;
	/** What the child is doing now, such as `read src/app.ts`. */
	activity?: string;
	usage: Usage;
}

export interface Outcome extends Progress {
	/** The child's last answer. */
	output: string;
	/** Why it failed, or "cancelled". */
	error?: string;
}

export interface ChildCommand {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
}

const KILL_GRACE_MS = 3_000;
const STDERR_TAIL = 2_000;

/** Kill switches for every child still running, so a quitting parent leaves none behind. */
const running = new Set<() => void>();

export function killAll(): void {
	for (const kill of [...running]) kill();
}

function describeTool(name: string, args: Record<string, unknown> | undefined): string {
	const first = ["command", "path", "pattern", "query", "url"].map((key) => args?.[key]).find((value) => typeof value === "string") as string | undefined;
	const detail = first?.replace(/\s+/g, " ").trim();
	return detail ? `${name} ${detail.length > 60 ? `${detail.slice(0, 60)}…` : detail}` : name;
}

/**
 * Start the child in its own process group, so an abort also ends whatever its tools started, and
 * follow its JSONL events until it exits.
 */
export function runChild(child: ChildCommand, signal?: AbortSignal, onProgress?: (progress: Progress) => void): Promise<Outcome> {
	const progress: Progress = { turns: 0, usage: emptyUsage() };
	let output = "";
	let modelError: string | undefined;
	let stderr = "";
	let cancelled = false;

	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve({ ...progress, output, error: "cancelled" });
			return;
		}
		const proc = spawn(child.command, child.args, { cwd: child.cwd, env: child.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
		let killTimer: NodeJS.Timeout | undefined;
		const signalGroup = (name: NodeJS.Signals) => {
			try {
				if (proc.pid) process.kill(-proc.pid, name);
			} catch {
				// already gone
			}
		};
		const kill = () => {
			cancelled = true;
			signalGroup("SIGTERM");
			killTimer ??= setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
		};
		running.add(kill);
		signal?.addEventListener("abort", kill, { once: true });

		const handle = (line: string) => {
			let event: { type?: string; message?: any; toolName?: string; args?: Record<string, unknown>; errorMessage?: string };
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event.type === "message_end" && event.message?.role === "assistant") {
				progress.turns++;
				addUsage(progress.usage, event.message.usage);
				const text = textOf(event.message.content);
				if (text) output = text;
				modelError = event.message.stopReason === "error" || event.message.stopReason === "aborted" ? event.message.errorMessage || event.message.stopReason : undefined;
				progress.activity = undefined;
			} else if (event.type === "tool_execution_start" && event.toolName) {
				progress.activity = describeTool(event.toolName, event.args);
			} else if (event.type === "auto_retry_start") {
				progress.activity = `retrying: ${event.errorMessage ?? "model error"}`;
			} else {
				return;
			}
			onProgress?.(progress);
		};

		// The stream is split on LF only: JSON strings may hold other line separators.
		let buffer = "";
		proc.stdout.setEncoding("utf8");
		proc.stdout.on("data", (chunk: string) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) handle(line.replace(/\r$/, ""));
		});
		proc.stderr.setEncoding("utf8");
		proc.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-STDERR_TAIL);
		});

		const finish = (code: number | null, spawnError?: Error) => {
			if (buffer.trim()) handle(buffer);
			buffer = "";
			running.delete(kill);
			signal?.removeEventListener("abort", kill);
			if (killTimer) clearTimeout(killTimer);
			const error = cancelled
				? "cancelled"
				: spawnError
					? `could not start pi: ${spawnError.message}`
					: code !== 0
						? `pi exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`
						: modelError ?? (output ? undefined : `no answer${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
			resolve({ ...progress, output, ...(error ? { error } : {}) });
		};
		proc.on("error", (error) => finish(null, error));
		proc.on("close", (code) => finish(code));
	});
}

/**
 * A cap on how many jobs run at once. A finishing job hands its slot straight to the next waiter,
 * so a newcomer can't slip in between and push the count over the cap.
 */
export function limiter(max: number): <T>(job: () => Promise<T>) => Promise<T> {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async (job) => {
		if (active < max) active++;
		else await new Promise<void>((resolve) => waiting.push(resolve));
		try {
			return await job();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	};
}

/** Cut text to `max` characters, saying where the rest is. */
export function clip(text: string, max: number, rest: string): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n\n[${text.length - max} more characters in ${rest}]`;
}

/** Pi's own launcher, so children run the same build as the parent. */
export function piCommand(): { command: string; args: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/root/") && fs.existsSync(script)) {
		return { command: process.execPath, args: [script] };
	}
	const exec = path.basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(exec) ? { command: "pi", args: [] } : { command: process.execPath, args: [] };
}
