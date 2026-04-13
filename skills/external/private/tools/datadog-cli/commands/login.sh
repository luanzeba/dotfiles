#!/usr/bin/env bash
# login.sh — Open Chrome for Datadog SSO authentication

open_datadog_page() {
  # Prefer reusing the existing Chrome instance/profile so we don't interfere with
  # normal browsing sessions.
  if [[ "$(uname)" == "Darwin" ]]; then
    if pgrep -x "Google Chrome" >/dev/null 2>&1; then
      /usr/bin/open -a "Google Chrome" "https://app.datadoghq.com"
    else
      # If Chrome is not running, start a dedicated window using the configured
      # profile directory.
      /usr/bin/open -na "Google Chrome" --args \
        --profile-directory="$CHROME_PROFILE_DIRECTORY" \
        --no-first-run \
        "https://app.datadoghq.com"
    fi
    return 0
  fi

  # Linux fallback
  local chrome_bin
  chrome_bin=$(find_chrome)
  if [[ -z "$chrome_bin" ]]; then
    echo "Error: Chrome/Chromium not found" >&2
    return 1
  fi

  "$chrome_bin" \
    --profile-directory="$CHROME_PROFILE_DIRECTORY" \
    --no-first-run \
    "https://app.datadoghq.com" >/dev/null 2>&1 &
}

cmd_login() {
  local chrome_bin
  chrome_bin=$(find_chrome)
  if [[ -z "$chrome_bin" ]]; then
    echo "Error: Chrome/Chromium not found" >&2
    return 1
  fi

  # Ensure user data directory exists.
  mkdir -p "$CHROME_USER_DATA_DIR"

  echo "Opening Chrome for Datadog SSO login..."
  echo "Chrome user data dir: $CHROME_USER_DATA_DIR"
  echo "Chrome profile: ${CHROME_PROFILE_NAME} (directory: ${CHROME_PROFILE_DIRECTORY})"
  echo ""
  echo "1. Complete SSO login in the browser tab/window"
  echo "2. Wait for the Datadog dashboard to load"
  echo "3. Return here and press Enter"
  echo ""
  echo "Note: datadog login will not kill your Chrome process."
  echo ""

  open_datadog_page || return 1

  if [[ -t 0 ]]; then
    echo "Press Enter after completing SSO login..."
    read -r || true
  else
    echo "Non-interactive shell detected."
    echo "Finish login in Chrome, then run:"
    echo "  datadog auth"
    return 0
  fi

  # Remove stale session cache to force fresh extraction
  rm -f "$SESSION_FILE"

  # Try to refresh session immediately
  if refresh_session 2>/dev/null; then
    echo ""
    echo "✅ Login successful! Session cached."
  else
    echo ""
    echo "⚠️  Could not verify session. Try running 'datadog auth' to check."
  fi
}
