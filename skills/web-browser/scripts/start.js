#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  DEFAULT_DEBUG_PORT,
  DEFAULT_REQUIRED_PROFILE_DIRECTORY,
  DEFAULT_ISOLATED_USER_DATA_DIR,
  classifyListener,
  describeListener,
  ensureDebugSession,
} = require("./chrome-session-core.cjs");

const args = new Set(process.argv.slice(2));

const showHelp = args.has("--help") || args.has("-h");
const requestedLegacyRefresh = args.has("--refresh-profile");
const requestedHeadless = args.has("--headless");
const requestedLegacyProfileCopy = args.has("--profile");

const validArgs = new Set([
  "--help",
  "-h",
  "--refresh-profile", // kept for clear deprecation error
  "--headless", // kept for clear deprecation error
  "--profile", // kept for clear deprecation error
]);

const invalidArg = [...args].find((arg) => !validArgs.has(arg));

function printUsage(exitCode = 0) {
  console.log("Usage: start.js");
  console.log("\nEnsures a visible debuggable Chrome session on :9222 using Work profile semantics.");
  console.log(`Uses the canonical Pi profile store at ${DEFAULT_ISOLATED_USER_DATA_DIR}.`);
  console.log("Never starts headless and never kills Chrome processes.");
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

if (requestedLegacyProfileCopy || requestedLegacyRefresh) {
  console.error("✗ --profile / --refresh-profile are no longer supported.");
  console.error(`  start.js now always uses the canonical Pi profile store (${DEFAULT_ISOLATED_USER_DATA_DIR}).`);
  process.exit(1);
}

function startWatcher() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const watcherPath = join(scriptDir, "watch.js");

  spawn(process.execPath, [watcherPath], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

try {
  const result = await ensureDebugSession({
    port: DEFAULT_DEBUG_PORT,
    requiredProfileDirectory: DEFAULT_REQUIRED_PROFILE_DIRECTORY,
    launchUserDataDir: DEFAULT_ISOLATED_USER_DATA_DIR,
    rejectIsolated: false,
    autoLaunchWhenChromeNotRunning: true,
  });

  startWatcher();

  const listenerDescription = describeListener(result.listenerInfo, {});
  const listener = classifyListener(result.listenerInfo, {});

  if (result.reusedExisting) {
    console.log(
      `✓ Chrome already running on :${DEFAULT_DEBUG_PORT} (reusing existing ${listenerDescription} instance)`,
    );
  } else {
    console.log(`✓ Chrome ready on :${DEFAULT_DEBUG_PORT} (${listenerDescription}, visible window)`);
  }

  if (listener.isIsolated) {
    console.log(`ℹ Using the Pi debug profile store at ${DEFAULT_ISOLATED_USER_DATA_DIR} (Work semantics).\n   This is the canonical session for browser + Pi automation.`);
  }
} catch (error) {
  console.error(`✗ ${error.message || String(error)}`);
  process.exit(1);
}
