#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Open Chrome (Pi Debug)
# @raycast.mode fullOutput

# Optional parameters:
# @raycast.icon 🌐
# @raycast.packageName Browser

# Documentation:
# @raycast.description Launch a visible Chrome debug session (:9222) for Pi web-browser automation (regular profile when possible, isolated fallback if needed).
# @raycast.author luanzeba
# @raycast.authorURL https://raycast.com/luanzeba

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This command is macOS-only."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
START_SCRIPT="$DOTFILES_DIR/skills/web-browser/scripts/start.js"

if [[ ! -f "$START_SCRIPT" ]]; then
  echo "Could not find start script: $START_SCRIPT"
  echo "Run: dot install skills"
  exit 1
fi

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local -a fnm_nodes=()
  shopt -s nullglob
  fnm_nodes=("$HOME/.local/share/fnm/node-versions"/*/installation/bin/node)
  shopt -u nullglob

  if [[ ${#fnm_nodes[@]} -gt 0 ]]; then
    printf '%s\n' "${fnm_nodes[@]}" | sort -V | tail -n 1
    return 0
  fi

  if [[ -x "$HOME/.local/share/fnm/fnm" ]]; then
    # Try bootstrapping fnm environment as a last resort.
    # shellcheck disable=SC1090
    eval "$($HOME/.local/share/fnm/fnm env --shell bash)" >/dev/null 2>&1 || true
    if command -v node >/dev/null 2>&1; then
      command -v node
      return 0
    fi
  fi

  return 1
}

NODE_BIN="$(resolve_node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Could not find a Node.js binary (Raycast often runs with a minimal PATH)."
  echo "Install Node via dotfiles (dot install node) or ensure ~/.local/share/fnm is set up."
  exit 1
fi

echo "Ensuring Chrome is running with remote debugging on :9222 (visible window)..."
"$NODE_BIN" "$START_SCRIPT"

# Bring Chrome to the foreground for a normal launch-like experience.
/usr/bin/open -a "Google Chrome"

echo "✓ Ready. Pi can now use the web-browser skill on the active visible debug session."
