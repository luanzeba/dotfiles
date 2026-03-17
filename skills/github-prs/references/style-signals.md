# Style Signals for PR Bodies

Reference PRs:
- https://github.com/rails/rails/pull/45126
- https://github.com/rails/rails/pull/48131
- https://github.com/rails/rails/pull/45243
- https://github.com/rails/rails/pull/48295
- https://github.com/rails/rails/pull/47877
- https://github.com/cli/cli/pull/6944

## Patterns to emulate

- Lead with context and motivation, not a change log.
- Explain the failure mode or user impact in plain language.
- Include a minimal reproduction or before/after output only when it materially helps reviewers.
- Call out tradeoffs or constraints briefly when they affect review decisions.
- Link issues directly (`Fixes #123`) when relevant.

## Patterns to avoid

- "Changed A, changed B, changed C" file-by-file summaries.
- Boilerplate "tests/lints run" sections with no special insight.
- Repeating what reviewers can already see in the Files Changed tab.
- Inflated prose that hides the concrete behavior change.

## UI PR demo guidance

When UI changes are present, include one of:
- short GIF/video
- before/after screenshots
- for CLI output changes, before/after command output blocks

Keep demo captions short and focused on what changed.
