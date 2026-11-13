/**
 * Subagents: child pi processes with their own context. `subagent` runs headless children and waits
 * for their answers (fan-out, swarms); `subagent_tab` starts a child in a Rex tab the user can
 * watch and type into, which the parent steers, waits for, and stops. See README.md.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { type Agent, loadAgents } from "./agents.ts";
import { addUsage, clip, emptyUsage, killAll, limiter, type Outcome, piCommand, runChild } from "./headless.ts";
import { type ModelChoice, THINKING_LEVELS, chooseModel, nearMatches, readSettings } from "./models.ts";
import { systemPrompt, taskPrompt } from "./prompt.ts";
import { setTimeout as sleep } from "node:timers/promises";
import {
	CHILD_ENV,
	enqueue,
	isRunId,
	type Meta,
	newRunDir,
	pidAlive,
	readMeta,
	readState,
	REPORT_SINK_EVENT,
	type ReportSinkRequest,
	runDir,
	runFiles,
	shortPath,
	subagentsRoot,
	tabStatus,
	updateMeta,
	writeMeta,
} from "./store.ts";
import { checkoutHelp, createCheckout, rexWindowArgs, slug, type TabReport, tabReport, tabsReportingTo, waitForTabs } from "./tabs.ts";

const AGENTS_DIR = fileURLToPath(new URL("./agents", import.meta.url));
const CHILD_EXTENSION = fileURLToPath(new URL("./child.ts", import.meta.url));
const DEFAULT_AGENT = "worker";
/** Runs per subagent call, counting each copy of a swarm. */
const MAX_RUNS = 32;
/** Headless children running at once, across every call in this pi. */
const MAX_PARALLEL = 8;
/** Tabs running at once per parent session. */
const MAX_TABS = 12;

/** Characters of child answers per tool result, shared among its children, with a floor per child. */
const OUTPUT_BUDGET = 50_000;
const MIN_OUTPUT = 2_000;
const WAIT_DEFAULT_S = 30 * 60;
const WAIT_MAX_S = 4 * 60 * 60;
const WIDGET = "subagents";

const runLimited = limiter(MAX_PARALLEL);

interface RunView {
	label: string;
	status: "queued" | "running" | "done" | "failed";
	turns: number;
	activity?: string;
	error?: string;
	/** The start of the answer, for the expanded view; the full answer is in the session file. */
	preview?: string;
}

interface RunDetails {
	agent: string;
	model: string;
	runs: RunView[];
}

/** A spawn records its id here, so the session can find its tabs again after a restart. */
type TabDetails = { id: string } | undefined;

