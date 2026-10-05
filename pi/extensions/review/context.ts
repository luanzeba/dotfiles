import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChangeSet } from "./sources/types";

export const REVIEW_HANDOFF_PREFIX = "Independent simplification and correctness reviews of ";

const MAX_MESSAGES_PER_ROLE = 2;
const ROLE_INFO = {
	user: { label: "User", maxChars: 6_000 },
	assistant: { label: "Implementing agent", maxChars: 6_000 },
	compactionSummary: { label: "Compacted session summary", maxChars: 24_000 },
} as const;

type ContextRole = keyof typeof ROLE_INFO;

interface ContextEntry {
	index: number;
	role: ContextRole;
	text: string;
}

function shorten(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const tailLength = 1_500;
	return `${text.slice(0, maxChars - tailLength)}\n\n[earlier message shortened]\n\n${text.slice(-tailLength)}`;
}

function conversationEntries(ctx: ExtensionContext): ContextEntry[] {
	return ctx.sessionManager.buildSessionProjection().messages.flatMap(
		(message, index): ContextEntry[] => {
			if (message.role === "compactionSummary") {
				const text = message.summary.trim();
				return text ? [{ index, role: message.role, text }] : [];
			}
			if (message.role !== "user" && message.role !== "assistant") return [];

			const text =
				typeof message.content === "string"
					? message.content.trim()
					: message.content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("\n")
							.trim();
			return text ? [{ index, role: message.role, text }] : [];
		},
	);
}

function relevantEntries(
	entries: ContextEntry[],
	change: Pick<ChangeSet, "kind" | "label" | "reviewUrl" | "references">,
): ContextEntry[] {
	if (change.kind === "git") {
		return entries.filter(
			(entry) => entry.role !== "user" || !entry.text.startsWith(REVIEW_HANDOFF_PREFIX),
		);
	}

	// A bare !number is ambiguous across projects. Prefer the full MR URL when available.
	const references = [change.reviewUrl ?? change.label, ...(change.references ?? [])]
		.filter((value): value is string => Boolean(value))
		.map((value) =>
			new RegExp(`(?<![\\w-])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i"),
		);
	const mentionsChange = (text: string) => references.some((reference) => reference.test(text));
	const relevant: ContextEntry[] = [];
	let followsRelevantUser = false;

	for (const entry of entries) {
		if (entry.role === "compactionSummary") {
			// Compaction summaries often mix several tasks. Keep only lines that identify
			// this remote change instead of leaking the entire local-session summary.
			const text = entry.text.split("\n").filter(mentionsChange).join("\n");
			if (text) relevant.push({ ...entry, text });
			continue;
		}
		if (entry.role === "user") {
			followsRelevantUser = mentionsChange(entry.text);
			if (followsRelevantUser && !entry.text.startsWith(REVIEW_HANDOFF_PREFIX)) relevant.push(entry);
		} else if (followsRelevantUser || mentionsChange(entry.text)) {
			relevant.push(entry);
		}
	}
	return relevant;
}

/** Pass recent intent, implementation decisions, and completed checks to the reviewers. */
export function parentReviewContext(
	ctx: ExtensionContext,
	change: Pick<ChangeSet, "kind" | "label" | "reviewUrl" | "references">,
): string | undefined {
	const conversation = relevantEntries(conversationEntries(ctx), change);
	const selected = [
		...conversation.filter((entry) => entry.role === "compactionSummary").slice(-1),
		...conversation.filter((entry) => entry.role === "user").slice(-MAX_MESSAGES_PER_ROLE),
		...conversation.filter((entry) => entry.role === "assistant").slice(-MAX_MESSAGES_PER_ROLE),
	].sort((left, right) => left.index - right.index);
	if (selected.length === 0) return undefined;

	return selected
		.map((entry) => {
			const info = ROLE_INFO[entry.role];
			return `${info.label}:\n${shorten(entry.text, info.maxChars)}`;
		})
		.join("\n\n");
}
