# Arch-specific configuration

This directory holds tools and configuration that only belong on the Arch + Hyprland machine. Cross-platform tools remain at the repository root.

Install an Arch-only tool explicitly with its path:

```bash
dot install arch/noctalia
dot status arch/noctalia
```

`arch/fontconfig` contains Fontconfig preferences only. Licensed font binaries remain private under `~/.local/share/fonts`.

`arch/noctalia` starts the shell through a dedicated Hyprland source. It replaces only the duplicate Waybar; Vicinae remains the primary launcher and Mako remains the notification daemon during the trial.
