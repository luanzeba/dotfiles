import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	copyToClipboard,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@mariozechner/pi-tui";

type ReviseAction = "copy" | "continue" | "copyAndContinue";

interface AssistantCandidate {
	entryId: string;
	text: string;
	relativeTime: string;
}

interface SendResult {
	queued: boolean;
}

function extractAssistantText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			const maybeText = block as { type?: string; text?: unknown };
			if (maybeText.type !== "text") return "";
			if (typeof maybeText.text !== "string") return "";
			return maybeText.text;
		})
		.filter(Boolean)
		.join("\n")
		.trim();
}

function formatRelativeTime(timestamp: string): string {
	const parsed = Date.parse(timestamp);
	if (!Number.isFinite(parsed)) return "unknown time";

	const deltaSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
	if (deltaSeconds < 60) return `${deltaSeconds}s ago`;

	const deltaMinutes = Math.floor(deltaSeconds / 60);
	if (deltaMinutes < 60) return `${deltaMinutes}m ago`;

	const deltaHours = Math.floor(deltaMinutes / 60);
	if (deltaHours < 24) return `${deltaHours}h ago`;

	const deltaDays = Math.floor(deltaHours / 24);
	return `${deltaDays}d ago`;
}

function findLastAssistantCandidate(entries: SessionEntry[]): AssistantCandidate | undefined {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type !== "message") continue;

		const message = entry.message as { role?: string; content?: unknown };
		if (message.role !== "assistant") continue;

		const text = extractAssistantText(message.content);
		if (!text) continue;

		return {
			entryId: entry.id,
			text,
			relativeTime: formatRelativeTime(entry.timestamp),
		};
	}

	return undefined;
}

function buildContinuationPrompt(editedMarkdown: string): string {
	return [
		"Use the edited markdown below as the corrected version of your previous answer, then continue the conversation from it.",
		"",
		"```markdown",
		editedMarkdown,
		"```",
	].join("\n");
}

function parseActionArg(args: string): ReviseAction | undefined {
	const raw = args.trim().toLowerCase();
	if (!raw) return undefined;

	if (["copy", "clipboard", "clip"].includes(raw)) return "copy";
	if (["send", "continue", "submit"].includes(raw)) return "continue";
	if (["both", "copy+send", "copy-and-send", "send+copy"].includes(raw)) return "copyAndContinue";

	return undefined;
}

async function promptForAction(ctx: ExtensionCommandContext): Promise<ReviseAction | undefined> {
	const choice = await ctx.ui.select("Choose revise action", [
		"Copy edited markdown to clipboard",
		"Send edited markdown back to assistant",
		"Copy and send",
	]);

	if (!choice) return undefined;
	if (choice === "Copy edited markdown to clipboard") return "copy";
	if (choice === "Send edited markdown back to assistant") return "continue";
	return "copyAndContinue";
}

function runExternalEditor(tui: TUI, editorCommand: string, initialText: string): { text?: string; error?: string } {
	const tempDir = mkdtempSync(path.join(tmpdir(), "pi-revise-message-"));
	const tempFile = path.join(tempDir, "revise-last-message.md");
	let stoppedTui = false;

	try {
		writeFileSync(tempFile, initialText, "utf8");

		tui.stop();
		stoppedTui = true;

		const result = spawnSync(editorCommand, [tempFile], {
			stdio: "inherit",
			shell: true,
		});

		if (result.error) {
			return { error: result.error.message };
		}

		if (typeof result.status === "number" && result.status !== 0) {
			return { error: `Editor exited with status ${result.status}` };
		}

		const edited = readFileSync(tempFile, "utf8");
		return { text: edited.replace(/\n$/, "") };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: message };
	} finally {
		if (stoppedTui) {
			tui.start();
			tui.requestRender(true);
		}
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
}

async function editWithExternalEditor(
	ctx: ExtensionCommandContext,
	editorCommand: string,
	initialText: string,
): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
		let finished = false;

		queueMicrotask(() => {
			if (finished) return;
			const result = runExternalEditor(tui, editorCommand, initialText);
			finished = true;

			if (result.error) {
				ctx.ui.notify(`Failed to open external editor: ${result.error}`, "error");
				done(undefined);
				return;
			}

			done(result.text ?? "");
		});

		const component: Component = {
			render(width: number) {
				return [
					truncateToWidth(theme.fg("accent", theme.bold("Opening external editor...")), width),
					truncateToWidth(theme.fg("muted", editorCommand), width),
				];
			},
			invalidate() {},
		};

		return component;
	});
}

