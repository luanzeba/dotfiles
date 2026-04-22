#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
START_SCRIPT="$DOTFILES_DIR/skills/web-browser/scripts/start.js"

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local fnm_node
  fnm_node="$HOME/.local/share/fnm/current/bin/node"
  if [[ -x "$fnm_node" ]]; then
    echo "$fnm_node"
    return 0
  fi

  if [[ -x "$HOME/.local/share/fnm/fnm" ]]; then
    # shellcheck disable=SC1090
    eval "$($HOME/.local/share/fnm/fnm env --shell bash)" >/dev/null 2>&1 || true
    if command -v node >/dev/null 2>&1; then
      command -v node
      return 0
    fi
  fi

  return 1
}

URL="${1:-}"
NODE_BIN="$(resolve_node || true)"

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  # fallback: still try opening with Chrome directly
  if [[ -n "$URL" ]]; then
    open -a "Google Chrome" "$URL"
  else
    open -a "Google Chrome"
  fi
  exit 0
fi

# Ensure canonical Pi debug session is available
"$NODE_BIN" "$START_SCRIPT" >/tmp/pi-browser-demos/finicky-open-last-start.txt 2>&1 || true

if [[ -z "$URL" ]]; then
  osascript -e 'tell application "Google Chrome" to activate' || true
  exit 0
fi

ENCODED_URL="$($NODE_BIN -e 'console.log(encodeURI(process.argv[1]))' "$URL")"

if curl -fsS -X PUT "http://127.0.0.1:9222/json/new?$ENCODED_URL" >/tmp/pi-browser-demos/finicky-open-last-cdp.json 2>/tmp/pi-browser-demos/finicky-open-last-cdp.err; then
  osascript -e 'tell application "Google Chrome" to activate' || true
  exit 0
fi

# Fallback when /json/new is unavailable
osascript <<APPLESCRIPT >/dev/null 2>&1 || true
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then
    make new window
  end if
  tell front window
    make new tab with properties {URL:"$URL"}
  end tell
end tell
APPLESCRIPT

exit 0
