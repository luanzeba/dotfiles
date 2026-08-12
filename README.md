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

`glab` and `aws` are intentionally opt-in and **not** included in default install phases.
Use `dot install <tool>` when you want to set one up.

`hunk` is included in default installs (macOS, Arch/Omarchy, and Codespaces).
It is configured with:
- `~/.config/hunk/config.toml` from `hunk/config.toml`
- Git aliases: `git hdiff` and `git hshow` (both use `hunk pager`)
- The `hunk-review` agent skill via `skills/hunk-review/`

## Nix adoption (Phase 1)

Base utilities, Node, Go, Rust, Ruby, Neovim, Helix, jj, gh, glab, AWS CLI, Git, 1Password CLI, Whisper, Zig, bat, Vicinae, and Handy are managed by the dotfiles Nix flake (`nix/flake.nix`) as separate installables:

- `base/install` → `path:~/dotfiles/nix#base`
  - `fzf` (required by fzf-lua; installed through Nix because distro packages can lag behind)
  - `azure-cli` (`az`), `fd`, `ffmpeg`, `jq`, `eza`, `ripgrep` (`rg`), `tmux`, `poppler-utils` (`pdftotext`)
- `node/install` → `path:~/dotfiles/nix#node`
  - `nodejs_22`, Corepack-managed `pnpm`/`pnpx`, `typescript` (`tsc`), `typescript-language-server`, `prettier`, `tree-sitter`
- `go/install` → `path:~/dotfiles/nix#go`
  - `go`, `gopls`, `gofumpt`, `goimports-reviser`
- `rust/install` → `path:~/dotfiles/nix#rust`
  - `rustc`, `cargo`, `rustfmt`, `clippy`, `rust-analyzer`
- `ruby/install` → `path:~/dotfiles/nix#ruby`
  - `ruby_3_4` (`ruby`, `gem`, `bundle`)
- `nvim/install` → `path:~/dotfiles/nix#nvim`
  - `neovim`
  - config symlink, Lazy plugin sync, and Mason tooling are still managed by `nvim/install`
- `helix/install` → `path:~/dotfiles/nix#helix`
  - `helix` (`hx`)
  - config symlinks are still managed by `helix/install`
- `jj/install` → `path:~/dotfiles/nix#jj`
  - `jujutsu` (`jj`)
- `gh/install` → `path:~/dotfiles/nix#gh`
  - `gh`
  - extensions, `gh-not` config, and launchd agent are still managed by `gh/install`
- `glab/install` → `path:~/dotfiles/nix#glab`
  - `glab`
  - opt-in; excluded from platform installers and the default Nix bundle
- `aws/install` → `path:~/dotfiles/nix#aws`
  - AWS CLI v2 (`aws`)
  - opt-in; links a private IAM Identity Center config when available
  - SSO tokens remain machine-local under `~/.aws/sso/cache`
- `git/install` → `path:~/dotfiles/nix#git`
  - `git`
  - `~/.gitconfig`, `~/.gitignore_global`, and `~/.git_template` are still managed by `git/install`
- `1password/install` → `path:~/dotfiles/nix#1password`
  - `1password-cli` (`op`; unfree package allowed explicitly for this package)
  - app integration is still configured in the 1Password app
- `whisper/install` → `path:~/dotfiles/nix#whisper`
  - `openai-whisper` (`whisper`; ffmpeg runtime is patched by nixpkgs, and the `ffmpeg` CLI is available from `base`)
  - opt-in; excluded from the default Nix bundle because of its large Python/ML closure
- `zig/install` → `path:~/dotfiles/nix#zig`
  - `zig` (from `mitchellh/zig-overlay` `master`, for Ziglings/dev builds), `zls`
- `bat/install` → `path:~/dotfiles/nix#bat`
  - `bat` (used by fzf-lua previews)
- `vicinae/install` → `path:~/dotfiles/nix#vicinae` (Arch desktop only)
  - Vicinae from its upstream flake, plus the community Omarchy Menu and PulseAudio extensions
  - stable imported settings, mutable GUI settings, personal script commands, and a user service
  - clipboard-history paste needs the one-time privileged setup documented in `vicinae/README.md`
- `handy/install` → `path:~/dotfiles/nix#handy` (Arch + Hyprland only)
  - Handy from its upstream flake, wrapped with NixGL and `wtype` for direct Wayland text input
  - an autostart user service and Omarchy's existing dictation bindings; initial model selection is manual

Base utilities are exposed through `dot install base` and are also installed by the platform installers. Tool-specific install scripts stay scoped to that tool while still using one flake source; for example, `tmux/install` ensures the Nix base profile exists and then manages `~/.tmux.conf`.

`hunk` still installs via `npm install -g hunkdiff` because `hunkdiff` is not in nixpkgs.
For `dot install hunk`, if the full `node` toolchain is not installed, dotfiles syncs a minimal `nodeRuntime` Nix package (node+npm only) first.
npm globals are pinned to `~/.local` (binaries in `~/.local/bin`).

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
| `dot update` | Update tools (brew, nvim plugins, etc.) |
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
| Omarchy | `~/.local/share/omarchy` | Arch + Hyprland; preserves Omarchy defaults (`dot pull` skips apply unless `--apply`, `install-local` skips nvim unless `DOTFILES_INSTALL_NVIM_ON_OMARCHY=1`) |
| GitHub Codespaces | `$CODESPACES` | Auto-installed on codespace creation |

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
