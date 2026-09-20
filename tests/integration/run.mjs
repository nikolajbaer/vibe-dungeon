#!/usr/bin/env node
// Runs every *.spec.mjs in this directory, one at a time, each under a hard
// timeout. A spec that hangs (this session's original motivation: a few
// scratchpad Playwright scripts ran for minutes under CPU contention with
// nothing to cut them off) gets its whole process group killed rather than
// left to idle indefinitely.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BASE_URL = process.env.VIBE_DUNGEON_URL ?? "http://localhost:5195/";
const DEFAULT_TIMEOUT_MS = 120000;

// Per-spec timeouts alone don't bound how long `npm run test:integration`
// can take -- summed together, the per-spec budgets below add up to well
// over the time this is supposed to save. This is the actual hard cap: the
// whole run (server startup included) stops here no matter what, even if
// that means cutting a spec off mid-run and skipping whatever's left.
// Override with VIBE_DUNGEON_SUITE_TIMEOUT_MS for a one-off longer run.
const SUITE_TIMEOUT_MS = Number(process.env.VIBE_DUNGEON_SUITE_TIMEOUT_MS) || 360000;

// A few specs legitimately run longer than the rest under this
// environment's software-rendered CPU load -- named per file rather than
// raising the default across the board, so a spec that actually hangs
// still gets caught promptly. These are each spec's own ceiling; the
// SUITE_TIMEOUT_MS budget above can still cut a spec short of this if the
// suite is running low on time.
const TIMEOUT_OVERRIDES_MS = {
  "verticality-stairs.spec.mjs": 180000,
  "stairwell-wall-gaps.spec.mjs": 150000,
  "bandit-combat.spec.mjs": 120000,
  "corpse-linger.spec.mjs": 130000,
};

function timeoutFor(file) {
  return TIMEOUT_OVERRIDES_MS[path.basename(file)] ?? DEFAULT_TIMEOUT_MS;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function ensureServer() {
  if (await waitForServer(BASE_URL, 2000)) {
    console.log(`Using already-running dev server at ${BASE_URL}`);
    return null;
  }
  console.log(`No dev server at ${BASE_URL} -- starting one`);
  const port = new URL(BASE_URL).port || "5195";
  const child = spawn("npx", ["vite", "--port", port, "--strictPort"], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    detached: true,
  });
  const ok = await waitForServer(BASE_URL, 30000);
  if (!ok) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
    throw new Error(`dev server never became ready at ${BASE_URL}`);
  }
  return child;
}

function runSpec(file, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [file], {
      stdio: "inherit",
      detached: true,
      env: { ...process.env, VIBE_DUNGEON_URL: BASE_URL },
    });
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      console.error(`\n[TIMEOUT] ${path.basename(file)} exceeded ${timeoutMs}ms -- killing its process group`);
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already exited
      }
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(killer);
      resolve({ file, ok: !timedOut && code === 0, timedOut, code, elapsed: Date.now() - start });
    });
  });
}

// Cheapest/fastest specs first, heaviest last -- under SUITE_TIMEOUT_MS, a
// run that's short on time should cover as many distinct systems as
// possible before it starts skipping specs, rather than alphabetical order
// happening to burn most of the budget on the two or three heaviest specs
// before anything else gets a turn. Unlisted specs (a new one added later)
// sort after all of these, alphabetically among themselves.
const SPEC_ORDER = [
  "item-icons.spec.mjs",
  "level-viewer.spec.mjs",
  "item-door-regression.spec.mjs",
  "rigid-bodies.spec.mjs",
  "touch-dialogue.spec.mjs",
  "mobile-layout.spec.mjs",
  "npc-dialogue.spec.mjs",
  "stairwell-wall-gaps.spec.mjs",
  "bandit-combat.spec.mjs",
  "corpse-linger.spec.mjs",
  "verticality-stairs.spec.mjs",
];
function specRank(file) {
  const i = SPEC_ORDER.indexOf(path.basename(file));
  return i === -1 ? SPEC_ORDER.length : i;
}

const specs = readdirSync(__dirname)
  .filter((f) => f.endsWith(".spec.mjs"))
  .sort((a, b) => specRank(a) - specRank(b) || a.localeCompare(b))
  .map((f) => path.join(__dirname, f));

if (specs.length === 0) {
  console.log("No *.spec.mjs files found in", __dirname);
  process.exit(0);
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const selected = onlyArg
  ? specs.filter((s) => path.basename(s).includes(onlyArg.slice("--only=".length)))
  : specs;

// The suite clock starts here, before server startup -- SUITE_TIMEOUT_MS
// bounds the whole `npm run test:integration` invocation, not just the
// specs themselves.
const suiteDeadline = Date.now() + SUITE_TIMEOUT_MS;
console.log(`Suite hard cap: ${SUITE_TIMEOUT_MS}ms total (override with VIBE_DUNGEON_SUITE_TIMEOUT_MS)`);

const serverChild = await ensureServer();

const results = [];
// Sequential, deliberately: running Playwright/swiftshader instances
// concurrently in this environment causes real CPU contention, which has
// already produced at least one false-negative failure (a settle-timing
// assertion) when tried in parallel. A timeout budget only means something
// if the specs aren't also fighting each other for CPU.
for (const spec of selected) {
  const msLeft = suiteDeadline - Date.now();
  if (msLeft <= 0) {
    console.error(`\n[SUITE TIMEOUT] ${SUITE_TIMEOUT_MS}ms total budget used up -- skipping ${path.basename(spec)} and everything after it`);
    results.push({ file: spec, ok: false, timedOut: false, skipped: true, code: null, elapsed: 0 });
    continue;
  }
  const timeoutMs = Math.min(timeoutFor(spec), msLeft);
  console.log(`\n--- Running ${path.basename(spec)} (timeout ${timeoutMs}ms, ${Math.round(msLeft / 1000)}s left in suite budget) ---`);
  results.push(await runSpec(spec, timeoutMs));
}

if (serverChild) {
  try {
    process.kill(-serverChild.pid);
  } catch {
    // already gone
  }
}

console.log("\n=== Integration test summary ===");
for (const r of results) {
  const status = r.skipped
    ? "SKIPPED (suite timeout)"
    : r.timedOut
      ? `TIMEOUT after ${r.elapsed}ms`
      : r.ok
        ? `PASS (${r.elapsed}ms)`
        : `FAIL exit=${r.code} (${r.elapsed}ms)`;
  console.log(`${r.ok ? "✓" : "✗"} ${path.basename(r.file)} -- ${status}`);
}
const totalElapsed = Date.now() - (suiteDeadline - SUITE_TIMEOUT_MS);
console.log(`Total suite time: ${totalElapsed}ms (cap: ${SUITE_TIMEOUT_MS}ms)`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
