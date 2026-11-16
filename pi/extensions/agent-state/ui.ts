/**
 * /status in the TUI: the state repo's work on the whole screen, a list to move through, and each work
 * file read in place. state.ts builds what's shown; this draws it and takes the keys.
 */

import { getMarkdownTheme, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, matchesKey, type TUI, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type Detail, keepSelection, type StatusEntry, type StatusList } from "./state.ts";

/** The main agent may update work files while /status is open, so the list is read again this often. */
const REFRESH_MS = 3_000;

export interface StatusSource {
	/** The first line: the state repo and how fresh it is. */
	title: string;
	load(): StatusList;
	open(entry: StatusEntry): Detail;
}

interface Opened {
	detail: Detail;
	markdown: Markdown;
	/** The first line shown. */
	top: number;
}

/** Full screen as an overlay over the whole terminal, so closing it leaves the transcript as it was. */
export const FULL_SCREEN = { anchor: "top-left", width: "100%", maxHeight: "100%" } as const;

export class StatusScreen implements Component {
	private list: StatusList = { sections: [], notes: [] };
	private entries: StatusEntry[] = [];
	private selected = 0;
	/** The first list line shown. */
	private top = 0;
	private opened?: Opened;
	private readonly timer: NodeJS.Timeout;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keys: KeybindingsManager,
		private readonly source: StatusSource,
		private readonly done: () => void,
	) {
		this.reload();
		this.timer = setInterval(() => {
			if (this.opened) return;
			this.reload();
			this.tui.requestRender();
		}, REFRESH_MS);
		this.timer.unref();
	}

	/** Read the state repo again, keeping the selection on the same entry. */
	private reload(): void {
		const key = this.entries[this.selected]?.key;
		this.list = this.source.load();
		this.entries = this.list.sections.flatMap((section) => section.entries);
		this.selected = keepSelection(this.entries.map((entry) => entry.key), key, this.selected);
	}

	/** pi calls it when done() closes the overlay. */
	dispose(): void {
		clearInterval(this.timer);
	}

	/** Rows between the title and the key hints. */
	private viewHeight(): number {
		return Math.max(1, this.tui.terminal.rows - 3);
	}

	private move(delta: number): void {
		if (this.opened) this.opened.top = Math.max(0, this.opened.top + delta);
		else this.selected = Math.min(Math.max(this.selected + delta, 0), Math.max(this.entries.length - 1, 0));
	}

	handleInput(data: string): void {
		const keys = this.keys;
		const page = Math.max(1, this.viewHeight() - 1);
		if (keys.matches(data, "tui.select.up") || matchesKey(data, "k")) this.move(-1);
		else if (keys.matches(data, "tui.select.down") || matchesKey(data, "j")) this.move(1);
		else if (matchesKey(data, "q")) return this.done();
		else if (this.opened) {
			if (keys.matches(data, "tui.select.pageUp") || matchesKey(data, "b")) this.move(-page);
			else if (keys.matches(data, "tui.select.pageDown") || matchesKey(data, "space")) this.move(page);
			else if (matchesKey(data, "g") || matchesKey(data, "home")) this.opened.top = 0;
			// Clamped to the last page when drawn, where the length is known.
			else if (matchesKey(data, "shift+g") || matchesKey(data, "end")) this.opened.top = Number.MAX_SAFE_INTEGER;
			else if (keys.matches(data, "tui.select.cancel")) {
				this.opened = undefined;
				this.reload();
			} else return;
		} else if (keys.matches(data, "tui.select.confirm")) {
			const entry = this.entries[this.selected];
			if (!entry) return;
			const detail = this.source.open(entry);
			this.opened = { detail, markdown: new Markdown(detail.body, 0, 0, getMarkdownTheme()), top: 0 };
		} else if (keys.matches(data, "tui.select.cancel")) return this.done();
		else return;
		this.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.move(this.opened ? event.wheelDelta : Math.sign(event.wheelDelta));
		return { handled: true };
	}

	invalidate(): void {
		this.opened?.markdown.invalidate();
	}

	render(width: number): string[] {
		const th = this.theme;
		const height = this.viewHeight();
		let title: string;
		let body: string[];
		let hints: string;
		let where = "";
		if (this.opened) {
			const lines = this.detailLines(width);
			const opened = this.opened;
			opened.top = Math.min(opened.top, Math.max(0, lines.length - height));
			body = lines.slice(opened.top, opened.top + height);
			title = th.fg("accent", th.bold(opened.detail.title));
			// Leaving first: on a narrow screen the scroll keys give way.
			hints = "esc back · q close · ↑↓ j/k scroll · pgup/pgdn space/b page · g/G top/end";
			if (lines.length > height) where = `${opened.top + 1}–${opened.top + body.length} of ${lines.length}`;
		} else {
			body = this.listLines(width, height);
			title = th.fg("accent", this.source.title);
			hints = "↑↓ j/k move · enter open · esc/q close";
		}
		const fill = Array.from({ length: Math.max(0, height - body.length) }, () => "");
		// The position stays visible on a narrow screen; the hints give way.
		const room = where ? Math.max(0, width - visibleWidth(where) - 2) : width;
		const left = truncateToWidth(hints, room, "…");
		const footer = where ? `${left}${" ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(where)))}${where}` : left;
		return [truncateToWidth(title, width, "…"), "", ...body, ...fill, th.fg("dim", truncateToWidth(footer, width, ""))];
	}

	/** The visible part of the list, scrolled so the selected entry and its `needs` line show. */
	private listLines(width: number, height: number): string[] {
		const th = this.theme;
		const lines: string[] = [];
		let selectedFrom = 0;
		let selectedTo = 0;
		/** Its line, which a section's first entry brings into view. */
		const section = (heading: string) => {
			if (lines.length > 0) lines.push("");
			lines.push(truncateToWidth(th.bold(heading), width, "…"));
			return lines.length - 1;
		};
		let index = 0;
		for (const { title, entries } of this.list.sections) {
			const heading = section(title);
			for (const entry of entries) {
				const selected = index++ === this.selected;
				if (selected) selectedFrom = entry === entries[0] ? heading : lines.length;
				const row = truncateToWidth(`${selected ? "›" : " "} • ${entry.text}`, width, "…", selected);
				lines.push(selected ? th.bg("selectedBg", th.fg("accent", row)) : row);
				// In full: it's what Luan has to do. Continuation lines line up after the arrow.
				if (entry.needs) for (const [at, part] of wrapTextWithAnsi(entry.needs, Math.max(10, width - 6)).entries()) lines.push(th.fg("warning", `${at === 0 ? "    → " : "      "}${part}`));
				if (selected) selectedTo = lines.length - 1;
			}
		}
		if (this.list.notes.length > 0) {
			section(`Notes for your next message (${this.list.notes.length})`);
			for (const note of this.list.notes) lines.push(truncateToWidth(`  • ${note}`, width, "…"));
		}
		if (this.list.more) lines.push("", th.fg("dim", truncateToWidth(this.list.more, width, "…")));
		if (lines.length === 0) lines.push("Nothing tracked yet.");
		// The last entry brings what follows it into view.
		if (this.selected === this.entries.length - 1) selectedTo = lines.length - 1;
		// Scroll only as far as needed to show the selection, as a pager would; its start if it's taller.
		if (selectedTo >= this.top + height) this.top = selectedTo - height + 1;
		if (selectedFrom < this.top) this.top = selectedFrom;
		this.top = Math.min(Math.max(this.top, 0), Math.max(0, lines.length - height));
		return lines.slice(this.top, this.top + height);
	}

	/** The header (front matter, wrapped), a rule, then the markdown body. */
	private detailLines(width: number): string[] {
		const th = this.theme;
		const { detail, markdown } = this.opened!;
		const labelWidth = Math.max(0, ...detail.header.map(({ label }) => visibleWidth(label))) + 2;
		const lines: string[] = [];
		for (const { label, values } of detail.header) {
			values.forEach((value, at) => {
				for (const [part, text] of wrapTextWithAnsi(value, Math.max(10, width - labelWidth)).entries()) {
					const left = th.fg("dim", (at === 0 && part === 0 ? label : "").padEnd(labelWidth));
					lines.push(truncateToWidth(`${left}${label === "needs" ? th.fg("warning", text) : text}`, width, "…"));
				}
			});
		}
		lines.push(th.fg("dim", "─".repeat(Math.max(1, width))), "", ...markdown.render(width));
		return lines;
	}
}
