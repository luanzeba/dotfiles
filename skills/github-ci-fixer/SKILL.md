---
name: github-ci-fixer
description: Diagnose and fix CI failures on GitHub PRs using the gh CLI. Use when CI checks fail, tests are failing in CI, builds break, linting errors occur, or when asked to investigate PR status. Handles workflow runs, job logs, reproducing failures locally, and making fixes.
---

# GitHub CI Fixer

Fix CI failures by: fetching status → reading logs → reproducing locally → diagnosing → fixing.

## Workflow

### Step 1: Get PR CI Status

```bash
# Get PR checks status
gh pr checks <PR_NUMBER> --repo github/github

# Get detailed workflow runs for PR
gh run list --branch <BRANCH_NAME> --repo github/github --limit 5

# View specific run details
gh run view <RUN_ID> --repo github/github
```

### Step 2: Get Failure Logs

```bash
# View failed job logs
gh run view <RUN_ID> --repo github/github --log-failed

# Get specific job logs (if multiple jobs)
gh run view <RUN_ID> --repo github/github --job <JOB_ID> --log
```

### Step 3: Identify Failure Type

| Log Pattern | Failure Type | Next Step |
|------------|--------------|-----------|
| `Failure:` or `Error:` in test output | Test failure | Step 4a |
| `rubocop` or `Style/` | Linting error | Step 4b |
| `srb tc` or `T.let` errors | Sorbet type error | Step 4c |
| `LoadError` or `NameError` | Missing require/dependency | Check imports |
| Timeout | Slow test or infinite loop | Check test setup |

### Step 4a: Reproduce Test Failures Locally

First, identify the CI environment from the failed job name or logs. Look for `GH_CI_RUNTIME` in the logs — it shows the build pipeline name (e.g., `github-all-features`, `github-enterprise`).

```bash
# Run specific test file
bin/rails test <path/to/test_file.rb>

# Run specific test by line number (NEVER use -n flag)
bin/rails test <path/to/test_file.rb>:<LINE_NUMBER>

# Run tests for changed files
bin/rails test:changes
```

#### Running in Specific Environments

Match the CI environment when reproducing failures locally:

```bash
# Run in Enterprise mode (for github-enterprise builds)
ENTERPRISE=1 bin/rails test <path/to/test_file.rb>

# Run in multi-tenancy/EMU mode (for multi-tenant builds)
MULTI_TENANT_ENTERPRISE=1 bin/rails test <path/to/test_file.rb>

# Run with all features enabled (for github-all-features builds)
TEST_ALL_FEATURES=1 bin/rails test <path/to/test_file.rb>

# Run with all EMU configurations
TEST_WITH_ALL_EMUS=1 bin/rails test <path/to/test_file.rb>
```

#### Environment Variable Reference

| CI Job Pattern | Environment Variable | Description |
|---------------|---------------------|-------------|
| `github-enterprise*` | `ENTERPRISE=1` | Enterprise mode |
| `*multi-tenant*` | `MULTI_TENANT_ENTERPRISE=1` | Multi-tenancy/EMU mode |
| `github-all-features*` | `TEST_ALL_FEATURES=1` | All features enabled |
| `*emu*` | `TEST_WITH_ALL_EMUS=1` | All EMU configurations |

For additional environment variables, see [test/test_helpers/test_env.rb](https://github.com/github/github/blob/master/test/test_helpers/test_env.rb).

### Step 4b: Fix Linting Errors

```bash
# Auto-fix rubocop issues
bin/rubocop --autocorrect <file.rb>

# Check ERB linting
bin/erb_lint <file.erb> --autocorrect
```

### Step 4c: Fix Type Errors

```bash
# Check specific file
bin/srb tc <file.rb>

# Regenerate RBIs if needed
bin/tapioca dsl
```

### Step 5: Diagnose and Fix

**For test failures:**
1. Read the failing test to understand expected behavior
2. Read the source code being tested
3. Determine if test or source is wrong
4. **NEVER delete a test just because it fails** — fix the code or update the test appropriately

**For flaky tests:**
1. Look for timing issues, race conditions, or state leakage
2. Check for missing `setup`/`teardown` cleanup
3. Use `gauntlet` to reproduce flakiness by running the test many times with database shuffling:

```ruby
# In your test file - wrap the flaky test with gauntlet
# This creates 100 copies of the test with shuffled DB results
gauntlet "my potentially flaky test", loops: 100 do
  # your test code here
end
```

Gauntlet options:
- `loops:` — number of times to run (default: 100)
- `timeshift:` — seconds to shift time between each loop (default: nil)
- `shuffle_database_results:` — randomize DB query order to surface flakiness (default: true)
- `debug_output:` — print DatabaseShuffler debug info (default: false)

**Note:** Remove gauntlet wrappers before merging — they're for local debugging only.

### Step 6: Verify Fix

```bash
# Run the specific failing tests
bin/rails test <test_file.rb>

# Run linting
bin/rubocop <changed_files>

# Run type checking
bin/srb tc <changed_files>
```

## Common CI Jobs

| Job Name | What It Checks |
|----------|---------------|
| `test-*` | Unit/integration tests |
| `rubocop` | Ruby style/linting |
| `sorbet` | Type checking |
| `erb_lint` | ERB template linting |
| `packwerk` | Package boundary violations |

## Critical Rules

1. **Never remove tests** that fail — propose removal with clear justification for approval
2. **Always reproduce locally** before attempting fixes
3. **Run the exact failing test** to confirm the fix works
4. **Check if failure is flaky** — may need multiple runs to reproduce
