import { assert, installWatchdog, launchGame } from "./harness.mjs";

const stopWatchdog = installWatchdog(90000);
const { browser, page, debug } = await launchGame({ viewport: { width: 1000, height: 700 } });

try {
  // --- Settling: everything should drop, stop, and sleep ---
  await page.waitForTimeout(3000);
  let bodies = await debug("getDynamicBodies");
  console.log("dynamic bodies after settling:");
  for (const b of bodies) {
    console.log(`  eid=${b.eid} ${b.itemTypeId ?? "prop"} y=${b.y.toFixed(3)} speed=${b.speed.toFixed(4)} sleeping=${b.sleeping}`);
  }
  assert(bodies.length >= 9, `all props + items are simulated bodies (${bodies.length})`);
  assert(bodies.every((b) => b.speed < 0.02), "everything has come to rest");
  // Not a flat `b.y > -0.2` any more -- the cellar wing (floor -1) put real
  // dynamic props (crates) at that floor's own baseline, `floorBaseline(-1)`
  // = -FLOOR_RISE = -6, which is a legitimate resting height, not a fall.
  // Checks each body settled near *some* floor's baseline (a multiple of
  // FLOOR_RISE) rather than assuming every dynamic body lives on floor 0.
  const FLOOR_RISE = 6; // keep in sync with FLOOR_RISE in src/level/tiles.ts
  assert(
    bodies.every((b) => {
      const nearestFloorY = Math.round(b.y / FLOOR_RISE) * FLOOR_RISE;
      return b.y > nearestFloorY - 0.5;
    }),
    "nothing fell through the floor",
  );

  // The gem used to be a floor-spawned dynamic body here too, but now
  // starts inside room-a's barrel instead (see item-door-regression.spec.mjs
  // for that coverage) -- it's never a `DynamicBody`/`Object3DRef` at all as
  // a container-seeded item, so it has nothing to check for in this list.
  const sword = bodies.find((b) => b.itemTypeId === "sword");
  const lantern = bodies.find((b) => b.itemTypeId === "lantern");
  assert(sword && lantern, "sword and lantern are dynamic bodies");
  // The sword is authored at (4,7) over the tabletop (table at (4.3,7.2),
  // 0.75 tall) and starts at y=1.
  assert(sword.y > 0.6 && sword.y < 1.0, `sword fell onto the tabletop rather than the floor (y=${sword.y.toFixed(3)})`);
  assert(lantern.y < 0.35, `lantern fell to the floor (y=${lantern.y.toFixed(3)})`);

  const settledY = Object.fromEntries(bodies.map((b) => [b.eid, b.y]));

  // --- Shove test: walk into the chair and it should move ---
  // Chair #1 is at (4.3, 6.35) in room-a; player spawns at (1.5, 7.5).
  function nearest(list, x, z) {
    return list.filter((b) => !b.itemTypeId).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  }
  const chairBefore = nearest(bodies, 4.3, 6.35);

  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));
  for (let i = 0; i < 40; i++) {
    const pos = await debug("getPlayerPosition");
    const dx = chairBefore.x - pos.x;
    const dz = chairBefore.z - pos.z;
    if (Math.hypot(dx, dz) < 0.55) break;
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(100);
    await page.keyboard.up("KeyW");
  }
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1200);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(600);

  bodies = await debug("getDynamicBodies");
  const chairAfter = bodies.find((b) => b.eid === chairBefore.eid);
  const chairMoved = Math.hypot(chairAfter.x - chairBefore.x, chairAfter.z - chairBefore.z);
  assert(chairMoved > 0.05, `walking into the chair pushed it (moved ${chairMoved.toFixed(3)}m)`);

  // --- The heavy table should barely budge by comparison ---
  const table = bodies.find((b) => Math.abs(b.x - 4.3) < 0.3 && Math.abs(b.z - 7.2) < 0.3 && !b.itemTypeId);
  if (table) {
    const tableMoved = Math.abs(table.y - settledY[table.eid]);
    assert(tableMoved < 0.05, "the table stayed put vertically (didn't get launched)");
  }

  // --- Player is still standing on the floor after all that ---
  const phys = await debug("getPlayerPhysics");
  const pos = await debug("getPlayerPosition");
  assert(phys.grounded, "player is still grounded after shoving furniture");
  assert(Math.abs(pos.y) < 0.1, `player is at floor level, not standing on top of the chair (y=${pos.y.toFixed(3)})`);

  console.log("\n=== Rigid-body tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
