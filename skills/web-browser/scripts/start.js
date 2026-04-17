#!/usr/bin/env node

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const DEBUG_PORT = 9222;
const LEGACY_ISOLATED_DIR = `${process.env["HOME"]}/.cache/scraping`;
const ISOLATED_DIR = LEGACY_ISOLATED_DIR;
const CHROME_PROFILE_SOURCE = `${process.env["HOME"]}/Library/Application Support/Google/Chrome`;

const showHelp = args.has("--help") || args.has("-h");
const refreshProfile = args.has("--refresh-profile");
const requestedHeadless = args.has("--headless");
const requestedLegacyProfileCopy = args.has("--profile");

const validArgs = new Set([
  "--refresh-profile",
  "--headless", // kept only for clearer deprecation errors
  "--profile", // kept only for clearer deprecation errors
  "--help",
  "-h",
]);

const invalidArg = [...args].find((arg) => !validArgs.has(arg));

function printUsage(exitCode = 0) {
  console.log("Usage: start.js [--refresh-profile]");
  console.log("\nStarts or reuses a visible debuggable Chrome session on :9222.");
  console.log("Never starts headless and never kills existing Chrome processes.");
  console.log("\nBehavior:");
  console.log("  1) Try regular Chrome profile first");
  console.log("  2) If CDP is blocked on regular profile, fall back to Pi isolated profile");
  console.log(`     (${ISOLATED_DIR})`);
  console.log("\nOptions:");
  console.log("  --refresh-profile  Re-sync isolated profile from regular Chrome profile before launch");
  process.exit(exitCode);
}

if (showHelp) {
  printUsage(0);
}

if (invalidArg) {
  console.error(`✗ Unknown argument: ${invalidArg}`);
  printUsage(1);
}

if (requestedHeadless) {
  console.error("✗ --headless is disabled by policy.");
  console.error("  This skill must use visible Chrome windows only.");
  process.exit(1);
}

if (requestedLegacyProfileCopy) {
  console.error("✗ --profile (legacy mode) has been removed.");
  console.error("  Use default behavior or --refresh-profile.");
  process.exit(1);
}

function endpoint(pathname) {
  return `http://localhost:${DEBUG_PORT}${pathname}`;
}

