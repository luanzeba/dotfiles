# Handy

Handy is an offline speech-to-text tool for Arch + Hyprland.

```bash
dot install handy
```

The Nix package wraps Handy with NixGL and bundles `wtype`, so direct text input
writes to the previously focused Wayland window without changing the clipboard.

- Hold `F9` to dictate; release it to transcribe and type.
- `Super+Ctrl+X` toggles dictation.

The installer starts Handy hidden at login and replaces Omarchy's optional
Voxtype commands at those existing dictation bindings. On first use, open
Handy from Vicinae or run `handy`, then choose and download a speech model.
Keep Handy's paste method as **Direct** and typing tool as **Auto** (it finds
bundled `wtype`).
