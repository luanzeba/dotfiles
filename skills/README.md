# Skills

Skills are structured prompts that provide domain-specific knowledge to AI coding assistants like [OpenCode](https://opencode.ai) and Claude Code. They're loaded automatically when the skill name is mentioned or when the context matches.

## Structure

```
skills/
├── install              # Downloads external skills, symlinks all to global locations
├── skill-creator/       # Guide for creating new skills (forked from anthropics/skills)
├── dotfiles/            # Custom skill for managing this dotfiles repo
├── github-prs/          # Draft/open concise PRs with template + demo guidance
│   ├── SKILL.md
│   └── references/
├── vernier-test-profiling/ # Profile slow github/github tests with Vernier
│   └── SKILL.md
├── feature-flag-removal/# Remove fully rolled-out flag conditionals from github/github
│   ├── SKILL.md
│   └── references/
├── writing-studio/      # Collaborative drafting for blog posts/discussions
│   ├── SKILL.md
│   └── references/
├── obsidian-vault/      # Obsidian Personal vault management
│   ├── SKILL.md
│   └── references/
└── external/            # Downloaded/cloned skills (gitignored)
    ├── pi-skills/       # From badlogic/pi-skills (gccli skill)
    ├── playwright-skill/# From lackeyjb/playwright-skill
    └── private/         # From luanzeba/private-dotfiles repo
```

## How It Works

The `install` script:
1. Downloads `playwright-skill` from [lackeyjb/playwright-skill](https://github.com/lackeyjb/playwright-skill) and runs setup
2. Clones [badlogic/pi-skills](https://github.com/badlogic/pi-skills) and links the `gccli` skill on local machines (skipped in Codespaces)
3. Clones private skills from a private repo (if accessible)
4. Symlinks all skills to global locations:
   - `~/.config/opencode/skill/<name>` (OpenCode)
   - `~/.claude/skills/<name>` (Claude Code)
   - `~/.pi/agent/skills/<name>` (Pi)

Note: `skill-creator` was originally from [anthropics/skills](https://github.com/anthropics/skills) but is now maintained locally with dotfiles-specific additions.

## Adding a New Skill

### Option 1: Add to this repo

Create a new directory under `skills/`:

```
skills/my-skill/
├── SKILL.md           # Required: frontmatter (name, description) + instructions
└── references/        # Optional: supporting docs
```

No `skills/install` change is needed for local skills. `configure()` auto-symlinks all top-level directories under `skills/` (except `external/`).

### Option 2: Add to private repo

Add the skill to `luanzeba/private-dotfiles` under `skills/`. It will be automatically symlinked on next install.

## Skill Format

A minimal `SKILL.md`:

```markdown
---
name: my-skill
description: When to use this skill (shown in skill picker)
---

# My Skill

Instructions for the AI...
```

See the `dotfiles/` skill for a full example with references.

## Running Install

```bash
# Via dotfiles CLI
dotfiles install skills

# Or directly
~/dotfiles/skills/install
```

## Playwright Skill vs Playwright MCP

This dotfiles repo includes both the Playwright Skill and Playwright MCP:

| | Playwright MCP | Playwright Skill |
|--|----------------|------------------|
| **Location** | `opencode/opencode.json` | `skills/external/playwright-skill/` |
| **How it works** | Tool-based (MCP protocol) | Claude writes custom scripts |
| **Best for** | Quick single actions | Complex multi-step automation |

They're complementary:
- **MCP**: Quick tasks like "take a screenshot of this page"
- **Skill**: Complex flows like "test the login, then verify dashboard loads, then check responsive design"

### Codespaces Note

In Codespaces, Playwright must run headless (no display available). The `HEADLESS=true` env var is automatically set in `.zshrc` when `$CODESPACES` is detected. When using the playwright-skill, Claude should use `headless: true` or the `helpers.launchBrowser()` function which respects this env var.

`gccli` from badlogic/pi-skills is intentionally linked only on local machines (macOS/Arch), not in Codespaces.
