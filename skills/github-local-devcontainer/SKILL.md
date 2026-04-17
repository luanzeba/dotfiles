---
name: github-local-devcontainer
description: Work with the github/github local macOS arm64 devcontainer. Use when asked to rebuild/recreate/exec the local devcontainer, verify dotfiles/onCreate behavior, run commands inside the container from the host, or troubleshoot local-bootstrapped container lifecycle.
---

# GitHub Local Devcontainer (macOS arm64)

## Paths

- Repo: `~/github/github`
- Devcontainer config: `.devcontainer/local-macos-arm64/devcontainer.json`
- onCreate script: `.devcontainer/local-macos-arm64/bootstrap-arm64.sh`

## Default Workflow

1. Ensure auth token exists on host:
   ```bash
   export GITHUB_TOKEN="$(gh auth token)"
   ```
2. Recreate container (reruns `onCreateCommand`):
   ```bash
   cd ~/github/github
   npx @devcontainers/cli up \
     --workspace-folder . \
     --config .devcontainer/local-macos-arm64/devcontainer.json \
     --remove-existing-container
   ```
3. Exec into container:
   ```bash
   npx @devcontainers/cli exec \
     --workspace-folder . \
     --config .devcontainer/local-macos-arm64/devcontainer.json \
     bash -l
   ```

## Dotfiles Behavior

- Dotfiles install is handled in `bootstrap-arm64.sh` during `onCreateCommand`.
- It clones and runs:
  - repo: `https://github.com/luanzeba/dotfiles.git` (default)
  - command: `./install`
- Overrides (host env passed into container):
  - `DOTFILES_REPO`
  - `DOTFILES_DIR`
  - `SKIP_DOTFILES_INSTALL=1`

## Verify Dotfiles/Tools in Container

Run inside container:

```bash
which dotfiles dot pi opencode nvim tmux gh
```

## Lifecycle Rules (important)

- `docker stop/start` preserves state.
- Removing/rebuilding container resets to image baseline, then reruns `onCreateCommand`.
- `onCreateCommand` runs only when a new container is created.

## Slow-but-clean reset

If asked for a full rebuild from scratch (image + container):

```bash
cd ~/github/github
export GITHUB_TOKEN="$(gh auth token)"
.devcontainer/local-macos-arm64/clean-rebuild.sh
```
