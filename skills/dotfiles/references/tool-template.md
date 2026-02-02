# Tool Install Script Template

Use this template when adding a new tool to dotfiles.

## Directory Structure

```
<tool>/
├── install             # Installation script with install(), configure(), apply(), update()
├── config/             # Config files to symlink (or individual config file)
└── ...                 # Any other supporting files
```

## Install Script Template

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_NAME="<tool>"
TOOL_INSTALL_DIR="$HOME/.local/$TOOL_NAME"

# Health checks for dot doctor
check_installed() {
    command -v $TOOL_NAME &>/dev/null
}

check_configured() {
    [[ -L "$HOME/.config/$TOOL_NAME" ]]
}

# Version helpers (for tools with GitHub releases)
get_latest_version() {
    curl -sL https://api.github.com/repos/OWNER/REPO/releases/latest | \
        grep '"tag_name"' | cut -d'"' -f4
}

get_installed_version() {
    if command -v $TOOL_NAME &>/dev/null; then
        $TOOL_NAME --version 2>/dev/null | awk '{print "v" $2}'
    fi
}

# Install the tool binary
install() {
    if command -v $TOOL_NAME &>/dev/null; then
        echo "$TOOL_NAME already installed"
        return 0
    fi

    echo "Installing $TOOL_NAME..."

    # Detect platform
    local os arch
    case "$(uname -s)" in
        Darwin) os="apple-darwin" ;;
        Linux) os="unknown-linux-gnu" ;;
        *) echo "Unsupported OS"; return 1 ;;
    esac

    case "$(uname -m)" in
        x86_64) arch="x86_64" ;;
        arm64|aarch64) arch="aarch64" ;;
        *) echo "Unsupported architecture"; return 1 ;;
    esac

    # Download from GitHub releases
    local version
    version=$(get_latest_version)
    [[ -z "$version" ]] && { echo "Failed to fetch version"; return 1; }

    local url="https://github.com/OWNER/REPO/releases/download/${version}/${TOOL_NAME}-${arch}-${os}.tar.gz"
    curl -fsSL "$url" -o /tmp/$TOOL_NAME.tar.gz

    # Extract to ~/.local/<tool>/
    [[ -d "$TOOL_INSTALL_DIR" ]] && rm -rf "$TOOL_INSTALL_DIR"
    mkdir -p "$TOOL_INSTALL_DIR"
    tar -xzf /tmp/$TOOL_NAME.tar.gz -C "$TOOL_INSTALL_DIR"
    rm /tmp/$TOOL_NAME.tar.gz

    # Symlink to ~/.local/bin
    mkdir -p "$HOME/.local/bin"
    ln -sf "$TOOL_INSTALL_DIR/bin/$TOOL_NAME" "$HOME/.local/bin/$TOOL_NAME"

    echo "$TOOL_NAME installed: $($TOOL_NAME --version)"
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

# Reload config after dotfiles pull (optional)
apply() {
    # Example: reload config if tool is running
    # if pgrep -x "$TOOL_NAME" &>/dev/null; then
    #     $TOOL_NAME reload
    # fi
    :
}

# Update tool for dotfiles update (optional)
update() {
    local latest installed
    latest=$(get_latest_version)
    installed=$(get_installed_version)

    if [[ "$installed" == "$latest" ]]; then
        echo "$TOOL_NAME is up to date: $installed"
        return 0
    fi

    echo "Updating $TOOL_NAME from ${installed:-'not installed'} to $latest..."
    rm -f "$HOME/.local/bin/$TOOL_NAME"
    [[ -d "$TOOL_INSTALL_DIR" ]] && rm -rf "$TOOL_INSTALL_DIR"
    install
}

# Main (only run when executed directly, not when sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    install
    configure
fi
```

For more patterns (version checking, migrations, Codespaces handling), see [install-patterns.md](install-patterns.md).

## Variations

### Package Manager Install (when no prebuilt binaries available)

```bash
install() {
    if command -v $TOOL_NAME &>/dev/null; then
        echo "$TOOL_NAME already installed"
        return 0
    fi

    if [[ "$(uname)" == "Darwin" ]]; then
        # macOS - Homebrew (installed by install-local Phase 3)
        brew install <package-name>
    elif command -v pacman &>/dev/null; then
        # Arch Linux
        sudo pacman -S --noconfirm <package-name>
    elif [[ -n "$CODESPACES" ]] || command -v apt-get &>/dev/null; then
        # Debian/Ubuntu/Codespaces
        sudo apt-get update && sudo apt-get install -y <package-name>
    fi
}
```

### Tool already installed (config only)

```bash
check_installed() {
    # Tool comes with the system or is installed separately
    return 0
}

install() {
    :
}

configure() {
    ln -sf "$SCRIPT_DIR/.toolrc" "$HOME/.toolrc"
}
```

### No config needed (install only)

```bash
check_configured() {
    return 0  # No config needed
}

configure() {
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

Add to `install-local` in the appropriate phase:

- **Phase 1-2**: Tools with direct GitHub downloads (no Homebrew needed)
- **Phase 3**: Tools requiring Homebrew/package managers

```bash
run_step "<tool>/install" bash "$SCRIPT_DIR/<tool>/install"
```

## Checklist

- [ ] `check_installed()` function for `dot doctor`
- [ ] `check_configured()` function for `dot doctor`
- [ ] `install()` handles all platforms (or uses `:` if nothing to install)
- [ ] `configure()` symlinks configs (or uses `:` if nothing to configure)
- [ ] `apply()` for config reload or migrations (optional)
- [ ] `update()` with version checking (optional)
- [ ] Uses `~/.local/bin` for binaries (not `~/bin`)
- [ ] Uses `~/.local/<tool>/` for tool extractions
- [ ] Config files are symlinked, not copied
- [ ] Script is executable (`chmod +x install`)
- [ ] Tested on at least one platform
