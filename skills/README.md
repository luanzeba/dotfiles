# Skills

Skills are structured prompts that provide domain-specific knowledge to AI coding assistants like Claude Code and Pi. They're loaded automatically when the skill name is mentioned or when the context matches.

## Structure

```
skills/
├── install              # Downloads external skills, symlinks all to global locations
├── skill-creator/       # Guide for creating new skills (forked from anthropics/skills)
├── dotfiles/            # Custom skill for managing this dotfiles repo
├── ponytail/            # Condensed take on Ponytail's simplest-solution skill
├── github-prs/          # Draft/open concise PRs with template + demo guidance
│   ├── SKILL.md
│   └── references/
├── gitlab-mr-review/    # Review MRs and manage pending GitLab draft notes safely
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── merge-conflict-resolver/ # Resolve merge conflicts using commit + PR intent
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── obsidian-vault/      # Obsidian Personal vault management
│   ├── SKILL.md
│   └── references/
└── external/            # Downloaded/cloned skills (gitignored)
    └── private/         # From luanzeba/private-dotfiles repo
```

## How It Works

The `install` script:
1. Clones private skills from a private repo (if accessible)
2. Symlinks all skills to global locations:
   - `~/.claude/skills/<name>` (Claude Code)
   - `~/.pi/agent/skills/<name>` (Pi)

Note: `skill-creator` was originally from [anthropics/skills](https://github.com/anthropics/skills) but is now maintained locally with dotfiles-specific additions.

The `ponytail` skill is a condensed local rewrite of [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT), kept to the parts that steer agents.

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

