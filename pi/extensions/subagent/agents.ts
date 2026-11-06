/**
 * Agent definitions: markdown files in ./agents with plain `key: value` frontmatter (name,
 * description, optional comma-separated tools, optional `skills: false`); README.md's "Agents"
 * section has the details. No pi imports, so `node --test` can run it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface Agent {
	name: string;
	description: string;
	tools?: string[];
	skills: boolean;
	prompt: string;
}

export function parseAgent(text: string): Agent | undefined {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
	if (!match) return undefined;
	const fields: Record<string, string> = {};
	for (const line of match[1]!.split(/\r?\n/)) {
		const colon = line.indexOf(":");
		if (colon > 0) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	if (!/^[a-z][a-z0-9-]*$/.test(fields.name ?? "") || !fields.description) return undefined;
	const tools = fields.tools
		?.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);
	return {
		name: fields.name!,
		description: fields.description,
		...(tools?.length ? { tools } : {}),
		skills: fields.skills !== "false",
		prompt: match[2]!.trim(),
	};
}

export function loadAgents(dir: string): Agent[] {
	const names = fs.readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
	return names.flatMap((name) => {
		const agent = parseAgent(fs.readFileSync(path.join(dir, name), "utf8"));
		return agent ? [agent] : [];
	});
}
