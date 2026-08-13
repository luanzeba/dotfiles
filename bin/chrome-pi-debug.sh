#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Open Chrome (Pi Debug)
# @raycast.mode silent

# Optional parameters:
# @raycast.icon 🌐
# @raycast.packageName Browser

# Documentation:
# @raycast.description Instantly focus the Home Chrome profile used for browsing and Pi automation.
# @raycast.author luanzeba
# @raycast.authorURL https://raycast.com/luanzeba

set -uo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This command is macOS-only."
  exit 1
fi

# Hyper+B takes the native fast path. Explicit diagnostic flags retain the
# slower CDP validation flow below for agents and troubleshooting.
if [[ $# -eq 0 && -x "$HOME/.local/bin/chrome-router" ]]; then
  exec "$HOME/.local/bin/chrome-router" open Home
fi

ENSURE_ONLY=0
STRICT=0
for arg in "$@"; do
  case "$arg" in
    --ensure-only)
      ENSURE_ONLY=1
      ;;
    --strict)
      STRICT=1
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: chrome-pi-debug.sh [--ensure-only] [--strict]"
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
START_SCRIPT="$DOTFILES_DIR/skills/web-browser/scripts/start.js"

# shellcheck disable=SC1091
source "$DOTFILES_DIR/lib/common.sh"

if [[ ! -f "$START_SCRIPT" ]]; then
  echo "Could not find start script: $START_SCRIPT"
  echo "Run: dot install skills"
  exit 1
fi

debug_chrome_pid() {
  python3 - <<'PY'
import subprocess

chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for line in subprocess.check_output(["ps", "-axo", "pid=,command="], text=True).splitlines():
    line = line.strip()
    if chrome in line and "Helper" not in line and "--remote-debugging-port=9222" in line:
        print(line.split(" ", 1)[0])
        break
PY
}

activate_chrome_window() {
  local pid
  pid="$(debug_chrome_pid || true)"

  if [[ -z "${pid:-}" ]]; then
    echo "No debug-enabled Chrome process is available to activate."
    return 1
  fi

  echo "Activating debug-enabled Chrome pid=$pid..."
  osascript <<APPLESCRIPT
    tell application "System Events"
      set frontmost of first process whose unix id is $pid to true
    end tell
APPLESCRIPT
}

if ! ensure_node; then
  echo "Could not find a Node.js binary (Raycast often runs with a minimal PATH)."
  echo "Install Node via dotfiles (dot install node)."
  exit 1
fi

NODE_BIN="$(command -v node)"

echo "Ensuring Chrome is running with remote debugging on :9222 (visible window)..."
START_OUTPUT=""
START_STATUS=0
START_OUTPUT=$("$NODE_BIN" "$START_SCRIPT" 2>&1)
START_STATUS=$?

if [[ -n "$START_OUTPUT" ]]; then
  echo "$START_OUTPUT"
fi

if [[ $ENSURE_ONLY -eq 1 ]]; then
  exit $START_STATUS
fi

if [[ $START_STATUS -ne 0 ]]; then
  if [[ $STRICT -eq 1 ]]; then
    exit $START_STATUS
  fi

  echo ""
  echo "⚠️  Debug session check failed, but I’ll still bring Chrome to the front."
fi

if ! activate_chrome_window; then
  exit 1
fi

echo "✓ Ready. Pi can now use the web-browser skill on the active visible debug session."

# Never fall back to launching ordinary Chrome without the shared debug session.
exit 0
