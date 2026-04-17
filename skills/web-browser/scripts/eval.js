#!/usr/bin/env node

import { connect } from "./cdp.js";
import { getPreferredOwnedTargetId, setActiveTarget } from "./session-state.js";

const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

const code = process.argv.slice(2).join(" ");
if (!code) {
  console.log("Usage: eval.js 'code'");
  console.log("\nExamples:");
  console.log('  eval.js "document.title"');
  console.log("  eval.js \"document.querySelectorAll('a').length\"");
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

  log("evaluating...");
  const expression = `(async () => { return (${code}); })()`;
  const result = await cdp.evaluate(sessionId, expression);

  log("formatting result...");
  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i++) {
      if (i > 0) console.log("");
      for (const [key, value] of Object.entries(result[i])) {
        console.log(`${key}: ${value}`);
      }
    }
  } else if (typeof result === "object" && result !== null) {
    for (const [key, value] of Object.entries(result)) {
      console.log(`${key}: ${value}`);
    }
  } else {
    console.log(result);
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
