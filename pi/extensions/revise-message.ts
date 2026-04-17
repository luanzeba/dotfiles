import {
	copyToClipboard,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type SessionEntry,
	type Theme,
} from "@mariozechner/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	SelectList,
	type SelectItem,
	type Focusable,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";

const MAX_ASSISTANT_MESSAGES = 20;

interface AssistantCandidate {
	entryId: string;
	timestamp: string;
	text: string;
	preview: string;
	relativeTime: string;
}

interface ReviseOverlayResult {
	action: "copy" | "continue";
	text: string;
	candidate: AssistantCandidate;
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

function collectAssistantCandidates(entries: SessionEntry[], limit = MAX_ASSISTANT_MESSAGES): AssistantCandidate[] {
	const candidates: AssistantCandidate[] = [];

	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type !== "message") continue;

		const message = entry.message as { role?: string; content?: unknown };
		if (message.role !== "assistant") continue;

		const text = extractAssistantText(message.content);
		if (!text) continue;

		const preview = text.replace(/\s+/g, " ").trim();
		candidates.push({
			entryId: entry.id,
			timestamp: entry.timestamp,
			text,
			preview,
			relativeTime: formatRelativeTime(entry.timestamp),
		});

		if (candidates.length >= limit) break;
	}

	return candidates;
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

class ReviseOverlayComponent implements Focusable {
	private mode: "pick" | "edit" = "pick";
	private activeCandidate: AssistantCandidate;
	private selectList: SelectList;
	private editor: Editor;
	private candidateById = new Map<string, AssistantCandidate>();
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value && this.mode === "edit";
	}

	constructor(
		private tui: TUI,
		private theme: Theme,
		private candidates: AssistantCandidate[],
		private done: (result: ReviseOverlayResult | undefined) => void,
	) {
		this.activeCandidate = candidates[0]!;
		for (const candidate of candidates) {
			this.candidateById.set(candidate.entryId, candidate);
		}

		const listItems: SelectItem[] = candidates.map((candidate, index) => ({
			value: candidate.entryId,
			label: `${index + 1}. ${candidate.preview}`,
			description: `${candidate.relativeTime} · ${candidate.entryId.slice(0, 8)}`,
		}));

		const selectTheme = {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		};

		this.selectList = new SelectList(listItems, Math.min(listItems.length, 8), selectTheme, {
			truncatePrimary: ({ text, maxWidth }) => truncateToWidth(text, maxWidth),
		});
		this.selectList.onSelectionChange = (item) => {
			const candidate = this.candidateById.get(item.value);
			if (!candidate) return;
			this.activeCandidate = candidate;
			this.tui.requestRender();
		};
		this.selectList.onSelect = (item) => this.openCandidate(item.value);
		this.selectList.onCancel = () => this.done(undefined);

		const editorTheme: EditorTheme = {
			borderColor: (text: string) => theme.fg("accent", text),
			selectList: selectTheme,
		};
		this.editor = new Editor(tui, editorTheme, { paddingX: 1 });
		this.editor.disableSubmit = true;
		this.editor.setText(this.activeCandidate.text);
	}

	private frameLine(text: string, innerWidth: number): string {
		const content = truncateToWidth(text, innerWidth);
		const padding = Math.max(0, innerWidth - visibleWidth(content));
		return this.theme.fg("border", "│") + content + " ".repeat(padding) + this.theme.fg("border", "│");
	}

	private openCandidate(entryId: string): void {
		const candidate = this.candidateById.get(entryId);
		if (!candidate) return;

		this.activeCandidate = candidate;
		this.mode = "edit";
		this.editor.setText(candidate.text);
		this.editor.focused = this.focused;
		this.tui.requestRender();
	}

	private renderPicker(innerWidth: number): string[] {
		const listWidth = Math.max(20, innerWidth - 2);
		const lines: string[] = [];

		lines.push(this.frameLine(this.theme.fg("accent", this.theme.bold("Revise Assistant Message")), innerWidth));
		lines.push(this.frameLine(this.theme.fg("muted", "Pick a recent assistant response to edit."), innerWidth));
		lines.push(this.frameLine("", innerWidth));

		for (const line of this.selectList.render(listWidth)) {
			lines.push(this.frameLine(` ${line}`, innerWidth));
		}

		lines.push(this.frameLine("", innerWidth));
		lines.push(this.frameLine(this.theme.fg("muted", "Preview:"), innerWidth));
		lines.push(this.frameLine(` ${truncateToWidth(this.activeCandidate.preview, innerWidth - 1)}`, innerWidth));
		lines.push(this.frameLine("", innerWidth));
		lines.push(
			this.frameLine(
				this.theme.fg("dim", "↑↓ navigate • enter edit • esc cancel"),
				innerWidth,
			),
		);

		return lines;
	}

	private renderEditor(innerWidth: number): string[] {
		const editorWidth = Math.max(20, innerWidth - 2);
		const lines: string[] = [];

		const source = `${this.activeCandidate.relativeTime} · ${this.activeCandidate.entryId.slice(0, 8)}`;
		lines.push(this.frameLine(this.theme.fg("accent", this.theme.bold("Edit Markdown")), innerWidth));
		lines.push(this.frameLine(this.theme.fg("muted", `Source: ${source}`), innerWidth));
		lines.push(this.frameLine("", innerWidth));

		const rawEditorLines = this.editor.render(editorWidth);
		const maxEditorLines = Math.max(8, (this.tui.terminal.rows || 24) - 14);
		const visibleEditorLines = rawEditorLines.slice(0, maxEditorLines);
		for (const line of visibleEditorLines) {
			lines.push(this.frameLine(` ${line}`, innerWidth));
		}
		if (rawEditorLines.length > visibleEditorLines.length) {
			const hiddenCount = rawEditorLines.length - visibleEditorLines.length;
			lines.push(this.frameLine(this.theme.fg("dim", ` … ${hiddenCount} more line(s)`), innerWidth));
		}

		lines.push(this.frameLine("", innerWidth));
		lines.push(
			this.frameLine(
				this.theme.fg(
					"dim",
					"ctrl+y copy • ctrl+s continue • esc back",
				),
				innerWidth,
			),
		);

		return lines;
	}

	handleInput(data: string): void {
		if (this.mode === "pick") {
			this.selectList.handleInput(data);
			this.tui.requestRender();
			return;
		}

		if (
			matchesKey(data, Key.escape) ||
			matchesKey(data, Key.ctrlShift("p")) ||
			matchesKey(data, "f2") ||
			matchesKey(data, "ctrl+b")
		) {
			this.mode = "pick";
			this.editor.focused = false;
			this.tui.requestRender();
			return;
		}

		if (
			matchesKey(data, Key.ctrlShift("c")) ||
			matchesKey(data, Key.alt("c")) ||
			matchesKey(data, "f5") ||
			matchesKey(data, "ctrl+y")
		) {
			this.done({
				action: "copy",
				text: this.editor.getExpandedText(),
				candidate: this.activeCandidate,
			});
			return;
		}

		if (
			matchesKey(data, Key.ctrlShift("s")) ||
			matchesKey(data, "ctrl+enter") ||
			matchesKey(data, "ctrl+return") ||
			matchesKey(data, "alt+enter") ||
			matchesKey(data, "f6") ||
			matchesKey(data, "ctrl+s")
		) {
			this.done({
				action: "continue",
				text: this.editor.getExpandedText(),
				candidate: this.activeCandidate,
			});
			return;
		}

		this.editor.handleInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(20, width);
		const innerWidth = Math.max(1, safeWidth - 2);

		const topBorder = this.theme.fg("border", `┌${"─".repeat(innerWidth)}┐`);
		const bottomBorder = this.theme.fg("border", `└${"─".repeat(innerWidth)}┘`);

		const body = this.mode === "pick" ? this.renderPicker(innerWidth) : this.renderEditor(innerWidth);

		return [topBorder, ...body, bottomBorder].map((line) => truncateToWidth(line, safeWidth));
	}

	invalidate(): void {
		this.selectList.invalidate();
		this.editor.invalidate();
	}
}