async function isDebugEndpointUp() {
  try {
    const response = await fetch(endpoint("/json/version"));
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDebugEndpoint(attempts = 60, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    if (await isDebugEndpointUp()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

function isChromeRunning() {
  try {
    execSync('pgrep -x "Google Chrome" >/dev/null', { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function launchRegularChromeWithDebugPort() {
  const chromeArgs = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--remote-allow-origins=*",
    "--disable-search-engine-choice-screen",
    "--no-first-run",
  ];

  // Use `open -a` (not `-na`) to target the regular app/profile.
  spawn("/usr/bin/open", ["-a", "Google Chrome", "--args", ...chromeArgs], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function launchIsolatedChromeWithDebugPort() {
  const chromeArgs = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${ISOLATED_DIR}`,
    "--profile-directory=Default",
    "--disable-search-engine-choice-screen",
    "--no-first-run",
    "--disable-features=ProfilePicker",
    "--disable-session-crashed-bubble",
  ];

  // Use `open -na` for an isolated app instance that does not interfere with existing browsing windows.
  spawn("/usr/bin/open", ["-na", "Google Chrome", "--args", ...chromeArgs], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function getDebugListenerInfo() {
  try {
    const pid = execSync(
      `lsof -nP -iTCP:${DEBUG_PORT} -sTCP:LISTEN -t | head -n 1`,
      { encoding: "utf-8" },
    ).trim();

    if (!pid) return null;

    const command = execSync(`ps -p ${pid} -o command=`, {
      encoding: "utf-8",
    }).trim();

    return {
      pid,
      command,
    };
  } catch {
    return null;
  }
}

function extractUserDataDir(command = "") {
  const match = command.match(/--user-data-dir=([^\s]+)/);
  return match?.[1] || null;
}

function classifyListener(listenerInfo) {
  const command = listenerInfo?.command || "";
  const userDataDir = extractUserDataDir(command);
  return {
    isHeadless: /(^|\s)--headless(?:\s|$|=)/.test(command),
    userDataDir,
    isIsolated: userDataDir === ISOLATED_DIR,
    isRegular: !userDataDir,
  };
}

function describeListener(listenerInfo) {
  const { userDataDir, isIsolated, isRegular } = classifyListener(listenerInfo);

  if (isRegular) return "regular profile";
  if (isIsolated) return "Pi isolated profile";
  return `custom profile (${userDataDir})`;
}

function enforceListenerPolicy(listenerInfo) {
  if (!listenerInfo?.command) {
    // Best effort only. If we can't inspect command line, continue.
    return true;
  }

  const { isHeadless } = classifyListener(listenerInfo);

  if (isHeadless) {
    console.error("✗ Refusing to attach to a headless Chrome instance.");
    console.error("  Close it manually and rerun ./scripts/start.js.");
    return false;
  }

  return true;
}

function clearSingletonLocks(userDataDir) {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      rmSync(join(userDataDir, name), { force: true });
    } catch {
      // Best effort only
    }
  }
}

function syncIsolatedProfile(force = false) {
  const prefsPath = join(ISOLATED_DIR, "Default", "Preferences");
  if (!force && existsSync(prefsPath)) {
    return false;
  }

  execSync(`mkdir -p "${ISOLATED_DIR}"`, { stdio: "ignore" });

  const rsyncCmd = [
    "rsync -a --delete",
    "--exclude='*/Sessions/*'",
    "--exclude='*/Session Storage/*'",
    "--exclude='*/Code Cache/*'",
    "--exclude='*/GPUCache/*'",
    "--exclude='*/DawnCache/*'",
    "--exclude='Crashpad/*'",
    `"${CHROME_PROFILE_SOURCE}/"`,
    `"${ISOLATED_DIR}/"`,
  ].join(" ");

  try {
    execSync(rsyncCmd, { stdio: "pipe" });
  } catch (error) {
    // rsync 23/24 are usually transient "vanished file" races from live profiles.
    if (error?.status !== 23 && error?.status !== 24) {
      throw error;
    }
  }

  try {
    const prefs = JSON.parse(readFileSync(prefsPath, "utf-8"));
    prefs.session = prefs.session || {};
    prefs.session.restore_on_startup = 5;
    prefs.session.startup_urls = [];
    prefs.profile = prefs.profile || {};
    prefs.profile.exit_type = "Normal";
    prefs.profile.exited_cleanly = true;
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    // Non-fatal.
  }

  return true;
}

function getChromeMajorVersion() {
  try {
    const raw = execSync(
      '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version',
      { encoding: "utf-8" },
    ).trim();

    const match = raw.match(/(\d+)\./);
    if (!match) return null;
    return Number(match[1]);
  } catch {
    return null;
  }
}

function startWatcher() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const watcherPath = join(scriptDir, "watch.js");

  spawn(process.execPath, [watcherPath], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

async function attachOrExit() {
  if (!(await isDebugEndpointUp())) return false;

  const listenerInfo = getDebugListenerInfo();
  if (!enforceListenerPolicy(listenerInfo)) {
    process.exit(1);
  }

  startWatcher();
  console.log(
    `✓ Chrome already running on :${DEBUG_PORT} (reusing existing ${describeListener(listenerInfo)} instance)`,
  );
  return true;
}

if (await attachOrExit()) {
  process.exit(0);
}

const chromeWasAlreadyRunning = isChromeRunning();
const chromeMajorVersion = getChromeMajorVersion();
const regularCdpLikelyBlocked = chromeMajorVersion !== null && chromeMajorVersion >= 136;

if (!regularCdpLikelyBlocked) {
  // First attempt: regular profile.
  launchRegularChromeWithDebugPort();
  const regularConnected = await waitForDebugEndpoint(10, 500);

  if (regularConnected) {
    const listenerInfo = getDebugListenerInfo();
    if (!enforceListenerPolicy(listenerInfo)) {
      process.exit(1);
    }

    startWatcher();
    console.log(`✓ Chrome ready on :${DEBUG_PORT} (${describeListener(listenerInfo)}, visible window)`);
    process.exit(0);
  }

  console.warn("⚠ Could not expose CDP on your primary Chrome profile.");
} else {
  console.warn(
    `⚠ Chrome ${chromeMajorVersion} blocks CDP on the primary profile; skipping regular-profile attempt.`,
  );
}

console.warn("  Falling back to an isolated Pi debug profile to avoid touching your browsing session.");
if (chromeWasAlreadyRunning) {
  console.warn("  (Your existing Chrome windows remain untouched.)");
}

try {
  const synced = syncIsolatedProfile(refreshProfile);
  if (synced) {
    console.log("✓ Synced isolated profile from regular Chrome profile");
  }
} catch (error) {
  console.error("✗ Failed to prepare isolated profile:", error.message || String(error));
  process.exit(1);
}

clearSingletonLocks(ISOLATED_DIR);
launchIsolatedChromeWithDebugPort();

const isolatedConnected = await waitForDebugEndpoint(60, 500);
if (!isolatedConnected) {
  console.error(`✗ Failed to connect to Chrome on :${DEBUG_PORT}`);
  console.error("  Could not start debuggable Chrome automatically.");
  console.error("  You can retry with a fresh profile sync:");
  console.error("    ./scripts/start.js --refresh-profile");
  process.exit(1);
}

const listenerInfo = getDebugListenerInfo();
if (!enforceListenerPolicy(listenerInfo)) {
  process.exit(1);
}

startWatcher();
console.log(`✓ Chrome ready on :${DEBUG_PORT} (${describeListener(listenerInfo)}, visible window)`);
