#!/usr/bin/env node

import { connect } from "./cdp.js";
import { getPreferredOwnedTargetId, rememberOwnedTarget, setActiveTarget } from "./session-state.js";

const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

const args = process.argv.slice(2);
const url = args.find((arg) => !arg.startsWith("--"));
const flags = new Set(args.filter((arg) => arg.startsWith("--")));

const useCurrentTab = flags.has("--current");
const requestNewTab = flags.has("--new");
const requestNewWindow = flags.has("--new-window");

const validFlags = new Set(["--new", "--new-window", "--current"]);

for (const flag of flags) {
  if (!validFlags.has(flag)) {
    console.log("Usage: nav.js <url> [--new] [--new-window] [--current]");
    console.log("\nExamples:");
    console.log("  nav.js https://example.com              # Open in new automation window (default)");
    console.log("  nav.js https://example.com --new        # Open in new automation tab");
    console.log("  nav.js https://example.com --current    # Navigate currently tracked automation tab");
    process.exit(1);
  }
}

if (useCurrentTab && (requestNewTab || requestNewWindow)) {
  console.error("✗ --current cannot be combined with --new or --new-window");
  process.exit(1);
}

if (requestNewTab && requestNewWindow) {
  console.error("✗ Use either --new or --new-window (not both)");
  process.exit(1);
}

if (!url) {
  console.log("Usage: nav.js <url> [--new] [--new-window] [--current]");
  console.log("\nExamples:");
  console.log("  nav.js https://example.com              # Open in new automation window (default)");
  console.log("  nav.js https://example.com --new        # Open in new automation tab");
  console.log("  nav.js https://example.com --current    # Navigate currently tracked automation tab");
  process.exit(1);
}

const mode = useCurrentTab ? "current" : requestNewTab ? "new" : "new-window";

// Global timeout
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (45s)");
  process.exit(1);
}, 45000);

try {
  log("connecting...");
  const cdp = await connect(5000);

  log("resolving target...");
  let targetId;
  let trackAsAutomationTarget = false;

  if (mode === "new" || mode === "new-window") {
    const { targetId: createdTargetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
      ...(mode === "new-window" ? { newWindow: true } : {}),
    });
    targetId = createdTargetId;
    rememberOwnedTarget(targetId);
    trackAsAutomationTarget = true;
  } else {
    const pages = await cdp.getPages();
    const ownedTargetId = getPreferredOwnedTargetId(pages);

    if (ownedTargetId) {
      targetId = ownedTargetId;
      trackAsAutomationTarget = true;
    } else if (pages.length === 1) {
      targetId = pages[0].targetId;
      console.error(
        "⚠ No tracked automation tab found; using the only open tab because --current was requested.",
      );
    } else {
      console.error("✗ No tracked automation tab found.");
      console.error("  Run nav.js <url> without --current (defaults to --new-window).\n");
      process.exit(1);
    }
  }

  log("attaching to page...");
  const sessionId = await cdp.attachToPage(targetId);

  log("navigating...");
  await cdp.navigate(sessionId, url);

  if (trackAsAutomationTarget) {
    setActiveTarget(targetId);
  }

  if (mode === "new-window") {
    console.log("✓ Opened in new automation window:", url);
  } else if (mode === "new") {
    console.log("✓ Opened in new automation tab:", url);
  } else {
    console.log("✓ Navigated current tab:", url);
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
