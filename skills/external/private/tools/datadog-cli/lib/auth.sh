#!/usr/bin/env bash
# auth.sh — Cookie extraction, caching, and session management for Datadog CLI

SESSION_FILE="${DATADOG_SESSION_FILE:-$HOME/.datadog-session.json}"
SESSION_TTL="${DATADOG_SESSION_TTL:-7200}"  # 2 hours in seconds
CHROME_CDP_PORT="${DATADOG_CHROME_CDP_PORT:-9222}"
CHROME_CDP_MIRROR_USER_DATA_DIR="${DATADOG_CHROME_CDP_MIRROR_USER_DATA_DIR:-$HOME/.cache/pi-chrome-profile}"
# For safety, avoid touching the live Chrome profile unless explicitly enabled.
DATADOG_CHROME_ALLOW_LIVE_PROFILE="${DATADOG_CHROME_ALLOW_LIVE_PROFILE:-0}"
DATADOG_CHROME_ALLOW_HEADLESS_FALLBACK="${DATADOG_CHROME_ALLOW_HEADLESS_FALLBACK:-0}"

# Chrome profile defaults: use normal Chrome user data dir and the Work profile.
default_chrome_user_data_dir() {
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "$HOME/Library/Application Support/Google/Chrome"
  else
    echo "$HOME/.config/google-chrome"
  fi
}

