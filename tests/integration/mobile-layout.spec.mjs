import { assert, installWatchdog, launchGame } from "./harness.mjs";

const stopWatchdog = installWatchdog(60000);
const { browser, page } = await launchGame({
  viewport: { width: 390, height: 700 },
  touch: true,
  // Headless browsers do not enter real display fullscreen. Intercept the
  // API to verify that Play invokes it during the originating tap.
  initScript: () => {
    const original = HTMLElement.prototype.requestFullscreen;
    HTMLElement.prototype.requestFullscreen = function (...args) {
      window.__requestedFullscreenFor = this.id;
      return original ? original.apply(this, args).catch(() => undefined) : Promise.resolve();
    };
  },
});

try {
  const requestedFor = await page.evaluate(() => window.__requestedFullscreenFor);
  assert(requestedFor === "app", "Play requests fullscreen for the complete game container");

  const layout = await page.evaluate(() => {
    // The equipment bar (EquipmentBar.tsx), not the old always-on
    // paperdoll/list panel that used to live at #inventory-root -- see
    // src/inventory/mount.tsx for the pop-up dialog that replaced it.
    const inventory = document.querySelector('[data-testid="equip-bar-open"]').getBoundingClientRect();
    const attack = document.querySelector(".touch-attack-btn").getBoundingClientRect();
    const target = document.elementFromPoint(attack.x + attack.width / 2, attack.y + attack.height / 2);
    return {
      inventoryBottom: inventory.bottom,
      attackTop: attack.top,
      attackOwnsTap: Boolean(target?.closest(".touch-attack-btn")),
    };
  });
  assert(layout.inventoryBottom <= layout.attackTop - 15, "inventory reserves a gap above the attack button");
  assert(layout.attackOwnsTap, "attack button remains the hit target at its center");

  await page.tap('[data-testid="game-menu-toggle"]');
  assert(await page.isVisible('[data-testid="game-menu-panel"]'), "in-game menu opens from the top-center control");

  // "Restart" (game-menu-restart) reloads back into the *same* game mode
  // (see game.ts's onRestart/main.ts's sessionStorage handoff) -- it's
  // "Main Menu" (game-menu-main/onMainMenu) that actually returns to the
  // title screen. Pre-existing mismatch found while verifying an unrelated
  // change: this assertion used to tap the wrong button and could never
  // have passed against the app's real behavior.
  await page.tap('[data-testid="game-menu-main"]');
  await page.waitForSelector('[data-testid="menu-play"]');
  assert(await page.isVisible('[data-testid="menu-play"]'), "Main Menu returns to a fresh title screen");
} finally {
  await browser.close();
  stopWatchdog();
}
