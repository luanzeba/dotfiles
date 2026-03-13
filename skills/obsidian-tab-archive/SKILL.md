---
name: obsidian-tab-archive
description: Archive browser tab/bookmark folders into structured Obsidian notes for long-term retrieval via QMD. Use when the user wants to clean up tabs, preserve reference links, move bookmark folders into notes, or make link collections searchable by project/topic intent (not browser-specific context).
---

# Obsidian Tab Archive

Convert browser bookmark folders into durable Obsidian reference notes.

## Goal

Store link collections as reusable knowledge, so future prompts like these work naturally:
- "Let's work on my growth plan for GitHub"
- "Show me the original doc for the rules engine project"
- "Open all links for the settings SDK"

Focus note titles, summaries, topics, and aliases on the **domain intent**, not migration history.

## Script

Use:

```bash
~/dotfiles/skills/obsidian-tab-archive/scripts/archive_chromium_bookmark_folder.py
```

## Workflow

1. Identify the user intent and choose a durable note title (project/topic language).
2. Select bookmark folders by `--folder-name` or `--folder-path`.
3. Run script in dry-run mode first (omit `--apply`) and review output.
4. Re-run with `--apply` to write note to `~/Obsidian/Personal/Notes/`.
5. Reindex for retrieval:
   ```bash
   qmd update && qmd embed
   ```

## Recommended metadata

- category: `[[Categories/GitHub|GitHub]]`, `[[Categories/Projects|Projects]]`
- type: `Reference`, `Link Archive`
- tags: include topic tags (`growth-plan`, `settings-sdk`, `career-plan`, etc.)
- topics: include likely query phrases
- aliases: include alternate wording users may ask later

## Examples

### 1) Growth/Career links

```bash
~/dotfiles/skills/obsidian-tab-archive/scripts/archive_chromium_bookmark_folder.py \
  --profile-name "Work" \
  --folder-name "Growth plans" \
  --note-title "GitHub Growth and Career Plan - Reference Links" \
  --summary "Reference links for growth planning and individual development discussions at GitHub." \
  --topic "growth plan" \
  --topic "career plan" \
  --topic "individual development plan" \
  --alias "GitHub growth plan" \
  --alias "career plan docs" \
  --question "Let's work on my growth plan for GitHub" \
  --question "Let's work on my career plan" \
  --tag work \
  --tag growth-plan \
  --apply
```

### 2) Settings SDK / rules engine links

```bash
~/dotfiles/skills/obsidian-tab-archive/scripts/archive_chromium_bookmark_folder.py \
  --profile-name "Work" \
  --folder-name "🐙 Project Tentacle" \
  --note-title "GitHub Settings SDK and Rules Engine - Reference Links" \
  --summary "Working references for the Settings SDK / rules engine project, including ADRs, planning docs, and tracking issues." \
  --topic "settings sdk" \
  --topic "rules engine" \
  --topic "project tentacle" \
  --alias "rules engine project docs" \
  --alias "settings sdk links" \
  --question "Show me the original doc for the rules engine project" \
  --question "Open all the links for the settings sdk in the browser" \
  --tag work \
  --tag settings-sdk \
  --apply
```
