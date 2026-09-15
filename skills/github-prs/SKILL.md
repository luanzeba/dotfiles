---
name: github-prs
description: Draft and open GitHub pull requests and GitLab merge requests with concise, high-signal descriptions in Luan's voice. Use when writing PR or MR titles and bodies, opening them with gh or glab, following repository templates, explaining foundation or opt-in changes, avoiding redundant change/test summaries, and including useful demos.
---

# Pull and Merge Requests

Write PR descriptions that explain **why the change matters** and **what behavior changed**. Do not narrate the entire diff.

## Default Workflow

1. **Confirm context**
   - What problem are we solving?
   - What is the behavioral change?
   - Is there a linked issue (`Fixes #...`)?
   - Does this include UI/UX changes?

2. **Find and follow the repository template (required when present)**
   - For GitHub, check:
     - `.github/pull_request_template.md`
     - `.github/PULL_REQUEST_TEMPLATE.md`
     - `.github/PULL_REQUEST_TEMPLATE/*.md`
     - `docs/pull_request_template.md`
     - `docs/PULL_REQUEST_TEMPLATE.md`
   - For GitLab, check `.gitlab/merge_request_templates/*.md`.
   - If not found locally, check the remote with the matching CLI (`gh` or `glab`).
   - If multiple templates exist, ask which one to use.
   - Keep the template structure; remove placeholder comments/text and empty sections.

3. **Draft a concise body**
   - Focus on:
     - motivation/context
     - key behavior change(s)
     - important tradeoffs/limitations (only if relevant)
     - links to issue/PRs/docs when useful
   - For shared foundations, feature flags, or opt-in capabilities with no enabled consumer, read `references/foundation-change-example.md`. State the before behavior, show the new path visually, include the activation switch, and say explicitly what is still unavailable and why.
   - Use `references/style-signals.md` for examples of tone and structure.

4. **Apply anti-redundancy rules**
   - Do **not** include file-by-file or exhaustive change lists.
   - Do **not** include generic "tests run" / "linters run" sections by default.
   - Mention verification only when it adds unique signal (manual flow, benchmark, repro script, or notable constraint).

5. **Use an honest demo**
   - For UI-facing changes, include a short video/GIF or before/after screenshots.
   - For behavior changes, prefer a real before/after request, command, or output.
   - Do not present pre-existing behavior or a test run as the feature demo. If no real consumer is enabled, say that plainly and demonstrate the activation boundary instead.

6. **Open with the matching CLI**
   - Write the final body to a file.
   - GitHub: `gh pr create --title "..." --body-file /path/to/body.md`
   - GitLab: `glab mr create --title "..." --description "$(cat /path/to/body.md)"`
   - Add `--draft` only when explicitly requested.

## Voice and Tone

Use Luan's style from `../voice-and-tone/SKILL.md`:
- direct and conversational
- technically precise
- no AI-polished fluff

## Quality Bar

Before submitting, verify:
- Template followed (if repo has one)
- Problem and behavior change are clear to someone unfamiliar with the implementation
- Foundation capability and consumer activation are not conflated
- Current behavior, new behavior, and deferred behavior are explicit when relevant
- No redundant diff/test narration
- Demo shows the changed behavior rather than a pre-existing endpoint
- Content is concise and sounds like Luan
