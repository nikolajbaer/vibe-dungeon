import { chromium } from "playwright";

// Shared setup for every integration spec. Centralized so the launch args,
// action timeout, and "start the game" boilerplate can't drift between
// specs the way they did across the ad hoc scratchpad scripts this suite
// replaces.

// Pin to the specific Chromium binary this project's Playwright scripts
// have used throughout its history (rather than whatever build Playwright's
// own default resolution picks -- observed to pick a different
// "headless_shell" build in this sandbox), so timeout budgets tuned against
// its performance stay meaningful. Still overridable for other machines.
export const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium";
export const LAUNCH_ARGS = [
  "--no-sandbox",
  "--use-gl=swiftshader",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--disable-dev-shm-usage",
];
export const BASE_URL = process.env.VIBE_DUNGEON_URL ?? "http://localhost:5195/";

// How long a single Playwright action (click, waitForSelector, ...) is
// allowed to take before it throws, rather than hanging indefinitely. This
// is what actually stops a spec from getting stuck: `run.mjs` (the runner)
// backstops it with a hard process kill in case something manages to hang
// outside of a Playwright-timed action, but this is the one that fires in
// the ordinary case and gives a real Playwright TimeoutError instead of a
// bare kill 90+ seconds later.
export const ACTION_TIMEOUT_MS = 15000;

export function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("OK:", msg);
}

/**
 * Launches a browser, starts the game, and waits for the debug hook -- the
 * same handful of steps every spec used to hand-roll. Returns everything a
 * spec needs; the spec owns closing `browser` when it's done (or lets it be
 * killed by the runner's timeout on failure).
 */
export async function launchGame({ viewport = { width: 1000, height: 700 }, touch = false } = {}) {
  const browser = await chromium.launch({ ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}), args: LAUNCH_ARGS });
  const context = touch
    ? await browser.newContext({ viewport, hasTouch: true, isMobile: true })
    : await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

  await page.goto(BASE_URL);
  await page.waitForSelector('[data-testid="menu-play"]');
  if (touch) await page.tap('[data-testid="menu-play"]');
  else await page.click('[data-testid="menu-play"]');
  await page.waitForFunction(() => !!window.__vibeDungeonDebug);
  await page.waitForTimeout(500);

  const debug = (fn, ...args) =>
    page.evaluate(({ fn, args }) => window.__vibeDungeonDebug[fn](...args), { fn, args });

  return { browser, context, page, debug };
}

/** Walks the player toward (targetX, targetZ) by repeated forward taps, same as every spec already did by hand. Returns false if it never got within `stopDist`. */
export async function walkTo(page, debug, targetX, targetZ, stopDist, opts = {}) {
  const { maxSteps = 300, stepMs = 100, onStep } = opts;
  for (let i = 0; i < maxSteps; i++) {
    const pos = await debug("getPlayerPosition");
    const dx = targetX - pos.x;
    const dz = targetZ - pos.z;
    if (Math.hypot(dx, dz) < stopDist) return true;
    await page.evaluate((y) => window.__vibeDungeonDebug.setYaw(y), Math.atan2(-dx, -dz));
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(stepMs);
    await page.keyboard.up("KeyW");
    if (onStep) await onStep(i, pos);
  }
  return false;
}

/**
 * Belt-and-suspenders in-process watchdog: `run.mjs` enforces the real
 * timeout by killing the spec's whole process group from outside, but that
 * still means waiting out the full timeout to notice. This fires the same
 * exit code sooner, with a clearer message, for the common case where the
 * hang is just an `await` that never resolves (a page action past its own
 * ACTION_TIMEOUT_MS, a `waitForTimeout` on a page that navigated away,
 * etc.) rather than the runner's true last resort of the renderer wedging
 * the whole process solid.
 */
export function installWatchdog(ms = 60000) {
  const timer = setTimeout(() => {
    console.error(`WATCHDOG: spec exceeded ${ms}ms without finishing -- forcing exit`);
    process.exit(124);
  }, ms);
  return () => clearTimeout(timer);
}
