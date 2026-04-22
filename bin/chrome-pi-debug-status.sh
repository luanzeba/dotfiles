#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CORE_MODULE="$DOTFILES_DIR/skills/web-browser/scripts/chrome-session-core.cjs"

if [[ ! -f "$CORE_MODULE" ]]; then
  echo "Missing shared core module: $CORE_MODULE"
  exit 1
fi

CORE_MODULE_PATH="$CORE_MODULE" node - <<'NODE'
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const core = require(process.env.CORE_MODULE_PATH);

const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_USER_DATA_DIR = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Google', 'Chrome');
const ISOLATED_USER_DATA_DIR = core.DEFAULT_ISOLATED_USER_DATA_DIR;
const LEGACY_ISOLATED_USER_DATA_DIR = core.LEGACY_PI_PROFILE_USER_DATA_DIR;

function frontmostApp() {
  try {
    return execSync("osascript -e 'tell application \"System Events\" to get name of first process whose frontmost is true' 2>/dev/null", {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function extractFlagValue(command = '', flagName) {
  const escaped = flagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = command.match(new RegExp(`--${escaped}=((?:"[^"]+")|(?:'[^']+')|(?:[^\\s]+))`));
  if (!match) return null;
  const value = match[1];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function samePath(a, b) {
  if (!a || !b) return false;
  try {
    return path.resolve(a) === path.resolve(b) || fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function listChromeRootProcesses() {
  const out = execSync('ps -axo pid=,command=', { encoding: 'utf8' });
  const rows = [];

  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.includes(CHROME_BIN)) continue;
    if (trimmed.includes('Helper')) continue;

    const [pidText, ...rest] = trimmed.split(' ');
    const pid = Number.parseInt(pidText, 10);
    if (!Number.isFinite(pid)) continue;

    const command = rest.join(' ').trim();
    const userDataDir = extractFlagValue(command, 'user-data-dir');
    const profileDirectory = extractFlagValue(command, 'profile-directory');
    const debugPort = Number.parseInt(extractFlagValue(command, 'remote-debugging-port') || '', 10);
    const effectiveUserDataDir = userDataDir || DEFAULT_USER_DATA_DIR;
    const profileDisplayName = core.readProfileDisplayName(effectiveUserDataDir, profileDirectory);

    let kind = 'main';
    if (
      samePath(effectiveUserDataDir, ISOLATED_USER_DATA_DIR) ||
      samePath(effectiveUserDataDir, LEGACY_ISOLATED_USER_DATA_DIR)
    ) {
      kind = 'pi-debug-profile';
    } else if (userDataDir && !samePath(userDataDir, DEFAULT_USER_DATA_DIR)) {
      kind = 'custom-user-data-dir';
    } else if (userDataDir && samePath(userDataDir, DEFAULT_USER_DATA_DIR)) {
      kind = 'main-explicit-user-data-dir';
    }

    rows.push({
      pid,
      kind,
      debugPort: Number.isFinite(debugPort) ? debugPort : null,
      userDataDir: userDataDir || '(default)',
      effectiveUserDataDir,
      profileDirectory: profileDirectory || '(none)',
      profileDisplayName: profileDisplayName || '(unknown)',
      command,
    });
  }

  return rows.sort((a, b) => a.pid - b.pid);
}

async function fetchDebugTabs(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!res.ok) return [];
    const data = await res.json();
    return data
      .filter((entry) => entry.type === 'page')
      .map((entry) => ({ title: entry.title || '(untitled)', url: entry.url || '' }));
  } catch {
    return [];
  }
}

(async () => {
  const rows = listChromeRootProcesses();

  console.log(`Frontmost app: ${frontmostApp()}`);
  console.log(`Chrome root process count: ${rows.length}`);

  if (rows.length === 0) {
    return;
  }

  for (const row of rows) {
    console.log(`\nPID ${row.pid}`);
    console.log(`  kind: ${row.kind}`);
    console.log(`  debugPort: ${row.debugPort ?? '(none)'}`);
    console.log(`  profileDirectory flag: ${row.profileDirectory}`);
    console.log(`  profile display name: ${row.profileDisplayName}`);
    console.log(`  userDataDir: ${row.userDataDir}`);

    if (row.debugPort) {
      const tabs = await fetchDebugTabs(row.debugPort);
      if (tabs.length === 0) {
        console.log('  tabs (via CDP): (none or unavailable)');
      } else {
        console.log('  tabs (via CDP):');
        for (const tab of tabs) {
          console.log(`    - ${tab.title}`);
          console.log(`      ${tab.url}`);
        }
      }
    } else {
      console.log('  tabs: unavailable (no debug port exposed by this process)');
    }
  }
})();
NODE
