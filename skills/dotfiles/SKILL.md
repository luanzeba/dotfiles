---
name: dotfiles
description: Navigate, modify, and manage Luan's dotfiles repository from any directory. Use when adding or configuring development tools, updating shell/editor/terminal settings, creating cross-platform install scripts for macOS and Arch Linux, or understanding dotfiles organization. Repo is at ~/dotfiles.
---

# Dotfiles Management

## Repository Location

The repository lives at `~/dotfiles` on macOS and Arch Linux.

**Debugging**: Installation output is logged to `~/dotfiles_install.log`

## Structure

The repo follows a **one directory per tool** pattern. To see the current structure:

```bash
tree ~/dotfiles -L 2 -d   # or: ls -la ~/dotfiles
```

Each tool directory should contain:
1. **`install`** script with `install()` and `configure()` functions
2. **Config files** to be symlinked to appropriate locations

See [references/tool-template.md](references/tool-template.md) for the install script template.

## Quick Reference

| Tool | Directory | Config Location | Has Install Script |
|------|-----------|-----------------|-------------------|
| Neovim | `nvim/` | `~/.config/nvim` | Yes (binary from Nix + config/plugin setup) |
| Tmux | `tmux/` | `~/.tmux.conf` | Yes (binary from Nix base + config symlink) |
| Zsh | `zsh/` | `~/.zshrc`, `~/.zsh/` | Yes (`install.zsh`) |
| Git | `git/` | `~/.gitconfig` | Yes (binary from Nix + config symlinks) |
| Ghostty | `ghostty/` | `~/.config/ghostty` | No |
| Helix | `helix/` | `~/.config/helix` | Yes (binary from Nix + config symlinks) |
| Whisper | `whisper/` | N/A | Yes (Nix flake: openai-whisper, opt-in) |
| Skills | `skills/` | `~/.claude/skills/`, `~/.pi/agent/skills/` | Yes |
| Rust | `rust/` | N/A | Yes (Nix flake: rustc, cargo, rustfmt, clippy, rust-analyzer) |
| Go | `go/` | N/A | Yes (Nix flake: go, gopls, gofumpt, goimports-reviser) |
| Ruby | `ruby/` | N/A | Yes (Nix flake: ruby_3_4) |
| Base utilities | `base/` | N/A | Yes (Nix flake: fzf, azure-cli, fd, ffmpeg, jq, eza, ripgrep, openssh, tmux, poppler-utils) |
| Node | `node/` | N/A | Yes (Nix flake: node + TypeScript tools) |
| Hunk | `hunk/` | `~/.config/hunk/config.toml`, git aliases (`hdiff`, `hshow`) | Yes |
| Bin | `bin/` | `~/.local/bin` | Yes (custom scripts) |
| jj | `jj/` | N/A | Yes (Nix flake: Jujutsu VCS) |
| gh | `gh/` | `~/.config/gh-not`, launchd agent | Yes (binary from Nix + extensions/config) |
| glab | `glab/` | N/A | Yes (Nix flake: glab, opt-in) |
| AWS CLI | `aws/` | `~/.aws/config` | Yes (Nix flake: awscli2, opt-in) |
| 1Password CLI | `1password/` | N/A | Yes (Nix flake: 1password-cli) |

## Platform Support

| Platform | Detection | Package Manager | Notes |
|----------|-----------|-----------------|-------|
| macOS | `uname == Darwin` | `brew` | Personal machines |
| Arch/Omarchy | `command -v pacman` | `pacman`/`yay` | Arch + Hyprland |
| Omarchy | `~/.local/share/omarchy` exists | `pacman`/`yay` | Uses default configs, skip apply() |

See [references/platform-detection.md](references/platform-detection.md) for detection code snippets.

## Important Constraints

### Always Modify Dotfiles, Not Config Targets

Never create or edit files directly in config target directories like `~/.config/` or `~/.local/bin/`. These locations contain symlinks to `~/dotfiles/`, so changes made there are either not version controlled or will be overwritten by install scripts.

Always make changes in `~/dotfiles/` so they are:
1. Version controlled (git)
2. Propagated to other machines via `dot pull`
3. Not overwritten by install scripts

Common mistakes to avoid:
- Creating skills in `~/.claude/skills/` or `~/.pi/agent/skills/` instead of `~/dotfiles/skills/`
- Editing nvim config in `~/.config/nvim/` instead of `~/dotfiles/nvim/`
- Adding scripts to `~/.local/bin/` instead of `~/dotfiles/bin/`

After creating or modifying files in `~/dotfiles/`, run the appropriate install script to create symlinks (e.g., `dot install skills`, `dot install nvim`).

