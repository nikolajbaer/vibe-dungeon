# Integration tests

Playwright specs that drive the actual game (or the level viewer) end to
end in a real headless browser -- the same approach used ad hoc throughout
this project's history, now consolidated into one committed, timeout-bound
suite instead of one-off scratchpad scripts.

## Running

```
npm run test:integration
```

This starts a dev server if one isn't already running at
`VIBE_DUNGEON_URL` (default `http://localhost:5195/`), then runs every
`*.spec.mjs` file in this directory **sequentially** -- not in parallel.
Running multiple Playwright/swiftshader instances concurrently in a
CPU-constrained environment causes real contention that has produced at
least one false-negative failure; a timeout budget only means something if
the specs aren't also fighting each other for CPU.

To run just one spec directly (for iterating on it) with a real dev server
already up:

```
node tests/integration/rigid-bodies.spec.mjs
```

## Why timeouts

A handful of these checks (ported from ad hoc scratchpad scripts during
the #86-#88 stairwell work) would occasionally run for minutes under CPU
contention with the software renderer, with nothing to cut them off. Two
layers guard against that now:

- Each spec calls `installWatchdog()` (`harness.mjs`), which force-exits
  the process with a clear message if the spec hasn't finished within its
  own budget -- this is what fires for the ordinary "an `await` never
  resolved" case.
- `run.mjs`, the runner, wraps every spec in its own hard timeout and
  kills its whole process group (not just the node process -- the
  spawned Chromium too) if it's still running past that. This is the
  backstop for the case where something wedges hard enough that even the
  in-process watchdog can't fire.

Both timeouts are generous (90s-180s depending on the spec) since this
environment's software rendering is genuinely slower than a real GPU, not
because these checks are expected to take that long normally.

## Adding a spec

Import `launchGame`, `walkTo`, `assert`, and `installWatchdog` from
`harness.mjs`. Call `installWatchdog(ms)` first, `launchGame()` next, do
the check, then `browser.close()` in a `finally` block alongside
`stopWatchdog()`. See any existing `*.spec.mjs` for the pattern. If the
check is expected to genuinely take longer than the runner's 120s default
(a full combat-to-the-death, a full stair climb), add a per-file override
to `TIMEOUT_OVERRIDES_MS` in `run.mjs`.
