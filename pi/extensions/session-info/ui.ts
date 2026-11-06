/** The session info card and the /resume-search picker. */
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	getCapabilities,
	hyperlink,
	Input,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import * as os from "node:os";
import { type Match, notableRefs, type Ref, type RefKind, type Teams } from "./refs.ts";
import { searchRecords, type SessionRecord } from "./store.ts";

const KIND_LABELS: Record<RefKind, string> = {
	ticket: "Linear",
	mr: "MR",
	github: "GitHub",
	dev: "Dev",
	slack: "Slack",
	link: "Link",
};
const KIND_ORDER: RefKind[] = ["ticket", "mr", "github", "dev", "slack", "link"];
const LABEL_WIDTH = 7;

function link(theme: Theme, text: string, url: string | undefined): string {
	const styled = theme.fg("accent", text);
	return url && getCapabilities().hyperlinks ? hyperlink(styled, url) : styled;
}

/** `~/beta/config-service/.worktrees/cus-1203` -> `~/beta/config-service ⎇ cus-1203`. */
export function shortPath(cwd: string): string {
	const home = os.homedir();
	const tilde = cwd === home || cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
	return tilde.replace("/.worktrees/", " ⎇ ");
}

function age(ms: number): string {
	const minutes = Math.floor((Date.now() - ms) / 60_000);
	if (minutes < 60) return `${Math.max(minutes, 0)}m`;
	if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
	if (minutes < 30 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`;
	return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export interface DevRow {
	url: string;
	live: boolean;
}

export interface CardView {
	title: string;
	summary?: string;
	status?: string;
	refs: Ref[];
	dev: DevRow[];
	location: string;
	hint: string;
}

/** A floating box with what the current session is about. Call invalidate() when its view changes. */
export class SessionCard implements Component {
	private cache?: { width: number; height: number; lines: string[] };
	private readonly theme: Theme;
	private readonly view: () => CardView;
	private readonly maxHeight: () => number;

	constructor(theme: Theme, view: () => CardView, maxHeight: () => number) {
		this.theme = theme;
		this.view = view;
		this.maxHeight = maxHeight;
	}

	invalidate(): void {
		this.cache = undefined;
	}

	render(width: number): string[] {
		const height = this.maxHeight();
		if (this.cache?.width !== width || this.cache.height !== height) {
			this.cache = { width, height, lines: this.build(width, height, this.view()) };
		}
		return this.cache.lines;
	}

	private build(width: number, height: number, view: CardView): string[] {
		const th = this.theme;
		const inner = Math.max(width - 4, 10);
		const border = (s: string) => th.fg("borderAccent", s);
		const head: string[] = [];
		if (view.summary) head.push(...wrapTextWithAnsi(view.summary, inner));
		if (view.status) head.push(...wrapTextWithAnsi(th.fg("dim", view.status), inner));

		const rows: string[] = [];
		for (const kind of KIND_ORDER) {
			const section =
				kind === "dev" ? this.devRows(view.dev, inner - LABEL_WIDTH) : view.refs.filter((ref) => ref.kind === kind).map((ref) => this.refRow(ref));
			section.forEach((row, i) => rows.push(`${th.fg("muted", (i === 0 ? KIND_LABELS[kind] : "").padEnd(LABEL_WIDTH))}${row}`));
		}
		// Everything shows unless the terminal is too short for it; the card can't scroll because it
		// never takes focus. Two border lines, the head, and a blank line plus location come first.
		const room = Math.max(height - 2 - head.length - 2 - 1, 0);
		const kept = Math.max(room - 1, 0);
		const shownRows =
			rows.length > room ? [...rows.slice(0, kept), th.fg("dim", `… ${rows.length - kept} more rows; the terminal is too short`)] : rows;
		const body = [...head, ...(shownRows.length > 0 ? ["", ...shownRows] : []), "", th.fg("dim", view.location)];

		const title = ` ${th.bold(truncateToWidth(view.title, inner - 4, "…"))} `;
		const hint = ` ${view.hint} `;
		const topFill = Math.max(width - 3 - visibleWidth(title), 0);
		const bottomFill = Math.max(width - 3 - visibleWidth(hint), 0);
		return [
			border("╭─") + th.fg("accent", title) + border(`${"─".repeat(topFill)}╮`),
			...body.map((line) => border("│ ") + truncateToWidth(line, inner, "…", true) + border(" │")),
			border(`╰${"─".repeat(bottomFill)}`) + th.fg("dim", hint) + border("─╯"),
		];
	}

	private refRow(ref: Ref): string {
		const th = this.theme;
		const parts = [link(th, ref.label, ref.url)];
		if (ref.source === "authored") parts.push(th.fg("success", "pushed"));
		if (ref.title) parts.push(th.fg("dim", ref.title));
		if (ref.url && !getCapabilities().hyperlinks) parts.push(th.fg("dim", ref.url));
		return parts.join("  ");
	}

	/**
	 * portless names worktree servers `<worktree>.<app>.<project>.localhost`. Group them under their
	 * worktree and list each app as a clickable chip, so a monorepo's nine servers take two lines.
	 * Without hyperlinks the URL is all there is, so each gets its own row.
	 */
	private devRows(dev: DevRow[], width: number): string[] {
		const th = this.theme;
		const dot = (row: DevRow) => (row.live ? th.fg("success", "●") : th.fg("dim", "○"));
		if (!getCapabilities().hyperlinks) return dev.map((row) => `${dot(row)} ${th.fg("accent", row.url)}`);
		const groups = new Map<string, string[]>();
		for (const row of dev) {
			const labels = new URL(row.url).hostname.replace(/\.localhost$/, "").split(".");
			const [worktree, app] = labels.length >= 3 ? [labels[0], labels[1]] : ["", labels.join(".")];
			groups.set(worktree, [...(groups.get(worktree) ?? []), `${dot(row)} ${link(th, app, row.url)}`]);
		}
		const rows: string[] = [];
		for (const [worktree, chips] of groups) {
			if (worktree) rows.push(th.fg("dim", worktree));
			let line = "";
			for (const chip of chips) {
				if (line && visibleWidth(line) + 2 + visibleWidth(chip) > width) {
					rows.push(line);
					line = "";
				}
				line = line ? `${line}  ${chip}` : chip;
			}
			if (line) rows.push(line);
		}
		return rows;
	}
}

interface FinderItem {
	record: SessionRecord;
	notable: Ref[];
	primary: string;
}

interface FinderRow {
	item: FinderItem;
	match?: Match;
}

export interface FinderOptions {
	records: SessionRecord[];
	teams: Teams;
	query: string;
	currentPath?: string;
	done: (path: string | undefined) => void;
}

/** Search box over every session, ranked by how strongly each one is tied to the query. */
export class SessionFinder implements Component, Focusable {
	private readonly input = new Input({ placeholder: "MR (!1235 or URL), ticket (CUS-718), or words" });
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly options: FinderOptions;
	private items: FinderItem[] = [];
	private rows: FinderRow[] = [];
	private selected = 0;
	private status = "";
	private _focused = false;

	constructor(tui: TUI, theme: Theme, keybindings: KeybindingsManager, options: FinderOptions) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.options = options;
		this.input.setValue(options.query);
		this.setRecords(options.records, options.teams);
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	setRecords(records: SessionRecord[], teams: Teams): void {
		const selectedPath = this.rows[this.selected]?.item.record.path;
		this.items = records
			.filter((record) => record.userMessages > 0)
			.map((record) => ({
				record,
				notable: notableRefs(record.refs, teams),
				primary: (record.name ?? record.summary ?? record.firstMessage).replace(/\s+/g, " "),
			}));
		this.filter(selectedPath);
	}

	setStatus(status: string): void {
		this.status = status;
		this.tui.requestRender();
	}

	invalidate(): void {
		this.input.invalidate();
	}

	handleInput(data: string): void {
		const kb = this.keybindings;
		const page = Math.max(this.visibleCount() - 1, 1);
		if (kb.matches(data, "tui.select.up")) this.move(-1);
		else if (kb.matches(data, "tui.select.down")) this.move(1);
		else if (kb.matches(data, "tui.select.pageUp")) this.move(-page);
		else if (kb.matches(data, "tui.select.pageDown")) this.move(page);
		else if (kb.matches(data, "tui.select.confirm")) this.options.done(this.rows[this.selected]?.item.record.path);
		else if (kb.matches(data, "tui.select.cancel")) this.options.done(undefined);
		else {
			const before = this.input.getValue();
			this.input.handleInput(data);
			if (this.input.getValue() !== before) this.filter();
		}
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const th = this.theme;
		const count = this.input.getValue().trim() ? `${this.rows.length} of ${this.items.length}` : `${this.items.length} sessions`;
		const header = `${th.fg("accent", th.bold("Resume session"))}  ${th.fg("dim", [count, this.status].filter(Boolean).join(" · "))}`;
		const lines = [th.fg("borderAccent", "─".repeat(width)), truncateToWidth(header, width, "…"), ...this.input.render(width), ""];

		const visible = this.visibleCount();
		const start = Math.min(Math.max(this.selected - Math.floor(visible / 2), 0), Math.max(this.rows.length - visible, 0));
		for (let i = start; i < Math.min(start + visible, this.rows.length); i++) lines.push(...this.renderRow(this.rows[i], i === this.selected, width));
		if (this.rows.length === 0) lines.push(th.fg("muted", "  No matching sessions"));

		lines.push("", th.fg("dim", "↑↓ select · enter resume · esc cancel"), th.fg("borderAccent", "─".repeat(width)));
		return lines;
	}

	private visibleCount(): number {
		return Math.min(Math.max(Math.floor((this.tui.terminal.rows - 10) / 2), 3), 15);
	}

	private move(delta: number): void {
		if (this.rows.length === 0) return;
		this.selected = Math.min(Math.max(this.selected + delta, 0), this.rows.length - 1);
	}

	private filter(keepPath?: string): void {
		const items = new Map(this.items.map((item) => [item.record, item]));
		this.rows = searchRecords([...items.keys()], this.input.getValue()).map(({ record, match }) => ({ item: items.get(record)!, match }));
		const kept = keepPath ? this.rows.findIndex((row) => row.item.record.path === keepPath) : -1;
		this.selected = Math.max(kept, 0);
	}

	private renderRow({ item, match }: FinderRow, selected: boolean, width: number): string[] {
		const th = this.theme;
		const { record } = item;
		const pointer = selected ? th.fg("accent", "› ") : "  ";
		const primary = selected ? th.fg("accent", th.bold(item.primary || "(no text)")) : item.primary || "(no text)";

		// Refs that matched the query come first, then what the session is about.
		const matched = match ? record.refs.filter((ref) => match.matched.has(ref.key)) : [];
		const labels = new Set<string>();
		const badge = (ref: Ref, color: "accent" | "success" | "muted") => {
			if (labels.has(ref.label)) return [];
			labels.add(ref.label);
			return [th.fg(color, ref.label)];
		};
		const badges = [
			...matched.flatMap((ref) => badge(ref, "accent")),
			...item.notable
				.filter((ref) => ref.kind !== "link")
				.flatMap((ref) => badge(ref, ref.source === "authored" ? "success" : "muted")),
		];
		const current = record.path === this.options.currentPath ? th.fg("warning", " (current)") : "";
		const meta = `${th.fg("dim", `${age(record.modified)} · ${shortPath(record.cwd)}`)}${current}  ${badges.join(" ")}`;
		return [truncateToWidth(pointer + primary, width, "…"), truncateToWidth(`  ${meta}`, width, "…")];
	}
}
