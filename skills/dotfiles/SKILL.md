---
name: dotfiles
description: Navigate, modify, and manage Luan's dotfiles repository from any directory. Use when adding or configuring development tools, updating shell/editor/terminal settings, creating cross-platform install scripts (macOS, Arch Linux, GitHub Codespaces), or understanding dotfiles organization. Repo is at ~/dotfiles.
---

# Dotfiles Management

## Repository Location

- **macOS/Arch**: `~/dotfiles`
- **Codespaces**: `/workspaces/.codespaces/.persistedshare/dotfiles` (GitHub implementation detail, may change)

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
| Neovim | `nvim/` | `~/.config/nvim` | Yes |
| Tmux | `tmux/` | `~/.tmux.conf` | Yes |
| Zsh | `zsh/` | `~/.zshrc`, `~/.zsh/` | Yes (`install.zsh`) |
| Git | `git/` | `~/.gitconfig` | Yes |
| Ghostty | `ghostty/` | `~/.config/ghostty` | No |
| Helix | `helix/` | `~/.config/helix` | Yes (builds from source) |
| Whisper | `whisper/` | N/A | Yes (macOS/Arch only) |
| OpenCode | `opencode/` | `~/.config/opencode/` | Yes |
| Skills | `skills/` | `~/.config/opencode/skill/`, `~/.claude/skills/` | Yes |
| Rust | `rust/` | N/A | Yes (rustup) |
| Go | `go/` | N/A | Yes (Go tools: gopls, gofumpt, etc.) |
| Node | `node/` | N/A | Yes (fnm + TypeScript tools) |
| Bin | `bin/` | `~/bin` | Yes (custom scripts) |

## Platform Support

| Platform | Detection | Package Manager | Notes |
|----------|-----------|-----------------|-------|
| GitHub Codespaces | `$CODESPACES` set | `apt` | Debian-based, ephemeral |
| macOS | `uname == Darwin` | `brew` | Personal machines |
| Arch/Omarchy | `command -v pacman` | `pacman`/`yay` | Arch + Hyprland |

See [references/platform-detection.md](references/platform-detection.md) for detection code snippets.

## Key Principles

- **Always install latest versions**: Install scripts should always fetch the latest stable/LTS version of tools, not pin to specific versions. Use `@latest` tags, `--lts` flags, or omit version specifiers where possible.
- **Idempotent scripts**: Install scripts should be safe to run multiple times. Check if tools are already installed before reinstalling.
- **Platform-aware**: Use platform detection to handle differences between Codespaces, macOS, and Arch.

## Common Tasks

### Adding a New Tool

1. Create `<tool>/` directory at repo root
2. Create `<tool>/install` script using the template (with `install()` and `configure()` functions)
3. Add config files to the directory
4. Test on each platform
5. Optionally integrate with main `./install` script

### Modifying Neovim Config

See [references/nvim-config.md](references/nvim-config.md) for structure details.

Key locations:
- Plugins: `nvim/lua/plugins/<name>.lua`
- Key bindings: `nvim/lua/config/mappings.lua`
- Core options: `nvim/init.lua`

### Running Install Scripts

```bash
# Main install (dispatches to platform-specific script)
~/dotfiles/install

# Platform-specific scripts (called by main install)
~/dotfiles/install-codespaces   # GitHub Codespaces
~/dotfiles/install-local        # macOS and Arch

# Tool-specific installs
~/dotfiles/nvim/install
~/dotfiles/zsh/install.zsh
~/dotfiles/skills/install
~/dotfiles/node/install
~/dotfiles/rust/install
~/dotfiles/go/install
```
