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
~/dotfiles/skills/obsidian-tab-archive/scripts/archive_chrome_bookmark_folder.py
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

### Work/project archives
- category: `[[Categories/GitHub|GitHub]]`, `[[Categories/Projects|Projects]]`
- type: `Reference`, `Link Archive`
- tags: include topic tags (`growth-plan`, `settings-sdk`, `career-plan`, etc.)

### List-style archives (shopping, books, movies, furniture)
- category: usually `[[Categories/Home|Home]]`; add `[[Categories/Products|Products]]` when relevant
- type: include list intent (`Shopping`, `Watchlist`, `Reference`)
- tags: include list topic (`shopping`, `wall-art`, `books`, `movies`)

For all archives:
- topics: include likely query phrases
- aliases: include alternate wording users may ask later
- questions: include explicit future prompts users may ask verbatim

## Examples

### 1) Growth/Career links

```bash
~/dotfiles/skills/obsidian-tab-archive/scripts/archive_chrome_bookmark_folder.py \
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
~/dotfiles/skills/obsidian-tab-archive/scripts/archive_chrome_bookmark_folder.py \
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

### 3) Home shopping/list folder

```bash
~/dotfiles/skills/obsidian-tab-archive/scripts/archive_chrome_bookmark_folder.py \
  --profile-name "Home" \
  --folder-name "Shopping" \
  --note-title "Home Shopping Candidates - Reference Links" \
  --summary "Products and items we're considering buying; a shortlist to revisit later." \
  --category "[[Categories/Home|Home]]" \
  --category "[[Categories/Products|Products]]" \
  --type Shopping \
  --type Reference \
  --topic "shopping list" \
  --topic "things to buy" \
  --alias "home shopping list" \
  --question "Show me my shopping list links" \
  --question "Open all shopping links in the browser" \
  --tag home \
  --tag shopping \
  --apply
```
