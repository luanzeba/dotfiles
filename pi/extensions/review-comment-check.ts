import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import {
	convertToLlm,
	createBashTool,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface ReviewCommentCheck {
	clear: boolean;
	feedback: string;
}

const SYSTEM_PROMPT = `You are a cold reader checking one proposed inline code-review comment from the author's perspective.

You know only the diff hunk and Markdown comment supplied in the user message. Do not inspect the local repository, search for related code, or assume facts that are not present there.

You may use Bash to follow any URL included directly in the comment when that link is necessary to understand the comment. Do not look up anything beyond those URLs, infer related URLs, follow links from fetched content, or modify anything. Use gh for GitHub links and glab for GitLab links when appropriate.

Decide whether the author can identify the current behavior, its impact, and the requested change. Flag missing causal links, unexplained names, and vague requests. Do not demand background that is unnecessary to act on the comment. Do not verify the technical claim, rewrite the comment, or invent missing facts.

Return only valid JSON with this exact shape:
{
  "clear": false,
  "feedback": "State what the author understands, or what is unclear and why."
}`;

const Params = Type.Object({
	hunk: Type.String({ description: "The exact diff hunk visible to the author" }),
	comment: Type.String({ description: "The exact proposed Markdown review comment" }),
});

function parseResponse(output: string): ReviewCommentCheck {
	const trimmed = output.trim().replace(/^```json\s*|\s*```$/g, "");
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		throw new Error(`checker did not return JSON:\n${output.trim()}`);
	}

	if (!parsed || typeof parsed !== "object") throw new Error("checker response is not an object");
	const result = parsed as Record<string, unknown>;
	if (typeof result.clear !== "boolean") throw new Error("checker response has no boolean clear");
	if (typeof result.feedback !== "string") throw new Error("checker response has no string feedback");
	return { clear: result.clear, feedback: result.feedback };
}

function finalAssistantText(agent: Agent): string {
	for (let index = agent.state.messages.length - 1; index >= 0; index -= 1) {
		const message = agent.state.messages[index];
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		return message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
	}
	return "";
}

async function runCheck(
	ctx: ExtensionContext,
	input: ReviewCommentCheckInput,
	signal?: AbortSignal,
): Promise<ReviewCommentCheck> {
	if (!ctx.model) throw new Error("review_comment_check needs an active model");

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error(`review_comment_check could not resolve model auth: ${auth.error}`);

	const registered = ctx.modelRegistry.getRegisteredProviderConfig(ctx.model.provider);
	const customStream = registered && registered.api === ctx.model.api ? registered.streamSimple : undefined;
	const baseStream = customStream ?? streamSimple;
	const streamFn: StreamFn = (model, context, options) =>
		baseStream(model, context, {
			...options,
			...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
			...(auth.env || options?.env ? { env: { ...(auth.env ?? {}), ...(options?.env ?? {}) } } : {}),
			headers: { ...(options?.headers ?? {}), ...(auth.headers ?? {}) },
		});

	const agent = new Agent({
		initialState: {
			systemPrompt: SYSTEM_PROMPT,
			model: ctx.model,
			thinkingLevel: ctx.thinkingLevel ?? "off",
			tools: [createBashTool(ctx.cwd, { exposeSessionEnvironment: false })],
		},
		convertToLlm,
		streamFn,
		getApiKey: (provider) => provider === ctx.model?.provider ? auth.apiKey : undefined,
		toolExecution: "sequential",
	});

	const abort = () => agent.abort();
	const abortSignal = signal ?? ctx.signal;
	abortSignal?.addEventListener("abort", abort, { once: true });
	try {
		await agent.prompt(JSON.stringify(input));
	} finally {
		abortSignal?.removeEventListener("abort", abort);
	}

	const output = finalAssistantText(agent);
	if (!output) throw new Error("checker returned no text");
	return parseResponse(output);
}

interface ReviewCommentCheckInput {
	hunk: string;
	comment: string;
}

export default function reviewCommentCheckExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "review_comment_check",
		label: "Review Comment Check",
		description: "Check whether a proposed inline PR or MR comment is understandable without hidden investigation context.",
		promptSnippet: "Check a proposed inline review comment from the author's perspective",
		promptGuidelines: [
			"Use review_comment_check after drafting a final inline PR or MR comment and before creating or updating it on the review platform. Pass only the visible diff hunk and comment, never hidden research notes.",
		],
		parameters: Params,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			onUpdate?.({ content: [{ type: "text", text: "Checking comment clarity..." }], details: {} });
			const check = await runCheck(ctx, params, signal);
			return {
				content: [{ type: "text", text: JSON.stringify(check, null, 2) }],
				details: check,
			};
		},
	});
}
