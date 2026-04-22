#!/bin/bash

set -euo pipefail

CANONICAL_PROFILE_DIR="${PI_CHROME_PROFILE_DIR:-$HOME/.cache/pi-chrome-profile}"
LEGACY_PROFILE_DIR="$HOME/.cache/scraping"
MAIN_PROFILE_DIR="$HOME/Library/Application Support/Google/Chrome"
BACKUP_ROOT_DIR="$HOME/.cache/pi-chrome-profile-backups"

usage() {
  cat <<'EOF'
Usage: chrome-pi-profile.sh <command>

Commands:
  status            Show canonical/legacy profile path status and profile names
  migrate           Move legacy ~/.cache/scraping to canonical profile dir and create compatibility symlink
  sync              Sync from main Chrome profile store into canonical profile dir (Chrome must be stopped)
  backup            Backup canonical profile dir into ~/.cache/pi-chrome-profile-backups/<timestamp>
  sanitize          Remove unwanted "Your Chrome" alias from Local State/profile list
  reset             Backup + resync canonical profile dir from main profile store

Env overrides:
  PI_CHROME_PROFILE_DIR   Canonical profile path (default: ~/.cache/pi-chrome-profile)
EOF
}

path_real() {
  python3 - "$1" <<'PY'
import os, sys
p = os.path.expanduser(sys.argv[1])
try:
    print(os.path.realpath(p))
except Exception:
    print(p)
PY
}

chrome_uses_profile_paths() {
  python3 - "$CANONICAL_PROFILE_DIR" "$LEGACY_PROFILE_DIR" <<'PY'
import os, subprocess, sys
canonical = os.path.realpath(os.path.expanduser(sys.argv[1]))
legacy = os.path.realpath(os.path.expanduser(sys.argv[2]))
out = subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True)
using = []
for line in out.splitlines():
    t = line.strip()
    if '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' not in t or 'Helper' in t:
        continue
    if '--user-data-dir=' not in t:
        continue
    user_data = t.split('--user-data-dir=', 1)[1].split(' ', 1)[0].strip('"\'')
    real = os.path.realpath(user_data)
    if real in {canonical, legacy}:
        using.append(t)
if using:
    print('\n'.join(using))
    raise SystemExit(0)
raise SystemExit(1)
PY
}

require_profile_not_in_use() {
  local in_use
  if in_use="$(chrome_uses_profile_paths 2>/dev/null)"; then
    echo "Chrome is currently using the Pi profile path. Please close Chrome first."
    echo "Processes:"
    echo "$in_use"
    exit 1
  fi
}

ensure_legacy_symlink() {
  mkdir -p "$(dirname "$CANONICAL_PROFILE_DIR")"
  mkdir -p "$CANONICAL_PROFILE_DIR"

  if [[ -e "$LEGACY_PROFILE_DIR" && ! -L "$LEGACY_PROFILE_DIR" ]]; then
    echo "Legacy path exists as a real directory: $LEGACY_PROFILE_DIR"
    echo "Leaving it unchanged to avoid accidental data loss."
    echo "Run migrate first after closing Chrome."
    return 0
  fi

  rm -f "$LEGACY_PROFILE_DIR"
  ln -s "$CANONICAL_PROFILE_DIR" "$LEGACY_PROFILE_DIR"
}

sanitize_local_state() {
  local local_state="$CANONICAL_PROFILE_DIR/Local State"
  if [[ ! -f "$local_state" ]]; then
    echo "No Local State found at: $local_state"
    return 0
  fi

  python3 - "$local_state" "$CANONICAL_PROFILE_DIR" <<'PY'
import json, os, sys, time
local_state_path = sys.argv[1]
profile_root = sys.argv[2]
changed = False
with open(local_state_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

info_cache = data.setdefault('profile', {}).setdefault('info_cache', {})
work_entry = info_cache.get('Work')
if isinstance(work_entry, dict) and str(work_entry.get('name', '')).strip() == 'Your Chrome':
    del info_cache['Work']
    changed = True

if changed:
    tmp = f"{local_state_path}.tmp"
    with open(tmp, 'w', encoding='utf-8') as f:
      json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, local_state_path)
    print('Updated Local State: removed Work => "Your Chrome" alias')
else:
    print('Local State already clean (no Work => "Your Chrome" alias)')

work_dir = os.path.join(profile_root, 'Work')
if os.path.isdir(work_dir):
    trash = os.path.join(profile_root, f"Work.removed.{int(time.time())}")
    os.rename(work_dir, trash)
    print(f'Moved unused Work profile directory to: {trash}')
PY
}

