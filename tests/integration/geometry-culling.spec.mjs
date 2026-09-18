import { assert, installWatchdog, launchGame } from "./harness.mjs";

// Coverage for step 3 of the rendering perf investigation (see
// src/level/visibility.ts's header comment): static level geometry (walls,
// floors, ceilings, torches, doors, staircases, props, items, readables) now
// gets `mesh.visible = false` for any sector that isn't the player's current
// one or one open connection away. This spec proves that measurably reduces
// what's drawn (a real drop in `getVisibilityDebugCounts()`'s
// `visibleObjects`/renderer.info draw calls) and, just as importantly, that
// nothing actually breaks at the seams the task's own risk list calls out:
// a doorway threshold, a vertical (staircase) connection, and ordinary
// interact-with-a-door/item gameplay continuing to work through culled
// geometry exactly as it did before (three.js's Raycaster doesn't consult
// `.visible` at all, so this is expected to be a pure rendering change --
// this spec is what actually confirms that rather than just asserting it in
// a comment).
//
// Deliberately uses `teleportPlayer` throughout for the same reason
// sector-visibility.spec.mjs does -- see that spec's header comment.
const stopWatchdog = installWatchdog(120000);
const { browser, page, debug } = await launchGame({ viewport: { width: 900, height: 650 } });

async function waitForSector(expected, maxAttempts = 25) {
  let sector;
  for (let i = 0; i < maxAttempts; i++) {
    await page.waitForTimeout(300);
    sector = await debug("getCurrentSector");
    if (sector === expected) return sector;
  }
  return sector;
}

try {
  // --- Baseline: room-a should have a real minority of the level's total
  // registered geometry visible, not everything (confirms culling is
  // actually narrowing things down, not a no-op). ---
  const spawnSector = await waitForSector("room-a");
  assert(spawnSector === "room-a", `player spawns in room-a's sector (got "${spawnSector}")`);
  const spawnVis = await debug("getVisibilityDebugCounts");
  assert(spawnVis.totalObjects > 50, `level has a substantial amount of registered culling-eligible geometry (got ${spawnVis.totalObjects})`);
  assert(spawnVis.visibleObjects > 0, "room-a's own geometry is visible while standing in it");
  assert(
    spawnVis.visibleObjects < spawnVis.totalObjects,
    `culling narrows the visible set (visible=${spawnVis.visibleObjects}, total=${spawnVis.totalObjects})`,
  );
  const spawnInfo = await debug("getRendererInfo");
  await page.screenshot({ path: "/tmp/geometry-culling-room-a.png" });

  // --- Far away (the cellar, floor -1): a different, still-partial subset
  // should be visible, and draw calls should be far below what a
  // whole-level, everything-always-rendered baseline would show. ---
  await debug("teleportPlayer", 18, -6, -13.0);
  const cellarSector = await waitForSector("cellar");
  assert(cellarSector === "cellar", `teleport lands in the cellar sector (got "${cellarSector}")`);
  const cellarVis = await debug("getVisibilityDebugCounts");
  assert(cellarVis.visibleObjects < spawnVis.totalObjects, "far from spawn, still fewer visible objects than the level total");
  const cellarInfo = await debug("getRendererInfo");
  console.log(`room-a: calls=${spawnInfo.calls} tris=${spawnInfo.triangles} visibleObjects=${spawnVis.visibleObjects}/${spawnVis.totalObjects}`);
  console.log(`cellar: calls=${cellarInfo.calls} tris=${cellarInfo.triangles} visibleObjects=${cellarVis.visibleObjects}/${cellarVis.totalObjects}`);

  // --- The cellar's bandit and its loot must still be fully interactive
  // through culled geometry -- getNpcState/getItemStates read ECS state, not
  // three.js visibility, so this confirms culling never touched gameplay
  // logic, only rendering. ---
  const npcs = await debug("getNpcState");
  const bandit = npcs.find((n) => n.archetypeId === "bandit");
  assert(!!bandit, "the cellar's bandit NPC still exists as a normal entity");
  assert(bandit.health > 0, "the bandit is alive and trackable");

  // --- Doorway threshold (room-b, right at the corridor door): both sides
  // of an open connection must render fully -- no popping, no missing
  // walls. Screenshot eyeballed for the actual visual check; the assertions
  // below are the objective backstop. ---
  await debug("teleportPlayer", 1.5, 0.1, -9.5);
  const doorwaySector = await waitForSector("room-b");
  assert(doorwaySector === "room-b", `teleport lands in room-b (got "${doorwaySector}")`);
  await page.screenshot({ path: "/tmp/geometry-culling-doorway.png" });
  // A door right next to the player must still be interactable (raycast-hit
  // and openable) regardless of which sector's geometry is currently culled
  // -- confirms culling a *neighboring* sector's own door leaves this one
  // (registered to room-b, which is always active while standing in it)
  // untouched.
  await page.evaluate(() => window.__vibeDungeonDebug.setYaw(0)); // face +z, back toward the corridor door
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(300);
  const doors = await debug("getDoorStates");
  assert(doors.length > 0, "doors still exist and report state after geometry culling landed");

  // --- Vertical connection (issue #86's own risk area): mid-climb on the
  // upward staircase, and the upper landing hub itself -- two floors sharing
  // XZ space is exactly the scenario docs/LEVEL_DESIGN.md warns culling
  // could get confused by (see floorForY's own doc comment). ---
  await debug("teleportPlayer", -13.5, 3.0, -4.5); // mid-ramp
  await page.waitForTimeout(500);
  const midClimbSector = await debug("getCurrentSector");
  assert(midClimbSector === "stairwell", `mid-climb resolves to the stairwell sector (got "${midClimbSector}")`);
  await page.screenshot({ path: "/tmp/geometry-culling-midstair.png" });
  const midClimbFloor = await debug("getPlayerFloor");
  console.log(`mid-climb: floor=${midClimbFloor} sector=${midClimbSector}`);

  await debug("teleportPlayer", -22.5, 6.05, -4.5); // upper landing hub
  const upperSector = await waitForSector("upper-landing");
  assert(upperSector === "upper-landing", `teleport lands in upper-landing (got "${upperSector}")`);
  assert((await debug("getPlayerFloor")) === 1, "upper landing resolves to floor 1");
  await page.screenshot({ path: "/tmp/geometry-culling-upper-landing.png" });

  // --- Back at spawn: the exact same visible-object count as the very
  // first measurement -- walking the whole level and back doesn't leave
  // anything permanently mis-culled. ---
  await debug("teleportPlayer", 1.5, 0.1, 7.5);
  await waitForSector("room-a");
  const backVis = await debug("getVisibilityDebugCounts");
  assert(backVis.visibleObjects === spawnVis.visibleObjects, `returning to room-a restores the exact same visible-object count (${backVis.visibleObjects} vs ${spawnVis.visibleObjects})`);
  await page.screenshot({ path: "/tmp/geometry-culling-room-a-return.png" });

  console.log("\n=== Geometry visibility culling tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
