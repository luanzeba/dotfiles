#!/usr/bin/env bash
# Gathers context about merge conflicts: lists conflicting files,
# finds the commits that introduced the remote-side changes, and
# looks up their associated PRs via the GitHub CLI.
#
# Usage: bash gather_conflict_context.sh [remote_branch]
# Default remote_branch: origin/main or origin/master (auto-detected)
#
# Requires: git, gh (GitHub CLI, authenticated)
# Output: structured text to stdout

set -euo pipefail

REMOTE_BRANCH="${1:-}"

# Auto-detect default branch if not provided
if [[ -z "$REMOTE_BRANCH" ]]; then
  DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
  if [[ -z "$DEFAULT_BRANCH" ]]; then
    # Fallback: check if origin/main or origin/master exists
    if git rev-parse --verify origin/main &>/dev/null; then
      DEFAULT_BRANCH="main"
    elif git rev-parse --verify origin/master &>/dev/null; then
      DEFAULT_BRANCH="master"
    else
      echo "ERROR: Could not detect default branch. Pass it as an argument." >&2
      exit 1
    fi
  fi
  REMOTE_BRANCH="origin/$DEFAULT_BRANCH"
fi

echo "=== MERGE CONFLICT CONTEXT ==="
echo "Remote branch: $REMOTE_BRANCH"
echo "Local branch: $(git branch --show-current)"
echo ""

# Get list of conflicting files
CONFLICT_FILES=$(git diff --name-only --diff-filter=U 2>/dev/null || true)

if [[ -z "$CONFLICT_FILES" ]]; then
  echo "No conflicting files detected."
  echo "Make sure you are in a merge/rebase state with unresolved conflicts."
  exit 0
fi

echo "=== CONFLICTING FILES ==="
echo "$CONFLICT_FILES"
echo ""

# For each conflicting file, find the remote commits that touch it
MERGE_BASE=$(git merge-base HEAD "$REMOTE_BRANCH" 2>/dev/null || echo "")

while IFS= read -r file; do
  echo "--- FILE: $file ---"

  if [[ -n "$MERGE_BASE" ]]; then
    # Get commits on the remote side that modified this file since the merge base
    COMMITS=$(git log --oneline "$MERGE_BASE".."$REMOTE_BRANCH" -- "$file" 2>/dev/null || true)

    if [[ -n "$COMMITS" ]]; then
      echo "Remote commits modifying this file:"
      echo "$COMMITS"
      echo ""

      # Collect unique PR numbers to avoid fetching the same PR body multiple times
      declare -A SEEN_PRS

      # Look up PRs for each commit SHA
      while IFS= read -r commit_line; do
        SHA=$(echo "$commit_line" | awk '{print $1}')
        PR_NUMBER=""
        PR_TITLE=""
        PR_URL=""

        # Use gh to find associated PR
        PR_INFO=$(gh pr list --search "$SHA" --state merged --json number,title,url --limit 1 2>/dev/null || true)
        if [[ -n "$PR_INFO" && "$PR_INFO" != "[]" ]]; then
          PR_NUMBER=$(echo "$PR_INFO" | gh api --input - --jq '.[0].number' 2>/dev/null || true)
          PR_TITLE=$(echo "$PR_INFO" | gh api --input - --jq '.[0].title' 2>/dev/null || true)
          PR_URL=$(echo "$PR_INFO" | gh api --input - --jq '.[0].url' 2>/dev/null || true)
        fi

        # Fallback: try the commit-based approach
        if [[ -z "$PR_NUMBER" ]]; then
          PR_NUMBER=$(gh api "repos/{owner}/{repo}/commits/$SHA/pulls" --jq '.[0].number' 2>/dev/null || true)
          PR_TITLE=$(gh api "repos/{owner}/{repo}/commits/$SHA/pulls" --jq '.[0].title' 2>/dev/null || true)
          PR_URL=$(gh api "repos/{owner}/{repo}/commits/$SHA/pulls" --jq '.[0].html_url' 2>/dev/null || true)
        fi

        if [[ -n "$PR_NUMBER" ]]; then
          echo "  Commit $SHA -> PR #$PR_NUMBER: $PR_TITLE ($PR_URL)"

          # Fetch and display the PR body once per unique PR
          if [[ -z "${SEEN_PRS[$PR_NUMBER]:-}" ]]; then
            SEEN_PRS[$PR_NUMBER]=1
            echo ""
            echo "  === PR #$PR_NUMBER DETAILS ==="
            echo "  Title: $PR_TITLE"
            PR_BODY=$(gh pr view "$PR_NUMBER" --json body --jq '.body' 2>/dev/null || true)
            if [[ -n "$PR_BODY" ]]; then
              echo "  Body:"
              echo "$PR_BODY" | sed 's/^/    /'
            else
              echo "  Body: (empty)"
            fi
            echo "  === END PR #$PR_NUMBER ==="
            echo ""
          fi
        else
          echo "  Commit $SHA -> No associated PR found"
        fi
      done <<< "$COMMITS"
    else
      echo "No remote commits found for this file since merge base."
    fi
  else
    echo "Could not determine merge base."
  fi

  echo ""
done <<< "$CONFLICT_FILES"
