const { execSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DEBUG_PORT = 9222;
const DEFAULT_REQUIRED_PROFILE_DIRECTORY = "Work";
const DEFAULT_CHROME_USER_DATA_DIR =
  process.platform === "darwin"
    ? path.join(process.env.HOME || "", "Library", "Application Support", "Google", "Chrome")
    : path.join(process.env.HOME || "", ".config", "google-chrome");

const LEGACY_PI_PROFILE_USER_DATA_DIR = path.join(process.env.HOME || "", ".cache", "scraping");
const DEFAULT_PI_PROFILE_USER_DATA_DIR = path.join(process.env.HOME || "", ".cache", "pi-chrome-profile");

function endpoint(port, pathname) {
  return `http://localhost:${port}${pathname}`;
}

function normalizePath(input) {
  if (!input) return null;

  try {
    return fs.realpathSync(input);
  } catch {
    try {
      return path.resolve(input);
    } catch {
      return input;
    }
  }
}

function samePath(a, b) {
  if (!a || !b) return false;
  const na = normalizePath(a);
  const nb = normalizePath(b);
  return Boolean(na && nb && na === nb);
}

function ensureLegacySymlink(canonicalPath) {
  if (!canonicalPath || canonicalPath === LEGACY_PI_PROFILE_USER_DATA_DIR) {
    return;
  }

  try {
    const legacyExists = fs.existsSync(LEGACY_PI_PROFILE_USER_DATA_DIR);

    if (!legacyExists) {
      fs.symlinkSync(canonicalPath, LEGACY_PI_PROFILE_USER_DATA_DIR);
      return;
    }

    const legacyStat = fs.lstatSync(LEGACY_PI_PROFILE_USER_DATA_DIR);
    if (!legacyStat.isSymbolicLink()) {
      return;
    }

    const currentTarget = fs.realpathSync(LEGACY_PI_PROFILE_USER_DATA_DIR);
    const desiredTarget = normalizePath(canonicalPath);

    if (desiredTarget && currentTarget !== desiredTarget) {
      fs.rmSync(LEGACY_PI_PROFILE_USER_DATA_DIR, { force: true });
      fs.symlinkSync(canonicalPath, LEGACY_PI_PROFILE_USER_DATA_DIR);
    }
  } catch {
    // best-effort only
  }
}

function resolvePiProfileUserDataDir() {
  const configured = (process.env.PI_CHROME_PROFILE_DIR || "").trim();
  const requested = configured || DEFAULT_PI_PROFILE_USER_DATA_DIR;

  if (configured && samePath(requested, LEGACY_PI_PROFILE_USER_DATA_DIR)) {
    return LEGACY_PI_PROFILE_USER_DATA_DIR;
  }

  try {
    if (fs.existsSync(requested)) {
      ensureLegacySymlink(requested);
      return requested;
    }
  } catch {
    // continue
  }

  try {
    if (fs.existsSync(LEGACY_PI_PROFILE_USER_DATA_DIR) && !samePath(LEGACY_PI_PROFILE_USER_DATA_DIR, requested)) {
      if (!isChromeRunning()) {
        fs.mkdirSync(path.dirname(requested), { recursive: true });
        fs.renameSync(LEGACY_PI_PROFILE_USER_DATA_DIR, requested);
        ensureLegacySymlink(requested);
        return requested;
      }

      return LEGACY_PI_PROFILE_USER_DATA_DIR;
    }
  } catch {
    // continue
  }

  try {
    fs.mkdirSync(requested, { recursive: true });
    ensureLegacySymlink(requested);
  } catch {
    // best-effort only
  }

  return requested;
}

const DEFAULT_ISOLATED_USER_DATA_DIR = resolvePiProfileUserDataDir();

async function isDebugEndpointUp(port = DEFAULT_DEBUG_PORT) {
  try {
    const response = await fetch(endpoint(port, "/json/version"));
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDebugEndpoint(port = DEFAULT_DEBUG_PORT, attempts = 30, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    if (await isDebugEndpointUp(port)) {
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

function launchChromeWithDebugPort({
  port = DEFAULT_DEBUG_PORT,
  profileDirectory = DEFAULT_REQUIRED_PROFILE_DIRECTORY,
  userDataDir,
} = {}) {
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    `--profile-directory=${profileDirectory}`,
    "--disable-search-engine-choice-screen",
    "--no-first-run",
    "--disable-features=ProfilePicker",
    "--disable-session-crashed-bubble",
  ];

  if (userDataDir) {
    chromeArgs.push(`--user-data-dir=${userDataDir}`);
  }

  if (process.platform === "darwin") {
    // Use `open -a` to target the existing app/profile instance.
    spawn("/usr/bin/open", ["-a", "Google Chrome", "--args", ...chromeArgs], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }

  const chromeBinary = process.env.CHROME_BINARY || "google-chrome";
  spawn(chromeBinary, chromeArgs, {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function stripOuterQuotes(value) {
  if (!value) return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function extractFlagValue(command = "", flagName) {
  const escaped = flagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = command.match(new RegExp(`--${escaped}=((?:\"[^\"]+\")|(?:'[^']+')|(?:[^\\s]+))`));
  if (!match) return null;
  return stripOuterQuotes(match[1]);
}

function readLocalState(userDataDir) {
  if (!userDataDir) return null;

  const localStatePath = path.join(userDataDir, "Local State");
  if (!fs.existsSync(localStatePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(localStatePath, "utf-8"));
  } catch {
    return null;
  }
}

function resolveChromeProfileDirectory(profileName, userDataDir = DEFAULT_CHROME_USER_DATA_DIR) {
  const trimmed = (profileName || "").trim();
  if (!trimmed) return "Default";

  // Prefer display-name resolution first to avoid false matches when a profile
  // directory happens to be named like the display profile (e.g. "Work").
  const localState = readLocalState(userDataDir);
  const infoCache = localState?.profile?.info_cache || {};
  const target = trimmed.toLowerCase();

  for (const [profileDirectory, entry] of Object.entries(infoCache)) {
    const displayName = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : "";
    if (displayName === target) {
      return profileDirectory;
    }
  }

  const explicitPath = path.join(userDataDir, trimmed);
  if (fs.existsSync(explicitPath)) {
    return trimmed;
  }

  return "Default";
}

function readProfileDisplayName(userDataDir, profileDirectory) {
  const effectiveUserDataDir = userDataDir || DEFAULT_CHROME_USER_DATA_DIR;
  if (!effectiveUserDataDir || !profileDirectory) return null;

  const localState = readLocalState(effectiveUserDataDir);
  const infoCache = localState?.profile?.info_cache || {};
  const profileEntry = infoCache?.[profileDirectory];
  const profileName = typeof profileEntry?.name === "string" ? profileEntry.name.trim() : "";
  return profileName || null;
}

function getDebugListenerInfo(port = DEFAULT_DEBUG_PORT) {
  try {
    const pid = execSync(
      `lsof -nP -iTCP:${port} -sTCP:LISTEN -t | head -n 1`,
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

function isPiProfileDir(userDataDir, { isolatedUserDataDir = DEFAULT_ISOLATED_USER_DATA_DIR } = {}) {
  if (!userDataDir) return false;
  return (
    samePath(userDataDir, isolatedUserDataDir) ||
    samePath(userDataDir, LEGACY_PI_PROFILE_USER_DATA_DIR)
  );
}

function classifyListener(
  listenerInfo,
  {
    isolatedUserDataDir = DEFAULT_ISOLATED_USER_DATA_DIR,
  } = {},
) {
  const command = listenerInfo?.command || "";
  const userDataDir = extractFlagValue(command, "user-data-dir");
  const profileDirectory = extractFlagValue(command, "profile-directory");
  const effectiveUserDataDir = userDataDir || DEFAULT_CHROME_USER_DATA_DIR;
  const profileDisplayName = readProfileDisplayName(effectiveUserDataDir, profileDirectory);

  return {
    command,
    userDataDir,
    effectiveUserDataDir,
    profileDirectory,
    profileDisplayName,
    isHeadless: /(^|\s)--headless(?:\s|$|=)/.test(command),
    isIsolated: isPiProfileDir(effectiveUserDataDir, { isolatedUserDataDir }),
  };
}

function describeListener(listenerInfo, options = {}) {
  const parsed = classifyListener(listenerInfo, options);

  const profileBits = [parsed.profileDisplayName, parsed.profileDirectory].filter(Boolean);
  const profileSuffix = profileBits.length > 0 ? ` (${profileBits.join(" / ")})` : "";

  if (parsed.isIsolated) {
    return `Pi debug profile${profileSuffix} @ ${parsed.effectiveUserDataDir || options.isolatedUserDataDir || DEFAULT_ISOLATED_USER_DATA_DIR}`;
  }

  if (parsed.userDataDir) {
    return `custom profile${profileSuffix} @ ${parsed.userDataDir}`;
  }

  return `regular profile${profileSuffix}`;
}

function validateListenerPolicy(
  listenerInfo,
  {
    requiredProfileDirectory = DEFAULT_REQUIRED_PROFILE_DIRECTORY,
    rejectIsolated = true,
    rejectHeadless = true,
    isolatedUserDataDir = DEFAULT_ISOLATED_USER_DATA_DIR,
  } = {},
) {
  if (!listenerInfo?.command) {
    return { ok: true };
  }

  const parsed = classifyListener(listenerInfo, { isolatedUserDataDir });

  if (rejectHeadless && parsed.isHeadless) {
    return {
      ok: false,
      code: "headless_listener",
      reason: "Refusing to attach to a headless Chrome debug listener.",
    };
  }

  if (rejectIsolated && parsed.isIsolated) {
    return {
      ok: false,
      code: "isolated_listener",
      reason: `Refusing to attach to isolated listener (${parsed.effectiveUserDataDir}). Use your Work-profile debug session instead.`,
    };
  }

  if (requiredProfileDirectory) {
    const expectedDisplay = requiredProfileDirectory.trim().toLowerCase();
    const expectedDirectory = resolveChromeProfileDirectory(requiredProfileDirectory, parsed.effectiveUserDataDir)
      .toLowerCase();

    const expectedValues = [...new Set([expectedDisplay, expectedDirectory])];
    const available = [parsed.profileDisplayName, parsed.profileDirectory]
      .filter(Boolean)
      .map((value) => value.toLowerCase());

    if (available.length > 0 && !available.some((value) => expectedValues.includes(value))) {
      return {
        ok: false,
        code: "wrong_profile",
        reason: `Debug listener profile mismatch (found: ${available.join(" / ")}, expected one of: ${expectedValues.join(" / ")}).`,
      };
    }
  }

  return { ok: true };
}

function formatManualRelaunchHint({ port, requiredProfileDirectory }) {
  const profile = requiredProfileDirectory || DEFAULT_REQUIRED_PROFILE_DIRECTORY;
  const resolvedProfileDirectory = resolveChromeProfileDirectory(profile, DEFAULT_CHROME_USER_DATA_DIR);
  return [
    `Please relaunch your Chrome debug session manually (port ${port}, profile '${profile}' => '${resolvedProfileDirectory}').`,
    "Shortcut: ~/dotfiles/bin/chrome-pi-debug.sh",
  ].join("\n");
}

async function ensureDebugSession({
  port = DEFAULT_DEBUG_PORT,
  requiredProfileDirectory = DEFAULT_REQUIRED_PROFILE_DIRECTORY,
  isolatedUserDataDir = DEFAULT_ISOLATED_USER_DATA_DIR,
  launchUserDataDir = null,
  rejectIsolated = true,
  autoLaunchWhenChromeNotRunning = true,
  launchAttempts = 30,
  launchDelayMs = 500,
} = {}) {
  const policyOptions = {
    requiredProfileDirectory,
    rejectIsolated,
    isolatedUserDataDir,
  };

  if (await isDebugEndpointUp(port)) {
    const listenerInfo = getDebugListenerInfo(port);
    const validation = validateListenerPolicy(listenerInfo, policyOptions);

    if (!validation.ok) {
      throw new Error(`${validation.reason}\n${formatManualRelaunchHint({ port, requiredProfileDirectory })}`);
    }

    return {
      reusedExisting: true,
      startedBrowser: false,
      listenerInfo,
    };
  }

  if (isChromeRunning()) {
    throw new Error(
      `Chrome is running but no CDP endpoint is available on :${port}.\n` +
      "To protect your primary browsing session, this tool will not launch an isolated fallback instance.\n" +
      formatManualRelaunchHint({ port, requiredProfileDirectory }),
    );
  }

  if (!autoLaunchWhenChromeNotRunning) {
    throw new Error(
      `No CDP endpoint found on :${port}.\n` +
      formatManualRelaunchHint({ port, requiredProfileDirectory }),
    );
  }

  const launchProfileDirectory = resolveChromeProfileDirectory(requiredProfileDirectory, DEFAULT_CHROME_USER_DATA_DIR);

  launchChromeWithDebugPort({
    port,
    profileDirectory: launchProfileDirectory,
    userDataDir: launchUserDataDir,
  });

  const connected = await waitForDebugEndpoint(port, launchAttempts, launchDelayMs);
  if (!connected) {
    throw new Error(
      `Failed to connect to Chrome debug endpoint on :${port}.\n` +
      formatManualRelaunchHint({ port, requiredProfileDirectory }),
    );
  }

  const listenerInfo = getDebugListenerInfo(port);
  const validation = validateListenerPolicy(listenerInfo, policyOptions);

  if (!validation.ok) {
    throw new Error(`${validation.reason}\n${formatManualRelaunchHint({ port, requiredProfileDirectory })}`);
  }

  return {
    reusedExisting: false,
    startedBrowser: true,
    listenerInfo,
  };
}

module.exports = {
  DEFAULT_DEBUG_PORT,
  DEFAULT_REQUIRED_PROFILE_DIRECTORY,
  DEFAULT_CHROME_USER_DATA_DIR,
  DEFAULT_PI_PROFILE_USER_DATA_DIR,
  LEGACY_PI_PROFILE_USER_DATA_DIR,
  DEFAULT_ISOLATED_USER_DATA_DIR,
  resolvePiProfileUserDataDir,
  isDebugEndpointUp,
  waitForDebugEndpoint,
  isChromeRunning,
  launchChromeWithDebugPort,
  resolveChromeProfileDirectory,
  readProfileDisplayName,
  getDebugListenerInfo,
  classifyListener,
  describeListener,
  validateListenerPolicy,
  ensureDebugSession,
};
