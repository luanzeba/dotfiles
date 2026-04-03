# Dotfiles

Personal dotfiles for macOS, Omarchy (Arch Linux), and GitHub Codespaces.

## Structure

Each tool has its own directory with an `install` script:

```
<tool>/
├── install          # Script with functions (see below)
└── <config files>   # Symlinked to appropriate locations
```

### Install script functions

| Function | Purpose |
|----------|---------|
| `check_installed()` | Returns true if tool binary exists |
| `check_configured()` | Returns true if config is symlinked |
| `install()` | Install the tool binary |
| `configure()` | Symlink config files |
| `apply()` | Reload config (optional) |
| `update()` | Update the tool (optional) |

When running `dot install <tool>`:
- If already installed, only `configure()` runs
- Use `-f/--force` to run both `install()` and `configure()`

## Quick Start

```bash
# Clone
git clone https://github.com/luanzeba/dotfiles.git ~/dotfiles

# Install everything
~/dotfiles/install
```

The main `install` script detects your platform and runs the appropriate setup.

## dotfiles CLI

After installation, use the `dotfiles` (or `dot`) command:

| Command | Description |
|---------|-------------|
| `dot status` | Show repo status |
| `dot pull` | Pull latest and apply changes |
| `dot install` | Run full install |
| `dot install <tool>` | Install specific tool(s) |
| `dot install -f <tool>` | Force reinstall (skip install check) |
| `dot update` | Update tools (brew, nvim plugins, etc.) |
| `dot doctor` | Check setup health |
| `dot logs` | View recent errors |
| `dot edit` | Open in editor |

All commands support `-h/--help` for usage information.

### dot doctor

Shows a table of all tools with their installation and configuration status:

```
┌───────────┬───────────┬────────────┐
│ Tool      │ Installed │ Configured │
├───────────┼───────────┼────────────┤
│ git       │   [OK]    │    [OK]    │
│ go        │   [OK]    │    [NO]    │
│ helix     │   [OK]    │    [OK]    │
│ ...       │    ...    │     ...    │
└───────────┴───────────┴────────────┘
```

Status indicators (colored in terminal):
- `[OK]` - Installed/Configured (green)
- `[NO]` - Not installed/Not configured (red)
- `[??]` - No health check defined (yellow)
- `[--]` - Not applicable (gray)

### dot logs

View errors from install, update, and pull operations:

```bash
dot logs              # Show recent errors (last 10)
dot logs -a           # Show all errors
dot logs -v           # Verbose mode (show full output)
dot logs <tool>       # Filter by tool name
dot logs --clear      # Clear error log
```

## Utilities

- `tui-qa`: PTY-driven TUI smoke tests. Example:
  `tui-qa --cmd "./gh-csd tui" --keys "sleep:1,j,q" --assert "codespace\(s\)"`

## Platforms

| Platform | Detection | Notes |
|----------|-----------|-------|
| macOS | `uname == Darwin` | Primary dev machine |
| Omarchy | `~/.local/share/omarchy` | Arch + Hyprland, uses its own configs |
| GitHub Codespaces | `$CODESPACES` | Auto-installed on codespace creation |

## Codespaces: Local Pi, remote dotcom tools

When I want to work on `github/github` from local macOS without opening a full SSH shell first, I use Pi in codespace mode.

Quick flow:

```bash
# Pick target codespace once
# (or pass a name explicitly later)
gh csd select

# Start Pi with remote dev tools enabled
pi --codespace
```

What switches to remote (inside Codespace):
- `read`, `write`, `edit`, `bash`

Everything else stays local.

Session behavior (important):
- Codespace target is **pinned per Pi session**.
- `pi --codespace` or `/codespace on` (without a name) resolves the current `gh csd` selection once, then keeps using that codespace.
- Changing `gh csd select` in another terminal will **not** retarget an already-running Pi session.
- Switch intentionally with `/codespace on <name>` or `/codespace use <name>`.

Useful in-session commands:
- `/codespace` (interactive menu: connect current, pick existing, or create new)
- `/codespace on [name] [cwd]` (enable and pin target; no name = pin current selection)
- `/codespace off`
- `/codespace status`
- `/codespace use <name>` (retarget current Pi session)
- `/codespace cwd <path>`

If Pi says `gh csd exec` is unavailable, update `gh-csd` first.

## Codespaces: Pi auth bootstrap (safe)

`pi/install` can bootstrap `~/.pi/agent/auth.json` from environment secrets so you don't need to run `/login` in every new codespace.

Supported variables (first match wins):
- `PI_AUTH_JSON_B64` — base64-encoded full `auth.json`
- `PI_AUTH_JSON` — raw `auth.json` JSON string
- `PI_GITHUB_COPILOT_REFRESH_TOKEN` — Copilot refresh token only (installer creates minimal OAuth entry)

Behavior:
- Runs in Codespaces only (unless `PI_AUTH_BOOTSTRAP_ALLOW_LOCAL=1`)
- Does **not** overwrite existing auth by default (set `PI_AUTH_BOOTSTRAP_FORCE=1` to force)
- Writes `~/.pi/agent/auth.json` with `0600` permissions

Example: set a user-level Codespaces secret with your Copilot refresh token:

```bash
REFRESH="$(jq -r '."github-copilot".refresh' ~/.pi/agent/auth.json)"
gh secret set PI_GITHUB_COPILOT_REFRESH_TOKEN --user --app codespaces --body "$REFRESH"
unset REFRESH
```

Alternative: store full auth file (base64) as a secret:

```bash
AUTH_B64="$(base64 < ~/.pi/agent/auth.json | tr -d '\n')"
gh secret set PI_AUTH_JSON_B64 --user --app codespaces --body "$AUTH_B64"
unset AUTH_B64
```

Never commit `~/.pi/agent/auth.json` or tokens to git.
