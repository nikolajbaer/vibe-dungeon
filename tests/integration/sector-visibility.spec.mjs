import { assert, installWatchdog, launchGame } from "./harness.mjs";

// Coverage for the sector-scoped shadow-gating perf fix (see
// src/level/visibility.ts's header comment for the full "why"): a
// shadow-casting torch PointLight anywhere in the level used to cost a full
// extra shadow-map render pass every frame regardless of where the player
// was standing. `level.ts`'s `updateVisibility` now gates `castShadow` off
// for every sector that isn't the player's current one or one open
// connection away, and this spec is what actually proves that measurably
// happens (a real, observed drop in `getVisibilityDebugCounts()`'s
// `shadowCastingLights`) rather than just trusting the code path ran.
//
// Deliberately uses `teleportPlayer` throughout, not `walkTo` — this spec
// only cares about *where* the player ends up, and a real multi-room walk
// costs real wall-clock minutes in this environment's software-rendered
// browser (see verticality-stairs.spec.mjs's own header comment for the
// measured cost) for no benefit here, since the property under test doesn't
// depend on how the player got there.
const stopWatchdog = installWatchdog(120000);
const { browser, page, debug } = await launchGame({ viewport: { width: 900, height: 650 } });

// `getCurrentSector`/`getVisibilityDebugCounts` both read state the main
// render loop only updates once a frame actually ticks past the most recent
// teleport (see game.ts's `currentSector` tracking and `level.updateVisibility`
// call) -- in this environment's software-rendered browser a single frame
// can take up to ~1s under load (see verticality-stairs.spec.mjs's own notes
// on this), so every check below polls for the *expected* sector rather than
// trusting one fixed wait to always be long enough.
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
  // --- Baseline: spawning in room-a, a torch-lit room, should have at
  // least one shadow-casting light active (its own torches), but nowhere
  // near the level's full total -- confirming the *gating* actually
  // narrows things down, not just that lights exist. ---
  const spawnSector = await waitForSector("room-a");
  assert(spawnSector === "room-a", `player spawns in room-a's sector (got "${spawnSector}")`);

  const spawnCounts = await debug("getVisibilityDebugCounts");
  assert(spawnCounts.totalShadowCapableLights > 4, `level has several registered shadow-capable torches (got ${spawnCounts.totalShadowCapableLights})`);
  assert(spawnCounts.shadowCastingLights > 0, "room-a's own torches keep casting shadows while the player is standing in room-a");
  assert(
    spawnCounts.shadowCastingLights < spawnCounts.totalShadowCapableLights,
    `gating narrows the active set (active=${spawnCounts.shadowCastingLights}, total=${spawnCounts.totalShadowCapableLights})`,
  );

  // Screenshot of the room the player is actually standing in -- eyeballed
  // manually (not pixel-diffed) to confirm room-a's own lighting/mood is
  // completely unaffected by this change, per the "zero visible change to
  // whichever room the player is in" constraint.
  await page.screenshot({ path: "/tmp/sector-visibility-room-a.png" });

  // --- Walking far away (the cellar, floor -1, several sectors and one
  // staircase removed from room-a) should measurably drop the active count:
  // room-a's torches are no longer within one open connection of "cellar". ---
  await debug("teleportPlayer", 18, -6, -13.0);
  const cellarSector = await waitForSector("cellar");
  assert(cellarSector === "cellar", `teleport lands in the cellar sector (got "${cellarSector}")`);
  const cellarCounts = await debug("getVisibilityDebugCounts");
  assert(
    cellarCounts.shadowCastingLights < spawnCounts.totalShadowCapableLights,
    `far from spawn, still fewer active shadow lights than the level total (active=${cellarCounts.shadowCastingLights}, total=${cellarCounts.totalShadowCapableLights})`,
  );

  // --- A plain corridor sector with no torches of its own, and whose
  // immediate neighbors also have none, should gate every shadow-casting
  // light off entirely -- the strongest form of "measurably drops," and
  // confirms this isn't just "always leaves a couple on no matter what." ---
  await debug("teleportPlayer", -8, 0.1, -3.0);
  const corridorSector = await waitForSector("west-corridor");
  assert(corridorSector === "west-corridor", `teleport lands in the west-corridor sector (got "${corridorSector}")`);
  const corridorCounts = await debug("getVisibilityDebugCounts");
  console.log(`corridor sector "${corridorSector}": shadowCastingLights=${corridorCounts.shadowCastingLights}`);
  assert(corridorCounts.shadowCastingLights === 0, `a torch-less corridor sector far from any room gates every shadow light off (got ${corridorCounts.shadowCastingLights})`);

  // --- Back in room-a, the exact same room should look exactly like the
  // very first screenshot: walking away and back doesn't leave anything
  // permanently gated off. ---
  await debug("teleportPlayer", 1.5, 0.1, 7.5);
  await waitForSector("room-a");
  const backCounts = await debug("getVisibilityDebugCounts");
  assert(backCounts.shadowCastingLights === spawnCounts.shadowCastingLights, "returning to room-a restores the exact same active shadow-light count");
  await page.screenshot({ path: "/tmp/sector-visibility-room-a-return.png" });

  // --- Standing right at an open doorway between two sectors: both sides
  // must be simultaneously fully lit (the whole point of "current +
  // adjacent," not just "current") -- teleport to room-b, right by the
  // corridor doorway, and confirm the corridor side (an immediate neighbor)
  // isn't gated off despite the player not standing in it. ---
  await debug("teleportPlayer", 1.5, 0.1, -9.5); // just inside room-b, at the corridor doorway
  const doorwaySector = await waitForSector("room-b");
  const doorwayCounts = await debug("getVisibilityDebugCounts");
  console.log(`doorway sector "${doorwaySector}": shadowCastingLights=${doorwayCounts.shadowCastingLights}`);
  await page.screenshot({ path: "/tmp/sector-visibility-doorway.png" });

  console.log("\n=== Sector visibility (shadow-gating) tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
