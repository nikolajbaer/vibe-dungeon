import { assert, installWatchdog, launchGame } from "./harness.mjs";

const stopWatchdog = installWatchdog(130000);
const { browser, page, debug } = await launchGame({ viewport: { width: 1000, height: 700 } });

function getBandit(npcs) {
  return npcs.find((n) => n.archetypeId === "bandit");
}

try {
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));

  // See bandit-combat.spec.mjs: the bandit relocated to the cellar (cellar
  // wing task, rooms/cellar.ts) at (18, -13.0, floor -1), behind a real
  // (unlocked) hinged door. Teleport onto the downward ramp itself, ~6m out
  // (x=12, y=-4 -- 1/3 up the ramp's linear climb from (15,-6) to (6,0)),
  // still just outside its 6m aggroRange. Aggro fires from there, but the
  // bandit's own CHASING movement can't open the door itself (only the
  // player's interact does -- see `tryInteract`, ecs/systems/doors.ts), so
  // this walks all the way up to the bandit (pressing `KeyE` periodically to
  // open the door along the way) rather than stopping the instant aggro
  // fires -- see bandit-combat.spec.mjs's own comment for the full
  // reasoning.
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
      if ((await debug("getDialogueState")).isOpen) await debug("closeDialogue");
    }
  }
  let bandit = getBandit(await debug("getNpcState"));
  assert(bandit.state === "CHASING" || bandit.state === "ATTACKING", `bandit aggroed (${bandit.state})`);

  // Let it land a hit or two (speeds up forcing player death below).
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(200);
    const health = await debug("getHealth");
    if (health.current < 90) break;
  }

  async function faceBandit() {
    const b = getBandit(await debug("getNpcState"));
    const pos = await debug("getPlayerPosition");
    const dx = b.x - pos.x;
    const dz = b.z - pos.z;
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
  }

  // Kill the bandit, then in the very next moment force the player's own
  // health to 0 too -- the "mutual kill" scenario that used to freeze the
  // bandit's 1.3s death-collapse clip mid-fall and let the corpse vanish
  // before it was ever really seen.
  let banditDead = false;
  for (let i = 0; i < 40 && !banditDead; i++) {
    await faceBandit();
    await debug("attack");
    await page.waitForTimeout(220);
    bandit = getBandit(await debug("getNpcState"));
    if (bandit.dead) banditDead = true;
  }
  assert(banditDead, "bandit killed");

  let animState = await debug("getNpcAnimationState", bandit.eid);
  assert(animState.activeClip === "death", `death one-shot active immediately after the kill (${animState.activeClip})`);
  const clipTimeAtDeath = animState.deathClipTime;

  // One round trip, not many separate keypresses (each a real round trip
  // slow enough under software rendering to blow past 1.3s on its own).
  await debug("setHealth", 0);
  const health = await debug("getHealth");
  assert(health.current === 0, `player forced to 0 health (${health.current})`);
  const defeated = await debug("isPlayerDefeated");
  assert(defeated === true, "death overlay is up (modal pause active)");

  animState = await debug("getNpcAnimationState", bandit.eid);
  assert(animState.deathClipTime < 1.3, `death clip caught mid-collapse, not yet finished (${animState.deathClipTime.toFixed(3)}s)`);

  // --- The death collapse must keep playing through the pause ---
  await page.waitForTimeout(1000);
  const animStateDuringPause = await debug("getNpcAnimationState", bandit.eid);
  assert(
    animStateDuringPause.deathClipTime > clipTimeAtDeath + 0.3,
    `death clip kept advancing during the pause (${clipTimeAtDeath.toFixed(3)}s -> ${animStateDuringPause.deathClipTime.toFixed(3)}s)`,
  );

  // Poll rather than assume a fixed real-time margin: this environment's
  // software-rendered frame loop clamps dt, so simulated time can run
  // noticeably slower than real time under heavy render load.
  let animStateFinal = animStateDuringPause;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    animStateFinal = await debug("getNpcAnimationState", bandit.eid);
    if (Math.abs(animStateFinal.deathClipTime - 1.3) < 0.05) break;
  }
  assert(
    Math.abs(animStateFinal.deathClipTime - 1.3) < 0.05,
    `death clip fully finished and clamped at its final frame during the pause (${animStateFinal.deathClipTime.toFixed(3)}s)`,
  );

  // --- The corpse must not vanish the instant the player teleports away on respawn ---
  let npcs = await debug("getNpcState");
  assert(getBandit(npcs).meshInScene === true, "corpse still in the scene right before respawn");

  await debug("respawn");
  await page.waitForTimeout(100);
  npcs = await debug("getNpcState");
  assert(getBandit(npcs).meshInScene === true, "corpse survives the respawn teleport (didn't vanish instantly)");

  await page.waitForTimeout(500);
  npcs = await debug("getNpcState");
  assert(getBandit(npcs).meshInScene === true, "corpse still present shortly after respawn (didn't vanish near-instantly)");

  let cleanedUp = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    npcs = await debug("getNpcState");
    if (!getBandit(npcs).meshInScene) {
      cleanedUp = true;
      break;
    }
  }
  assert(cleanedUp, "corpse eventually cleaned up once the linger window passed and the player was elsewhere");

  console.log("\n=== Corpse-linger / death-animation-through-pause tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
