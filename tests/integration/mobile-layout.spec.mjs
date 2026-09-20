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
    const inventory = document.querySelector("#inventory-root").getBoundingClientRect();
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

  await page.tap('[data-testid="game-menu-restart"]');
  await page.waitForSelector('[data-testid="menu-play"]');
  assert(await page.isVisible('[data-testid="menu-play"]'), "Restart game returns to a fresh title screen");
} finally {
  await browser.close();
  stopWatchdog();
}
