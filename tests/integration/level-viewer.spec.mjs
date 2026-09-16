import { chromium } from "playwright";
import { assert, installWatchdog, CHROMIUM_PATH, LAUNCH_ARGS, BASE_URL, ACTION_TIMEOUT_MS } from "./harness.mjs";

const stopWatchdog = installWatchdog(60000);

// This spec starts from the main menu rather than Play, so it doesn't use
// launchGame()'s "click Play and wait for the debug hook" flow directly --
// borrow just the launch args/base URL from the shared harness.
const browser = await chromium.launch({ ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}), args: LAUNCH_ARGS });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(ACTION_TIMEOUT_MS);
const pageErrors = [];
page.on("pageerror", (err) => {
  pageErrors.push(err.message);
  console.log("PAGE ERROR:", err.message);
});

try {
  await page.goto(BASE_URL);
  await page.waitForSelector('[data-testid="menu-root"]');

  const viewTilesBtn = page.locator('[data-testid="menu-view-tiles"]');
  assert(await viewTilesBtn.isEnabled(), "View Tiles button is enabled");
  const editLevelBtn = page.locator('[data-testid="menu-edit-level"]');
  assert(await editLevelBtn.isDisabled(), "Edit Level is still the disabled placeholder");

  await viewTilesBtn.click();
  await page.waitForSelector("#viewer-hud");
  await page.waitForTimeout(1000); // let a few frames render

  const legendText = await page.locator(".viewer-legend").innerText();
  for (const sector of ["room-a", "room-b", "corridor", "branch-corridor", "side-chamber"]) {
    assert(legendText.includes(sector), `legend lists sector "${sector}"`);
  }

  const canvasCount = await page.locator("canvas").count();
  assert(canvasCount >= 1, `at least one canvas rendering (${canvasCount})`);

  // Orbit the camera a bit via drag, to exercise OrbitControls without erroring.
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.move(750, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  assert(pageErrors.length === 0, `no page errors so far (${pageErrors.length})`);

  // Back to menu, and confirm the game itself still starts fine afterward
  // (regression: menu remount + Play still works after visiting the viewer).
  await page.locator(".viewer-back-btn").click();
  await page.waitForSelector('[data-testid="menu-root"]');
  assert((await page.locator("canvas").count()) === 0, "viewer canvas removed after returning to menu");

  await page.locator('[data-testid="menu-play"]').click();
  await page.waitForFunction(() => !!window.__vibeDungeonDebug);
  await page.waitForTimeout(500);
  const health = await page.evaluate(() => window.__vibeDungeonDebug.getHealth());
  assert(health.current === 100, "the real game still starts fine after visiting the level viewer");

  assert(pageErrors.length === 0, `still no page errors after the full round trip (${pageErrors.length})`);

  console.log("\n=== Level viewer tests passed ===\n");
} finally {
  stopWatchdog();
  await browser.close();
}
