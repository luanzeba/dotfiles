# Platform Detection

## Detection Snippets

### macOS

```bash
if [[ "$(uname)" == "Darwin" ]]; then
    # Running on macOS
fi
```

### Arch Linux

```bash
if command -v pacman &>/dev/null; then
    # Running on Arch Linux or an Arch-based distribution
fi
```

### Omarchy

Omarchy is Arch Linux with a custom Hyprland setup. Detect it by checking for its marker directory:

```bash
if [[ -d "$HOME/.local/share/omarchy" ]]; then
    # Running on Omarchy
fi
```

Omarchy uses its own defaults, so `dot pull` skips `apply()` unless `--apply` is provided.

## Package Manager Commands

| Platform | Install | Update | Search |
|----------|---------|--------|--------|
| macOS | `brew install <pkg>` | `brew update && brew upgrade` | `brew search <pkg>` |
| Arch | `sudo pacman -S --noconfirm <pkg>` | `sudo pacman -Syu` | `pacman -Ss <pkg>` |
| Arch (AUR) | `yay -S --noconfirm <pkg>` | `yay -Syu` | `yay -Ss <pkg>` |

## Combined Detection Pattern

```bash
detect_platform() {
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "macos"
    elif command -v pacman &>/dev/null; then
        echo "arch"
    else
        echo "unknown"
    fi
}

case "$(detect_platform)" in
    macos)
        brew install <package-name>
        ;;
    arch)
        sudo pacman -S --noconfirm <package-name>
        ;;
    *)
        echo "Unsupported platform"
        exit 1
        ;;
esac
```

## Common Gotchas

1. **Homebrew on Linux**: Some systems have Linuxbrew; check `uname` rather than only checking for `brew`.
2. **yay vs pacman**: Use `yay` for AUR packages and `pacman` for official repositories.