show_status() {
  echo "Canonical profile dir: $CANONICAL_PROFILE_DIR"
  echo "  realpath: $(path_real "$CANONICAL_PROFILE_DIR")"
  if [[ -d "$CANONICAL_PROFILE_DIR" ]]; then
    echo "  size: $(du -sh "$CANONICAL_PROFILE_DIR" 2>/dev/null | awk '{print $1}')"
  else
    echo "  size: (missing)"
  fi

  echo "Legacy profile dir: $LEGACY_PROFILE_DIR"
  if [[ -L "$LEGACY_PROFILE_DIR" ]]; then
    echo "  symlink -> $(readlink "$LEGACY_PROFILE_DIR")"
  elif [[ -e "$LEGACY_PROFILE_DIR" ]]; then
    echo "  exists as regular path"
  else
    echo "  missing"
  fi

  local in_use
  if in_use="$(chrome_uses_profile_paths 2>/dev/null)"; then
    echo "Profile currently in use by Chrome: yes"
    echo "$in_use"
  else
    echo "Profile currently in use by Chrome: no"
  fi

  local local_state="$CANONICAL_PROFILE_DIR/Local State"
  if [[ -f "$local_state" ]]; then
    echo "Profiles in Local State:"
    python3 - "$local_state" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    d = json.load(f)
for k, v in (d.get('profile', {}).get('info_cache', {}) or {}).items():
    print(f"  {k}: {v.get('name')!r}")
PY
  fi
}

migrate_profile_dir() {
  if [[ ! -e "$CANONICAL_PROFILE_DIR" && -d "$LEGACY_PROFILE_DIR" && ! -L "$LEGACY_PROFILE_DIR" ]]; then
    require_profile_not_in_use
    mkdir -p "$(dirname "$CANONICAL_PROFILE_DIR")"
    mv "$LEGACY_PROFILE_DIR" "$CANONICAL_PROFILE_DIR"
    echo "Moved legacy profile dir to canonical path."
  fi

  ensure_legacy_symlink
  sanitize_local_state
  echo "Migration complete."
}

sync_from_main() {
  require_profile_not_in_use
  if [[ ! -d "$MAIN_PROFILE_DIR" ]]; then
    echo "Main profile dir not found: $MAIN_PROFILE_DIR"
    exit 1
  fi

  mkdir -p "$CANONICAL_PROFILE_DIR"

  rsync -a --delete \
    --exclude='SingletonLock' \
    --exclude='SingletonSocket' \
    --exclude='SingletonCookie' \
    --exclude='DevToolsActivePort' \
    --exclude='*/Code Cache/*' \
    --exclude='*/GPUCache/*' \
    --exclude='*/DawnCache/*' \
    "$MAIN_PROFILE_DIR/" "$CANONICAL_PROFILE_DIR/"

  ensure_legacy_symlink
  sanitize_local_state
  echo "Sync complete."
}

backup_profile_dir() {
  if [[ ! -d "$CANONICAL_PROFILE_DIR" ]]; then
    echo "Canonical profile dir missing: $CANONICAL_PROFILE_DIR"
    exit 1
  fi

  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local backup_dir="$BACKUP_ROOT_DIR/$stamp"
  mkdir -p "$backup_dir"
  rsync -a "$CANONICAL_PROFILE_DIR/" "$backup_dir/"
  echo "Backup created: $backup_dir"
}

reset_profile_dir() {
  require_profile_not_in_use
  backup_profile_dir
  rm -rf "$CANONICAL_PROFILE_DIR"
  mkdir -p "$CANONICAL_PROFILE_DIR"
  sync_from_main
}

cmd="${1:-status}"
case "$cmd" in
  status)
    show_status
    ;;
  migrate)
    migrate_profile_dir
    ;;
  sync)
    sync_from_main
    ;;
  backup)
    backup_profile_dir
    ;;
  sanitize)
    sanitize_local_state
    ;;
  reset)
    reset_profile_dir
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd"
    usage
    exit 1
    ;;
esac