function firstLine(text: string, max: number): string {
	const line = text.trim().split("\n")[0]!.trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A task's first line, cut in the middle when long: tasks often differ only at the end, in a path. */
function runLabel(text: string, max: number): string {
	const line = text.trim().split("\n")[0]!.trim();
	if (line.length <= max) return line;
	const head = Math.floor(max / 3);
	return `${line.slice(0, head)}…${line.slice(line.length - (max - head - 1))}`;
}

function modelSpec(model: ModelChoice): string {
	return `${model.provider}/${model.id}`;
}

const isLive = (tab: TabReport) => tab.status !== "exited" && tab.status !== "stopped";

export default function subagents(pi: ExtensionAPI) {
	// A child never gets the tools, so subagents don't nest.
	if (process.env[CHILD_ENV]) return;

	const agents = loadAgents(AGENTS_DIR);
	const agentNames = agents.map((agent) => agent.name);
	const agentList = agents.map((agent) => `${agent.name}: ${agent.description}`).join(" ");
	/** The tabs this session spawned, oldest first. */
	let tabDirs = new Set<string>();
	let widgetCtx: ExtensionContext | undefined;
	let widgetTimer: NodeJS.Timeout | undefined;

	// Agent names are a schema enum, so pi has already rejected anything else.
	const findAgent = (name: string | undefined): Agent => agents.find((agent) => agent.name === (name ?? DEFAULT_AGENT))!;

	function resolveCwd(base: string, cwd: string | undefined): string {
		const resolved = path.resolve(base, (cwd ?? ".").replace(/^@/, "").replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
		if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
		return resolved;
	}

	/** The child's model, checked before anything is spawned when it isn't the parent's own. */
	async function resolveModel(ctx: ExtensionContext, agent: Agent, model?: string, thinking?: string): Promise<ModelChoice> {
		if (!ctx.model) throw new Error("This session has no model selected, so subagents have nothing to inherit.");
		const choice = chooseModel({
			settings: readSettings(),
			...(process.env.PI_PROFILE ? { profile: process.env.PI_PROFILE } : {}),
			agent: agent.name,
			parent: { provider: ctx.model.provider, id: ctx.model.id, thinking: pi.getThinkingLevel() },
			...(model ? { model } : {}),
			...(thinking ? { thinking } : {}),
		});
		if (!choice.from) return choice;
		const find = () => ctx.modelRegistry.find(choice.provider, choice.id);
		// Proxy-backed providers can be missing from the startup catalog until a refresh.
		if (!find()) await ctx.modelRegistry.refresh({ signal: AbortSignal.timeout(15_000) }).catch(() => {});
		const found = find();
		const profile = process.env.PI_PROFILE ? ` in the ${process.env.PI_PROFILE} profile` : "";
		if (!found) {
			const close = nearMatches(choice.id, ctx.modelRegistry.getAvailable());
			throw new Error(
				[
					`${modelSpec(choice)} (from ${choice.from}) is not available${profile}.`,
					close.length ? `Close matches: ${close.join(", ")}` : "Run `pi --list-models` to see what is.",
				].join("\n"),
			);
		}
		if (!ctx.modelRegistry.hasConfiguredAuth(found)) {
			throw new Error(`${modelSpec(choice)} (from ${choice.from}) has no credentials${profile}. Check with: pi auth check --provider ${choice.provider}`);
		}
		return choice;
	}

	/**
	 * A child in the parent's own directory, or a checkout of it, takes the parent's trust decision;
	 * otherwise a tab would open on pi's trust prompt instead of its task. A child anywhere else,
	 * subdirectories included, gets the decision pi itself makes for that directory.
	 */
	function trustArgs(ctx: ExtensionContext, cwd: string): string[] {
		if (cwd !== ctx.cwd) return [];
		return [ctx.isProjectTrusted() ? "--approve" : "--no-approve"];
	}

	/** pi arguments shared by both kinds of child, ending with the first prompt. */
	function childArgs(dir: string, agent: Agent, model: ModelChoice, trust: string[], inTab: boolean, prompt: string): string[] {
		// An explicit tool list without codemode, tool_search, or mcp__ entries can't reach MCP tools,
		// so don't connect the servers either.
		const mcp = !agent.tools || agent.tools.some((tool) => /^(codemode|tool_search|mcp__)/.test(tool));
		return [
			"--session",
			runFiles(dir).session,
			"--model",
			modelSpec(model),
			"--thinking",
			model.thinking,
			...(agent.tools ? ["--tools", agent.tools.join(",")] : []),
			...(mcp ? [] : ["--no-mcp"]),
			...(agent.skills ? [] : ["--no-skills"]),
			...trust,
			"--append-system-prompt",
			systemPrompt(agent, inTab),
			"--",
			// pi reads a first message that starts with @ as a file to attach, even after --.
			prompt.startsWith("@") ? `Task:\n${prompt}` : prompt,
		];
	}

	/** Environment additions: mark the child, and keep the todos extension's files out of its cwd. */
	function childEnv(dir: string): Record<string, string> {
		return { [CHILD_ENV]: dir, PI_TODO_PATH: path.join(runFiles(dir).scratch, "todos") };
	}

	function sessionTabs(): TabReport[] {
		adoptMainAgentTabs();
		return [...tabDirs].flatMap((dir) => tabReport(dir) ?? []);
	}

	/** Tabs this session spawned, from its own tool results: spawn returns the id in its details. */
	function spawnedTabs(ctx: ExtensionContext): Set<string> {
		const dirs = new Set<string>();
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "message") continue;
			const message = entry.message as { role?: string; toolName?: string; details?: { id?: unknown } };
			const id = message.details?.id;
			if (message.role === "toolResult" && message.toolName === "subagent_tab" && typeof id === "string" && isRunId(id)) dirs.add(runDir(id));
		}
		return dirs;
	}

	function refreshWidget(): void {
		const ctx = widgetCtx;
		if (!ctx) return;
		const live = sessionTabs().filter(isLive);
		if (live.length === 0) {
			ctx.ui.setWidget(WIDGET, undefined);
			return;
		}
		const theme = ctx.ui.theme;
		const items = live.map(({ meta, status }) =>
			theme.fg(status === "busy" ? "warning" : status === "idle" ? "success" : "muted", `${meta.name}:${status}`),
		);
		ctx.ui.setWidget(WIDGET, [theme.fg("dim", "subagents: ") + items.join(theme.fg("dim", " · "))], { placement: "belowEditor" });
	}

	function tabOf(id: string | undefined): { dir: string; meta: Meta } {
		if (!id) throw new Error("This action needs the id that spawn returned (see subagent_tab list).");
		const dir = runDir(id.trim());
		const meta = readMeta(dir);
		if (!meta) throw new Error(`No subagent tab with id ${id}`);
		return { dir, meta };
	}

	async function stopTab(dir: string, meta: Meta): Promise<string> {
		const state = readState(dir);
		const status = tabStatus(meta, state);
		if (meta.rex) await pi.exec("rex", ["window", "close", "-s", meta.rex.session, meta.rex.window], { timeout: 10_000 });
		updateMeta(dir, { stoppedAt: new Date().toISOString() });
		// Closing the tab hangs up on pi; make sure it went. A pid from a tab that already ended may
		// belong to something else by now, so leave it alone.
		if (state?.pid && (status === "busy" || status === "idle")) {
			for (let i = 0; i < 30 && pidAlive(state.pid); i++) await sleep(100);
			if (pidAlive(state.pid)) {
				try {
					process.kill(state.pid, "SIGTERM");
				} catch {
					// it went after all
				}
			}
		}
		refreshWidget();
		return [
			`Stopped ${meta.name} (${meta.id}). Its transcript stays in ${shortPath(runFiles(dir).session)}.`,
			...(meta.checkout ? [checkoutHelp(meta.checkout)] : []),
		].join("\n");
	}

	/** Make the checkout if asked, and open the tab. Returns what to tell the model. */
	async function openTab(
		ctx: ExtensionContext,
		dir: string,
		meta: Meta,
		options: { agent: Agent; model: ModelChoice; task: string; rexSession: string; isolate: boolean },
	): Promise<string> {
		const { agent, model, task, rexSession } = options;
		const files = runFiles(dir);
		let childCwd = meta.cwd;
		let checkout: Meta["checkout"];
		if (options.isolate) {
			const isolated = await createCheckout(pi.exec, meta.cwd, files.checkout, `subagent-${slug(meta.name)}-${meta.id}`);
			checkout = isolated.checkout;
			childCwd = isolated.cwd;
			updateMeta(dir, { checkout });
		}
		const prompt = taskPrompt({ task, scratch: files.scratch, ...(checkout ? { checkout } : {}) });
		const launcher = piCommand();
		const env = { ...childEnv(dir), ...(process.env.PI_PROFILE ? { PI_PROFILE: process.env.PI_PROFILE } : {}) };
		const command = [
			launcher.command,
			...launcher.args,
			"-e",
			CHILD_EXTENSION,
			"--name",
			`subagent ${meta.name}`,
			...childArgs(dir, agent, model, trustArgs(ctx, meta.cwd), true, prompt),
		];
		const label = `sub:${slug(meta.name)}`;
		const opened = await pi.exec("rex", rexWindowArgs({ session: rexSession, label, cwd: childCwd, env, command }), { timeout: 15_000 });
		let window: string | undefined;
		try {
			window = JSON.parse(opened.stdout).window_id;
		} catch {
			// reported below
		}
		if (opened.code !== 0 || !window) {
			const reason = (opened.stderr || opened.stdout).trim() || `rex exited with ${opened.code}`;
			throw new Error([`Couldn't open the Rex tab: ${reason}`, ...(checkout ? [checkoutHelp(checkout)] : [])].join("\n"));
		}
		updateMeta(dir, { rex: { session: rexSession, window, openedAt: new Date().toISOString() } });
		refreshWidget();
		return [
			`Started ${meta.name} (id ${meta.id}) in Rex tab "${label}" on ${modelSpec(model)} (${model.thinking}), working in ${shortPath(childCwd)}.`,
			...(checkout ? [`It has its own ${checkout.vcs === "jj" ? `jj workspace ${checkout.ref}` : `git worktree on branch ${checkout.ref}`}.`] : []),
			`Use subagent_tab wait, send, or stop with id ${meta.id}.`,
		].join(" ");
	}

	function reportSink(): string | undefined {
		const sink: ReportSinkRequest = {};
		pi.events.emit(REPORT_SINK_EVENT, sink);
		return sink.dir;
	}

	/**
	 * The main agent's tabs outlive its sessions (/new, restarts); its current session manages them.
	 * Asked when the tabs are first needed rather than in session_start, where agent-state may not have
	 * decided yet whether this is the main agent.
	 */
	let adopted = false;
	function adoptMainAgentTabs(): void {
		if (adopted) return;
		const sink = reportSink();
		if (!sink) return;
		adopted = true;
		for (const dir of tabsReportingTo(sink)) tabDirs.add(dir);
	}

	pi.on("session_start", (_event, ctx) => {
		tabDirs = spawnedTabs(ctx);
		adopted = false;
		if (ctx.mode !== "tui") return;
		widgetCtx = ctx;
		refreshWidget();
		widgetTimer = setInterval(refreshWidget, 2_000);
		widgetTimer.unref();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		// Headless children belong to a tool call that is ending with this session. Tabs keep going.
		killAll();
		if (widgetTimer) clearInterval(widgetTimer);
		widgetTimer = undefined;
		widgetCtx = undefined;
		if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET, undefined);
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Run headless subagents: fresh pi processes that each do one task with their own context and return their final answer.",
			`Several tasks run in parallel (up to ${MAX_PARALLEL} at once, ${MAX_RUNS} runs per call), and \`count\` runs each task that many times (a swarm).`,
			"Blocks until every child is done. Children run on your model and thinking level unless the call or settings choose another.",
			`Agents: ${agentList}`,
		].join(" "),
		promptSnippet: "Run headless subagents in parallel and wait for their answers",
		promptGuidelines: [
			"subagent children can't see your conversation: each task must stand on its own, with the paths it needs; instructions every task shares, such as the shape to return, go in `brief`.",
			"subagent children share your checkout and you wait for all of them; subagent_tab children run in Rex tabs while you carry on.",
			"You own what subagent and subagent_tab children report: check claims that matter before relying on them.",
		],
		parameters: Type.Object({
			tasks: Type.Array(Type.String(), {
				minItems: 1,
				maxItems: MAX_RUNS,
				description: "One entry per child. Each is a complete, standalone task; the brief goes before it.",
			}),
			brief: Type.Optional(Type.String({ description: "Instructions shared by every task, such as the exact shape to return." })),
			agent: Type.Optional(StringEnum(agentNames as [string, ...string[]], { description: `Agent for every child. Default: ${DEFAULT_AGENT}.` })),
			count: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_RUNS, description: "Run each task this many times, independently. Default: 1." })),
			cwd: Type.Optional(Type.String({ description: "Working directory for every child. Default: yours." })),
			model: Type.Optional(Type.String({ description: "provider/id to run on instead of the default. Only when asked for." })),
			thinking: Type.Optional(StringEnum(THINKING_LEVELS, { description: "Thinking level instead of the default." })),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agent = findAgent(params.agent);
			const cwd = resolveCwd(ctx.cwd, params.cwd);
			const count = params.count ?? 1;
			if (params.tasks.length * count > MAX_RUNS) {
				throw new Error(`${params.tasks.length} tasks × ${count} is ${params.tasks.length * count} runs; the limit is ${MAX_RUNS} per call.`);
			}
			const model = await resolveModel(ctx, agent, params.model, params.thinking);
			const spec = modelSpec(model);
			const launcher = piCommand();
			const trust = trustArgs(ctx, cwd);

			const jobs = params.tasks.flatMap((task) =>
				Array.from({ length: count }, (_, index) => {
					const { id, dir } = newRunDir();
					const prompt = taskPrompt({
						task,
						...(params.brief ? { brief: params.brief } : {}),
						scratch: runFiles(dir).scratch,
						...(count > 1 ? { copy: { index: index + 1, count } } : {}),
					});
					return { dir, id, label: `${runLabel(task, 60)}${count > 1 ? ` #${index + 1}` : ""}`, prompt };
				}),
			);
			const views: RunView[] = jobs.map((job) => ({ label: job.label, status: "queued", turns: 0 }));
			const details = (): RunDetails => ({ agent: agent.name, model: `${spec} ${model.thinking}`, runs: views.map((view) => ({ ...view })) });
			const emit = () => {
				const done = views.filter((view) => view.status === "done" || view.status === "failed").length;
				onUpdate?.({ content: [{ type: "text", text: `${done}/${views.length} subagents done` }], details: details() });
			};
			emit();

			const outcomes: Outcome[] = await Promise.all(
				jobs.map((job, index) =>
					runLimited(async () => {
						const view = views[index]!;
						view.status = "running";
						emit();
						const outcome = await runChild(
							{
								command: launcher.command,
								args: [...launcher.args, "--mode", "json", "-p", ...childArgs(job.dir, agent, model, trust, false, job.prompt)],
								cwd,
								env: { ...process.env, ...childEnv(job.dir) },
							},
							signal,
							(progress) => {
								view.turns = progress.turns;
								view.activity = progress.activity;
								emit();
							},
						);
						Object.assign(view, {
							status: outcome.error ? "failed" : "done",
							turns: outcome.turns,
							activity: undefined,
							...(outcome.error ? { error: outcome.error } : {}),
							preview: outcome.output.slice(0, 2_000),
						});
						emit();
						return outcome;
					}),
				),
			);

			const usage = emptyUsage();
			for (const outcome of outcomes) addUsage(usage, outcome.usage);
			const where = shortPath(subagentsRoot());
			const succeeded = outcomes.filter((outcome) => !outcome.error).length;
			if (signal?.aborted) {
				// Returned rather than thrown, so the work the children did still counts in the usage.
				return {
					content: [{ type: "text", text: `Cancelled after ${succeeded} of ${jobs.length} finished. Their answers are in ${where}/<id>/session.jsonl for ids ${jobs.map((job) => job.id).join(", ")}.` }],
					details: details(),
					usage,
					isError: true,
				};
			}
			const share = Math.max(MIN_OUTPUT, Math.floor(OUTPUT_BUDGET / jobs.length));
			const sections = jobs.map((job, index) => {
				const outcome = outcomes[index]!;
				const transcript = `${where}/${job.id}/session.jsonl`;
				const heading = `## ${index + 1}. ${job.label} (${job.id}${outcome.error ? ", failed" : ""})`;
				const body = outcome.error
					? `Error: ${outcome.error}${outcome.output ? `\n\nLast answer:\n${clip(outcome.output, share, transcript)}` : ""}`
					: clip(outcome.output, share, transcript);
				return `${heading}\n\n${body}`;
			});
			const header = `${jobs.length} ${agent.name} run${jobs.length === 1 ? "" : "s"} on ${spec} (${model.thinking}): ${succeeded} succeeded.`;
			const footer = `Each run's full transcript is ${where}/<id>/session.jsonl.`;
			return {
				content: [{ type: "text", text: [header, ...sections, footer].join("\n\n") }],
				details: details(),
				usage,
				...(succeeded === 0 ? { isError: true } : {}),
			};
		},

		renderCall(args, theme) {
			const runs = (args.tasks?.length ?? 0) * (args.count ?? 1);
			let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", args.agent ?? DEFAULT_AGENT) + theme.fg("muted", ` · ${runs} run${runs === 1 ? "" : "s"}`);
			const first = args.tasks?.[0];
			if (first) text += `\n  ${theme.fg("dim", runLabel(first, 100))}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as RunDetails | undefined;
			if (!details?.runs) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			return new Text(renderRuns(details, expanded, theme), 0, 0);
		},
	});

	pi.registerTool({
		name: "subagent_tab",
		label: "Subagent tab",
		description: [
			"Run a subagent in a background Rex tab of this session that the user can watch and type into. It keeps running after the call, after /reload, and after this pi quits.",
			"Actions: spawn {name, task, agent?, cwd?, isolate?, report?} returns an id at once; send {id, message, followUp?} prompts an idle child or steers a busy one (followUp waits until it finishes);",
			`wait {id?, timeout?} blocks until the child (default: every running one) finishes and returns its last answer; stop {id} closes the tab; list shows this session's tabs. At most ${MAX_TABS} run at once.`,
			"isolate gives the child its own jj workspace or git worktree, kept after stop.",
			`Agents: ${agentList}`,
		].join(" "),
		promptSnippet: "Run a subagent in a Rex tab that keeps going while you work; steer, wait for, and stop it",
		promptGuidelines: [
			"A subagent_tab child edits the checkout it runs in, so two working in one checkout clobber each other.",
			`A subagent_tab child keeps running, and counts toward the ${MAX_TABS}, until it's stopped.`,
		],
		parameters: Type.Object({
			action: StringEnum(["spawn", "send", "wait", "stop", "list"] as const),
			id: Type.Optional(Type.String({ description: "send, stop, wait: the child's id from spawn. wait without it waits for every running child." })),
			name: Type.Optional(Type.String({ description: "spawn: short name for the tab and the widget." })),
			task: Type.Optional(Type.String({ description: "spawn: the complete, standalone task." })),
			message: Type.Optional(Type.String({ description: "send: the message. /skill: commands and prompt templates expand as if typed in the tab; extension commands such as /review reach its model as text." })),
			followUp: Type.Optional(Type.Boolean({ description: "send: deliver after the child finishes its current work instead of steering it." })),
			agent: Type.Optional(StringEnum(agentNames as [string, ...string[]], { description: `spawn: the agent. Default: ${DEFAULT_AGENT}.` })),
			cwd: Type.Optional(Type.String({ description: "spawn: working directory. Default: yours." })),
			isolate: Type.Optional(Type.Boolean({ description: "spawn: work in a new jj workspace or git worktree of cwd's repository." })),
			report: Type.Optional(Type.Boolean({ description: "spawn: message you the child's answer each time it finishes a turn, instead of you calling wait." })),
			model: Type.Optional(Type.String({ description: "spawn: provider/id instead of the default. Only when asked for." })),
			thinking: Type.Optional(StringEnum(THINKING_LEVELS, { description: "spawn: thinking level instead of the default." })),
			timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: WAIT_MAX_S, description: `wait: seconds before returning anyway. Default: ${WAIT_DEFAULT_S}.` })),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const text = (value: string, details: TabDetails = undefined) => ({ content: [{ type: "text" as const, text: value }], details });

			if (params.action === "spawn") {
				const rexSession = process.env.REX_SESSION;
				if (!rexSession) throw new Error("subagent_tab needs Rex, and this pi isn't running in a Rex terminal. Use the subagent tool for a headless child.");
				const task = params.task?.trim();
				if (!task) throw new Error("spawn needs a task.");
				const agent = findAgent(params.agent);
				const cwd = resolveCwd(ctx.cwd, params.cwd);
				const model = await resolveModel(ctx, agent, params.model, params.thinking);
				// Calls in one message run in parallel. Nothing awaits between this check and
				// tabDirs.add, where the new tab counts as starting, so they can't both pass it.
				if (sessionTabs().filter(isLive).length >= MAX_TABS) throw new Error(`${MAX_TABS} tabs are already running in this session; stop one first.`);
				const { id, dir } = newRunDir();
				const meta: Meta = {
					id,
					name: firstLine(params.name || task, 40),
					agent: agent.name,
					cwd,
					model: modelSpec(model),
					thinking: model.thinking,
					parent: ctx.sessionManager.getSessionId(),
					createdAt: new Date().toISOString(),
					...(params.report ? { report: true } : {}),
				};
				const sink = params.report ? reportSink() : undefined;
				if (sink) meta.reportTo = sink;
				writeMeta(dir, meta);
				tabDirs.add(dir);
				try {
					return text(await openTab(ctx, dir, meta, { agent, model, task, rexSession, isolate: !!params.isolate }), { id });
				} catch (error) {
					// A run that never got a tab mustn't look like one that is starting.
					updateMeta(dir, { stoppedAt: new Date().toISOString() });
					throw error;
				}
			}

			if (params.action === "send") {
				const { dir, meta } = tabOf(params.id);
				const message = params.message?.trim();
				if (!message) throw new Error("send needs a message.");
				const report = tabReport(dir)!;
				const { status } = report;
				if (status === "exited" || status === "stopped") throw new Error(`${meta.name} (${meta.id}) has ${status}; spawn a new one.`);
				// Its inbox only drains once its task has started, so a message would sit there.
				if (report.failedToStart) throw new Error(`${meta.name} (${meta.id}) hasn't started its task. Look at its Rex tab: it may be waiting at a prompt, or its pi failed.`);
				enqueue(dir, { message, delivery: params.followUp ? "followUp" : "steer" });
				const verb = status !== "busy" ? "Sent a new prompt to" : params.followUp ? "Queued a follow-up for" : "Steered";
				return text(`${verb} ${meta.name} (${meta.id}).`);
			}

			if (params.action === "wait") {
				const dirs = params.id ? [tabOf(params.id).dir] : sessionTabs().filter(isLive).map((tab) => tab.dir);
				if (dirs.length === 0) return text("No subagent tabs are running in this session.");
				const started = Date.now();
				const { reports, timedOut } = await waitForTabs(dirs, {
					timeoutMs: (params.timeout ?? WAIT_DEFAULT_S) * 1000,
					...(signal ? { signal } : {}),
					onTick: (ticks) => {
						const minutes = Math.floor((Date.now() - started) / 60_000);
						const waiting = ticks.filter((tick) => !tick.finished).map((tick) => `${tick.meta.name}:${tick.status}`);
						onUpdate?.({ content: [{ type: "text", text: `Waiting ${minutes}m for ${waiting.join(", ") || "nothing"}` }], details: undefined });
					},
				});
				if (signal?.aborted) throw new Error("Stopped waiting; the tabs keep running.");
				return text(waitReport(reports, timedOut));
			}

			if (params.action === "stop") {
				const { dir, meta } = tabOf(params.id);
				return text(await stopTab(dir, meta));
			}

			const tabs = sessionTabs();
			if (tabs.length === 0) return text("This session has no subagent tabs.");
			return text(
				tabs
					.map(({ meta, status }) => `- ${meta.name} (${meta.id}): ${status}, ${meta.agent} on ${meta.model} (${meta.thinking}), in ${shortPath(meta.checkout?.path ?? meta.cwd)}`)
					.join("\n"),
			);
		},

		renderCall(args, theme) {
			const subject = args.name ?? args.id ?? (args.task ? firstLine(args.task, 60) : "");
			return new Text(theme.fg("toolTitle", theme.bold("subagent_tab ")) + theme.fg("accent", args.action ?? "") + (subject ? ` ${theme.fg("muted", subject)}` : ""), 0, 0);
		},
	});

	pi.registerCommand("subagents", {
		description: "Show or stop this session's subagent tabs",
		handler: async (_args, ctx) => {
			const tabs = sessionTabs().reverse();
			if (tabs.length === 0) {
				ctx.ui.notify("This session has no subagent tabs", "info");
				return;
			}
			const labels = tabs.map((tab) => `${tab.meta.name} (${tab.meta.id})  ${tab.status}  ${tab.meta.model}`);
			const picked = await ctx.ui.select("Subagent tabs", labels);
			const tab = picked === undefined ? undefined : tabs[labels.indexOf(picked)];
			if (!tab) return;
			const actions = isLive(tab) ? ["Show its tab", "Stop it"] : ["Show its transcript path"];
			const action = await ctx.ui.select(tab.meta.name, actions);
			if (action === "Stop it") {
				ctx.ui.notify(await stopTab(tab.dir, tab.meta), "info");
			} else if (action === "Show its tab" && tab.meta.rex) {
				// Switching tabs in the app needs Rex's Remote Control; say where it is otherwise.
				const shown = await pi.exec("rex", ["do", "session.select", `session_id=${tab.meta.rex.session}`, `window_id=${tab.meta.rex.window}`], { timeout: 5_000 });
				if (shown.code !== 0) ctx.ui.notify(`It's the "sub:${slug(tab.meta.name)}" tab in this Rex session. (${(shown.stderr || shown.stdout).trim()})`, "info");
			} else if (action) {
				ctx.ui.notify(shortPath(runFiles(tab.dir).session), "info");
			}
		},
	});
}

