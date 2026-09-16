import { assert, installWatchdog, launchGame } from "./harness.mjs";

const stopWatchdog = installWatchdog(60000);
const { browser, page, debug } = await launchGame({ viewport: { width: 1000, height: 700 } });

try {
  const health = await debug("getHealth");
  assert(health.current === 100 && health.max === 100, `player spawns at full health (${JSON.stringify(health)})`);

  let npcs = await debug("getNpcState");
  const villager = npcs.find((n) => n.archetypeId === "villager");
  const bandit = npcs.find((n) => n.archetypeId === "bandit");
  assert(!!villager, "villager NPC spawned");
  assert(!!bandit, "bandit NPC spawned");
  assert(villager.state === "LOITERING", `villager starts LOITERING (${villager.state})`);
  assert(bandit.state === "LOITERING", `bandit starts LOITERING (${bandit.state})`);

  // Villager spawn is (1.5, 3.5); player spawn is (1.5, 7.5) facing -z --
  // walking forward approaches the villager directly on the shared x=1.5 spine.
  await page.evaluate(() => window.__vibeDungeonDebug.setYaw(0));
  await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));

  async function getVillagerPos() {
    const v = (await debug("getNpcState")).find((n) => n.archetypeId === "villager");
    return { x: v.x, z: v.z };
  }

  async function faceAndInteract(targetPos) {
    const pos = await debug("getPlayerPosition");
    const dx = targetPos.x - pos.x;
    const dz = targetPos.z - pos.z;
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
    await page.waitForTimeout(150);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(150);
  }

  // The villager wanders while LOITERING, so track its live position.
  for (let i = 0; i < 60; i++) {
    const target = await getVillagerPos();
    const pos = await debug("getPlayerPosition");
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    if (Math.hypot(dx, dz) < 2.2) break;
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(100);
    await page.keyboard.up("KeyW");
  }

  await faceAndInteract(await getVillagerPos());

  let dlg = await debug("getDialogueState");
  assert(dlg.isOpen === true, "dialogue opened on villager interact");
  assert(dlg.npcName === "Villager", `dialogue npcName is Villager (${dlg.npcName})`);
  assert(dlg.choices.length === 3, `greeting node has 3 choices (${dlg.choices.length})`);

  await debug("chooseDialogue", 0);
  dlg = await debug("getDialogueState");
  assert(dlg.isOpen === true, "dialogue still open after branching choice");
  assert(dlg.nodeId === "about-place", `branched to about-place (${dlg.nodeId})`);

  await debug("chooseDialogue", 0);
  dlg = await debug("getDialogueState");
  assert(dlg.nodeId === "greeting", `looped back to greeting (${dlg.nodeId})`);

  // "Will you come with me?" (toggleFollow) -- closes dialogue AND sets FOLLOWING.
  await debug("chooseDialogue", 1);
  dlg = await debug("getDialogueState");
  assert(dlg.isOpen === false, "dialogue closed after toggleFollow choice");
  npcs = await debug("getNpcState");
  assert(npcs.find((n) => n.archetypeId === "villager").state === "FOLLOWING", "villager now FOLLOWING");

  await page.waitForTimeout(800);
  await faceAndInteract(await getVillagerPos());
  dlg = await debug("getDialogueState");
  assert(dlg.isOpen === true, "dialogue reopens on second interact");
  await debug("chooseDialogue", 2); // "Farewell." -- closes with no effect
  dlg = await debug("getDialogueState");
  assert(dlg.isOpen === false, "Farewell choice closes dialogue with no effect");
  npcs = await debug("getNpcState");
  assert(npcs.find((n) => n.archetypeId === "villager").state === "FOLLOWING", "villager still FOLLOWING (farewell had no effect)");

  console.log("\n=== Villager dialogue tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
