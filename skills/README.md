# Skills

Skills are structured prompts that provide domain-specific knowledge to AI coding assistants like [OpenCode](https://opencode.ai) and Claude Code. They're loaded automatically when the skill name is mentioned or when the context matches.

## Structure

```
skills/
├── install              # Downloads external skills, symlinks all to global locations
├── skill-creator/       # Guide for creating new skills (forked from anthropics/skills)
├── dotfiles/            # Custom skill for managing this dotfiles repo
├── obsidian-vault/      # Obsidian Personal vault management
│   ├── SKILL.md
│   └── references/
└── external/            # Downloaded/cloned skills (gitignored)
    ├── playwright-skill/# From lackeyjb/playwright-skill
    └── private/         # From luanzeba/private-dotfiles repo
```

## How It Works

The `install` script:
1. Downloads `playwright-skill` from [lackeyjb/playwright-skill](https://github.com/lackeyjb/playwright-skill) and runs setup
2. Clones private skills from a private repo (if accessible)
3. Symlinks all skills to global locations:
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

Then add to `configure()` in `skills/install`:

```bash
symlink_skill "$SCRIPT_DIR/my-skill" "my-skill"
```

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
