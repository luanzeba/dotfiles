---
name: github-monolith-navigator
description: Navigate the GitHub monolith (github/github) codebase efficiently. Use when exploring code, finding files, understanding package structure, locating tests, or discovering where functionality lives. Helps with questions like "where is X implemented?", "find the controller for Y", "what package handles Z?", or general codebase exploration.
---

# GitHub Monolith Navigator

This codebase is a large Ruby on Rails application using Packwerk for modular architecture. It has 140+ packages in `/packages/`, each functioning as a mini-Rails app.

## Architecture Overview

```
/workspaces/github/
├── app/                    # Main Rails app (controllers, models, views, jobs)
├── packages/               # Packwerk packages (140+), each with own app/, test/
├── lib/                    # Shared libraries
├── test/                   # Main app tests
├── config/                 # Rails configuration
├── db/                     # Database migrations and schema
└── sorbet/                 # Type definitions (.rbi files)
```

### Package Structure

Each package in `/packages/<name>/` contains:
- `app/` - controllers, models, views, jobs, helpers
- `test/` - tests mirroring app/ structure
- `package.yml` - dependencies and metadata

## Navigation Strategies

### 1. Find Code Location

**By feature/domain**: Check packages first
```bash
ls packages/ | grep -i <feature>  # e.g., copilot, issues, codespaces
```

**By class/module name**: Use Sorbet RBIs or grep
```bash
grep -r "class ClassName" packages/ app/ lib/ --include="*.rb" | head -20
```

**By route/URL**: Check config/routes or controllers
```bash
grep -r "pattern" config/routes* --include="*.rb"
```

### 2. Understand Package Dependencies

Read `packages/<name>/package.yml` to see:
- `dependencies:` - other packages this depends on
- `metadata.tables:` - database tables owned by package

### 3. Find Tests

Tests mirror source structure:
- `app/models/user.rb` → `test/models/user_test.rb`
- `packages/issues/app/models/issue.rb` → `packages/issues/test/models/issue_test.rb`

### 4. Use LSP Tools

**Sorbet** for type info and go-to-definition:
```bash
bin/srb tc --isolate-error-code 7003 <file>  # Check a specific file
```

**Ruby LSP** is available at:
```
/workspaces/github/vendor/ruby/*/bin/ruby-lsp
```

## Context Management

**CRITICAL**: This is a massive codebase. Avoid loading large files entirely.

- Use `view_range` parameter to read specific line ranges
- Grep for specific patterns rather than reading whole files
- Preview file structure with `head -50` before full read
- Large models (User, Repository) can be 5000+ lines—navigate by method name

## Common Patterns

| Looking for... | Check first |
|---------------|-------------|
| API endpoints | `app/api/`, `packages/api/` |
| Background jobs | `app/jobs/`, `packages/*/app/jobs/` |
| GraphQL | `app/graphql/`, `packages/*/app/graphql/` |
| Feature flags | grep for `FeatureFlag.vexi.enabled?` |
| Controllers | `app/controllers/`, `packages/*/app/controllers/` |

## Quick Commands

```bash
# Find all files mentioning a class
grep -rl "ClassName" packages/ app/ --include="*.rb" | head -20

# List package contents
ls packages/<name>/app/

# Find test for a source file
# Source: packages/issues/app/models/issue/timeline.rb
# Test: packages/issues/test/models/issue/timeline_test.rb

# Check what packages exist for a domain
ls packages/ | grep -E "(copilot|issue|repo|user)"
```
