---
name: github-prs
description: Draft and open GitHub pull requests with concise, high-signal descriptions in Luan's voice. Use when writing PR titles/bodies, opening PRs with gh, ensuring repository PR templates are followed, avoiding redundant change/test summaries, and including demos for UI changes.
---

# GitHub PRs

Write PR descriptions that explain **why the change matters** and **what behavior changed**. Do not narrate the entire diff.

## Default Workflow

1. **Confirm context**
   - What problem are we solving?
   - What is the behavioral change?
   - Is there a linked issue (`Fixes #...`)?
   - Does this include UI/UX changes?

2. **Find and follow the repository PR template (required when present)**
   - Check local paths first:
     - `.github/pull_request_template.md`
     - `.github/PULL_REQUEST_TEMPLATE.md`
     - `.github/PULL_REQUEST_TEMPLATE/*.md`
     - `docs/pull_request_template.md`
     - `docs/PULL_REQUEST_TEMPLATE.md`
   - If not found locally, check remote via `gh api`.
   - If multiple templates exist, ask which one to use.
   - Keep the template structure; remove placeholder comments/text and empty sections.

3. **Draft a concise body**
   - Focus on:
     - motivation/context
     - key behavior change(s)
     - important tradeoffs/limitations (only if relevant)
     - links to issue/PRs/docs when useful
   - Use `references/style-signals.md` for examples of tone and structure.

4. **Apply anti-redundancy rules**
   - Do **not** include file-by-file or exhaustive change lists.
   - Do **not** include generic "tests run" / "linters run" sections by default.
   - Mention verification only when it adds unique signal (manual flow, benchmark, repro script, or notable constraint).

5. **UI changes require a demo**
   - For UI-facing changes, include a demo section in the PR body.
   - Preferred assets: short video/GIF, or before/after screenshots.
   - If no demo is available, ask for one before opening the PR.

6. **Open PR with gh**
   - Write the final body to a file and open with:
     - `gh pr create --title "..." --body-file /path/to/body.md`
   - Add `--draft` only when explicitly requested.

## Voice and Tone

Use Luan's style from `../voice-and-tone/SKILL.md`:
- direct and conversational
- technically precise
- no AI-polished fluff

## Quality Bar

Before submitting, verify:
- Template followed (if repo has one)
- Problem and behavior change are clear
- No redundant diff/test narration
- UI demo included for UI changes
- Content is concise and sounds like Luan
