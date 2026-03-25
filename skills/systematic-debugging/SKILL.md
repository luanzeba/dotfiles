---
name: systematic-debugging
description: Root-cause-first debugging workflow for bugs, failing tests, flaky behavior, CI breakages, install script failures, and production incidents. Use before proposing fixes to enforce evidence gathering, data-flow tracing, minimal hypothesis testing, and verification.
---

# Systematic Debugging

Use this skill whenever behavior is wrong and you are about to debug. Do not propose fixes until Phase 1 is complete.

## Non-negotiable rule

`NO FIXES BEFORE ROOT-CAUSE INVESTIGATION`

If you catch yourself guessing, stop and return to Phase 1.

## Four-phase workflow

### Phase 1 — Root cause investigation

1. Read complete error output (message, stack trace, failing assertion, file/line).
2. Reproduce the issue consistently.
3. Check recent changes (`git diff`, recent commits, config/env changes).
4. Instrument boundaries in multi-component flows (workflow → script → service → DB).
5. Trace bad data backward to its origin (see `references/root-cause-tracing.md`).

**Exit criteria:** You can explain what fails, where it starts, and why.

### Phase 2 — Pattern analysis

1. Find a similar working implementation in the same repository.
2. Compare broken vs working behavior line-by-line.
3. List assumptions and dependencies (flags, env vars, ordering, fixtures, timing).

**Exit criteria:** You can name the concrete difference likely causing failure.

### Phase 3 — Hypothesis + minimal experiment

1. State one explicit hypothesis: “X fails because Y”.
2. Run the smallest experiment that can disprove/confirm it.
3. Change one variable at a time.
4. If it fails, capture evidence and form a new hypothesis.
5. After 3 failed fix attempts, stop and question architecture/design instead of stacking guesses.

**Exit criteria:** A hypothesis is validated with evidence.

### Phase 4 — Implement + verify

1. Create a failing repro/test first.
2. Implement one fix aimed at root cause.
3. Verify with targeted tests, then broader regression checks.
4. Add layered safeguards where appropriate (see `references/defense-in-depth.md`).
5. Replace arbitrary sleeps with condition-based waits for async/flaky issues (see `references/condition-based-waiting.md`).

**Exit criteria:** Repro passes, related checks pass, and no regressions are introduced.

## Dotfiles + Pi integration

- Use `github-ci-fixer` to collect CI logs and reproduction commands, then apply this skill for diagnosis.
- For GitHub investigation, always use `gh` CLI.
- For dotfiles install/debugging, inspect `~/dotfiles_install.log` and rerun exact install steps.
- For long-running repro commands in Pi, use the bash tool `timeout` parameter and clean up lingering processes.
- Use `scripts/find-polluter.sh` when tests leak files/shared state and the polluting test is unknown.
- Use `evidence-based-responses` when writing final root-cause summaries in PR comments/reviews.

## Debug summary checklist

Before finalizing, provide:
- Symptom
- Root cause
- Evidence (logs/tests/commands)
- Fix
- Verification steps/results
- Follow-up hardening (if any)

## Resources

- `references/root-cause-tracing.md`
- `references/defense-in-depth.md`
- `references/condition-based-waiting.md`
- `scripts/find-polluter.sh`
