---
name: github-ci-fixer
description: Triage and fix GitHub CI failures using gh CLI. Use when PR checks fail, workflows break, or CI-only failures need local reproduction. Focuses on run/log collection and repro setup; pair with systematic-debugging for root-cause analysis.
---

# GitHub CI Fixer

Scope:
1. Collect CI failure evidence from GitHub Actions.
2. Reproduce the failure locally in the closest matching environment.
3. Verify and re-run checks after the fix.

For deep diagnosis and fix strategy, use `systematic-debugging` after reproduction is ready.

## Workflow

### Step 1: Get PR status and failing runs

```bash
# Check statuses on the PR
gh pr checks <PR_NUMBER> --repo github/github

# List recent runs for the branch
gh run list --branch <BRANCH_NAME> --repo github/github --limit 10

# Inspect one run summary
gh run view <RUN_ID> --repo github/github
```

### Step 2: Pull failed job logs

```bash
# Failed jobs only
gh run view <RUN_ID> --repo github/github --log-failed

# Specific job logs
gh run view <RUN_ID> --repo github/github --job <JOB_ID> --log
```

### Step 3: Classify failure type

| Log Pattern | Failure Type | Local Repro |
|------------|--------------|-------------|
| `Failure:` / `Error:` / assertion diff | Test failure | Step 4a |
| `rubocop` / `Style/` | Linting | Step 4b |
| `srb tc` / Sorbet errors | Type checking | Step 4c |
| Timeout / stuck output | Flake/race/perf | Step 4a + flake loop |
| `LoadError` / `NameError` | Missing dependency/require | Step 4a + inspect requires |

### Step 4a: Reproduce tests locally

Find the CI runtime in job logs (`GH_CI_RUNTIME`) and match it locally.

```bash
# File
bin/rails test <path/to/test_file.rb>

# Specific test line (never use -n)
bin/rails test <path/to/test_file.rb>:<LINE_NUMBER>

# Changed files only
bin/rails test:changes
```

#### Environment mapping

| CI Job Pattern | Local Env |
|---------------|-----------|
| `github-enterprise*` | `ENTERPRISE=1` |
| `*multi-tenant*` | `MULTI_TENANT_ENTERPRISE=1` |
| `github-all-features*` | `TEST_ALL_FEATURES=1` |
| `*emu*` | `TEST_WITH_ALL_EMUS=1` |

Examples:

```bash
ENTERPRISE=1 bin/rails test <test_file>
TEST_ALL_FEATURES=1 bin/rails test <test_file>
```

### Step 4b: Reproduce/fix lint failures

```bash
bin/rubocop --autocorrect <file.rb>
bin/erb_lint <file.erb> --autocorrect
```

### Step 4c: Reproduce/fix type failures

```bash
bin/srb tc <file.rb>
bin/tapioca dsl
```

### Step 5: Diagnose with systematic-debugging

Once local repro works, apply `systematic-debugging`:
- root-cause investigation first
- one hypothesis at a time
- one fix at a time
- verify targeted + regression checks

For flaky tests, run repeated repro loops and isolate timing/state leaks before changing production code.

### Step 6: Verify before pushing

```bash
# Re-run failing tests
bin/rails test <test_file.rb>

# Lint/type checks for touched files
bin/rubocop <changed_files>
bin/srb tc <changed_files>
```

Then confirm CI status remotely:

```bash
gh pr checks <PR_NUMBER> --repo github/github
```

## Critical rules

1. Reproduce locally before proposing fixes.
2. Do not remove failing tests just to get green CI.
3. If first fix fails, return to root-cause analysis (don’t stack random fixes).
4. Keep the final fix minimal and tied to observed evidence.
