---
name: merge-conflict-resolver
description: >
  Resolve git merge conflicts intelligently by understanding the intent behind conflicting changes.
  Use when (1) the user asks to fix, resolve, or handle merge conflicts, (2) a git merge or rebase
  produced conflicts, (3) the user asks to update their branch from main/master and conflicts arise,
  (4) the user mentions conflict markers in files. Requires git and gh CLI.
---

# Merge Conflict Resolver

Resolve merge conflicts by researching the intent behind each conflicting change via git history and GitHub PRs, then applying the appropriate resolution strategy.

## Workflow

1. **Fetch and merge the default branch** to trigger conflicts
2. **Gather conflict context** using the bundled script
3. **Research intent** of each conflicting change via PR descriptions
4. **Resolve each file** using the appropriate strategy
5. **Verify and finalize** the merge

## Step 1: Fetch and Merge

Detect the default branch and merge it into the current branch:

```bash
# Fetch latest
git fetch origin

# Detect default branch
DEFAULT_BRANCH=$(git remote show origin | grep 'HEAD branch' | awk '{print $NF}')

# Merge (this will produce conflicts)
git merge "origin/$DEFAULT_BRANCH" || true
```

If already in a conflict state (user ran merge/rebase themselves), skip this step.

## Step 2: Gather Conflict Context

Run the bundled script to identify conflicting files and look up associated PRs:

```bash
bash ~/.pi/agent/skills/merge-conflict-resolver/scripts/gather_conflict_context.sh
```

This outputs:

- List of conflicting files
- Remote commits that modified each file since the merge base
- Associated PR numbers, titles, URLs, and **full PR bodies** (fetched once per unique PR)

The PR bodies often contain motivation, design decisions, and context that are critical for understanding the intent behind conflicting changes.

If the script is unavailable, gather context manually:

```bash
# List conflicting files
git diff --name-only --diff-filter=U

# For each file, find remote commits
MERGE_BASE=$(git merge-base HEAD origin/main)
git log --oneline "$MERGE_BASE"..origin/main -- <file>

# Look up PR for a commit
gh api "repos/{owner}/{repo}/commits/<sha>/pulls" --jq '.[0] | "PR #\(.number): \(.title)"'

# Fetch the PR body for additional context on motivation
gh pr view <pr_number> --json title,body --jq '"Title: \(.title)\nBody: \(.body)"'
```

## Step 3: Research Intent

PR titles and bodies are already collected in Step 2. Use them to understand WHY each remote change was made:

1. Review the PR titles and bodies from Step 2 output — these usually explain the motivation and design decisions
2. If the PR body is insufficient, fetch additional context (e.g., linked issues, review comments, or changed files):
   ```bash
   gh pr view <pr_number> --json title,body,files,comments
   ```
3. Read the conflicting sections in the file to understand both sides

Summarize for each conflict:

- **Local intent**: what your branch was trying to accomplish
- **Remote intent**: what the merged PR was trying to accomplish

## Step 4: Resolve Each File

Apply the appropriate strategy per file. See [references/strategies.md](references/strategies.md) for detailed guidance.

### Decision Tree

```
Is this a lock file or auto-generated file?
  YES → Accept local version, regenerate (see strategies.md "Special File Strategies")
  NO  ↓

Did only one side make a meaningful change? (other side is whitespace/formatting)
  YES → Keep the meaningful change
  NO  ↓

Are the changes in different logical sections that happen to overlap?
  YES → Keep both changes, arrange logically
  NO  ↓

Do the changes conflict in intent?
  YES → Favor the change aligned with the current branch's purpose,
        but preserve any bug fixes or API updates from remote
  NO  → Merge both changes manually, combining the intent of each
```

### Resolving a file

1. Read the file to see all conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
2. For each conflict block, apply the decision tree above
3. Edit the file to remove ALL conflict markers and produce clean code
4. Stage the resolved file: `git add <file>`

### Verification after resolving

After resolving all files:

```bash
# Confirm no remaining conflict markers
git diff --check

# Verify no unresolved files remain
git diff --name-only --diff-filter=U

# If the project has a build/lint step, run it
# e.g., bin/rubocop <files>, npx tsc --noEmit, etc.
```

## Step 5: Finalize

Once all conflicts are resolved and verified:

```bash
git commit --no-edit  # Uses the default merge commit message
```

Do NOT use `--no-verify` — let pre-commit hooks run to catch issues.

## Key Principles

- **Understand before resolving**: Never blindly pick a side. Always research the PR/commit intent first.
- **Prefer correctness over convenience**: If unsure, keep both changes and manually integrate rather than discarding one side.
- **Regenerate over merging** for generated files (lockfiles, schemas, compiled output).
- **Preserve bug fixes**: If the remote change was a bug fix, make sure the fix is preserved in the resolution.
- **Test after resolving**: Run relevant tests or linting to verify the resolution doesn't break anything.
