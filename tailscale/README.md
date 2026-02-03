# Tailscale

Mesh VPN for secure networking between devices.

## Installation

```bash
~/dotfiles/tailscale/install
# or
dot install tailscale
```

## Post-Install

### macOS

1. Open Tailscale from Applications
2. Click the menu bar icon and log in with your account

### Linux (Arch/Debian)

```bash
sudo tailscale up
```

This opens a browser for authentication. After logging in, your device joins your Tailscale network.

## Usage with voice-opencode

Tailscale Serve exposes local services over HTTPS on your tailnet:

```bash
# Expose voice-opencode on port 8443
tailscale serve --bg --https=8443 http://localhost:8080

# Access from any device on your tailnet
# https://<hostname>.<tailnet-name>.ts.net:8443
```

## Useful Commands

```bash
tailscale status          # Show connected devices
tailscale ip              # Show your Tailscale IP
tailscale ping <hostname> # Ping another device
tailscale serve status    # Show active Tailscale Serve endpoints
tailscale serve off       # Disable all Tailscale Serve
```

## Documentation

- https://tailscale.com/kb
- https://tailscale.com/kb/1242/tailscale-serve
