/**
 * Chrome/CDP bootstrap helpers.
 */

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const LOCALHOST = '127.0.0.1';

export interface EnsureChromeForCDPOptions {
  port: number;
  profileName: string;
  profileDirectory?: string;
  userDataDir: string;
  mirrorUserDataDir?: string;
  startupTimeoutMs: number;
}

export interface EnsureChromeForCDPResult {
  profileDirectory: string;
  startedBrowser: boolean;
  usedMirroredProfile: boolean;
}

interface LocalStateProfileEntry {
  name?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseProfileDirectoryFromLocalState(localStateContents: string, profileName: string): string | null {
  if (!profileName.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(localStateContents);
  } catch {
    return null;
  }

  const infoCache = (parsed as { profile?: { info_cache?: Record<string, LocalStateProfileEntry> } })
    ?.profile?.info_cache;

  if (!infoCache || typeof infoCache !== 'object') {
    return null;
  }

  const target = profileName.trim().toLowerCase();

  for (const [profileDirectory, entry] of Object.entries(infoCache)) {
    const entryName = (entry?.name || '').trim().toLowerCase();
    if (entryName === target) {
      return profileDirectory;
    }
  }

  return null;
}

export function resolveChromeProfileDirectory(profileName: string, userDataDir: string): string {
  const trimmed = profileName.trim();

  // If the caller already passed a profile directory name (Default/Profile N), allow it.
  const explicitDirPath = path.join(userDataDir, trimmed);
  if (trimmed && fs.existsSync(explicitDirPath) && fs.statSync(explicitDirPath).isDirectory()) {
    return trimmed;
  }

  const localStatePath = path.join(userDataDir, 'Local State');
  if (fs.existsSync(localStatePath)) {
    try {
      const localStateContents = fs.readFileSync(localStatePath, 'utf-8');
      const fromLocalState = parseProfileDirectoryFromLocalState(localStateContents, profileName);
      if (fromLocalState) {
        return fromLocalState;
      }
    } catch {
      // Fall through to default profile.
    }
  }

  return 'Default';
}

export async function isCDPEndpointAvailable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${LOCALHOST}:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCDPEndpoint(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isCDPEndpointAvailable(port)) {
      return true;
    }

    await sleep(250);
  }

  return false;
}

function buildChromeArgs(port: number, profileDirectory: string, userDataDir?: string): string[] {
  const args = [
    `--remote-debugging-port=${port}`,
    `--profile-directory=${profileDirectory}`,
    '--no-first-run',
    '--disable-search-engine-choice-screen',
    '--disable-features=ProfilePicker',
    '--disable-session-crashed-bubble',
  ];

  if (userDataDir) {
    args.push(`--user-data-dir=${userDataDir}`);
  }

  return args;
}