async function editLastMessage(ctx: ExtensionCommandContext, candidate: AssistantCandidate): Promise<string | undefined> {
	const editorCommand = process.env.VISUAL || process.env.EDITOR;
	const canLaunchExternalEditor = Boolean(editorCommand) && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

	if (!canLaunchExternalEditor) {
		if (!editorCommand) {
			ctx.ui.notify("No $VISUAL/$EDITOR set, using inline editor", "warning");
		}
		return ctx.ui.editor("Revise last assistant message", candidate.text);
	}

	return editWithExternalEditor(ctx, editorCommand!, candidate.text);
}

async function sendEditedMarkdown(pi: ExtensionAPI, ctx: ExtensionCommandContext, editedMarkdown: string): Promise<SendResult> {
	const continuationPrompt = buildContinuationPrompt(editedMarkdown);
	if (ctx.isIdle()) {
		pi.sendUserMessage(continuationPrompt);
		return { queued: false };
	}

	pi.sendUserMessage(continuationPrompt, { deliverAs: "followUp" });
	return { queued: true };
}

async function runReviseCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/revise requires interactive mode", "error");
		return;
	}

	const requestedAction = parseActionArg(args);
	if (args.trim() && !requestedAction) {
		ctx.ui.notify("Usage: /revise [copy|send|both]", "warning");
		return;
	}

	const candidate = findLastAssistantCandidate(ctx.sessionManager.getBranch());
	if (!candidate) {
		ctx.ui.notify("No assistant messages with markdown text found in this branch", "warning");
		return;
	}

	ctx.ui.notify(
		`Editing last assistant message (${candidate.relativeTime}, ${candidate.entryId.slice(0, 8)})`,
		"info",
	);

	const editedFromEditor = await editLastMessage(ctx, candidate);
	if (editedFromEditor === undefined) {
		ctx.ui.notify("Revise canceled", "info");
		return;
	}

	const editedMarkdown = editedFromEditor.replace(/\s+$/, "");
	if (!editedMarkdown.trim()) {
		ctx.ui.notify("Edited markdown is empty", "warning");
		return;
	}

	const action = requestedAction ?? (await promptForAction(ctx));
	if (!action) {
		ctx.ui.notify("Revise canceled", "info");
		return;
	}

	let copied = false;
	let copyError: string | undefined;

	if (action === "copy" || action === "copyAndContinue") {
		try {
			await copyToClipboard(editedMarkdown);
			copied = true;
		} catch (error) {
			copyError = error instanceof Error ? error.message : String(error);
		}
	}

	let sendResult: SendResult | undefined;
	if (action === "continue" || action === "copyAndContinue") {
		sendResult = await sendEditedMarkdown(pi, ctx, editedMarkdown);
	}

	if (action === "copy") {
		if (copied) {
			ctx.ui.notify("Copied edited markdown to clipboard", "success");
		} else {
			ctx.ui.notify(`Failed to copy to clipboard: ${copyError}`, "error");
		}
		return;
	}

	if (action === "continue") {
		ctx.ui.notify(sendResult?.queued ? "Queued edited markdown as follow-up" : "Sent edited markdown back to assistant", "success");
		return;
	}

	if (copied && sendResult) {
		ctx.ui.notify(
			sendResult.queued
				? "Copied edited markdown and queued as follow-up"
				: "Copied edited markdown and sent to assistant",
			"success",
		);
		return;
	}

	if (!copied && sendResult) {
		ctx.ui.notify(
			`Sent edited markdown, but failed to copy: ${copyError ?? "unknown error"}`,
			"warning",
		);
		return;
	}

	if (!copied) {
		ctx.ui.notify(`Failed to copy to clipboard: ${copyError ?? "unknown error"}`, "error");
	}
}

export default function reviseMessageExtension(pi: ExtensionAPI) {
	pi.registerCommand("revise", {
		description:
			"Open the latest assistant message in $VISUAL/$EDITOR (or inline), then copy/send it back",
		handler: async (args, ctx) => runReviseCommand(pi, ctx, args),
	});

	pi.registerCommand("revise-last", {
		description: "Alias for /revise",
		handler: async (args, ctx) => runReviseCommand(pi, ctx, args),
	});
}