resolve_chrome_profile_directory() {
  local user_data_dir="$1"
  local profile_name="$2"
  local explicit_profile_dir="${DATADOG_CHROME_PROFILE_DIRECTORY:-}"

  if [[ -n "$explicit_profile_dir" ]]; then
    echo "$explicit_profile_dir"
    return 0
  fi

  # If caller already passed an on-disk profile directory name (Default/Profile N), use it.
  if [[ -n "$profile_name" ]] && [[ -d "$user_data_dir/$profile_name" ]]; then
    echo "$profile_name"
    return 0
  fi

  # Resolve display name (e.g. "Work") -> profile directory from Local State.
  local local_state_path="$user_data_dir/Local State"
  if [[ -f "$local_state_path" ]] && [[ -n "$profile_name" ]]; then
    local resolved
    resolved=$(python3 - "$local_state_path" "$profile_name" <<'PY'
import json
import sys

local_state_path = sys.argv[1]
target = sys.argv[2].strip().lower()
if not target:
    sys.exit(0)

try:
    with open(local_state_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    info_cache = data.get("profile", {}).get("info_cache", {})
    for profile_dir, entry in info_cache.items():
        name = str((entry or {}).get("name", "")).strip().lower()
        if name == target:
            print(profile_dir)
            break
except Exception:
    pass
PY
)
    if [[ -n "$resolved" ]]; then
      echo "$resolved"
      return 0
    fi
  fi

  echo "Default"
}

CHROME_USER_DATA_DIR="${DATADOG_CHROME_USER_DATA_DIR:-$(default_chrome_user_data_dir)}"
CHROME_PROFILE_NAME="${DATADOG_CHROME_PROFILE:-Work}"
CHROME_PROFILE_DIRECTORY="$(resolve_chrome_profile_directory "$CHROME_USER_DATA_DIR" "$CHROME_PROFILE_NAME")"

# Backward-compatible alias used by older command scripts.
CHROME_PROFILE="$CHROME_USER_DATA_DIR"

# Check if session is valid (cached and not expired)
session_valid() {
  [[ -f "$SESSION_FILE" ]] || return 1
  python3 -c "
import json, sys, time
try:
    with open('$SESSION_FILE') as f:
        d = json.load(f)
    if time.time() - d.get('timestamp', 0) > $SESSION_TTL:
        sys.exit(1)
    if not d.get('cookies') or not d.get('csrf_token'):
        sys.exit(1)
except:
    sys.exit(1)
"
}

# Extract cookies from Chrome profile via CDP
extract_cookies() {
  local cookies_json
  cookies_json=$(DATADOG_CHROME_CDP_PORT="$CHROME_CDP_PORT" node "$SCRIPT_DIR/lib/extract-cookies.js" 2>/dev/null) || return 1
  echo "$cookies_json"
}

cookies_json_to_header() {
  local cookies_json="$1"
  printf '%s' "$cookies_json" | python3 -c "
import sys, json
cookies = json.load(sys.stdin)
parts = [f\"{c['name']}={c['value']}\" for c in cookies if c.get('domain', '').endswith('datadoghq.com')]
print('; '.join(parts))
"
}

# Get CSRF token from Datadog using cookies
get_csrf_token() {
  local cookies="$1"
  local csrf
  csrf=$(curl -s "https://app.datadoghq.com/api/v1/legacy_current_user" \
    -H "Cookie: $cookies" \
    -H "Origin: https://app.datadoghq.com" \
    2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    token = d.get('csrf_token', '')
    if not token:
        sys.exit(1)
    print(token)
except:
    sys.exit(1)
")
  echo "$csrf"
}

# Save session to cache file
save_session() {
  local cookies="$1"
  local csrf_token="$2"
  python3 -c "
import json, time
session = {
    'cookies': '''$cookies''',
    'csrf_token': '$csrf_token',
    'timestamp': time.time()
}
with open('$SESSION_FILE', 'w') as f:
    json.dump(session, f, indent=2)
"
}

# Load session from cache
load_session() {
  if [[ ! -f "$SESSION_FILE" ]]; then
    return 1
  fi
  # Sets DD_COOKIES and DD_CSRF as global variables
  eval "$(python3 -c "
import json
with open('$SESSION_FILE') as f:
    d = json.load(f)
cookies = d.get('cookies', '').replace(\"'\", \"'\\\\''\")
csrf = d.get('csrf_token', '')
print(f\"DD_COOKIES='{cookies}'\")
print(f\"DD_CSRF='{csrf}'\")
")"
}

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local fnm_node="$HOME/.local/share/fnm/current/bin/node"
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

ensure_pi_debug_session() {
  local start_script="${DATADOG_PI_START_SCRIPT:-$HOME/dotfiles/skills/web-browser/scripts/start.js}"
  if [[ ! -f "$start_script" ]]; then
    return 1
  fi

  local node_bin
  node_bin="$(resolve_node || true)"
  if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
    return 1
  fi

  "$node_bin" "$start_script" >/tmp/pi-browser-demos/datadog-last-start.txt 2>&1
}

wait_for_cdp_endpoint() {
  local retries=0
  while ! curl -s "http://localhost:${CHROME_CDP_PORT}/json" &>/dev/null; do
    sleep 0.5
    retries=$((retries + 1))
    if [[ $retries -gt 20 ]]; then
      return 1
    fi
  done
  return 0
}

cleanup_profile_lock_files() {
  local profile_dir="$1"
  local lock_files=(
    "SingletonCookie"
    "SingletonLock"
    "SingletonSocket"
    "DevToolsActivePort"
  )

  for file in "${lock_files[@]}"; do
    rm -rf "$profile_dir/$file" 2>/dev/null || true
  done
}

sync_profile_snapshot() {
  local source_dir="$1"
  local mirror_dir="$2"

  mkdir -p "$mirror_dir"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$source_dir/" "$mirror_dir/" >/dev/null 2>&1 || return 1
  else
    rm -rf "$mirror_dir"
    mkdir -p "$mirror_dir"
    cp -R "$source_dir/." "$mirror_dir/" >/dev/null 2>&1 || return 1
  fi

  cleanup_profile_lock_files "$mirror_dir"
  return 0
}

extract_cookies_via_profile() {
  local user_data_dir="$1"

  local chrome_bin
  chrome_bin=$(find_chrome)
  if [[ -z "$chrome_bin" ]]; then
    echo "Error: Chrome/Chromium not found" >&2
    return 1
  fi

  local chrome_pid
  "$chrome_bin" \
    --headless=new \
    --remote-debugging-port="$CHROME_CDP_PORT" \
    --user-data-dir="$user_data_dir" \
    --profile-directory="$CHROME_PROFILE_DIRECTORY" \
    --no-first-run \
    --disable-gpu \
    "https://app.datadoghq.com" &>/dev/null &
  chrome_pid=$!

  if ! wait_for_cdp_endpoint; then
    kill "$chrome_pid" 2>/dev/null || true
    wait "$chrome_pid" 2>/dev/null || true
    return 1
  fi

  # Wait a moment for page load and cookie setting
  sleep 2

  local cookies_json
  cookies_json=$(extract_cookies 2>/dev/null || true)

  kill "$chrome_pid" 2>/dev/null || true
  wait "$chrome_pid" 2>/dev/null || true

  if [[ -z "$cookies_json" ]]; then
    return 1
  fi

  printf '%s' "$cookies_json"
}

# Refresh session by extracting cookies from the canonical Pi Chrome debug session.
refresh_session() {
  # Check if Chrome user data dir exists
  if [[ ! -d "$CHROME_USER_DATA_DIR" ]]; then
    echo "Error: Chrome user data dir not found at $CHROME_USER_DATA_DIR" >&2
    echo "Run 'datadog login' to set up authentication." >&2
    return 1
  fi

  echo "Refreshing Datadog session..." >&2

  local cookies_json

  # 1) Ensure canonical visible Chrome debug session exists on :9222.
  if ! ensure_pi_debug_session; then
    echo "Warning: could not ensure canonical Pi debug session. Trying existing CDP endpoints..." >&2
  fi

  # 2) Primary path: extract from the active visible CDP session.
  cookies_json=$(extract_cookies 2>/dev/null || true)

  # 3) Optional headless fallback (disabled by default).
  if [[ -z "$cookies_json" && "$DATADOG_CHROME_ALLOW_HEADLESS_FALLBACK" == "1" ]]; then
    echo "Trying mirrored profile snapshot with headless fallback..." >&2
    if sync_profile_snapshot "$CHROME_USER_DATA_DIR" "$CHROME_CDP_MIRROR_USER_DATA_DIR"; then
      cookies_json=$(extract_cookies_via_profile "$CHROME_CDP_MIRROR_USER_DATA_DIR" 2>/dev/null || true)
    fi
  fi

  # 4) Optional live-profile headless fallback (also disabled by default).
  if [[ -z "$cookies_json" && "$DATADOG_CHROME_ALLOW_HEADLESS_FALLBACK" == "1" && "$DATADOG_CHROME_ALLOW_LIVE_PROFILE" == "1" ]]; then
    echo "Mirrored profile failed; trying live profile headless fallback (DATADOG_CHROME_ALLOW_LIVE_PROFILE=1)..." >&2
    cookies_json=$(extract_cookies_via_profile "$CHROME_USER_DATA_DIR" 2>/dev/null || true)
  fi

  if [[ -z "$cookies_json" ]]; then
    echo "Error: Failed to extract Datadog cookies from the canonical Chrome debug session/profile." >&2
    echo "Try running 'datadog login' and then retry." >&2
    echo "Optional fallback flags: DATADOG_CHROME_ALLOW_HEADLESS_FALLBACK=1 (and DATADOG_CHROME_ALLOW_LIVE_PROFILE=1)." >&2
    return 1
  fi

  # Parse cookies into header format
  local cookie_header
  cookie_header=$(cookies_json_to_header "$cookies_json")

  if [[ -z "$cookie_header" ]]; then
    echo "Error: No Datadog cookies found" >&2
    return 1
  fi

  # Get CSRF token
  local csrf_token
  csrf_token=$(get_csrf_token "$cookie_header")
  if [[ -z "$csrf_token" ]]; then
    echo "Error: Failed to get CSRF token. Session may have expired." >&2
    echo "Run 'datadog login' to re-authenticate." >&2
    return 1
  fi

  # Save session
  save_session "$cookie_header" "$csrf_token"
  echo "Session refreshed successfully." >&2
}

# Ensure we have valid auth — main entry point for commands
ensure_auth() {
  if session_valid; then
    load_session
    return 0
  fi

  # Try to refresh from Chrome profile
  if refresh_session; then
    load_session
    return 0
  fi

  return 1
}

# Find Chrome/Chromium binary
find_chrome() {
  if [[ "$(uname)" == "Darwin" ]]; then
    local paths=(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    )
    for p in "${paths[@]}"; do
      if [[ -x "$p" ]]; then
        echo "$p"
        return 0
      fi
    done
  else
    for cmd in google-chrome chromium chromium-browser; do
      if command -v "$cmd" &>/dev/null; then
        echo "$cmd"
        return 0
      fi
    done
  fi
  return 1
}
