"use strict";
/**
 * Chrome/CDP bootstrap helpers.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProfileDirectoryFromLocalState = parseProfileDirectoryFromLocalState;
exports.resolveChromeProfileDirectory = resolveChromeProfileDirectory;
exports.isCDPEndpointAvailable = isCDPEndpointAvailable;
exports.ensureChromeForCDP = ensureChromeForCDP;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const LOCALHOST = '127.0.0.1';
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseProfileDirectoryFromLocalState(localStateContents, profileName) {
    if (!profileName.trim()) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(localStateContents);
    }
    catch {
        return null;
    }
    const infoCache = parsed
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
function resolveChromeProfileDirectory(profileName, userDataDir) {
    const trimmed = profileName.trim();
    // If the caller already passed a profile directory name (Default/Profile N), allow it.
    const explicitDirPath = path_1.default.join(userDataDir, trimmed);
    if (trimmed && fs_1.default.existsSync(explicitDirPath) && fs_1.default.statSync(explicitDirPath).isDirectory()) {
        return trimmed;
    }
    const localStatePath = path_1.default.join(userDataDir, 'Local State');
    if (fs_1.default.existsSync(localStatePath)) {
        try {
            const localStateContents = fs_1.default.readFileSync(localStatePath, 'utf-8');
            const fromLocalState = parseProfileDirectoryFromLocalState(localStateContents, profileName);
            if (fromLocalState) {
                return fromLocalState;
            }
        }
        catch {
            // Fall through to default profile.
        }
    }
    return 'Default';
}
async function isCDPEndpointAvailable(port) {
    try {
        const response = await fetch(`http://${LOCALHOST}:${port}/json/version`);
        return response.ok;
    }
    catch {
        return false;
    }
}
async function waitForCDPEndpoint(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isCDPEndpointAvailable(port)) {
            return true;
        }
        await sleep(250);
    }
    return false;
}
function buildChromeArgs(port, profileDirectory, userDataDir) {
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
function launchChromeForCDP(port, profileDirectory, userDataDir) {
    const args = buildChromeArgs(port, profileDirectory, userDataDir);
    if (process.platform === 'darwin') {
        (0, child_process_1.spawn)('/usr/bin/open', ['-na', 'Google Chrome', '--args', ...args], {
            detached: true,
            stdio: 'ignore',
        }).unref();
        return;
    }
    // Linux fallback.
    const chromeBinary = process.env.SPLUNK_CHROME_BINARY || 'google-chrome';
    (0, child_process_1.spawn)(chromeBinary, args, {
        detached: true,
        stdio: 'ignore',
    }).unref();
}
function manualStartCommand(port, profileDirectory, userDataDir) {
    const args = buildChromeArgs(port, profileDirectory, userDataDir).join(' ');
    if (process.platform === 'darwin') {
        return `open -na "Google Chrome" --args ${args}`;
    }
    const chromeBinary = process.env.SPLUNK_CHROME_BINARY || 'google-chrome';
    return `${chromeBinary} ${args}`;
}
function syncProfileSnapshot(sourceUserDataDir, mirrorUserDataDir) {
    fs_1.default.mkdirSync(mirrorUserDataDir, { recursive: true });
    const rsyncResult = (0, child_process_1.spawnSync)('rsync', ['-a', '--delete', `${sourceUserDataDir}/`, `${mirrorUserDataDir}/`], {
        stdio: 'ignore',
    });
    const rsyncMissing = rsyncResult.error?.code === 'ENOENT';
    if (rsyncMissing) {
        // Fallback if rsync is not available.
        fs_1.default.cpSync(sourceUserDataDir, mirrorUserDataDir, {
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
        const fullPath = path_1.default.join(mirrorUserDataDir, file);
        try {
            fs_1.default.rmSync(fullPath, { force: true, recursive: true });
        }
        catch {
            // Ignore lock cleanup failures.
        }
    }
}
function patchMirroredProfilePreferences(mirrorUserDataDir, profileDirectory) {
    const prefsPath = path_1.default.join(mirrorUserDataDir, profileDirectory, 'Preferences');
    if (!fs_1.default.existsSync(prefsPath)) {
        return;
    }
    try {
        const prefs = JSON.parse(fs_1.default.readFileSync(prefsPath, 'utf-8'));
        prefs.session = prefs.session || {};
        prefs.session.restore_on_startup = 5;
        prefs.session.startup_urls = [];
        prefs.profile = prefs.profile || {};
        prefs.profile.exit_type = 'Normal';
        prefs.profile.exited_cleanly = true;
        fs_1.default.writeFileSync(prefsPath, JSON.stringify(prefs));
    }
    catch {
        // Best effort only.
    }
}
async function ensureChromeForCDP(options) {
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
    const tryLive = async (timeoutMs) => {
        launchChromeForCDP(options.port, profileDirectory);
        return waitForCDPEndpoint(options.port, timeoutMs);
    };
    const tryMirror = async (timeoutMs) => {
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
    }
    else {
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
    throw new Error(`Failed to connect to Chrome DevTools endpoint on port ${options.port}. ` +
        `Try starting Chrome in debug mode manually.\n\n` +
        `Live profile command:\n${liveCmd}` +
        (mirrorCmd ? `\n\nIsolated mirrored profile command:\n${mirrorCmd}` : '') +
        `\n\nDefaults: SPLUNK_CHROME_PREFER_MIRROR=1 and SPLUNK_CHROME_ALLOW_LIVE_PROFILE_FALLBACK=0.`);
}