## Key Principles

- **Always install latest versions**: Install scripts should always fetch the latest stable/LTS version of tools, not pin to specific versions. Use `@latest` tags, `--lts` flags, or omit version specifiers where possible.
- **Idempotent scripts**: Install scripts must be safe to run multiple times without side effects.
- **Platform-aware**: Use platform detection to handle differences between macOS and Arch.
- **Script pattern**: Each tool script should have `install()`, `configure()`, and optionally `apply()` and `update()` functions.

### Installation Preference Hierarchy

1. **Direct GitHub releases** - Preferred for tools with prebuilt binaries not yet managed by Nix
2. **Nix flake profile** - Preferred for shared language runtimes/toolchains and base utilities managed in dotfiles (currently base utilities, Node + TypeScript tools, Go, Rust, Ruby, Neovim, Helix, jj, gh, glab, AWS CLI, Git, 1Password CLI, Whisper, Zig, bat)
3. **Package managers** - Only when no prebuilt binaries or Nix packages fit (system tools via pacman, GUI apps via brew casks)

Homebrew is installed lazily in Phase 3 of `install`, only when needed for brew-dependent tools.

### Standard Binary Locations

| Purpose | Location | Example |
|---------|----------|---------|
| User binaries/scripts | `~/.local/bin/` | `dotfiles`, `dot` |
| Tool extractions | `~/.local/<tool>/` | `~/.local/gh/` |

Scripts from `bin/` are symlinked individually to `~/.local/bin/`.

### Idempotency Guidelines

Scripts should produce the same result whether run once or many times:

1. **Check before installing**: Use `command -v <tool>` to skip if already installed
   ```bash
   if command -v rustc &>/dev/null; then
       echo "Rust already installed"
       return
   fi
   ```

2. **Use `-sf` for symlinks**: The `-f` flag overwrites existing symlinks safely
   ```bash
   ln -sf "$SCRIPT_DIR/.config" "$HOME/.config/tool"
   ```

3. **Handle existing directories**: Check and backup if needed
   ```bash
   if [[ -e "$target" && ! -L "$target" ]]; then
       mv "$target" "$target.backup"
   fi
   ```

4. **Use `--noconfirm` for package managers**: Avoid interactive prompts
   ```bash
   sudo pacman -S --noconfirm package
   brew install package  # Already non-interactive
   ```

## dotfiles CLI

The `dot` command (symlinked to `~/.local/bin/` from `bin/dotfiles`) provides easy management:

```bash
dotfiles status   # Check install/config health
dotfiles pull     # Pull latest and apply changes (skipped on Omarchy)
dotfiles edit     # Open dotfiles in $EDITOR
dotfiles update   # Update tools (brew, Nix profiles, nvim plugins, etc.)
```

The CLI uses jj (Jujutsu) if available, falling back to git.

## Common Tasks

### Adding a New Tool

1. Create `<tool>/` directory at repo root
2. Create `<tool>/install` script using the template with:
   - `install()` - Install the tool binary/package
   - `configure()` - Symlink configs, set up environment
   - `apply()` (optional) - Reload config after `dotfiles pull`, or handle migrations
   - `update()` (optional) - Update tool for `dotfiles update`
   - `check_installed()` / `check_configured()` - For `dot status` health checks
3. Add config files to the directory
4. Test on each platform
5. Optionally integrate with `install` in the appropriate phase

See [references/tool-template.md](references/tool-template.md) for the install script template.
See [references/install-patterns.md](references/install-patterns.md) for version checking and migrations.

### Modifying Neovim Config

See [references/nvim-config.md](references/nvim-config.md) for structure details.

Key locations:
- Plugins: `nvim/lua/plugins/<name>.lua`
- Key bindings: `nvim/lua/config/mappings.lua`
- Core options: `nvim/init.lua`

### Running Install Scripts

```bash
# Main install
~/dotfiles/install

# Tool-specific installs
~/dotfiles/base/install
~/dotfiles/nvim/install
~/dotfiles/zsh/install.zsh
~/dotfiles/skills/install
~/dotfiles/aws/install
~/dotfiles/node/install
~/dotfiles/rust/install
~/dotfiles/go/install
~/dotfiles/jj/install
```

## Shared Utilities

The `lib/common.sh` file provides shared functions for all scripts:

```bash
source "$DOTFILES_DIR/lib/common.sh"

dotfiles_dir    # Get dotfiles path
is_macos        # Check if running on macOS
is_arch         # Check if running on Arch Linux
is_omarchy      # Check if running on Omarchy
vcs_cmd         # Run jj or git command
log_info/log_success/log_warn/log_error  # Logging helpers
```
