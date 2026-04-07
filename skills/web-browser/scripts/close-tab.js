#!/usr/bin/env node

import { connect } from "./cdp.js";

const args = new Set(process.argv.slice(2));
const closeAll = args.has("--all");
const validArgs = new Set(["--all"]);

if ([...args].some((a) => !validArgs.has(a))) {
  console.log("Usage: close-tab.js [--all]");
  console.log("\nExamples:");
  console.log("  close-tab.js        # Close current automation tab");
  console.log("  close-tab.js --all  # Close all tabs in the debug instance");
  process.exit(1);
}

// Global timeout
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (30s)");
  process.exit(1);
}, 30000);

try {
  const cdp = await connect(5000);
  const pages = await cdp.getPages();

  if (pages.length === 0) {
    console.log("✓ No tabs to close");
    cdp.close();
    process.exit(0);
  }

  if (closeAll) {
    for (const page of pages) {
      await cdp.send("Target.closeTarget", { targetId: page.targetId });
    }
    console.log(`✓ Closed ${pages.length} tab(s)`);
  } else {
    const page = pages.at(-1);
    await cdp.send("Target.closeTarget", { targetId: page.targetId });
    console.log("✓ Closed tab:", page.title || page.url || page.targetId);
  }

  cdp.close();
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
  setTimeout(() => process.exit(0), 100);
}
