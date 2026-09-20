import { assert, installWatchdog, launchGame } from "./harness.mjs";

const stopWatchdog = installWatchdog(45000);
const { browser, page, debug } = await launchGame({ viewport: { width: 900, height: 600 } });

try {
  const idle = await debug("getFirstPersonArmsState");
  assert(idle.visibleTriangles > 0, "first-person arm mesh has visible geometry");
  assert(idle.visibleTriangles < 800, `first-person mesh excludes torso/head/legs (${idle.visibleTriangles} triangles)`);
  assert(idle.attachedWeapons === 0 && !idle.armed, "unarmed view begins in boxing guard");

  await debug("attack", "jab");
  await page.waitForTimeout(180);
  const jab = await debug("getFirstPersonArmsState");
  const movement = Math.hypot(
    jab.leftHand[0] - idle.leftHand[0],
    jab.leftHand[1] - idle.leftHand[1],
    jab.leftHand[2] - idle.leftHand[2],
  );
  assert(movement > .08, `unarmed jab drives the humanoid lead hand (${movement.toFixed(3)}m)`);
} finally {
  await browser.close();
  stopWatchdog();
}
