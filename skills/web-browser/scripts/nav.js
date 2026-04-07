#!/usr/bin/env node

import { connect } from "./cdp.js";

const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

const args = process.argv.slice(2);
const url = args.find((arg) => !arg.startsWith("--"));
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const newTab = flags.has("--new") || flags.has("--new-window");
const newWindow = flags.has("--new-window");
const validFlags = new Set(["--new", "--new-window"]);

for (const flag of flags) {
  if (!validFlags.has(flag)) {
    console.log("Usage: nav.js <url> [--new] [--new-window]");
    console.log("\nExamples:");
    console.log("  nav.js https://example.com                    # Navigate current tab");
    console.log("  nav.js https://example.com --new              # Open in new tab");
    console.log("  nav.js https://example.com --new-window       # Open in isolated window");
    process.exit(1);
  }
}

if (!url) {
  console.log("Usage: nav.js <url> [--new] [--new-window]");
  console.log("\nExamples:");
  console.log("  nav.js https://example.com                    # Navigate current tab");
  console.log("  nav.js https://example.com --new              # Open in new tab");
  console.log("  nav.js https://example.com --new-window       # Open in isolated window");
  process.exit(1);
}

// Global timeout
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (45s)");
  process.exit(1);
}, 45000);

try {
  log("connecting...");
  const cdp = await connect(5000);

  log("getting pages...");
  let targetId;

  if (newTab) {
    log(newWindow ? "creating new window..." : "creating new tab...");
    const { targetId: newTargetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
      ...(newWindow ? { newWindow: true } : {}),
    });
    targetId = newTargetId;
  } else {
    const pages = await cdp.getPages();
    const page = pages.at(-1);
    if (!page) {
      console.error("✗ No active tab found");
      process.exit(1);
    }
    targetId = page.targetId;
  }

  log("attaching to page...");
  const sessionId = await cdp.attachToPage(targetId);

  log("navigating...");
  await cdp.navigate(sessionId, url);

  if (newWindow) {
    console.log("✓ Opened in new window:", url);
  } else {
    console.log(newTab ? "✓ Opened:" : "✓ Navigated to:", url);
  }

  log("closing...");
  cdp.close();
  log("done");
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
  setTimeout(() => process.exit(0), 100);
}
