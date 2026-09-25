# Dotfiles

Personal dotfiles for macOS and Omarchy (Arch Linux).

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

The main `install` script sets up the machine for macOS or Arch Linux.

`glab`, `aws`, `whisper`, and `blender` are intentionally opt-in and **not** included in default install phases.
Use `dot install <tool>` when you want to set one up. Blender currently installs via Omarchy's package manager only; macOS support can be added later.

`hunk` is included in default installs on macOS and Arch/Omarchy.
It is configured with:
- `~/.config/hunk/config.toml` from `hunk/config.toml`
- Git aliases: `git hdiff` and `git hshow` (both use `hunk pager`)
- The `hunk-review` agent skill via `skills/hunk-review/`

## Nix

Most CLI tools and language toolchains come from one flake, `nix/flake.nix`. `nix/flake.lock` pins nixpkgs for most tools; Node deliberately tracks current nixpkgs, and Whisper uses `uv` instead of Nix. Each package is installed as its own Nix profile entry, named after its tool directory, so `dot install go` installs only `path:~/dotfiles/nix#go`.

| Package | Contents |
|---------|----------|
| `base` | `fzf`, `fd`, `ffmpeg`, `jq`, `eza`, `rg`, `ssh`, `tmux`, `pdftotext`, `uv` |
| `node` | `nodejs_latest`, Corepack, `tsc`, `typescript-language-server`, `prettier`, `tree-sitter` |
| `nodeRuntime` | Minimal Node/npm fallback for Hunk (lower profile priority) |
| `go` | `go`, `gopls`, `gofumpt`, `goimports-reviser` |
| `rust` | `rustc`, `cargo`, `rustfmt`, `clippy`, `rust-analyzer` |
| `zig` | zig `master` (zig-overlay) + `zls` |
| `ruby`, `nvim`, `helix`, `jj`, `gh`, `git`, `bat`, `1password` | the single package |
| `glab`, `aws` | opt-in Nix packages; not part of `./install` |
| `chrome` | x86_64 Linux only (macOS uses the Homebrew cask) |
| `handy` | Linux only; wrapped with NixGL + `wtype` |

A Nix-backed tool script is mostly one line:

```bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib/nix.sh"
nix_package_tool go go gopls gofumpt goimports-reviser   # <entry> <commands to check>
```

That line defines `check_installed`, `get_installed_version`, `install`, and `update`. Scripts override `configure`/`check_configured` for config symlinks. `update` only upgrades entries that are already installed, so opt-in tools stay opt-in.

To bump pinned versions on every machine: `nix flake update --flake ~/dotfiles/nix`, commit the lock, then `dot pull && dot update` elsewhere. Node deliberately tracks the latest nixpkgs independently of the lock when synced.

Whisper is an opt-in exception: `whisper/install` installs pinned `mlx-whisper` with `uv` on Apple Silicon. `dot update whisper` upgrades existing installations to the pinned version and removes the old Nix profile entry.

npm-only tools (`hunk`, `pi`, `qmd`) install as npm globals into `~/.local`; Hunk can install a minimal `nodeRuntime` profile entry when npm is missing.

Run `bash tests/installers-smoke.sh` for offline checks of the profile helper and targeted update CLI.

## dotfiles CLI

After installation, use the `dotfiles` (or `dot`) command:

| Command | Description |
|---------|-------------|
| `dot status` | Show install/config health |
| `dot pull` | Pull latest (Omarchy skips apply by default; use `--apply`) |
| `dot install` | Run full install |
| `dot install <tool>` | Install specific tool(s), e.g. `dot install base` |
| `dot install aws` | Install AWS CLI v2 and link private SSO profiles |
| `dot install -f <tool>` | Force reinstall (skip install check) |
| `dot update [tool...]` | Update all installed tools (and brew on macOS), or only named tools |
| `dot logs` | View recent errors |
| `dot edit` | Open in editor |

All commands support `-h/--help` for usage information.

### dot status

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

- `chrome-router`: native macOS HTTP/HTTPS handler that routes links to Chrome profiles while keeping the Pi CDP session available. Hold Hyper while clicking a link to choose Home or Work and remember that site. CLI examples: `chrome-router open Work`, `chrome-router open Home`, `chrome-router choose`, `chrome-router rules`, and `chrome-router status`. Raycast discovers the `Open Chrome — Work`, `Open Chrome — Home`, and `Choose Chrome Profile for URL` commands from `bin/` for direct keybinding assignment.
- `oryx`: Oryx GraphQL wrapper for layout inspection, key updates, and compilation. `oryx auth login` uses an isolated visible Chromium profile; its session is stored outside the repository at `~/.local/state/oryx/session.json` with mode `0600`.
- `zsa/install`: installs minimal Voyager-only udev rules and adds the user to `plugdev` for Oryx WebUSB flashing.
- `tui-qa`: PTY-driven TUI smoke tests.

## Platforms

| Platform | Detection | Notes |
|----------|-----------|-------|
| macOS | `uname == Darwin` | Primary dev machine |
| Omarchy | `~/.local/share/omarchy` | Arch + Hyprland; preserves Omarchy defaults (`dot pull` skips apply unless `--apply`, `install` skips nvim unless `DOTFILES_INSTALL_NVIM_ON_OMARCHY=1`) |
