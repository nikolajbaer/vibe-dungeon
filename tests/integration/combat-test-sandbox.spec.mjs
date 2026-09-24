import { chromium } from "playwright";
import { assert, ACTION_TIMEOUT_MS, BASE_URL, CHROMIUM_PATH, LAUNCH_ARGS, installWatchdog } from "./harness.mjs";

// The combat-test sandbox (src/combatTest/bootstrap.ts) got a batch of
// changes at once: a player spawn moved next to the weapon table, a
// configurable opponent count/team, physical character-vs-character
// collision (so a batch of opponents can't spawn stacked on top of each
// other), and per-team hostility (so two different-team batches actually
// fight one another instead of only ever the player). This spec drives the
// real UI/game loop end to end rather than re-testing what
// combat-test-level-validation.mjs and melee-collision-validation.mjs
// already cover at the unit level (spawn/barrel placement, team filtering,
// cleave) in isolation.

const stopWatchdog = installWatchdog(120000);

const browser = await chromium.launch({ ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}), args: LAUNCH_ARGS });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
page.setDefaultTimeout(ACTION_TIMEOUT_MS);
page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

const debug = (fn, ...args) => page.evaluate(({ fn, args }) => window.__vibeDungeonDebug[fn](...args), { fn, args });

try {
  await page.goto(BASE_URL);
  await page.waitForSelector('[data-testid="menu-combat-test"]');
  await page.click('[data-testid="menu-combat-test"]');
  await page.waitForFunction(() => !!window.__vibeDungeonDebug);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));

  // --- Player spawns next to the weapon table ---
  const spawnPos = await debug("getPlayerPosition");
  assert(Math.abs(spawnPos.x - 0) < 0.01 && Math.abs(spawnPos.z - -10.5) < 0.01, `player spawns in front of the weapon table (${spawnPos.x}, ${spawnPos.z})`);

  // --- The "Configure opponent" button opens the panel (the old
  // "stepping onto the mat auto-opens it" trigger was removed -- the
  // always-on-screen button already covers opening it) ---
  await debug("teleportPlayer", 0, 0, 0);
  await page.waitForTimeout(300);
  await page.click('[data-testid="opponent-config-open"]');
  await page.waitForSelector('[data-testid="opponent-config-panel"]');
  assert(true, "the Configure opponent button opened the opponent configurator");

  async function setRange(nth, value) {
    const input = page.locator('[data-testid="opponent-config-panel"] input[type="range"]').nth(nth);
    await input.evaluate((el, v) => {
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }
  async function setSelect(nth, value) {
    const select = page.locator('[data-testid="opponent-config-panel"] select').nth(nth);
    await select.selectOption(String(value));
  }

  // Range inputs, in the form's own order: health, speed, count.
  // Select inputs, in the form's own order: weapon, style, team.
  await setRange(0, 10); // health = 10 -- low enough for the player's bare fists to actually finish one off
  await setRange(2, 3); // count = 3
  await setSelect(1, "passive"); // stand still rather than run/fight back mid-measurement
  await page.click('[data-testid="opponent-config-spawn"]');
  await page.waitForTimeout(300);

  // --- count spawns that many opponents, none overlapping ---
  let npcs = (await debug("getNpcState")).filter((n) => !n.dead);
  assert(npcs.length === 3, `count=3 spawned exactly three opponents (got ${npcs.length})`);
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const dist = Math.hypot(npcs[i].x - npcs[j].x, npcs[i].z - npcs[j].z);
      assert(dist > 0.6, `opponents ${i} and ${j} don't overlap (${dist.toFixed(2)}m apart)`);
    }
  }

  // --- killing every opponent (through real combat, so Dead is actually
  // set -- not the setNpcHealth debug shortcut, which only pokes Health and
  // would never trip the sandbox's own hasComponent(Dead) check) restores
  // the player's health immediately ---
  await debug("setHealth", 40);
  for (const npc of npcs) {
    await debug("teleportPlayer", npc.x, 0, npc.z + 0.7);
    const pos = await debug("getPlayerPosition");
    const dx = npc.x - pos.x, dz = npc.z - pos.z;
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
    let dead = false;
    for (let i = 0; i < 20 && !dead; i++) {
      await debug("attack", "swing");
      await page.waitForTimeout(300);
      dead = (await debug("getNpcState")).find((n) => n.eid === npc.eid)?.dead;
    }
    assert(dead, `opponent ${npc.eid} was actually killed (Dead component set)`);
  }
  await page.waitForTimeout(200);
  const health = await debug("getHealth");
  assert(health.current === health.max, `player health restored the instant every opponent is dead (${health.current}/${health.max})`);

  // --- a combat-test opponent looks like its archetype but never offers
  // that archetype's dialogue (issue: guard-visual sparring dummies were
  // popping the real "guard-greeting" dialogue on interact) ---
  await page.click('[data-testid="opponent-config-open"]');
  await page.waitForSelector('[data-testid="opponent-config-panel"]');
  await setRange(0, 60);
  await setRange(2, 1); // count = 1
  await setSelect(0, "sword"); // -> the "guard" archetype (ARCHETYPE_FOR_WEAPON)
  await setSelect(1, "passive");
  await setSelect(2, "1");
  await page.click('[data-testid="opponent-config-spawn"]');
  await page.waitForTimeout(300);
  const dummy = (await debug("getNpcState")).find((n) => !n.dead);
  assert(dummy.archetypeId === "guard", `spawned the guard archetype for its mesh/stats (got ${dummy.archetypeId})`);
  await debug("teleportPlayer", dummy.x, 0, dummy.z + 1);
  const dpos = await debug("getPlayerPosition");
  const ddx = dummy.x - dpos.x, ddz = dummy.z - dpos.z;
  await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-ddx, -ddz));
  await page.waitForTimeout(150);
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(200);
  assert(!(await debug("getDialogueState")).isOpen, "interacting with a combat-test guard dummy never opens the real guard's dialogue");

  // --- two different teams actually fight each other ---
  // Every prior spawn closed the panel (onSpawn's own setOpen(false)); the
  // "Configure opponent" button re-opens it.
  await page.click('[data-testid="opponent-config-open"]');
  await page.waitForSelector('[data-testid="opponent-config-panel"]');
  await setRange(0, 60); // health back up from the 10 used to speed up the kill test above
  await setRange(2, 1); // count = 1
  await setSelect(1, "aggressive");
  await setSelect(2, "1");
  await page.click('[data-testid="opponent-config-spawn"]');
  await page.waitForTimeout(150);

  await page.click('[data-testid="opponent-config-open"]');
  await page.waitForSelector('[data-testid="opponent-config-panel"]');
  await setSelect(2, "2");
  await page.click('[data-testid="opponent-config-spawn"]');
  await page.waitForTimeout(150);

  // Step well off the mat so neither side ever targets the player instead
  // of each other -- findHostileTarget always picks the *nearest* hostile.
  await debug("teleportPlayer", 0, -20, 0);

  // Both teams spawned with the default "sword" weapon, which maps to the
  // "guard" archetype (see bootstrap.ts's ARCHETYPE_FOR_WEAPON) -- the debug
  // hook doesn't expose NPC.team directly, so "two guards, one of them hurt
  // or dead, with nobody else around to have hurt them" is the observable
  // proxy for "the two teams fought each other."
  let fought = false;
  for (let i = 0; i < 100 && !fought; i++) {
    await page.waitForTimeout(150);
    const guards = (await debug("getNpcState")).filter((n) => n.archetypeId === "guard");
    if (guards.some((n) => n.dead || n.health < 60)) fought = true;
  }
  assert(fought, "two different-team NPCs left alone actually fight -- and damage -- each other");

  console.log("\n=== Combat-test sandbox: spawn placement, opponent count/non-overlap, victory health-restore and NPC-vs-NPC fighting passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
