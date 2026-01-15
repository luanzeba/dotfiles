# Skills

Skills are structured prompts that provide domain-specific knowledge to AI coding assistants like [OpenCode](https://opencode.ai) and Claude Code. They're loaded automatically when the skill name is mentioned or when the context matches.

## Structure

```
skills/
├── install              # Downloads external skills, symlinks all to global locations
├── dotfiles/            # Custom skill for managing this dotfiles repo
│   ├── SKILL.md         # Main skill file (frontmatter + instructions)
│   └── references/      # Supporting documentation
└── external/            # Downloaded/cloned skills (gitignored)
    ├── skill-creator/   # From anthropics/skills repo
    └── private/         # From luanzeba/private-dotfiles repo
```

## How It Works

The `install` script:
1. Downloads `skill-creator` from [anthropics/skills](https://github.com/anthropics/skills)
2. Clones private skills from a private repo (if accessible)
3. Symlinks all skills to global locations:
   - `~/.config/opencode/skill/<name>` (OpenCode)
   - `~/.claude/skills/<name>` (Claude Code)

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
