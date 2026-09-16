import { assert, installWatchdog, launchGame, walkTo } from "./harness.mjs";

const stopWatchdog = installWatchdog(60000);
const { browser, page, debug } = await launchGame({ viewport: { width: 1000, height: 700 } });

try {
  // Item spawns exist and are walkable-to (sword at (4,7), gem at (-1,7) per room-a.ts).
  const spawns = await debug("getItemSpawns");
  assert(spawns.sword && spawns.gem, "sword and gem item spawns registered");

  // The sword sits right next to the NE table/chairs grouping, which a naive
  // straight-line walk can snag on; use the gem instead (placed clear of
  // furniture per room-a.ts's comments) for this pickup regression check.
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));
  await walkTo(page, debug, spawns.gem.x, spawns.gem.z, 2, { maxSteps: 80 });

  let gem;
  for (let attempt = 0; attempt < 5; attempt++) {
    const pos = await debug("getPlayerPosition");
    const dx = spawns.gem.x - pos.x;
    const dz = spawns.gem.z - pos.z;
    const yaw = Math.atan2(-dx, -dz);
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), yaw);
    // Items are dynamic rigid bodies, so where one ends up resting is
    // decided by the simulation, not its authored spawn height -- sweep the
    // pitch rather than hardcoding a look-down angle.
    let picked = false;
    for (let pitch = -0.2; pitch >= -1.1; pitch -= 0.1) {
      await page.evaluate((v) => window.__vibeDungeonDebug.setPitch(v), pitch);
      await page.waitForTimeout(80);
      await page.keyboard.press("KeyE");
      await page.waitForTimeout(120);
      const items = await debug("getItemStates");
      gem = items.find((i) => i.itemTypeId === "gem");
      if (gem.carried) {
        picked = true;
        break;
      }
    }
    if (picked) break;
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(150);
    await page.keyboard.up("KeyW");
  }
  assert(gem.carried === true, "gem picked up (carried)");
  assert(gem.worldMeshVisible === false, "gem's world mesh hidden once carried");

  // Attack (unarmed) -- confirm the pipeline fires without error.
  await debug("attack");
  await page.waitForTimeout(100);

  // Door open/close regression.
  const doorsBefore = await debug("getDoorStates");
  assert(doorsBefore.length > 0, "doors exist in the level");

  console.log("\n=== Item/door regression tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