function launchChromeForCDP(port: number, profileDirectory: string, userDataDir?: string): void {
  const args = buildChromeArgs(port, profileDirectory, userDataDir);

  if (process.platform === 'darwin') {
    spawn('/usr/bin/open', ['-na', 'Google Chrome', '--args', ...args], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  // Linux fallback.
  const chromeBinary = process.env.SPLUNK_CHROME_BINARY || 'google-chrome';
  spawn(chromeBinary, args, {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function manualStartCommand(port: number, profileDirectory: string, userDataDir?: string): string {
  const args = buildChromeArgs(port, profileDirectory, userDataDir).join(' ');

  if (process.platform === 'darwin') {
    return `open -na "Google Chrome" --args ${args}`;
  }

  const chromeBinary = process.env.SPLUNK_CHROME_BINARY || 'google-chrome';
  return `${chromeBinary} ${args}`;
}

function syncProfileSnapshot(sourceUserDataDir: string, mirrorUserDataDir: string): void {
  fs.mkdirSync(mirrorUserDataDir, { recursive: true });

  const rsyncResult = spawnSync('rsync', ['-a', '--delete', `${sourceUserDataDir}/`, `${mirrorUserDataDir}/`], {
    stdio: 'ignore',
  });

  const rsyncMissing = (rsyncResult.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
  if (rsyncMissing) {
    // Fallback if rsync is not available.
    fs.cpSync(sourceUserDataDir, mirrorUserDataDir, {
      recursive: true,
      force: true,
    });
  }

  // Remove singleton locks copied from the source profile.
  const lockFiles = [
    'SingletonCookie',
    'SingletonLock',
    'SingletonSocket',
    'DevToolsActivePort',
  ];

  for (const file of lockFiles) {
    const fullPath = path.join(mirrorUserDataDir, file);
    try {
      fs.rmSync(fullPath, { force: true, recursive: true });
    } catch {
      // Ignore lock cleanup failures.
    }
  }
}

function patchMirroredProfilePreferences(mirrorUserDataDir: string, profileDirectory: string): void {
  const prefsPath = path.join(mirrorUserDataDir, profileDirectory, 'Preferences');
  if (!fs.existsSync(prefsPath)) {
    return;
  }

  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8')) as {
      session?: { restore_on_startup?: number; startup_urls?: string[] };
      profile?: { exit_type?: string; exited_cleanly?: boolean };
    };

    prefs.session = prefs.session || {};
    prefs.session.restore_on_startup = 5;
    prefs.session.startup_urls = [];

    prefs.profile = prefs.profile || {};
    prefs.profile.exit_type = 'Normal';
    prefs.profile.exited_cleanly = true;

    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    // Best effort only.
  }
}

export async function ensureChromeForCDP(options: EnsureChromeForCDPOptions): Promise<EnsureChromeForCDPResult> {
  const profileDirectory = options.profileDirectory?.trim() ||
    resolveChromeProfileDirectory(options.profileName, options.userDataDir);

  // Safer default: prefer isolated mirrored profile so we don't interfere with
  // the user's normal Chrome instance.
  const preferMirror = process.env.SPLUNK_CHROME_PREFER_MIRROR !== '0';
  const allowLiveFallback = process.env.SPLUNK_CHROME_ALLOW_LIVE_PROFILE_FALLBACK === '1';

  if (await isCDPEndpointAvailable(options.port)) {
    return {
      profileDirectory,
      startedBrowser: false,
      usedMirroredProfile: false,
    };
  }

  const tryLive = async (timeoutMs: number): Promise<boolean> => {
    launchChromeForCDP(options.port, profileDirectory);
    return waitForCDPEndpoint(options.port, timeoutMs);
  };

  const tryMirror = async (timeoutMs: number): Promise<boolean> => {
    if (!options.mirrorUserDataDir) {
      return false;
    }

    syncProfileSnapshot(options.userDataDir, options.mirrorUserDataDir);
    patchMirroredProfilePreferences(options.mirrorUserDataDir, profileDirectory);
    launchChromeForCDP(options.port, profileDirectory, options.mirrorUserDataDir);
    return waitForCDPEndpoint(options.port, timeoutMs);
  };

  if (preferMirror) {
    if (await tryMirror(options.startupTimeoutMs)) {
      return {
        profileDirectory,
        startedBrowser: true,
        usedMirroredProfile: true,
      };
    }

    if (allowLiveFallback) {
      const liveTimeoutMs = Math.min(5000, options.startupTimeoutMs);
      if (await tryLive(liveTimeoutMs)) {
        return {
          profileDirectory,
          startedBrowser: true,
          usedMirroredProfile: false,
        };
      }
    }
  } else {
    const liveTimeoutMs = Math.min(5000, options.startupTimeoutMs);
    if (await tryLive(liveTimeoutMs)) {
      return {
        profileDirectory,
        startedBrowser: true,
        usedMirroredProfile: false,
      };
    }

    const remainingTimeoutMs = Math.max(2000, options.startupTimeoutMs - liveTimeoutMs);
    if (await tryMirror(remainingTimeoutMs)) {
      return {
        profileDirectory,
        startedBrowser: true,
        usedMirroredProfile: true,
      };
    }
  }

  const liveCmd = manualStartCommand(options.port, profileDirectory);
  const mirrorCmd = options.mirrorUserDataDir
    ? manualStartCommand(options.port, profileDirectory, options.mirrorUserDataDir)
    : '';

  throw new Error(
    `Failed to connect to Chrome DevTools endpoint on port ${options.port}. ` +
    `Try starting Chrome in debug mode manually.\n\n` +
    `Live profile command:\n${liveCmd}` +
    (mirrorCmd ? `\n\nIsolated mirrored profile command:\n${mirrorCmd}` : '') +
    `\n\nDefaults: SPLUNK_CHROME_PREFER_MIRROR=1 and SPLUNK_CHROME_ALLOW_LIVE_PROFILE_FALLBACK=0.`
  );
}
