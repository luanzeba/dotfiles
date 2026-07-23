# Vicinae

Vicinae is the experimental unified launcher for the Arch/Hyprland desktop.
It is installed from the upstream Nix flake together with the community
Omarchy Menu and PulseAudio extensions.

## Install

```bash
dot install vicinae
```

The installer:

- installs Vicinae through the dotfiles Nix profile
- imports stable settings from `base.jsonc`
- creates a mutable `~/.config/vicinae/settings.json` on first install
- indexes only `~/Downloads` and `~/Documents` initially
- links personal scripts into `~/.local/share/vicinae/scripts`
- seeds a Search GitHub shortcut only when no shortcuts exist
- registers Vicinae's desktop entries and URL handlers
- disables anonymous system-info telemetry
- enables the `vicinae.service` user service
- on Hyprland, links and sources `hyprland.conf` after personal bindings

## Clipboard paste helper on Arch

Vicinae monitors the clipboard without elevated privileges, but pasting a
history item into the previously focused application requires its Linux input
helper to read input devices and use `uinput`.

NixOS creates the capability wrapper declaratively. On Arch, complete the same
one-time host setup interactively:

```bash
~/dotfiles/vicinae/setup-input-server
```

The script installs a root-owned helper under `/usr/local/libexec`, grants only
`cap_dac_override`, loads `uinput`, and maintains the `/run/wrappers` path
expected by Vicinae's upstream Nix package. Re-run it after a Vicinae update;
the previous helper remains usable and its Nix closure remains GC-rooted until
then.

## Configuration model

`~/.config/vicinae/settings.json` remains mutable because Vicinae's settings UI
writes to it. It imports the version-controlled `base.jsonc`, which Vicinae
never rewrites. History, live shortcuts, clipboard data, and caches are local
state and are not committed to dotfiles. `shortcuts.json` is only the seed used
for an empty first-run shortcut store.

The user service forces Qt Quick software rendering because Nix GUI packages on
non-NixOS do not automatically see the host Mesa driver. This avoids an OpenGL
startup crash while keeping the host graphics stack untouched.

## Hyprland bindings

On a Hyprland installation, the installer links `hyprland.conf` into
`~/.config/hypr/vicinae.conf` and sources it after personal bindings. It sets:

- `Super+Space`: toggle Vicinae (replacing Omarchy's Walker launcher binding)
- `Super+Return`: create a new Ghostty through Vicinae

`Super+Alt+Space` remains Omarchy Menu.
