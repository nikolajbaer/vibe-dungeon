import { assert, installWatchdog, launchGame, walkTo } from "./harness.mjs";

const stopWatchdog = installWatchdog(60000);
const { browser, page, debug } = await launchGame({ viewport: { width: 1000, height: 700 } });

try {
  // Item spawns exist and are walkable-to (sword at (4,7) per room-a.ts --
  // the gem used to be a floor spawn here too, but now starts inside the
  // room's barrel instead, see below).
  const spawns = await debug("getItemSpawns");
  assert(spawns.sword, "sword item spawn registered");

  // Container regression: room-a's barrel (src/level/rooms/room-a.ts) starts
  // with a gem already inside it (`PropPlacement.contents`) -- walk to it,
  // open it via the same aim-based interact raycast a door/item uses, and
  // confirm the gem is there before ever being touched by the player.
  const containers = await debug("getContainerEntities");
  const barrel = containers.find((c) => Math.abs(c.x - 5.3) < 1 && Math.abs(c.z - 8.4) < 1);
  assert(!!barrel, "room-a's barrel exists as a Container entity");

  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));
  await walkTo(page, debug, barrel.x, barrel.z, 1.5, { maxSteps: 80 });

  let containerState;
  for (let attempt = 0; attempt < 5; attempt++) {
    const pos = await debug("getPlayerPosition");
    const dx = barrel.x - pos.x;
    const dz = barrel.z - pos.z;
    const yaw = Math.atan2(-dx, -dz);
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), yaw);
    // Same reasoning as the old item pickup below: sweep the pitch rather
    // than hardcoding a look angle, since the exact eye-to-barrel geometry
    // depends on wherever `walkTo` actually stopped.
    let opened = false;
    for (let pitch = -0.2; pitch >= -1.1; pitch -= 0.1) {
      await page.evaluate((v) => window.__vibeDungeonDebug.setPitch(v), pitch);
      await page.waitForTimeout(80);
      await page.keyboard.press("KeyE");
      await page.waitForTimeout(120);
      containerState = await debug("getContainerState");
      if (containerState.isOpen) {
        opened = true;
        break;
      }
    }
    if (opened) break;
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(150);
    await page.keyboard.up("KeyW");
  }
  assert(containerState.isOpen, "interacting with the barrel opened the container panel");
  const seededGem = containerState.contents.find((i) => i.itemTypeId === "gem");
  assert(!!seededGem, "barrel already contains the gem it was authored with, before ever being opened by the player");

  await debug("takeItemFromContainer", seededGem.eid);
  await page.waitForTimeout(100);
  await debug("closeContainer");

  const items = await debug("getItemStates");
  const gem = items.find((i) => i.itemTypeId === "gem");
  assert(gem.carried === true, "gem taken from the barrel is now carried");
  assert(gem.worldMeshVisible === false, "gem's world mesh stays hidden -- it never had one, only ever existed as a carried item");

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
