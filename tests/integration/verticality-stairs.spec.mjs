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

  // dorm-room-n1 (dormitory-expansion task): a straight walkTo from here
  // would cut diagonally across the new north dormitory corridor's own west
  // wall rather than through its (1m-wide) door -- teleport into the
  // corridor first, aligned with dorm-room-n1's door (world cell x in
  // [-27,-24], z in [-3,0], center (-25.5,-1.5)).
  //
  // Unlike every other door this test walks through (all reached after a
  // long transit that gives the door's own animation plenty of real
  // wall-clock time to finish while the player is still closing the
  // distance), this one starts right next to its door -- too close for
  // walkThroughDoors' "press E every few steps while walking" approach to
  // outrun the door's own swing in this environment's slow (~1 real FPS)
  // software-rendered browser, where OPEN_DURATION's nominal 0.8 seconds
  // (doors.ts) actually takes several real seconds of animation-system
  // frames to complete. So: stand still and open it first (poll `progress`
  // the same "press and wait until it's actually done" pattern
  // dormitory-decor.spec.mjs's openContainerInFront uses for containers,
  // rather than a fixed number of presses), *then* walk the short remaining
  // distance through it.
  await debug("teleportPlayer", -22.5, 6.1, -1.5);
  await page.evaluate(() => window.__vibeDungeonDebug.setYaw(Math.PI / 2)); // face west, toward the door
  let doorOpen = false;
  for (let i = 0; i < 30 && !doorOpen; i++) {
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(300);
    const door = (await debug("getDoorStates")).find((d) => Math.abs(d.x - -24) < 0.5 && Math.abs(d.z - -2) < 0.5);
    doorOpen = !!door && door.progress >= 0.85;
  }
  assert(doorOpen, "dorm-room-n1's bedroom door actually opened");
  reached = await walkThroughDoors(-25.5, -1.5, 1.5, 60);
  assert(reached, "reached dorm-room-n1 through its bedroom door");
  pos = await debug("getPlayerPosition");
  assert(pos.y > 5.0, "still on floor 1 inside the bedroom (didn't fall back down)");

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
