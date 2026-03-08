---
name: qmd
description: Search personal knowledge base using QMD (Query Markup Documents). Use when users ask to find information, search notes, look up details about house/family/kids/work, recall stored facts, or retrieve any previously saved knowledge. Also use when adding new information to remember.
allowed-tools: Bash(qmd:*)
---

# QMD - Personal Knowledge Search

Search the Obsidian vault using QMD's hybrid search (BM25 + vector + LLM reranking).

## Status

!`qmd status 2>/dev/null || echo "Not installed: npm install -g @tobilu/qmd"`

## Collections

| Collection | Path | Content |
|-----------|------|---------|
| `obsidian` | `~/Obsidian/Personal` | All personal notes, family docs, house manual, work notes, journal |

## Searching

### CLI Commands

```bash
# Best quality: query expansion + reranking (recommended for most questions)
qmd query "what ski level are the kids at"

# Fast keyword search (exact terms, names, codes)
qmd search "Green 5 ski"

# Semantic search (natural language, no reranking)
qmd vsearch "home appliance replacement history"

# Get a specific document
qmd get "Notes/Ski lessons - March 2026.md"

# Get by docid (shown in search results)
qmd get "#abc123"

# Structured multi-type search for best recall
qmd query $'lex: Jack ski level\nvec: what ski class should Jack be in next season'
```

### Query Strategy

| Goal | Approach |
|------|----------|
| Know exact terms/names | `qmd search "exact terms"` (BM25 only, fast) |
| Natural language question | `qmd query "your question"` (auto-expands + reranks) |
| Don't know vocabulary | `qmd vsearch "describe what you're looking for"` |
| Best recall on important query | Structured: `lex` + `vec` + `hyde` |

### Lex Query Syntax

| Syntax | Meaning | Example |
|--------|---------|---------|
| `term` | Prefix match | `perf` → "performance" |
| `"phrase"` | Exact phrase | `"Green 5"` |
| `-term` | Exclude | `ski -water` |

## Adding New Knowledge

When the user shares information to remember, create a note in the Obsidian vault following the obsidian-vault skill's conventions, then reindex:

```bash
# After creating/editing a note in ~/Obsidian/Personal/Notes/
qmd update && qmd embed
```

New notes should use proper Obsidian frontmatter with categories. See the `obsidian-vault` skill for templates and conventions.

## Reindexing

A LaunchAgent runs `qmd update && qmd embed` every 30 minutes. For immediate reindex after adding notes:

```bash
qmd update && qmd embed
```

## Reference

See `references/qmd-commands.md` for the full CLI reference.
