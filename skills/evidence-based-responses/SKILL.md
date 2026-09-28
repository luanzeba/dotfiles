---
name: evidence-based-responses
description: Draft, revise, and respond to human code-review comments on GitHub PRs and GitLab MRs. Use when reviewing diffs, leaving inline feedback, explaining a concern, responding to reviewers, or revising comments for clarity. Verifies technical claims and writes plain-language comments with concrete code or pseudocode when suggesting a change.
---

# Evidence-Based Review Communication

Verify the concern first, then explain it in language the author can act on. Evidence prevents incorrect comments; clear writing prevents correct comments from becoming useless.

## Review workflow

1. Understand the code and the behavior being changed. Read the full implementation, relevant callers, and tests rather than reviewing the patch in isolation.
2. Verify each technical claim with code, documentation, a focused experiment, or test output.
3. Draft one comment per main concern.
4. Run a clarity pass: remove unexplained jargon, state the current problem first, and include the expected code shape when asking for a change.

## Writing an actionable review comment

A useful comment normally answers four questions:

1. What does the current code do that seems wrong, confusing, or fragile?
2. Why does that matter in this change?
3. What would you change instead?
4. Roughly what should the result look like?

This is a checklist, not a mandatory four-paragraph template. A simple issue may only need two sentences. A less familiar design or architecture concern may need several paragraphs.

When recommending a code change, include one of:

- An exact suggestion block when the replacement can be applied directly
- A shortened code sample when surrounding code can be omitted
- Pseudocode when the change spans files or the exact implementation needs author input

Say when a sample is approximate. Do not present pseudocode as a drop-in replacement.

## Clarity rules

- Concise means no filler, not minimal explanation. Write enough that the author should not need to ask what the comment means.
- Start with the concrete behavior or code. Do not lead with labels such as “semantic,” “tone,” “shared API,” or “second cue.”
- If a technical term helps, explain the concrete idea first and name the term afterward if it is still useful.
- When a comment depends on a distant component, route, API, or contract, state its relationship to this hunk. Do not assume the author followed the investigation that found it.
- Make suggestions specific. “Add another cue” is unclear; “keep the colors and use an exclamation mark inside Faulted pins” is actionable.
- Prefer one recommended path over several vague alternatives. Mention alternatives only when the choice genuinely depends on information the reviewer does not have.
- Explain what is wrong now. Do not make hypothetical future work the main reason for changing the current code.
- Keep one main concern per comment. Split unrelated accessibility, correctness, and maintainability issues.
- Avoid drive-by comments such as “this is wrong,” “nit,” or “could be cleaner” without explaining why and what better looks like.
- If uncertain, ask a focused question rather than turning an assumption into a finding.
- Do not narrate the investigation (for example, “I dug into…”). Keep the needed causal link in the comment itself, and use a direct source link when it helps the author evaluate that link.

See [references/review-comment-examples.md](references/review-comment-examples.md) for before-and-after examples.

## Evidence in comments

Validate every technical claim before writing it. Include the evidence the author needs to evaluate the concern, but do not turn every comment into a bibliography when the nearby diff already demonstrates the behavior.

Use:

- A code reference for repository behavior
- A focused test or experiment for edge cases
- Official documentation for language or framework rules
- Concrete measurements for accessibility or performance claims

When evidence is incomplete, say so plainly and frame the comment as a question.

See [references/validation-techniques.md](references/validation-techniques.md) for research methods.

## Responding to review comments

First understand what the reviewer is actually asking. Research the claim, gather evidence, then answer that question directly.

Acknowledge valid feedback without filler. If the reviewer found a real issue, explain the change. If the concern comes from a misunderstanding, clarify it with code, docs, or test results rather than dismissing it.

Do not answer a specific question with a generic summary of the implementation. Link to the relevant change or test when useful.

See [references/response-examples.md](references/response-examples.md) for response examples.

## Stable links and suggestions

Use commit SHAs in source links so references remain stable.

GitHub:

```text
https://github.com/org/repo/blob/<sha>/path/to/file.rb#L10-L20
```

GitLab:

```text
https://gitlab.example.com/group/project/-/blob/<sha>/path/to/file.rb#L10-20
```

Both platforms support suggestion fences for directly applicable replacements:

````markdown
```suggestion
the corrected code here
```
````

Use a normal language-tagged code fence instead when the sample is approximate or spans multiple locations.

## Style

Write conversational prose. Be friendly and direct, assume good intent, and avoid corporate hedging.

Do not over-format a simple point, but do not compress a nuanced concern until it becomes cryptic. Stop when the issue, impact, and expected change are clear.

Avoid em dashes. Use commas, parentheses, or separate sentences.
