---
name: vernier-test-profiling
description: Profile slow Rails tests in github/github with Vernier. Use when a user asks "why is this test suite slow", "what tests are the slowest", "profile this test", "optimize test performance", or requests runtime reductions for a test file/class. Covers suite and per-test profiling (`VERNIER=suite`, `VERNIER=1`), profile inspection, and turning hotspots into concrete optimizations.
---

# Vernier Test Profiling

Profile slow tests in the GitHub monolith (`github/github`) using Vernier to find where time is spent.

## Quick reference

```bash
# Profile one test class as a single trace (suite mode)
VERNIER=suite bin/rails test path/to/test_file.rb

# Profile each test method separately (per-test mode)
VERNIER=1 bin/rails test path/to/test_file.rb

# Optional: reduce noise from domain table validator
SKIP_DOMAIN_TABLE_VALIDATOR=1 VERNIER=suite bin/rails test path/to/test_file.rb

# View top functions in a profile
vernier view --top 30 tmp/vernier/<profile>.vernier.json
```

## Output locations

- **Local:** `tmp/vernier/*.vernier.json`
- **CI builds:** `/tmp/<GH_CI_RUNTIME>-artifacts/*.vernier.json`
- **Per-test mode filenames:** include the test line suffix (e.g. `...-_L123.vernier.json`)

## When to use

Use this skill when the user asks to:

- understand why a specific test file/class is slow
- identify the slowest test methods in a suite
- optimize test runtime by a target percentage
- investigate timeout-like test behavior caused by expensive setup or queries

## Recommended workflow

### 1) Capture a baseline runtime (no profiler)

Always measure baseline first so improvements are real (profiling adds overhead):

```bash
time bin/rails test path/to/test_file.rb
```

### 2) Run suite profile (`VERNIER=suite`)

Use this first for a high-level picture of where the class spends time.

```bash
VERNIER=suite bin/rails test path/to/test_file.rb
```

### 3) Run per-test profile (`VERNIER=1`)

Use this next to isolate the slowest individual tests.

```bash
VERNIER=1 bin/rails test path/to/test_file.rb
```

### 4) Inspect profiles

```bash
# Most recent profile files
ls -1t tmp/vernier/*.vernier.json | head -20

# CLI summary (self-time hotspots)
vernier view --top 30 tmp/vernier/<profile>.vernier.json
```

For deeper analysis, upload profiles to https://vernier.prof and inspect:
- **Flame Graph** (where total time accumulates)
- **Stack Chart** (time order)
- **Marker Chart** (SQL, GC, Rails events)

### 5) Translate hotspots into fixes

Prioritize the biggest contributors first. Typical patterns:

| Signal in profile | Common fix |
|---|---|
| Heavy FactoryBot markers / many object allocations | Create fewer records, only required associations, reduce per-test setup |
| High SQL time / many similar queries | Reduce unnecessary data setup, preload associations, avoid repeated queries |
| Large GC pauses | Cut allocations in setup/helpers, reuse objects where safe |
| One or two tests dominate runtime | Narrow expensive setup to only those tests |

### 6) Verify real improvement

Re-run without Vernier and compare to baseline:

```bash
time bin/rails test path/to/test_file.rb
```

If the user requested a target (e.g. 10%), report before/after timings and percentage change.

## Environment parity with CI

When a failure/slowdown is specific to a CI runtime, combine the same env flags with Vernier:

```bash
# Enterprise
ENTERPRISE=1 VERNIER=suite bin/rails test path/to/test_file.rb

# All features
TEST_ALL_FEATURES=1 VERNIER=suite bin/rails test path/to/test_file.rb

# Multi-tenant / EMU
MULTI_TENANT_ENTERPRISE=1 VERNIER=suite bin/rails test path/to/test_file.rb
TEST_WITH_ALL_EMUS=1 VERNIER=suite bin/rails test path/to/test_file.rb
```

## Reporting format

When summarizing findings, include:

1. baseline runtime (no profiler)
2. top hotspots from suite profile
3. slowest individual tests from per-test profile
4. concrete fix recommendations (ordered by expected impact)
5. after-fix runtime and percent improvement

## Guardrails

- Do **not** use profiled runs as absolute performance numbers.
- Do **not** commit `.vernier.json` files.
- Prefer small, test-only changes first (setup/data/query reductions) before broader refactors.
