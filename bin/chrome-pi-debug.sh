#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Open Chrome (Pi Debug)
# @raycast.mode fullOutput

# Optional parameters:
# @raycast.icon 🌐
# @raycast.packageName Browser

# Documentation:
# @raycast.description Launch/reuse a visible Chrome debug session (:9222) on Work profile for Pi web-browser automation.
# @raycast.author luanzeba
# @raycast.authorURL https://raycast.com/luanzeba

set -uo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This command is macOS-only."
  exit 1
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
    # shellcheck disable=SC1090
    eval "$($HOME/.local/share/fnm/fnm env --shell bash)" >/dev/null 2>&1 || true
    if command -v node >/dev/null 2>&1; then
      command -v node
      return 0
    fi
  fi

  return 1
}

pick_preferred_chrome_pid() {
  python3 - <<'PY'
import os
import subprocess

DEFAULT_USER_DATA_DIR = os.path.expanduser("~/Library/Application Support/Google/Chrome")
CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

out = subprocess.check_output(["ps", "-axo", "pid=,command="], text=True)
entries = []
for line in out.splitlines():
    line = line.strip()
    if not line:
        continue
    if CHROME_BIN not in line:
        continue
    if "Helper" in line:
        continue

    pid_text, command = line.split(" ", 1)
    pid = int(pid_text)

    entries.append((pid, command))

if not entries:
    raise SystemExit(0)

# Preference order:
# 1) Active Pi-debug session (:9222)
# 2) Main Chrome instance (no explicit --user-data-dir flag)
# 3) Explicit default Chrome user-data-dir
# 4) Any other chrome root process
for pid, command in entries:
    if "--remote-debugging-port=9222" in command:
        print(pid)
        raise SystemExit(0)

for pid, command in entries:
    if "--user-data-dir=" not in command:
        print(pid)
        raise SystemExit(0)

for pid, command in entries:
    if f"--user-data-dir={DEFAULT_USER_DATA_DIR}" in command:
        print(pid)
        raise SystemExit(0)

print(entries[0][0])
PY
}

activate_chrome_window() {
  if ! pgrep -x "Google Chrome" >/dev/null 2>&1; then
    echo "No Chrome process found, launching..."
    /usr/bin/open -a "Google Chrome"
    return 0
  fi

  local preferred_pid
  preferred_pid="$(pick_preferred_chrome_pid || true)"

  if [[ -n "${preferred_pid:-}" ]]; then
    echo "Chrome is already running, activating preferred process pid=$preferred_pid..."
    osascript <<APPLESCRIPT
      tell application "System Events"
        try
          set frontmost of first process whose unix id is $preferred_pid to true
        on error
          set frontmost of first process whose name is "Google Chrome" to true
        end try
      end tell
      tell application "Google Chrome" to activate
APPLESCRIPT
    return 0
  fi

  echo "Chrome is already running, activating..."
  osascript -e 'tell application "Google Chrome" to activate'
}

NODE_BIN="$(resolve_node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Could not find a Node.js binary (Raycast often runs with a minimal PATH)."
  echo "Install Node via dotfiles (dot install node) or ensure ~/.local/share/fnm is set up."
  exit 1
fi

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

activate_chrome_window

echo "✓ Ready. Pi can now use the web-browser skill on the active visible debug session."

# Non-strict default: prioritize UX (always open browser) even when debug check fails.
exit 0
