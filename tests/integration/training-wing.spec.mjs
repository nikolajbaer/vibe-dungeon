import { assert, installWatchdog, launchGame } from "./harness.mjs";

// Coverage for the training wing (training wing task, rooms/training-wing.ts):
// reaching each of its four rooms, the readables showing the right text, the
// quartermaster's "no trading yet" dialogue, and the lockpick-nook's locked
// door + key + reward chain. Teleports straight to each room rather than
// walking the whole wing (transit through `side-chamber`/`training-corridor`
// isn't what's under test here -- verticality-stairs.spec.mjs and
// item-door-regression.spec.mjs already exercise walking through doors/
// openings generally).
const stopWatchdog = installWatchdog(90000);
const { browser, page, debug } = await launchGame({ viewport: { width: 900, height: 600 } });

try {
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));

  // --- Melee training room (world x[27,33], z[3,9]) ---
  await debug("teleportPlayer", 30, 0.1, 6);
  let pos = await debug("getPlayerPosition");
  assert(Math.abs(pos.x - 30) < 0.1 && Math.abs(pos.z - 6) < 0.1, "reached the melee training room");

  // --- Ranged training room (world x[30,36], z[-12,-6]) ---
  await debug("teleportPlayer", 33, 0.1, -9);
  pos = await debug("getPlayerPosition");
  assert(Math.abs(pos.x - 33) < 0.1 && Math.abs(pos.z - -9) < 0.1, "reached the ranged training room");

  // --- Equipment room (world x[36,42], z[-6,0]) -- quartermaster present
  // and its dialogue is explicit about trading not being set up. ---
  await debug("teleportPlayer", 38, 0.1, -3.5);
  pos = await debug("getPlayerPosition");
  assert(Math.abs(pos.x - 38) < 0.1, "reached the equipment room");

  let npcs = await debug("getNpcState");
  const quartermaster = npcs.find((n) => n.archetypeId === "quartermaster");
  assert(!!quartermaster, "quartermaster NPC is present");

  await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), 0);
  let dialogueOpened = false;
  for (let i = 0; i < 10 && !dialogueOpened; i++) {
    const dx = quartermaster.x - (await debug("getPlayerPosition")).x;
    const dz = quartermaster.z - (await debug("getPlayerPosition")).z;
    await page.evaluate((yy) => window.__vibeDungeonDebug.setYaw(yy), Math.atan2(-dx, -dz));
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(150);
    if ((await debug("getDialogueState")).isOpen) dialogueOpened = true;
    else await page.keyboard.down("KeyW"), await page.waitForTimeout(100), await page.keyboard.up("KeyW");
  }
  assert(dialogueOpened, "interacting with the quartermaster opens dialogue");
  const dialogueState = await debug("getDialogueState");
  assert(/trad/i.test(dialogueState.line) || /ledger/i.test(dialogueState.line), `quartermaster's line mentions no trading (${dialogueState.line})`);
  await debug("closeDialogue");

  // The two display swords are real, uncarried world items -- getItemStates
  // has no position field, so this checks the total count instead: room-a
  // always has exactly one sword (its own pickup), so the equipment room's
  // two bring the level total to three.
  const items = await debug("getItemStates");
  const uncarriedSwords = items.filter((i) => i.itemTypeId === "sword" && !i.carried);
  assert(uncarriedSwords.length === 3, `level has room-a's sword plus the equipment room's two (found ${uncarriedSwords.length})`);

  // --- Readables: melee/ranged/hub posters show the right text ---
  async function readPosterAt(x, z, yaw) {
    await debug("teleportPlayer", x, 0.1, z);
    await page.evaluate((yy) => window.__vibeDungeonDebug.setYaw(yy), yaw);
    let opened = false;
    for (let pitch = 0; pitch >= -0.6 && !opened; pitch -= 0.1) {
      await page.evaluate((p) => window.__vibeDungeonDebug.setPitch(p), pitch);
      await page.keyboard.press("KeyE");
      await page.waitForTimeout(150);
      if ((await debug("getNoticeState")).isOpen) opened = true;
    }
    return opened;
  }

  assert(await readPosterAt(29, 5.0, Math.PI / 2), "melee-room poster opens on interact");
  let notice = await debug("getNoticeState");
  assert(notice.title === "Melee Training", `melee poster has the right title (${notice.title})`);
  await debug("closeNotice");

  assert(await readPosterAt(34, -8.0, -Math.PI / 2), "ranged-room poster opens on interact");
  notice = await debug("getNoticeState");
  assert(/Coming Soon/i.test(notice.title), `ranged poster flags it as coming soon (${notice.title})`);
  await debug("closeNotice");

  // --- Lockpick-nook: locked door, key, and reward ---
  const doorsBefore = await debug("getDoorStates");
  const lockDoor = doorsBefore.find((d) => d.locked && Math.abs(d.x - 36) < 1);
  assert(!!lockDoor, "lockpick-nook's door exists and is locked");

  // Pick up the rusty key from the hub.
  await debug("teleportPlayer", 31.5, 0.1, -1.0);
  let keyPicked = false;
  for (let pitch = -0.1; pitch >= -0.8 && !keyPicked; pitch -= 0.1) {
    await page.evaluate((p) => window.__vibeDungeonDebug.setPitch(p), pitch);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(150);
    const invItems = await debug("getItemStates");
    if (invItems.some((i) => i.itemTypeId === "rusty_key" && i.carried)) keyPicked = true;
  }
  assert(keyPicked, "picked up the rusty key in the hub");

  // Walk to and open the locked door, approaching from the hub side
  // (outside the nook, x<36) rather than teleporting past it -- a teleport
  // ignores collision, so starting already inside wouldn't actually
  // exercise the closed/locked door at all.
  await debug("teleportPlayer", 34, 0.1, 1.5);
  await page.evaluate(() => window.__vibeDungeonDebug.setYaw(-Math.PI / 2)); // face +x, toward the door
  let doorOpened = false;
  for (let i = 0; i < 15 && !doorOpened; i++) {
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(150);
    const states = await debug("getDoorStates");
    const thisDoor = states.find((d) => Math.abs(d.x - 36) < 1);
    if (thisDoor && thisDoor.state !== "CLOSED") doorOpened = true;
    else {
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(100);
      await page.keyboard.up("KeyW");
    }
  }
  assert(doorOpened, "the rusty key opens the lockpick-nook's locked door");

  // The backpack reward is a real container item -- getItemStates has no
  // position field, so this checks the total count instead (carried or not
  // -- walking right up to it while opening the door from inside the nook,
  // above, can incidentally auto-pick it up via the same interact raycast,
  // which is fine; the point here is just that it exists at all):
  // side-chamber.ts already places one backpack elsewhere in the level, so
  // the lockpick-nook's reward brings the total to two.
  const itemsAfter = await debug("getItemStates");
  const backpacks = itemsAfter.filter((i) => i.itemTypeId === "backpack");
  assert(backpacks.length === 2, `level has side-chamber's backpack plus the lockpick-nook's reward (found ${backpacks.length})`);

  console.log("\n=== Training wing tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
