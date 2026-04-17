#!/usr/bin/env node

import { connect } from "./cdp.js";
import { forgetOwnedTarget, getPreferredOwnedTargetId, listOpenOwnedTargetIds } from "./session-state.js";

const args = new Set(process.argv.slice(2));
const closeAll = args.has("--all");
const validArgs = new Set(["--all"]);

if ([...args].some((arg) => !validArgs.has(arg))) {
  console.log("Usage: close-tab.js [--all]");
  console.log("\nExamples:");
  console.log("  close-tab.js        # Close the active automation tab/window");
  console.log("  close-tab.js --all  # Close all tracked automation tabs/windows");
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
  const pageById = new Map(pages.map((page) => [page.targetId, page]));

  if (closeAll) {
    const ownedTargetIds = listOpenOwnedTargetIds(pages);

    if (ownedTargetIds.length === 0) {
      console.log("✓ No automation tabs/windows to close");
      cdp.close();
      process.exit(0);
    }

    for (const targetId of ownedTargetIds) {
      await cdp.send("Target.closeTarget", { targetId });
      forgetOwnedTarget(targetId);
    }

    console.log(`✓ Closed ${ownedTargetIds.length} automation tab(s)/window(s)`);
    cdp.close();
    process.exit(0);
  }

  const targetId = getPreferredOwnedTargetId(pages);
  if (!targetId) {
    console.log("✓ No tracked automation tab/window to close");
    cdp.close();
    process.exit(0);
  }

  await cdp.send("Target.closeTarget", { targetId });
  const page = pageById.get(targetId);
  forgetOwnedTarget(targetId);

  console.log("✓ Closed automation tab/window:", page?.title || page?.url || targetId);
  cdp.close();
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
  setTimeout(() => process.exit(0), 100);
}
