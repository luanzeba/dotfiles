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
