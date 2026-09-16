import { assert, installWatchdog, launchGame, walkTo } from "./harness.mjs";

// Full-traversal regression for the stairwell wing (issue #86): reaches the
// upper floor via the ramp, visits a nook, and confirms the original east
// branch (side-chamber) still works. Wall-gap-specific regressions (#87,
// #88) live in stairwell-wall-gaps.spec.mjs instead of here.
//
// Teleports past pure transit (the empty corridor stretch from spawn to
// the crossroads, and back down to the side-chamber branch) rather than
// walking it -- each simulated keyboard step costs roughly a second of
// real wall time in this environment's software-rendered browser (measured:
// a full spawn-to-crossroads-to-side-chamber walk alone exceeded a 10
// *minute* budget), and that transit isn't what's under test. The ramp
// climb itself stays a real, continuous walk: unlike a point-in-space
// teleport check, only actually walking it exercises the character
// controller's slope-climb detection over the whole run, which is the
// mechanic issue #86 depends on.
const stopWatchdog = installWatchdog(600000);
const { browser, page, debug } = await launchGame({ viewport: { width: 700, height: 500 } });

async function walkThroughDoors(tx, tz, stop, maxSteps = 150) {
  return walkTo(page, debug, tx, tz, stop, {
    maxSteps,
    stepMs: 90,
    onStep: async (i) => {
      if (i % 3 === 0) {
        await page.keyboard.press("KeyE");
        if ((await debug("getDialogueState")).isOpen) await debug("closeDialogue");
      }
    },
  });
}

try {
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));

  // Teleport to just east of the west-corridor opening (crossroads center is
  // (1.5,-4.5)) rather than walking the ~12m from spawn -- that stretch is
  // empty corridor, not part of what issue #86 changed.
  await debug("teleportPlayer", 0.5, 0.1, -4.5);
  let reached = await walkThroughDoors(-9, -4.5, 2.0, 120);
  assert(reached, "walked west through the opening and down west-corridor to the shaft entrance");
  let pos = await debug("getPlayerPosition");
  assert(Math.abs(pos.y) < 0.5, `still at floor-0 height entering the shaft (y=${pos.y.toFixed(2)})`);

  // The real climb: continue into the landing hub itself rather than
  // stopping mid-ramp (walkTo's stopDist halts short of an exact target,
  // and a 9m sloped run would otherwise read as a false "wrong height"
  // failure).
  reached = await walkThroughDoors(-21, -6, 2.0, 250);
  assert(reached, "climbed the stairs and reached the upper landing hub");
  pos = await debug("getPlayerPosition");
  let phys = await debug("getPlayerPhysics");
  assert(pos.y > 5.5, `landed on floor 1 at the expected height (y=${pos.y.toFixed(2)}, expected ~6)`);
  assert(phys.grounded === true, "grounded on the upper floor, not falling or hovering");
  assert((await debug("getPlayerFloor")) === 1, "getPlayerFloor resolves to 1 after the climb");

  // upper-room-north: world cell x in [-24,-21], z in [-3,0], center (-22.5,-1.5).
  reached = await walkThroughDoors(-22.5, -1.5, 1.5, 80);
  assert(reached, "reached upper-room-north");
  pos = await debug("getPlayerPosition");
  assert(pos.y > 5.0, "still on floor 1 inside the nook (didn't fall back down)");

  // --- Regression: the original east branch (side-chamber) still reachable ---
  // Teleport partway down the east corridor (skipping the crossroads return
  // trip and the empty stretch east of it) and walk the real remaining
  // distance into the side-chamber itself.
  await debug("teleportPlayer", 10, 0.1, -5);
  reached = await walkThroughDoors(16, -5, 2.5, 80);
  assert(reached, "the original east branch (side-chamber) still works");
  pos = await debug("getPlayerPosition");
  assert(Math.abs(pos.y) < 0.5, `back on floor 0 in the original wing (y=${pos.y.toFixed(2)})`);

  console.log("\n=== Verticality/stairwell traversal tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
