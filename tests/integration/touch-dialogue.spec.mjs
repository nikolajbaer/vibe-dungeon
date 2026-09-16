import { assert, installWatchdog, launchGame } from "./harness.mjs";

const stopWatchdog = installWatchdog(60000);
// hasTouch:true so isTouchDevice() reports true and the real touch control
// stack (moveStick/attackButton/lookDrag) gets constructed, matching a real
// phone -- these bugs were all touch-specific.
const { browser, page, debug } = await launchGame({ viewport: { width: 400, height: 800 }, touch: true });

try {
  const isTouch = await page.evaluate(() => "ontouchstart" in window || navigator.maxTouchPoints > 0);
  assert(isTouch, "context reports as a touch device (real touch control stack active)");

  async function getVillagerPos() {
    return (await debug("getNpcState")).find((n) => n.archetypeId === "villager");
  }

  async function faceVillagerAndTapCanvas() {
    // The villager wanders while LOITERING, so retry a few times, re-aiming
    // at its live position each attempt.
    for (let attempt = 0; attempt < 6; attempt++) {
      const v = await getVillagerPos();
      const pos = await debug("getPlayerPosition");
      const dx = v.x - pos.x;
      const dz = v.z - pos.z;
      await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
      await page.evaluate(() => window.__vibeDungeonDebug.setPitch(0));
      await page.waitForTimeout(150);
      // A real touch tap dead-center of the viewport -- nowhere near the
      // move stick or attack button -- lands on the canvas itself.
      await page.touchscreen.tap(200, 400);
      await page.waitForTimeout(200);
      if ((await debug("getDialogueState")).isOpen) return;
    }
  }

  for (let i = 0; i < 40; i++) {
    const v = await getVillagerPos();
    const pos = await debug("getPlayerPosition");
    const dx = v.x - pos.x;
    const dz = v.z - pos.z;
    if (Math.hypot(dx, dz) < 2.2) break;
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(100);
    await page.keyboard.up("KeyW");
  }

  // --- Bug: tap-to-interact opens dialogue via a real touch tap ---
  await faceVillagerAndTapCanvas();
  let dlg = await debug("getDialogueState");
  assert(dlg.isOpen === true, "real touch tap on the canvas opened the villager's dialogue");

  const npcsBefore = await debug("getNpcState");
  const villagerHealthBefore = npcsBefore.find((n) => n.archetypeId === "villager").health;

  // --- Bug: the sim should be fully paused while dialogue is open ---
  const villagerPosBeforeWait = await getVillagerPos();
  await page.waitForTimeout(1500);
  const villagerPosAfterWait = await getVillagerPos();
  const villagerMoved = Math.hypot(villagerPosAfterWait.x - villagerPosBeforeWait.x, villagerPosAfterWait.z - villagerPosBeforeWait.z);
  assert(villagerMoved < 0.001, `villager didn't move while dialogue was open (moved ${villagerMoved.toFixed(4)}m) -- sim is paused`);

  // --- Bug: tapping "Farewell" should close the dialogue and not reopen it ---
  dlg = await debug("getDialogueState");
  const farewellIndex = dlg.choices.findIndex((c) => c.toLowerCase().includes("farewell"));
  assert(farewellIndex >= 0, "greeting node has a Farewell choice");

  // Tap the real screen coordinates directly (Playwright's actionability
  // check flags this button as covered by the canvas, even though
  // document.elementFromPoint correctly returns it) -- still exercises the
  // real touchstart/touchend dispatch this bug is about.
  const farewellRect = await page.evaluate(
    (idx) => document.querySelector(`[data-testid="dialogue-choice-${idx}"]`).getBoundingClientRect(),
    farewellIndex,
  );
  await page.touchscreen.tap(farewellRect.x + farewellRect.width / 2, farewellRect.y + farewellRect.height / 2);
  await page.waitForTimeout(300);
  dlg = await debug("getDialogueState");
  assert(dlg.isOpen === false, "dialogue closed immediately after tapping Farewell");

  // The same physical tap used to also register as a canvas
  // tap-to-interact, reopening the dialogue a moment later.
  await page.waitForTimeout(500);
  dlg = await debug("getDialogueState");
  assert(dlg.isOpen === false, "dialogue stayed closed 500ms after tapping Farewell (did not reopen)");

  // --- Bug: the villager should be unharmed by any of the above taps ---
  const npcsFinal = await debug("getNpcState");
  const villagerFinal = npcsFinal.find((n) => n.archetypeId === "villager");
  assert(villagerFinal.health === villagerHealthBefore, `villager took no damage from any tap (health still ${villagerFinal.health})`);
  assert(villagerFinal.dead === false, "villager is still alive");

  console.log("\n=== Touch/dialogue bug-fix tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
