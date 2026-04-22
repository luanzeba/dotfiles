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
function isChromeProcessRunning() {
    const result = (0, child_process_1.spawnSync)('pgrep', ['-x', 'Google Chrome'], { stdio: 'ignore' });
    return result.status === 0;
}
function resolveSharedChromeCorePath() {
    if (process.env.SPLUNK_SHARED_CHROME_CORE_MODULE) {
        return process.env.SPLUNK_SHARED_CHROME_CORE_MODULE;
    }
    return path_1.default.resolve(__dirname, '../../../../../web-browser/scripts/chrome-session-core.cjs');
}
function loadSharedChromeCore() {
    const modulePath = resolveSharedChromeCorePath();
    if (!fs_1.default.existsSync(modulePath)) {
        return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(modulePath);
    if (typeof loaded?.ensureDebugSession !== 'function') {
        return null;
    }
    return loaded;
}
async function ensureChromeForCDP(options) {
    const profileDirectory = options.profileDirectory?.trim() ||
        resolveChromeProfileDirectory(options.profileName, options.userDataDir);
    const autoStart = process.env.SPLUNK_CHROME_AUTO_START === '1';
    const allowMirrorAutoStart = process.env.SPLUNK_CHROME_ALLOW_MIRROR_AUTOSTART === '1';
    const sharedCore = loadSharedChromeCore();
    const requestedPolicyProfile = (options.profileName || profileDirectory).trim();
    const canUseSharedPolicy = Boolean(sharedCore && options.port === 9222);
    if (canUseSharedPolicy && sharedCore) {
        const launchAttempts = Math.max(10, Math.ceil(options.startupTimeoutMs / 500));
        const canonicalProfileStore = options.mirrorUserDataDir ||
            sharedCore.DEFAULT_ISOLATED_USER_DATA_DIR ||
            options.userDataDir;
        const result = await sharedCore.ensureDebugSession({
            port: options.port,
            requiredProfileDirectory: requestedPolicyProfile,
            isolatedUserDataDir: canonicalProfileStore,
            launchUserDataDir: canonicalProfileStore,
            rejectIsolated: false,
            autoLaunchWhenChromeNotRunning: autoStart,
            launchAttempts,
            launchDelayMs: 500,
        });
        return {
            profileDirectory,
            startedBrowser: result.startedBrowser ?? !result.reusedExisting,
            usedMirroredProfile: canonicalProfileStore !== options.userDataDir,
        };
    }
    if (await isCDPEndpointAvailable(options.port)) {
        return {
            profileDirectory,
            startedBrowser: false,
            usedMirroredProfile: false,
        };
    }
    const liveCmd = manualStartCommand(options.port, profileDirectory);
    const mirrorCmd = options.mirrorUserDataDir
        ? manualStartCommand(options.port, profileDirectory, options.mirrorUserDataDir)
        : '';
    if (!autoStart) {
        if (isChromeProcessRunning()) {
            throw new Error(`Chrome is running but no CDP endpoint is available on port ${options.port}. ` +
                `To avoid touching your existing browser session, splunk-cli will not auto-start an isolated Chrome instance.\n\n` +
                `Please relaunch your existing Chrome session with remote debugging enabled (profile: ${profileDirectory}).\n` +
                `Manual command:\n${liveCmd}\n\n` +
                `Set SPLUNK_CHROME_AUTO_START=1 only if you explicitly want splunk-cli to launch Chrome for you.`);
        }
        throw new Error(`No CDP endpoint found on port ${options.port}. ` +
            `Start Chrome in debug mode manually (profile: ${profileDirectory}) and retry.\n\n` +
            `Manual command:\n${liveCmd}\n\n` +
            `Set SPLUNK_CHROME_AUTO_START=1 only if you explicitly want splunk-cli to launch Chrome for you.`);
    }
    if (isChromeProcessRunning()) {
        throw new Error(`Chrome is already running but no CDP endpoint is available on port ${options.port}. ` +
            `Refusing to launch another Chrome instance automatically to avoid disrupting your session.\n\n` +
            `Please relaunch Chrome with remote debugging enabled (profile: ${profileDirectory}).\n` +
            `Manual command:\n${liveCmd}`);
    }
    launchChromeForCDP(options.port, profileDirectory);
    if (await waitForCDPEndpoint(options.port, options.startupTimeoutMs)) {
        return {
            profileDirectory,
            startedBrowser: true,
            usedMirroredProfile: false,
        };
    }
    if (allowMirrorAutoStart && options.mirrorUserDataDir) {
        syncProfileSnapshot(options.userDataDir, options.mirrorUserDataDir);
        patchMirroredProfilePreferences(options.mirrorUserDataDir, profileDirectory);
        launchChromeForCDP(options.port, profileDirectory, options.mirrorUserDataDir);
        if (await waitForCDPEndpoint(options.port, options.startupTimeoutMs)) {
            return {
                profileDirectory,
                startedBrowser: true,
                usedMirroredProfile: true,
            };
        }
    }
    throw new Error(`Failed to connect to Chrome DevTools endpoint on port ${options.port}.\n\n` +
        `Manual command:\n${liveCmd}` +
        (mirrorCmd ? `\n\nOptional isolated fallback (explicit opt-in only):\n${mirrorCmd}` : '') +
        `\n\nAuto-start flags:\n` +
        `- SPLUNK_CHROME_AUTO_START=1 (allow live profile autostart)\n` +
        `- SPLUNK_CHROME_ALLOW_MIRROR_AUTOSTART=1 (allow isolated fallback autostart)`);
}
