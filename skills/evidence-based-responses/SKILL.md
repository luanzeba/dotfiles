---
name: evidence-based-responses
description: Verify technical claims in code reviews and answer reviewer comments on GitHub PRs and GitLab MRs. Use when reviewing diffs, deciding whether a review finding is real, responding to reviewers, or explaining a concern with evidence.
---

# Evidence-Based Review

Verify the concern before writing about it. A wrong comment costs the author more than no comment.

## Verify first

1. Read the full implementation, its callers, and its tests. Don't review the patch in isolation.
2. Check every claim with the strongest cheap evidence: the code itself for repository behavior, a focused test or one-off probe for edge cases, official docs for language or framework rules, and measurements for performance or accessibility.
3. Check alternate code paths and sibling callers that might share the same problem.
4. Check that it can happen in the system as it runs today: who calls this in production, what the real data looks like, what's deployed. Query the data when you can (database, external API, logs, exports in the repo). What an MR description, code comment, or seed data says about another system is a claim to check, not evidence.
5. Keep a finding only if it's high impact: something users or operations will realistically hit, a decision that's hard to undo, or a simplification that makes a big difference. Put everything else in your summary to the user, not in the review.
6. If you can't confirm it, ask a focused question instead of asserting it, or skip it.

The wording and shape of a review comment come from `write_for_publication`. Pass it the point and the facts it needs, not your whole investigation, plus pinned links. Say whether it's a bug, a simplification, or a design concern, and whether it's light (a local fix that's obvious once seen), medium (the author has to follow one scenario), or heavy (a concept, redesign, or multi-step scenario). Without that tool, follow `../voice-and-tone/SKILL.md`.

## Links and suggestions

Pin source links to a commit SHA so they stay valid:

```text
https://github.com/org/repo/blob/<sha>/path/to/file.ts#L10-L20
https://gitlab.example.com/group/project/-/blob/<sha>/path/to/file.ts#L10-20
```

Use a `suggestion` fence only for an exact replacement at the commented lines. Approximate or multi-file code goes in a normal language-tagged fence, because a suggestion can be applied as-is.

## Responding to review comments

Figure out what the reviewer is actually asking, research it, then answer that question directly. If they found a real issue, say what changed and link the commit. If the concern is a misunderstanding, clear it up with code, docs, or test output instead of dismissing it. Don't answer a specific question with a generic summary of the implementation.
