import { assert, installWatchdog, launchGame, walkTo } from "./harness.mjs";

// Coverage for the cellar wing's downward staircase (cellar wing task,
// rooms/cellar.ts) -- the level's first real floor -1, and the `floorForY`
// fix (tiles.ts) it needed. Mirrors verticality-stairs.spec.mjs (the real
// walk-down, floor reporting) and stairwell-wall-gaps.spec.mjs (stepping
// off the ramp's side doesn't fall out of the level) for the *upward*
// staircase, applied to this downward one.
const stopWatchdog = installWatchdog(120000);
const { browser, page, debug } = await launchGame({ viewport: { width: 700, height: 500 } });

async function walkThroughDoors(tx, tz, stop, maxSteps = 150) {
  return walkTo(page, debug, tx, tz, stop, {
    maxSteps,
    stepMs: 90,
    onStep: async (i) => {
      if (i % 3 === 0) await page.keyboard.press("KeyE");
    },
  });
}

try {
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));

  // --- The warning poster reads before the player ever reaches the stairs ---
  await debug("teleportPlayer", 5.0, 0.1, -11.0);
  await page.evaluate(() => window.__vibeDungeonDebug.setYaw(-Math.PI / 2)); // face +x, toward the east wall
  let noticeOpened = false;
  for (let pitch = -0.1; pitch >= -0.7 && !noticeOpened; pitch -= 0.1) {
    await page.evaluate((p) => window.__vibeDungeonDebug.setPitch(p), pitch);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(150);
    if ((await debug("getNoticeState")).isOpen) noticeOpened = true;
  }
  assert(noticeOpened, "room-b's warning poster opens on interact");
  const notice = await debug("getNoticeState");
  assert(notice.title === "Warning", `poster is titled "Warning" (${notice.title})`);
  await debug("closeNotice");

  // --- Real walk down: through room-b's new east opening, down the ramp,
  // into the cellar. Teleport to just past the opening (skipping the
  // corridor/room-b transit, same reasoning verticality-stairs.spec.mjs
  // uses) and walk the rest for real. ---
  await debug("teleportPlayer", 6.5, 0.1, -13.5);
  let reached = await walkThroughDoors(17, -13, 2.0, 150);
  assert(reached, "walked down the ramp and into the cellar room");
  let pos = await debug("getPlayerPosition");
  assert(pos.y < -5.5, `landed on floor -1 at the expected height (y=${pos.y.toFixed(2)}, expected ~-6)`);
  let phys = await debug("getPlayerPhysics");
  assert(phys.grounded === true, "grounded in the cellar, not falling or hovering");
  assert((await debug("getPlayerFloor")) === -1, "getPlayerFloor resolves to -1 in the cellar");

  // --- Stepping off the ramp's side mid-climb must not fall out of the
  // level (same regression class as issue #87 for the upward staircase) ---
  await debug("teleportPlayer", 10.5, -3.5, -13.0); // mid-ramp
  await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), 0); // face a perpendicular direction
  let fellOut = false;
  await page.keyboard.down("KeyW");
  try {
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(100);
      const p = await debug("getPlayerPosition");
      if (p.y < -20) {
        fellOut = true;
        break;
      }
    }
  } finally {
    await page.keyboard.up("KeyW");
  }
  assert(!fellOut, "stepping sideways off the downward ramp mid-climb doesn't fall out of the level");

  console.log("\n=== Cellar staircase tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