async function runReviseCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/revise requires interactive mode", "error");
		return;
	}

	const candidates = collectAssistantCandidates(ctx.sessionManager.getBranch());
	if (!candidates.length) {
		ctx.ui.notify("No assistant messages with markdown text found in this branch", "warning");
		return;
	}

	const result = await ctx.ui.custom<ReviseOverlayResult | undefined>(
		(tui, theme, _keybindings, done) => new ReviseOverlayComponent(tui, theme, candidates, done),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "90%",
				maxWidth: 140,
				maxHeight: "90%",
			},
		},
	);

	if (!result) {
		ctx.ui.notify("Revise canceled", "info");
		return;
	}

	const editedMarkdown = result.text.replace(/\s+$/, "");
	if (!editedMarkdown.trim()) {
		ctx.ui.notify("Edited markdown is empty", "warning");
		return;
	}

	if (result.action === "copy") {
		try {
			await copyToClipboard(editedMarkdown);
			ctx.ui.notify("Copied edited markdown to clipboard", "success");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Failed to copy to clipboard: ${message}`, "error");
		}
		return;
	}

	const continuationPrompt = buildContinuationPrompt(editedMarkdown);
	if (ctx.isIdle()) {
		pi.sendUserMessage(continuationPrompt);
		ctx.ui.notify("Sent edited markdown back to assistant", "success");
	} else {
		pi.sendUserMessage(continuationPrompt, { deliverAs: "followUp" });
		ctx.ui.notify("Queued edited markdown as follow-up", "info");
	}
}

export default function reviseMessageExtension(pi: ExtensionAPI) {
	pi.registerCommand("revise", {
		description: "Open an overlay to pick/edit a previous assistant message, then copy or continue",
		handler: async (_args, ctx) => runReviseCommand(pi, ctx),
	});

	pi.registerCommand("revise-last", {
		description: "Alias for /revise",
		handler: async (_args, ctx) => runReviseCommand(pi, ctx),
	});
}
