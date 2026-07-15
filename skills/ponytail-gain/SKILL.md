---
name: ponytail-gain
description: >
  Show ponytail's measured impact as a compact scoreboard: less code, less
  cost, more speed, from the benchmark medians. One-shot display, not a
  persistent mode, and not a per-repo number. Trigger: /ponytail-gain,
  "ponytail gain", "what does ponytail save", "show ponytail impact", or
  "ponytail scoreboard".
license: MIT
metadata:
  source: "https://github.com/DietrichGebert/ponytail/tree/14a0d79548d4de8fc2de95c1b94bb0de63a739d3/skills/ponytail-gain"
  upstream-commit: "14a0d79548d4de8fc2de95c1b94bb0de63a739d3"
  local-note: "Copied manually into dotfiles; plugin/command harness files intentionally omitted."
---

# Ponytail Gain

Display this scoreboard when invoked. One-shot: do NOT change mode, write flag
files, or persist anything.

The figures are the published benchmark medians (5 everyday tasks: email
validator, debounce, CSV sum, countdown timer, rate limiter; three models:
Haiku, Sonnet, Opus). They are measured, not computed from the current repo.
Source: upstream `benchmarks/` and README.

## Scoreboard

Render plain ASCII bars. The bar length shows the measured range; the label
carries the exact figure:

```text
  ponytail gain                     benchmark median · 5 tasks · 3 models

  Lines of code   no-skill  ████████████████████  100%
                  ponytail  ██▌·················    6–20%   ▼ 80–94%
  Cost            no-skill  ████████████████████  100%
                  ponytail  █████▌··············   23–53%  ▼ 47–77%
  Speed           ponytail  ▸ 3–6× faster

  This repo:  /ponytail-debt  (shortcuts you deferred)
              /ponytail-audit (what's still cuttable)
```

## Honesty boundary

These are benchmark medians, not this repo. NEVER print a per-repo savings
number ("you saved X lines/tokens here"): the unbuilt version was never
written, so there is no real baseline to subtract from in a live repo. The
only real per-repo figures come from ponytail-debt (a counted ledger), and this
card points there instead of inventing one.

## Boundaries

One-shot display. Edits nothing, changes no mode. `stop ponytail` or
`normal mode`: revert.

## Source

Adapted from Dietrich Gebert's MIT-licensed Ponytail project:
`DietrichGebert/ponytail` → `skills/ponytail-gain/SKILL.md` at commit
`14a0d79548d4de8fc2de95c1b94bb0de63a739d3`. License text is included in
`../ponytail/LICENSE`. Compare/update with:

```bash
gh api repos/DietrichGebert/ponytail/contents/skills/ponytail-gain/SKILL.md --jq .content | base64 --decode
```
