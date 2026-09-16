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
  assert(bodies.every((b) => b.y > -0.2), "nothing fell through the floor");

  const sword = bodies.find((b) => b.itemTypeId === "sword");
  const gem = bodies.find((b) => b.itemTypeId === "gem");
  const lantern = bodies.find((b) => b.itemTypeId === "lantern");
  assert(sword && gem && lantern, "sword, gem and lantern are all dynamic bodies");
  // The sword is authored at (4,7) over the tabletop (table at (4.3,7.2),
  // 0.75 tall); the gem at (-1,7) over open floor. Both start at y=1.
  assert(sword.y > 0.6 && sword.y < 1.0, `sword fell onto the tabletop rather than the floor (y=${sword.y.toFixed(3)})`);
  assert(gem.y < 0.35, `gem fell to the floor (y=${gem.y.toFixed(3)})`);
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
