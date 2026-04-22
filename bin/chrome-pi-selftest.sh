#!/bin/bash

set -euo pipefail

status_script="$HOME/dotfiles/bin/chrome-pi-debug-status.sh"
debug_script="$HOME/dotfiles/bin/chrome-pi-debug.sh"

if [[ ! -x "$status_script" || ! -x "$debug_script" ]]; then
  echo "Missing required scripts."
  echo "Expected:"
  echo "  $status_script"
  echo "  $debug_script"
  exit 1
fi

root_count() {
  python3 - <<'PY'
import subprocess
out = subprocess.check_output(['ps','-axo','pid=,command='], text=True)
count = 0
for line in out.splitlines():
    t = line.strip()
    if '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' in t and 'Helper' not in t:
        count += 1
print(count)
PY
}

echo "== Chrome Pi Selftest =="
echo ""

echo "[1/4] Inventory"
"$status_script"
echo ""

echo "[2/4] Debug ensure-only"
if "$debug_script" --ensure-only; then
  echo "PASS: ensure-only"
else
  echo "WARN: ensure-only failed (see output above)"
fi
echo ""

echo "[3/4] Hyper+B UX flow"
if "$debug_script"; then
  echo "PASS: hyper+b flow"
else
  echo "FAIL: hyper+b flow"
  exit 1
fi
echo ""

echo "[4/4] External-link stability"
before_count="$(root_count)"
open "https://example.com/?pi_selftest=$(date +%s)"
sleep 2
after_count="$(root_count)"

echo "root process count: before=$before_count after=$after_count"
if [[ "$after_count" -gt "$before_count" ]]; then
  echo "WARN: root Chrome process count increased after link open"
else
  echo "PASS: process count stable after link open"
fi

echo ""
echo "Manual checks still required:"
echo "- Did Hyper+B focus your real main Chrome window?"
echo "- Did the opened link actually navigate in that same window/profile?"