function waitReport(reports: TabReport[], timedOut: boolean): string {
	const share = Math.max(MIN_OUTPUT, Math.floor(OUTPUT_BUDGET / Math.max(1, reports.length)));
	const sections = reports.map(({ dir, meta, state, status, finished, failedToStart }) => {
		const transcript = shortPath(runFiles(dir).session);
		const heading = `## ${meta.name} (${meta.id}): ${failedToStart ? "hasn't started its task" : status}`;
		if (failedToStart) {
			return `${heading}\n\nLook at its Rex tab: it may be waiting at a prompt, such as pi's trust prompt, or its pi failed. Stop it if it failed.`;
		}
		const reply = state?.reply;
		const note = !finished ? "Still working; this is its latest answer so far." : reply?.error ? `Its last turn ended with an error: ${reply.error}` : "";
		const body = reply?.text ? clip(reply.text, share, transcript) : "(no answer yet)";
		return [heading, note, body].filter(Boolean).join("\n\n");
	});
	return [...(timedOut ? ["Timed out; the unfinished tabs keep running. Wait again or check their tabs."] : []), ...sections].join("\n\n");
}

function renderRuns(details: RunDetails, expanded: boolean, theme: Theme): string {
	const lines: string[] = [];
	for (const run of details.runs) {
		const icon =
			run.status === "done"
				? theme.fg("success", "✓")
				: run.status === "failed"
					? theme.fg("error", "✗")
					: run.status === "running"
						? theme.fg("warning", "●")
						: theme.fg("dim", "○");
		const info =
			run.status === "running"
				? (run.activity ?? "thinking")
				: run.status === "failed"
					? firstLine(run.error ?? "failed", 80)
					: run.status === "done"
						? `${run.turns} turn${run.turns === 1 ? "" : "s"}`
						: "queued";
		lines.push(`${icon} ${theme.fg("accent", run.label)} ${theme.fg(run.status === "failed" ? "error" : "dim", info)}`);
		if (expanded && run.preview) {
			const preview = run.preview.trim().split("\n").slice(0, 12);
			lines.push(...preview.map((line) => `    ${theme.fg("toolOutput", line)}`));
		}
	}
	const done = details.runs.filter((run) => run.status === "done" || run.status === "failed").length;
	lines.push(theme.fg("muted", `${done}/${details.runs.length} done · ${details.agent} · ${details.model}`));
	return lines.join("\n");
}
