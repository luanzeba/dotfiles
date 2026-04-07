#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const useProfile = args.has("--profile");
const useHeadless = args.has("--headless");
const validArgs = new Set(["--profile", "--headless"]);

if ([...args].some((a) => !validArgs.has(a))) {
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

async function isDebugEndpointUp() {
  try {
    const response = await fetch("http://localhost:9222/json/version");
    return response.ok;
  } catch {
    return false;
  }
}

// If something is already listening on :9222, reuse it instead of killing Chrome.
if (await isDebugEndpointUp()) {
  console.log("✓ Chrome already running on :9222 (reusing existing instance)");
  process.exit(0);
}

const scrapingDir = `${process.env["HOME"]}/.cache/scraping`;

function clearSingletonLocks(userDataDir) {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      rmSync(join(userDataDir, name), { force: true });
    } catch {
      // Best effort only
    }
  }
}

// Setup profile directory
execSync(`mkdir -p ${scrapingDir}`, { stdio: "ignore" });

if (useProfile) {
  // Sync profile with rsync (much faster on subsequent runs).
  // Exclude highly volatile files that frequently disappear mid-copy.
  const rsyncCmd = [
    "rsync -a --delete",
    "--exclude='*/Sessions/*'",
    "--exclude='*/Session Storage/*'",
    "--exclude='*/Code Cache/*'",
    "--exclude='*/GPUCache/*'",
    "--exclude='*/DawnCache/*'",
    "--exclude='Crashpad/*'",
    `"${process.env["HOME"]}/Library/Application Support/Google/Chrome/"`,
    `"${scrapingDir}/"`,
  ].join(" ");

  try {
    execSync(rsyncCmd, { stdio: "pipe" });
  } catch (error) {
    // rsync 23/24 are usually transient "vanished file" races from live profiles.
    if (error?.status === 23 || error?.status === 24) {
      console.warn(
        `⚠ rsync exited with code ${error.status} (transient profile file changes). Continuing...`,
      );
    } else {
      throw error;
    }
  }

  // Patch preferences to prevent session restore and New Tab on startup.
  // This stops the copied profile from opening tabs from the last session.
  const prefsPath = join(scrapingDir, "Default", "Preferences");
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, "utf-8"));
    // 5 = open specific pages; 1 = open New Tab; 4 = continue where left off
    // Set to 5 with empty URLs so Chrome opens with just about:blank
    prefs.session = prefs.session || {};
    prefs.session.restore_on_startup = 5;
    prefs.session.startup_urls = [];
    // Mark as clean exit so Chrome doesn't show "restore pages?" bar
    prefs.profile = prefs.profile || {};
    prefs.profile.exit_type = "Normal";
    prefs.profile.exited_cleanly = true;
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    // If we can't patch prefs, continue anyway
  }
}

// Clean stale singleton files that can block Chrome startup with copied profiles.
clearSingletonLocks(scrapingDir);

// Build Chrome args
const chromeArgs = [
  "--remote-debugging-port=9222",
  `--user-data-dir=${scrapingDir}`,
  "--profile-directory=Default",
  "--disable-search-engine-choice-screen",
  "--no-first-run",
  "--disable-features=ProfilePicker",
  "--disable-session-crashed-bubble",
];

if (useHeadless) {
  chromeArgs.push("--headless=new");
}

// Start a separate Chrome instance in background (detached so Node can exit).
// `open -na` avoids interfering with an already-running personal Chrome and
// lets macOS handle window management correctly. In headless mode, spawn the
// binary directly since there's no window to manage.
if (useHeadless) {
  spawn(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    chromeArgs,
    { detached: true, stdio: "ignore" },
  ).unref();
} else {
  spawn("/usr/bin/open", ["-na", "Google Chrome", "--args", ...chromeArgs], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

// Wait for Chrome to be ready by checking the debugging endpoint
let connected = false;
for (let i = 0; i < 60; i++) {
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
  console.error("✗ Failed to connect to Chrome on :9222");
  console.error("  Tip: remove stale locks in ~/.cache/scraping and retry.");
  process.exit(1);
}

// Close extra chrome://newtab/ tabs that Chrome opened on startup.
// The copied profile's default behavior opens New Tab pages that cause window
// layering issues on macOS (New Tab renders on top, pushing real pages behind it).
// Keep one tab alive (navigated to about:blank) so nav.js has something to work with.
try {
  const resp = await fetch("http://localhost:9222/json");
  const targets = await resp.json();
  const newTabs = targets.filter(
    (t) =>
      t.type === "page" &&
      (t.url === "chrome://newtab/" || t.url === "chrome://new-tab-page/"),
  );
  // Close all but one new tab; navigate the survivor to about:blank
  for (let i = 0; i < newTabs.length; i++) {
    if (i === 0) {
      // Navigate the first new tab to about:blank instead of closing it
      await fetch(
        `http://localhost:9222/json/activate/${newTabs[i].id}`,
      );
      // Use CDP to navigate it
      const verResp = await fetch("http://localhost:9222/json/version");
      const { webSocketDebuggerUrl } = await verResp.json();
      const { default: WebSocket } = await import("ws");
      const ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise((resolve) => {
        ws.on("open", async () => {
          const msgId = 1;
          // Attach to the tab
          ws.send(
            JSON.stringify({
              id: msgId,
              method: "Target.attachToTarget",
              params: { targetId: newTabs[i].id, flatten: true },
            }),
          );
          ws.on("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.id === msgId && msg.result?.sessionId) {
              // Navigate to about:blank
              ws.send(
                JSON.stringify({
                  id: msgId + 1,
                  method: "Page.navigate",
                  params: { url: "about:blank" },
                  sessionId: msg.result.sessionId,
                }),
              );
            }
            if (msg.id === msgId + 1) {
              ws.close();
              resolve();
            }
          });
        });
      });
    } else {
      await fetch(`http://localhost:9222/json/close/${newTabs[i].id}`);
    }
  }
  // Give Chrome a moment to settle after closing tabs
  await new Promise((r) => setTimeout(r, 300));
} catch {
  // Non-fatal if we can't close tabs
}

// Start background watcher for logs/network (detached)
const scriptDir = dirname(fileURLToPath(import.meta.url));
const watcherPath = join(scriptDir, "watch.js");
spawn(process.execPath, [watcherPath], {
  detached: true,
  stdio: "ignore",
}).unref();

console.log(
  `✓ Chrome started on :9222${useProfile ? " with your profile" : ""}${useHeadless ? " (headless)" : ""}`,
);
