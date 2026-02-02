# Install Script Patterns

Reference implementations for common install script patterns. See actual scripts in the repo for complete examples.

## Version Checking

Check versions before downloading to avoid unnecessary updates.

```bash
get_latest_version() {
    curl -sL https://api.github.com/repos/OWNER/REPO/releases/latest | \
        grep '"tag_name"' | cut -d'"' -f4
}

get_installed_version() {
    if command -v tool &>/dev/null; then
        tool --version 2>/dev/null | awk '{print "v" $2}'
    fi
}

update() {
    local latest installed
    latest=$(get_latest_version)
    installed=$(get_installed_version)

    if [[ "$installed" == "$latest" ]]; then
        echo "Already up to date: $installed"
        return 0
    fi

    echo "Updating from ${installed:-'not installed'} to $latest..."
    # ... download and install
}
```

Reference: `jj/install`, `gh/install`

## Direct GitHub Release Download

Preferred over package managers when prebuilt binaries are available.

```bash
TOOL_INSTALL_DIR="$HOME/.local/tool"

install() {
    if command -v tool &>/dev/null; then
        echo "tool already installed"
        return 0
    fi

    # Detect OS and architecture
    local os arch
    case "$(uname -s)" in
        Darwin) os="apple-darwin" ;;  # or "macOS" - check release naming
        Linux) os="unknown-linux-gnu" ;;  # or "linux"
        *) echo "Unsupported OS"; return 1 ;;
    esac

    case "$(uname -m)" in
        x86_64) arch="x86_64" ;;  # or "amd64"
        arm64|aarch64) arch="aarch64" ;;  # or "arm64"
        *) echo "Unsupported architecture"; return 1 ;;
    esac

    # Get latest version
    local version
    version=$(get_latest_version)
    [[ -z "$version" ]] && { echo "Failed to fetch version"; return 1; }

    # Download (check actual release URL pattern)
    local url="https://github.com/OWNER/REPO/releases/download/${version}/tool-${version}-${arch}-${os}.tar.gz"
    curl -fsSL "$url" -o /tmp/tool.tar.gz
    [[ ! -s /tmp/tool.tar.gz ]] && { echo "Download failed"; return 1; }

    # Extract to ~/.local/tool/
    [[ -d "$TOOL_INSTALL_DIR" ]] && rm -rf "$TOOL_INSTALL_DIR"
    mkdir -p "$TOOL_INSTALL_DIR"
    tar -xzf /tmp/tool.tar.gz -C "$TOOL_INSTALL_DIR" --strip-components=1
    rm /tmp/tool.tar.gz

    # Symlink to ~/.local/bin
    mkdir -p "$HOME/.local/bin"
    ln -sf "$TOOL_INSTALL_DIR/bin/tool" "$HOME/.local/bin/tool"
}
```

**Key points:**
- Extract to `~/.local/<tool>/`, symlink binary to `~/.local/bin/`
- Check release naming conventions (varies per project)
- macOS: May need `xattr -c` to remove quarantine flag

Reference: `jj/install`, `gh/install`, `nvim/install`, `helix/install`

## Migration via apply()

Use `apply()` for migrations that should run on `dot pull`. Include a TODO with removal date.

```bash
apply() {
    # TODO: Remove this migration block after YYYY-MM-DD
    # Migration: Remove old ~/bin symlink if it points to dotfiles/bin
    if [[ -L "$HOME/bin" ]]; then
        local target
        target=$(readlink "$HOME/bin")
        if [[ "$target" == *"dotfiles/bin"* ]]; then
            echo "Migrating from ~/bin to ~/.local/bin..."
            rm "$HOME/bin"
        fi
    fi

    # Re-run configure to ensure current state
    configure
}
```

**Key points:**
- `apply()` runs on every `dot pull`, so migrations must be idempotent
- Add TODO comment with removal date (typically 1-3 months out)
- Call `configure` at end to ensure current state

Reference: `bin/install`

## Codespaces-Aware Installation

Handle pre-installed tools and Codespaces-specific behavior.

```bash
install() {
    # In Codespaces, tool may be pre-installed
    if [[ -n "$CODESPACES" ]] && command -v tool &>/dev/null; then
        echo "tool already available in Codespaces"
        return 0
    fi

    # Normal installation for local machines
    # ...
}

configure() {
    if [[ -n "$CODESPACES" ]]; then
        # Codespaces: minimal config
        setup_essential_config
    else
        # Local: full config with extensions/plugins
        setup_full_config
    fi
}

update() {
    # Skip binary update in Codespaces (managed by GitHub)
    if [[ -z "$CODESPACES" ]]; then
        update_binary
    fi

    # Config updates apply everywhere
    update_config
}
```

**Key points:**
- Check `$CODESPACES` environment variable
- Skip binary installs for pre-installed tools
- May still need to configure (extensions, plugins, config files)
- Skip binary updates in Codespaces

Reference: `gh/install`

## Health Check Functions

Implement `check_installed()` and `check_configured()` for `dot doctor`.

```bash
check_installed() {
    command -v tool &>/dev/null
}

check_configured() {
    # Check if config symlink exists
    [[ -L "$HOME/.config/tool" ]]
}
```

**Variations:**
- Tools with no config: `check_configured() { return 0; }`
- Tools that are always "installed" (scripts in dotfiles): `check_installed() { return 0; }`
- Check for specific files/extensions: `gh extension list | grep -q "extension-name"`

Reference: All install scripts implement these for `dot doctor` support.
