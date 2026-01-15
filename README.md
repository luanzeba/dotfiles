# Dotfiles

Personal dotfiles for macOS, Omarchy (Arch Linux), and GitHub Codespaces.

## Structure

Each tool has its own directory with an `install` script:

```
<tool>/
├── install          # Script with install() and configure() functions
└── <config files>   # Symlinked to appropriate locations
```

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
| `dot update` | Update tools (brew, nvim plugins, etc.) |
| `dot doctor` | Check setup health |
| `dot edit` | Open in editor |

## Platforms

| Platform | Detection | Notes |
|----------|-----------|-------|
| macOS | `uname == Darwin` | Primary dev machine |
| Omarchy | `~/.local/share/omarchy` | Arch + Hyprland, uses its own configs |
| GitHub Codespaces | `$CODESPACES` | Auto-installed on codespace creation |
