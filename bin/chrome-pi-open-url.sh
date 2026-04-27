#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
START_SCRIPT="$DOTFILES_DIR/skills/web-browser/scripts/start.js"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
LOG_DIR="/tmp/pi-browser-demos"

mkdir -p "$LOG_DIR"

PROFILE_NAME=""
if [[ "${1:-}" == "--profile" ]]; then
  PROFILE_NAME="${2:-}"
  shift 2 || true
fi
URL="${1:-}"

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

activate_chrome() {
  osascript -e 'tell application "Google Chrome" to activate' || true
}

resolve_pi_user_data_dir() {
  local node_bin="$1"

  local core_path
  core_path="$DOTFILES_DIR/skills/web-browser/scripts/chrome-session-core.cjs"
  if [[ ! -f "$core_path" ]]; then
    echo "${PI_CHROME_PROFILE_DIR:-$HOME/.cache/pi-chrome-profile}"
    return 0
  fi

  local resolved
  resolved="$($node_bin -e 'const core=require(process.argv[1]); process.stdout.write(core.DEFAULT_ISOLATED_USER_DATA_DIR || "")' "$core_path" 2>/dev/null || true)"

  if [[ -n "$resolved" ]]; then
    echo "$resolved"
    return 0
  fi

  echo "${PI_CHROME_PROFILE_DIR:-$HOME/.cache/pi-chrome-profile}"
}

resolve_profile_directory() {
  local profile_name="$1"
  local user_data_dir="$2"

  python3 - "$profile_name" "$user_data_dir" <<'PY'
import json
import os
import sys

requested = (sys.argv[1] or "").strip()
user_data_dir = os.path.expanduser(sys.argv[2])

if not requested:
    print("Default")
    raise SystemExit(0)

target = requested.lower()
local_state = os.path.join(user_data_dir, "Local State")

try:
    with open(local_state, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    candidate = os.path.join(user_data_dir, requested)
    if os.path.isdir(candidate):
        print(requested)
    else:
        print("Default")
    raise SystemExit(0)

info_cache = ((data.get("profile") or {}).get("info_cache") or {})
for profile_dir, entry in info_cache.items():
    display_name = str((entry or {}).get("name") or "").strip().lower()
    if display_name == target:
        print(profile_dir)
        raise SystemExit(0)

candidate = os.path.join(user_data_dir, requested)
if os.path.isdir(candidate):
    print(requested)
else:
    print("Default")
PY
}

open_url_with_profile() {
  local profile_name="$1"
  local url="$2"
  local user_data_dir="$3"

  local profile_directory
  profile_directory="$(resolve_profile_directory "$profile_name" "$user_data_dir")"

  if [[ -x "$CHROME_BIN" ]]; then
    "$CHROME_BIN" \
      "--user-data-dir=$user_data_dir" \
      "--profile-directory=$profile_directory" \
      "$url" \
      >"$LOG_DIR/finicky-open-last-profile-launch.txt" 2>&1 &
    return 0
  fi

  open -a "Google Chrome" "$url"
  return 0
}

NODE_BIN="$(resolve_node || true)"
PI_USER_DATA_DIR="${PI_CHROME_PROFILE_DIR:-$HOME/.cache/pi-chrome-profile}"

if [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]]; then
  PI_USER_DATA_DIR="$(resolve_pi_user_data_dir "$NODE_BIN")"
  "$NODE_BIN" "$START_SCRIPT" >"$LOG_DIR/finicky-open-last-start.txt" 2>&1 || true
fi

if [[ -z "$URL" ]]; then
  activate_chrome
  exit 0
fi

if [[ -n "$PROFILE_NAME" ]]; then
  if open_url_with_profile "$PROFILE_NAME" "$URL" "$PI_USER_DATA_DIR"; then
    activate_chrome
    exit 0
  fi
fi

if [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]]; then
  ENCODED_URL="$($NODE_BIN -e 'console.log(encodeURI(process.argv[1]))' "$URL")"

  if curl -fsS -X PUT "http://127.0.0.1:9222/json/new?$ENCODED_URL" >"$LOG_DIR/finicky-open-last-cdp.json" 2>"$LOG_DIR/finicky-open-last-cdp.err"; then
    activate_chrome
    exit 0
  fi

  if curl -fsS "http://127.0.0.1:9222/json/new?$ENCODED_URL" >"$LOG_DIR/finicky-open-last-cdp.json" 2>"$LOG_DIR/finicky-open-last-cdp.err"; then
    activate_chrome
    exit 0
  fi
fi

# Fallback when profile + CDP launches are unavailable
if [[ -n "$PROFILE_NAME" ]]; then
  open_url_with_profile "$PROFILE_NAME" "$URL" "$PI_USER_DATA_DIR" || true
  activate_chrome
  exit 0
fi

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
