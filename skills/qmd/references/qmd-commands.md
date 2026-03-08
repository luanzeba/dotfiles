# QMD CLI Reference

## Collection Management

```bash
qmd collection add ~/path --name name    # Add collection
qmd collection list                      # List collections
qmd collection remove <name>             # Remove collection
qmd collection rename <old> <new>        # Rename collection
qmd ls [collection[/path]]               # List files
```

## Context

```bash
qmd context add [path] "description"     # Add context (helps search quality)
qmd context list                         # List all contexts
qmd context check                        # Find paths missing context
qmd context rm <path>                    # Remove context
```

## Search

```bash
qmd search "keywords"                    # BM25 keyword search (fast, no LLM)
qmd vsearch "natural language"           # Vector semantic search
qmd query "question"                     # Hybrid: expansion + reranking (best)
qmd query --json "question"              # JSON output for processing
qmd query --json --explain "q"           # Show score traces
```

### Structured Queries

```bash
# Multi-line structured query
qmd query $'lex: keyword terms\nvec: natural language question\nhyde: hypothetical answer passage'

# Explicit expand
qmd query $'expand: your question here'
```

### Query Types

| Type | Method | Best For |
|------|--------|----------|
| `lex` | BM25 | Exact terms, names, identifiers |
| `vec` | Vector | Natural language questions |
| `hyde` | Vector | Hypothetical answer (50-100 words) |
| `expand` | Auto | Let LLM generate search variations |

## Document Retrieval

```bash
qmd get "path/to/doc.md"                # By path
qmd get "#abc123"                        # By docid
qmd get "path/doc.md:50" -l 100         # From line 50, max 100 lines
qmd get "path/doc.md" --full             # Full content
qmd multi-get "pattern/*.md"             # Glob pattern
qmd multi-get "a.md, b.md, #id"         # Comma-separated
```

## Indexing

```bash
qmd update                               # Re-index all collections
qmd update --pull                        # Git pull first, then re-index
qmd embed                                # Generate/update vector embeddings
qmd embed --force                        # Regenerate all embeddings
```

## Status

```bash
qmd status                               # Index health, collections, MCP status
```

## MCP Server

```bash
qmd mcp                                  # Start MCP (stdio)
qmd mcp --http                           # Start MCP (HTTP, port 8181)
qmd mcp --http --daemon                  # Background daemon
qmd mcp stop                             # Stop daemon
```
