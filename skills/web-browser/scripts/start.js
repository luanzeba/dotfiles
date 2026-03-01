#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const useProfile = args.has("--profile");
const useHeadless = args.has("--headless");
const validArgs = new Set(["--profile", "--headless"]);

if ([...args].some(a => !validArgs.has(a))) {
  console.log("Usage: start.ts [--profile] [--headless]");
  console.log("\nOptions:");
  console.log(
    "  --profile   Copy your default Chrome profile (cookies, logins)",
  );
  console.log(
    "  --headless  Run Chrome in headless mode (no visible window)",
  );
  console.log("\nExamples:");
  console.log("  start.ts              # Start with fresh profile");
  console.log("  start.ts --profile    # Start with your Chrome profile");
  console.log("  start.ts --headless   # Start headless (no window)");
  process.exit(1);
}

// Kill existing Chrome
try {
  execSync("killall 'Google Chrome'", { stdio: "ignore" });
} catch {}

// Wait a bit for processes to fully die
await new Promise((r) => setTimeout(r, 1000));

// Setup profile directory
execSync("mkdir -p ~/.cache/scraping", { stdio: "ignore" });

if (useProfile) {
  // Sync profile with rsync (much faster on subsequent runs)
  execSync(
    `rsync -a --delete "${process.env["HOME"]}/Library/Application Support/Google/Chrome/" ~/.cache/scraping/`,
    { stdio: "pipe" },
  );
}

// Start Chrome in background (detached so Node can exit)
const chromeArgs = [
  "--remote-debugging-port=9222",
  `--user-data-dir=${process.env["HOME"]}/.cache/scraping`,
  "--profile-directory=Default",
  "--disable-search-engine-choice-screen",
  "--no-first-run",
  "--disable-features=ProfilePicker",
];

if (useHeadless) {
  chromeArgs.push("--headless=new");
}

spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  chromeArgs,
  { detached: true, stdio: "ignore" },
).unref();

// Wait for Chrome to be ready by checking the debugging endpoint
let connected = false;
for (let i = 0; i < 30; i++) {
  try {
    const response = await fetch("http://localhost:9222/json/version");
    if (response.ok) {
      connected = true;
      break;
    }
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (!connected) {
  console.error("✗ Failed to connect to Chrome");
  process.exit(1);
}

// Start background watcher for logs/network (detached)
const scriptDir = dirname(fileURLToPath(import.meta.url));
const watcherPath = join(scriptDir, "watch.js");
spawn(process.execPath, [watcherPath], { detached: true, stdio: "ignore" }).unref();

console.log(
  `✓ Chrome started on :9222${useProfile ? " with your profile" : ""}${useHeadless ? " (headless)" : ""}`,
);
