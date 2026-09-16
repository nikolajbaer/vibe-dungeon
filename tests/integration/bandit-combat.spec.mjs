import { assert, installWatchdog, launchGame } from "./harness.mjs";

const stopWatchdog = installWatchdog(120000);
const { browser, page, debug } = await launchGame({ viewport: { width: 1000, height: 700 } });

function getBandit(npcs) {
  return npcs.find((n) => n.archetypeId === "bandit");
}

try {
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));

  // Player spawns at (1.5, 7.5); the bandit sits at (1.5, -13) in room-b
  // with a 6m aggroRange (bandit.ts). The ~18m corridor between spawn and
  // room-b's doorway is pure transit with nothing under test, so teleport
  // to just outside the aggro radius (8m out) and walk the real remaining
  // distance -- that still exercises the actual proximity-triggered aggro,
  // just without the long walk to get there first.
  await debug("teleportPlayer", 1.5, 0.1, -5);
  let reachedAggro = false;
  for (let i = 0; i < 100 && !reachedAggro; i++) {
    const pos = await debug("getPlayerPosition");
    const dx = 1.5 - pos.x;
    const dz = -13 - pos.z;
    if (Math.hypot(dx, dz) < 1.5) break;
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
    const bandit = getBandit(await debug("getNpcState"));
    if (bandit.state !== "LOITERING") reachedAggro = true;
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
