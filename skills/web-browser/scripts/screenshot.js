#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "./cdp.js";
import { getPreferredOwnedTargetId, setActiveTarget } from "./session-state.js";

const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

// Global timeout
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (15s)");
  process.exit(1);
}, 15000);

try {
  log("connecting...");
  const cdp = await connect(5000);

  log("getting pages...");
  const pages = await cdp.getPages();
  const targetId = getPreferredOwnedTargetId(pages);

  if (!targetId) {
    console.error("✗ No tracked automation tab/window found");
    console.error("  Run: nav.js <url>   # defaults to a new automation window");
    process.exit(1);
  }

  log("attaching to page...");
  const sessionId = await cdp.attachToPage(targetId);
  setActiveTarget(targetId);

  log("taking screenshot...");
  const data = await cdp.screenshot(sessionId);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `screenshot-${timestamp}.png`;
  const filepath = join(tmpdir(), filename);

  writeFileSync(filepath, data);
  console.log(filepath);

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
