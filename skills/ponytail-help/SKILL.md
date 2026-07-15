---
name: ponytail-help
description: >
  Quick-reference card for all ponytail modes and dotfiles-maintained skills.
  One-shot display, not a persistent mode. Trigger: /ponytail-help, "ponytail
  help", "what ponytail commands", or "how do I use ponytail".
license: MIT
metadata:
  source: "https://github.com/DietrichGebert/ponytail/tree/14a0d79548d4de8fc2de95c1b94bb0de63a739d3/skills/ponytail-help"
  upstream-commit: "14a0d79548d4de8fc2de95c1b94bb0de63a739d3"
  local-note: "Copied manually into dotfiles; plugin/command harness files intentionally omitted."
---

# Ponytail Help

Display this reference card when invoked. One-shot; do NOT change mode, write
flag files, or persist anything.

## Levels

| Level | Trigger | What changes |
|-------|---------|--------------|
| **Lite** | `ponytail lite` | Build what's asked, name the lazier alternative in one line. |
| **Full** | `ponytail` / `ponytail full` | The ladder enforced: YAGNI → stdlib → native → one line → minimum. Default. |
| **Ultra** | `ponytail ultra` | YAGNI extremist. Deletion before addition. Challenges requirements before building. |

Level sticks for the current coding task/session until changed or stopped.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | `ponytail` | Lazy mode itself. Simplest solution that works. |
| **ponytail-review** | `ponytail-review` | Over-engineering review: `L42: yagni: factory, one product. Inline.` |
| **ponytail-audit** | `ponytail-audit` | Whole-repo over-engineering audit: ranked list of what to delete. |
| **ponytail-debt** | `ponytail-debt` | Harvest `ponytail:` shortcut comments into a tracked ledger. |
| **ponytail-gain** | `ponytail-gain` | Measured-impact scoreboard: less code, less cost, more speed. |
| **ponytail-help** | `ponytail-help` | This card. |

In Pi/Claude Code, natural language works too: "use ponytail", "review this
for over-engineering", "what can we delete", etc. These dotfiles keep only the
skills, not Ponytail's upstream plugins, slash-command wrappers, hooks, MCP
server, or other harness-specific files.

## Deactivate

Say `stop ponytail` or `normal mode`. Resume anytime with `ponytail`.

## Update local copy

This repo vendors the upstream skill text manually. To check for updates, compare
against the source repo with `gh` and copy only what still matters to dotfiles:

```bash
for skill in ponytail ponytail-review ponytail-audit ponytail-debt ponytail-gain ponytail-help; do
  gh api repos/DietrichGebert/ponytail/contents/skills/$skill/SKILL.md --jq .content | base64 --decode > /tmp/$skill.SKILL.md
done
```

Upstream source: https://github.com/DietrichGebert/ponytail
Pinned source commit for this copy: `14a0d79548d4de8fc2de95c1b94bb0de63a739d3`.

## Source

Adapted from Dietrich Gebert's MIT-licensed Ponytail project:
`DietrichGebert/ponytail` → `skills/ponytail-help/SKILL.md` at commit
`14a0d79548d4de8fc2de95c1b94bb0de63a739d3`. License text is included in
`../ponytail/LICENSE`.
