import { assert, installWatchdog, launchGame } from "./harness.mjs";

// The dedicated touch block button (index.html's `.touch-block-btn`, wired
// up in touchControls.ts's `TouchBlockButton`) replaced the old "swipe down
// on the attack button" gesture with a real held state -- this exercises
// the actual DOM element a player's thumb presses, not just the underlying
// setBlocking() mechanic (already covered by combat-system-validation.mjs),
// to catch a wiring regression between the button and game.ts's per-frame
// wantsBlock check.
const stopWatchdog = installWatchdog(60000);
const { browser, page, debug } = await launchGame({ touch: true });

function dispatchTouch(selector, type) {
  return page.evaluate(({ selector, type }) => {
    const el = document.querySelector(selector);
    const rect = el.getBoundingClientRect();
    const touch = new Touch({
      identifier: 1,
      target: el,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    });
    el.dispatchEvent(new TouchEvent(type, { touches: type === "touchend" ? [] : [touch], changedTouches: [touch], bubbles: true, cancelable: true }));
  }, { selector, type });
}

try {
  assert(await page.locator(".touch-block-btn").count() === 1, "the dedicated block button exists in touch mode");

  const before = await debug("getCombatState");
  assert(before.blocking === false, "not blocking before the button is touched");

  await dispatchTouch(".touch-block-btn", "touchstart");
  await page.waitForTimeout(200);
  const whileHeld = await debug("getCombatState");
  assert(whileHeld.blocking === true, "holding the block button raises the guard");

  await dispatchTouch(".touch-block-btn", "touchend");
  await page.waitForTimeout(200);
  const afterRelease = await debug("getCombatState");
  assert(afterRelease.blocking === false, "releasing the block button lowers the guard again");
} finally {
  await browser.close();
  stopWatchdog();
}
