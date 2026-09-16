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

// A few specs legitimately run longer than the rest under this
// environment's software-rendered CPU load -- named per file rather than
// raising the default across the board, so a spec that actually hangs
// still gets caught promptly. Budgets below include real margin over
// measured worst-case runs, not just a guess: bandit-combat and
// corpse-linger measured ~90s, stairwell-wall-gaps ~150s, and
// verticality-stairs' real ramp climb alone measured over 4 minutes on one
// run in this environment (its budget is deliberately the most generous).
const TIMEOUT_OVERRIDES_MS = {
  "verticality-stairs.spec.mjs": 600000,
  "stairwell-wall-gaps.spec.mjs": 240000,
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

function runSpec(file) {
  const timeoutMs = timeoutFor(file);
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

const specs = readdirSync(__dirname)
  .filter((f) => f.endsWith(".spec.mjs"))
  .sort()
  .map((f) => path.join(__dirname, f));

if (specs.length === 0) {
  console.log("No *.spec.mjs files found in", __dirname);
  process.exit(0);
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const selected = onlyArg
  ? specs.filter((s) => path.basename(s).includes(onlyArg.slice("--only=".length)))
  : specs;

const serverChild = await ensureServer();

const results = [];
// Sequential, deliberately: running Playwright/swiftshader instances
// concurrently in this environment causes real CPU contention, which has
// already produced at least one false-negative failure (a settle-timing
// assertion) when tried in parallel. A timeout budget only means something
// if the specs aren't also fighting each other for CPU.
for (const spec of selected) {
  console.log(`\n--- Running ${path.basename(spec)} (timeout ${timeoutFor(spec)}ms) ---`);
  results.push(await runSpec(spec));
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
  const status = r.timedOut ? `TIMEOUT after ${r.elapsed}ms` : r.ok ? `PASS (${r.elapsed}ms)` : `FAIL exit=${r.code} (${r.elapsed}ms)`;
  console.log(`${r.ok ? "✓" : "✗"} ${path.basename(r.file)} -- ${status}`);
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
