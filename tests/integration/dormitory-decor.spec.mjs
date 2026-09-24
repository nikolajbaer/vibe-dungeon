import { assert, installWatchdog, launchGame } from "./harness.mjs";

// Smoke coverage for the dormitory/decor pass: room-a's new fireplace/
// crossed-swords props load without a load-time error (the level throws
// loudly on a bad placement -- see spawning.ts's "fail loudly" philosophy),
// and each dormitory chest is actually a real, openable, correctly-seeded
// container. Not a visual check (that's done separately via a screenshot)
// -- just confirms the level actually builds with the new furniture ids
// wired up and behaving correctly.
const stopWatchdog = installWatchdog(90000);
const { browser, page, debug } = await launchGame({ viewport: { width: 900, height: 600 } });

/** Aims a downward-ish pitch sweep at whatever's in front of the player and
 * presses interact until a container opens -- the same pattern
 * bandit-combat.spec.mjs uses for a corpse's loot panel. */
async function openContainerInFront(page, debug) {
  for (let pitch = -0.05; pitch >= -0.7; pitch -= 0.1) {
    await page.evaluate((p) => window.__vibeDungeonDebug.setPitch(p), pitch);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(150);
    if ((await debug("getContainerState")).isOpen) return true;
  }
  return false;
}

try {
  // The level loaded at all (a bad furniture id/contents throws inside
  // buildLevel before the debug hook is ever installed, so launchGame's own
  // waitForFunction would have hung/timed out instead of reaching here if
  // room-a's new fireplace/crossed-swords props, or the dormitory's new
  // bed/chest/bookshelf props, were misconfigured).
  const pos = await debug("getPlayerPosition");
  assert(Math.abs(pos.x - 1.5) < 0.1 && Math.abs(pos.z - 7.5) < 0.1, "level loaded and player spawned in room-a as usual");

  // --- Dormitory chests: each is a real Container with its seeded starting
  // loot, openable via the ordinary interact raycast. Positions are the
  // dormitory-expansion task's dorm-room-n1/s1 (each bedroom's chest sits
  // beside its own bed, at x=-25.6 -- see rooms/stairwell.ts). ---
  const containers = await debug("getContainerEntities");

  const n1Chest = containers.find((c) => Math.abs(c.x - -25.6) < 0.6 && Math.abs(c.z - -1.5) < 0.6);
  assert(!!n1Chest, "dorm-room-n1's chest exists as a container entity");
  await debug("teleportPlayer", n1Chest.x, 6.2, n1Chest.z + 0.8);
  await page.evaluate(() => window.__vibeDungeonDebug.setYaw(0)); // face -z (south), toward the chest
  assert(await openContainerInFront(page, debug), "dorm-room-n1's chest opens on interact");
  let state = await debug("getContainerState");
  assert(
    state.contents.some((i) => i.itemTypeId === "coin" && i.count === 8),
    `chest holds its seeded 8 coins (${JSON.stringify(state.contents)})`,
  );
  await debug("closeContainer");

  const s1Chest = containers.find((c) => Math.abs(c.x - -25.6) < 0.6 && Math.abs(c.z - -19.5) < 0.6);
  assert(!!s1Chest, "dorm-room-s1's chest exists as a container entity");
  await debug("teleportPlayer", s1Chest.x, 6.2, s1Chest.z + 0.8);
  await page.evaluate(() => window.__vibeDungeonDebug.setYaw(0)); // face -z (south), toward the chest
  assert(await openContainerInFront(page, debug), "dorm-room-s1's chest opens on interact");
  state = await debug("getContainerState");
  assert(
    state.contents.some((i) => i.itemTypeId === "gem"),
    `chest holds its seeded gem (${JSON.stringify(state.contents)})`,
  );
  await debug("closeContainer");

  console.log("\n=== Dormitory/decor smoke tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
