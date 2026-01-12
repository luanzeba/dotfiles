# Tool Install Script Template

Use this template when adding a new tool to dotfiles.

## Directory Structure

```
<tool>/
├── install             # Installation script with install() and configure()
├── config/             # Config files to symlink (or individual config file)
└── ...                 # Any other supporting files
```

## Install Script Template

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL_NAME="<tool>"

# Install the tool binary/package
install() {
    if [[ -n "$CODESPACES" ]]; then
        # GitHub Codespaces (Debian/Ubuntu)
        sudo apt-get update
        sudo apt-get install -y <package-name>

    elif [[ "$(uname)" == "Darwin" ]]; then
        # macOS
        if ! command -v brew &>/dev/null; then
            echo "Error: Homebrew not installed"
            exit 1
        fi
        brew install <package-name>

    elif command -v pacman &>/dev/null; then
        # Arch Linux
        sudo pacman -S --noconfirm <package-name>
        # For AUR packages, use: yay -S --noconfirm <aur-package>

    else
        echo "Unsupported platform"
        exit 1
    fi
}

# Symlink configuration files
configure() {
    local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/$TOOL_NAME"

    # Backup existing non-symlink config
    if [[ -e "$config_dir" && ! -L "$config_dir" ]]; then
        mv "$config_dir" "$config_dir.backup"
        echo "Backed up existing config to $config_dir.backup"
    fi
    rm -rf "$config_dir"

    # Symlink config
    ln -s "$SCRIPT_DIR/config" "$config_dir"
    echo "Linked: $config_dir -> $SCRIPT_DIR/config"
}

# Main
echo "Installing $TOOL_NAME..."
install
configure
echo "$TOOL_NAME installation complete!"
```

## Variations

### Tool already installed (config only)

```bash
install() {
    # Tool comes with the system or is installed separately
    :
}

configure() {
    ln -sf "$SCRIPT_DIR/.toolrc" "$HOME/.toolrc"
}
```

### No config needed (install only)

```bash
install() {
    brew install <package>  # or appropriate package manager
}

configure() {
    # No configuration needed
    :
}
```

### Platform-specific config

```bash
configure() {
    local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/$TOOL_NAME"
    ln -sf "$SCRIPT_DIR/config" "$config_dir"

    # Platform-specific additions
    if [[ "$(uname)" == "Darwin" ]]; then
        ln -sf "$SCRIPT_DIR/macos.conf" "$config_dir/platform.conf"
    elif command -v pacman &>/dev/null; then
        ln -sf "$SCRIPT_DIR/arch.conf" "$config_dir/platform.conf"
    fi
}
```

## Integration with Main Install

To have the tool installed automatically, add to `./install`:

```bash
# In install_software() or setup_software()
bash <tool>/install
```

## Checklist

- [ ] `install()` function handles all three platforms (or uses `:` if nothing to install)
- [ ] `configure()` function symlinks configs (or uses `:` if nothing to configure)
- [ ] Config files are symlinked, not copied
- [ ] Script is executable (`chmod +x install`)
- [ ] Tested on at least one platform
