import { assert, installWatchdog, launchGame, walkTo } from "./harness.mjs";

// Regression coverage for two wall-gap bugs found after the stairwell wing
// shipped (see verticality-stairs.spec.mjs for the original traversal
// check issue #86 was verified with): #87's long-side gap and #88's
// entry-header gap. Teleports straight to mid-climb rather than walking
// the ~27m transit from spawn -- that transit isn't what's under test here
// (verticality-stairs.spec.mjs already covers the real walk-up), and each
// simulated step costs roughly a second of real wall time in this
// environment's software-rendered browser, so walking it just to get to
// the interesting few meters would make this spec needlessly slow.
const stopWatchdog = installWatchdog(150000);
const { browser, page, debug } = await launchGame({ viewport: { width: 700, height: 500 } });

try {
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));

  // Mid-climb: shaft runs world x from -9 to -18 at z~-4.5; midpoint
  // x~-13.5 is where y should be roughly FLOOR_RISE/2 = 3.
  await debug("teleportPlayer", -13.5, 3, -4.5);
  let pos = await debug("getPlayerPosition");
  console.log("mid-climb position:", JSON.stringify(pos));

  // --- #87 regression: stepping sideways off the ramp mid-climb must not
  // fall out of the level anymore ---
  await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), 0); // face a perpendicular direction
  let fellOut = false;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(100);
    await page.keyboard.up("KeyW");
    const p = await debug("getPlayerPosition");
    if (p.y < -1) {
      fellOut = true;
      break;
    }
  }
  assert(!fellOut, "stepping sideways off the ramp mid-climb no longer falls out of the level (#87)");

  // --- #88 regression: the entry-header gap band (y in [3,6]) at the
  // hallway boundary (x=-9) must be blocked -- not reachable by walking off
  // the ramp (its slope ties x and y together), so teleport directly into
  // the band and try to walk further into it ---
  await debug("teleportPlayer", -8, 3.5, -4.5);
  await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.PI / 2); // face -x, into the shaft
  for (let i = 0; i < 40; i++) {
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(100);
    await page.keyboard.up("KeyW");
  }
  let gapPos = await debug("getPlayerPosition");
  assert(gapPos.x > -9.3, `entry-header gap band (y=3-6, x=-9) is blocked (stopped at x=${gapPos.x.toFixed(2)})`);

  // --- Normal doorway passage at y=0-3 through that same x=-9 boundary must
  // remain unimpeded (the actual walkway used entering the stairwell) ---
  await debug("teleportPlayer", -8, 0.1, -4.5);
  await walkTo(page, debug, -13, -4.5, 0.6, { maxSteps: 40 });
  const doorwayPos = await debug("getPlayerPosition");
  assert(doorwayPos.x < -9.5, `normal doorway passage at floor height is unimpeded (reached x=${doorwayPos.x.toFixed(2)})`);

  console.log("\n=== Stairwell wall-gap regression tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
