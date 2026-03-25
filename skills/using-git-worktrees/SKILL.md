---
name: using-git-worktrees
description: Create or reuse isolated git worktrees for parallel feature work in the same repository. Use when the user asks to run multiple Pi sessions/tabs for different features, to start feature X without disturbing feature Y, or to avoid parallel sessions editing the same checkout.
---

# Using Git Worktrees for Parallel Pi Sessions

Use worktrees as the default isolation strategy for concurrent feature work.

## Core rules

- Keep one feature per worktree.
- Avoid implementing two features in the same checkout.
- Prefer deterministic defaults over back-and-forth questions.
- Ask only when intent is ambiguous (feature name/base branch) or action is destructive.

## Standard workflow

1. Resolve feature intent.
2. Resolve repo root and worktree root.
3. Ensure worktree root is ignored.
4. Create or reuse a feature worktree.
5. Launch a separate `pi` session in that worktree.
6. Report what was created/reused.

## 1) Resolve feature intent

Infer these values:

- `feature_slug`: kebab-case from user request (`feature X` -> `feature-x`)
- `branch`: `feature/<feature_slug>` unless user specifies a branch
- `base_ref`: prefer `origin/HEAD`, then `origin/main`, then `origin/master`, then `main`

If you cannot infer a reasonable feature slug, ask a single concise question.

## 2) Resolve repo root and worktree root

From current directory:

```bash
git rev-parse --show-toplevel
```

Choose worktree root with this priority:

1. Existing `<repo>/.worktrees`
2. Existing `<repo>/worktrees`
3. Create `<repo>/.worktrees`

Do not ask the user unless they explicitly request a custom location.

## 3) Ensure worktree root is ignored

If using project-local worktrees (`.worktrees` or `worktrees`), ensure git ignores it.

Check:

```bash
git check-ignore -q .worktrees || git check-ignore -q worktrees
```

If not ignored, prefer a local non-committed rule first:

```bash
echo ".worktrees/" >> .git/info/exclude
```

Only modify `.gitignore` when the user asks for a shared repository policy.

## 4) Create or reuse worktree

Use this behavior in order:

1. If target path already exists as a valid worktree, reuse it.
2. If branch already exists and is checked out in another worktree, reuse that worktree path.
3. If branch exists locally but is not checked out elsewhere, create worktree from branch.
4. Otherwise create new branch from base ref.

Useful commands:

```bash
git worktree list --porcelain
```

```bash
# Existing branch
git worktree add <worktree_path> <branch>

# New branch from base
git worktree add -b <branch> <worktree_path> <base_ref>
```

Never use force flags for creation.

## 5) Launch a separate pi session in that worktree

Prefer automatic launch in a new terminal tab/window.

### If in tmux

```bash
tmux new-window -n "pi:<feature_slug>" "cd <worktree_path> && exec pi"
```

### If in cmux

```bash
SURFACE=$(cmux new-surface --type terminal | awk '{print $2}')
sleep 0.4
cmux send --surface "$SURFACE" "cd <worktree_path> && pi\n"
```

### If on macOS with Ghostty available

```bash
open -na Ghostty.app --args -e "cd <worktree_path> && pi"
```

### Fallback

If no launcher is available, print the exact command for the user:

```bash
cd <worktree_path> && pi
```

## 6) Report outcome clearly

Always summarize:

- repo root
- worktree path
- branch
- base ref
- whether worktree was created or reused
- how `pi` was launched (tmux/cmux/ghostty/manual)

## Safety constraints

- Never prune/remove worktrees unless explicitly requested.
- Never auto-commit unrelated files.
- Do not switch the current checkout branch as part of this workflow.
- If uncommitted changes exist in the current checkout, warn but continue (worktrees are isolated).

## Quick examples

- “Start feature X in a separate Pi tab” -> create/reuse `feature/feature-x` in `.worktrees/feature-x`, launch new `pi` there.
- “Open another Pi session for bugfix login-race” -> create/reuse `feature/bugfix-login-race`, launch isolated session.
- “Resume work on feature Y” -> find existing worktree for `feature/feature-y`, launch `pi` there instead of creating a duplicate.
