import { assert, installWatchdog, launchGame } from "./harness.mjs";

const stopWatchdog = installWatchdog(120000);
const { browser, page, debug } = await launchGame({ viewport: { width: 1000, height: 700 } });

function getBandit(npcs) {
  return npcs.find((n) => n.archetypeId === "bandit");
}

try {
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));

  // The bandit relocated from room-b to the cellar (cellar wing task) --
  // see rooms/cellar.ts -- and now sits at (18, -13.0, floor -1) behind a
  // real (unlocked) hinged door, with the same 6m aggroRange (bandit.ts).
  // Its cellar room is only 6m x 6m, so almost the entire room is already
  // within aggro range of a centrally-placed bandit -- there's no spot
  // inside the room itself that's meaningfully "outside aggro range" to
  // teleport to. Instead, teleport onto the downward ramp itself (see
  // cellar.ts/stairBuilder.ts) at the one point ~6m out along it -- the
  // ramp climbs linearly from (x=15,y=-6) to (x=6,y=0), so x=12 is exactly
  // 1/3 of the way up, at y=-4 (an already-established pattern -- see
  // stairwell-wall-gaps.spec.mjs's own mid-climb teleport).
  //
  // Aggro fires the moment the player is within 6m -- which, from the ramp,
  // is still on the *other side of the closed door* from the bandit, so the
  // bandit's own CHASING movement gets stuck at the doorway (an NPC never
  // opens a door itself -- only the player's own interact does, see
  // `tryInteract` in ecs/systems/doors.ts). So unlike the old room-b
  // version, this loop doesn't stop the instant aggro fires -- it keeps
  // walking (and pressing `KeyE` periodically, which opens the door once in
  // range) all the way up to the bandit, exactly what a real player would
  // do, rather than standing on the ramp waiting for a bandit that can't
  // reach them.
  await debug("teleportPlayer", 12, -3.9, -13.0);
  for (let i = 0; i < 150; i++) {
    const bandit = getBandit(await debug("getNpcState"));
    const pos = await debug("getPlayerPosition");
    const dx = bandit.x - pos.x;
    const dz = bandit.z - pos.z;
    if (Math.hypot(dx, dz) < 1.3) break;
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(100);
    await page.keyboard.up("KeyW");
    if (i % 3 === 0) {
      await page.keyboard.press("KeyE");
      // The route passes through the villager on the x=1.5 spine, so a
      // blind interact can open its dialogue; dismiss it and carry on.
      if ((await debug("getDialogueState")).isOpen) await debug("closeDialogue");
    }
  }

  let npcs = await debug("getNpcState");
  let bandit = getBandit(npcs);
  assert(bandit.state === "CHASING" || bandit.state === "ATTACKING", `bandit aggroed (state=${bandit.state})`);

  let health = await debug("getHealth");
  const startHealth = health.current;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(200);
    npcs = await debug("getNpcState");
    bandit = getBandit(npcs);
    health = await debug("getHealth");
    if (bandit.state === "ATTACKING" && health.current < startHealth) break;
  }
  assert(bandit.state === "ATTACKING", `bandit reached ATTACKING (state=${bandit.state})`);
  assert(health.current < startHealth, `player took damage from bandit (${health.current} < ${startHealth})`);

  async function faceBandit() {
    const b = getBandit(await debug("getNpcState"));
    const pos = await debug("getPlayerPosition");
    const dx = b.x - pos.x;
    const dz = b.z - pos.z;
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
  }

  let banditDead = false;
  for (let i = 0; i < 40; i++) {
    await faceBandit();
    await debug("attack");
    await page.waitForTimeout(250);
    npcs = await debug("getNpcState");
    bandit = getBandit(npcs);
    if (bandit.dead) {
      banditDead = true;
      break;
    }
  }
  assert(banditDead, "player killed the bandit with melee attacks");
  assert(bandit.deathSector !== undefined, `bandit got a DeathSector recorded (${bandit.deathSector})`);

  // --- Lootable corpse (cellar.ts seeds the bandit with a gem) ---
  let lootOpened = false;
  for (let pitch = -0.2; pitch >= -1.0; pitch -= 0.1) {
    await faceBandit();
    await page.evaluate((p) => window.__vibeDungeonDebug.setPitch(p), pitch);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(150);
    if ((await debug("getContainerState")).isOpen) {
      lootOpened = true;
      break;
    }
  }
  assert(lootOpened, "interacting with the bandit's corpse opened the loot panel, not dialogue");
  const lootState = await debug("getContainerState");
  const lootedGem = lootState.contents.find((i) => i.itemTypeId === "gem");
  assert(!!lootedGem, "corpse contains the pre-seeded gem");
  const lootedDagger = lootState.contents.find((i) => i.itemTypeId === "dagger");
  assert(!!lootedDagger, "corpse contains the bandit's dagger");
  await debug("takeItemFromContainer", lootedGem.eid);
  await page.waitForTimeout(150);
  const gemAfterLoot = (await debug("getItemStates")).find((i) => i.eid === lootedGem.eid);
  assert(gemAfterLoot.carried === true, "gem taken from the corpse into the player's inventory");
  await debug("closeContainer");

  // --- Player death + respawn ---
  health = await debug("getHealth");
  const presses = Math.ceil(health.current / 10) + 2;
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("BracketLeft");
    await page.waitForTimeout(30);
  }
  health = await debug("getHealth");
  assert(health.current === 0, `player health forced to 0 (${health.current})`);

  await page.waitForTimeout(200);
  let defeated = await debug("isPlayerDefeated");
  assert(defeated === true, `hudStore.playerDefeated true at 0 health (${defeated})`);

  const deathOverlayVisible = await page.locator('[data-testid="death-overlay"]').isVisible();
  assert(deathOverlayVisible, "death overlay is visible in the DOM");

  const posBeforeFreeze = await debug("getPlayerPosition");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyW");
  const posAfterFreeze = await debug("getPlayerPosition");
  const moved = Math.hypot(posAfterFreeze.x - posBeforeFreeze.x, posAfterFreeze.z - posBeforeFreeze.z);
  assert(moved < 0.01, `player movement frozen while defeated (moved ${moved.toFixed(4)}m)`);

  await debug("respawn");
  await page.waitForTimeout(200);
  health = await debug("getHealth");
  assert(health.current === health.max, `player fully healed after respawn (${health.current}/${health.max})`);
  defeated = await debug("isPlayerDefeated");
  assert(defeated === false, "playerDefeated cleared after respawn");
  const spawnPos = await debug("getPlayerPosition");
  assert(Math.abs(spawnPos.x - 1.5) < 0.01 && Math.abs(spawnPos.z - 7.5) < 0.01, "player repositioned to level spawn");

  const deathOverlayVisibleAfter = await page.locator('[data-testid="death-overlay"]').isVisible();
  assert(!deathOverlayVisibleAfter, "death overlay hidden after respawn");

  const posBeforeMove = await debug("getPlayerPosition");
  await page.evaluate(() => window.__vibeDungeonDebug.setYaw(0));
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyW");
  const posAfterMove = await debug("getPlayerPosition");
  const movedAfterRespawn = Math.hypot(posAfterMove.x - posBeforeMove.x, posAfterMove.z - posBeforeMove.z);
  assert(movedAfterRespawn > 0.05, `player can move again after respawn (moved ${movedAfterRespawn.toFixed(4)}m)`);

  console.log("\n=== Bandit combat + player death/respawn tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
