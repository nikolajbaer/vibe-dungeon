# Cleanup backlog

Items a codebase review flagged as probably-safe-to-remove or worth revisiting,
but not acted on yet — each is either not fully confirmed unused, or is a
bigger change than the PR that noticed it warranted. Revisit after a few more
PRs land, once it's clearer whether new code has started depending on any of
these; if not, remove/fix.

- **Dead `wallRun` mesh metadata** — `src/level/tileBuilder.ts`'s `addWall()`
  sets `mesh.userData.wallRun = true` on every wall mesh, but nothing in the
  codebase reads `userData.wallRun` anywhere. Looks like leftover metadata
  from an earlier wall-run feature/experiment. Remove once confirmed nothing
  external (an in-progress branch, a debug tool) depends on it.

- **`docs/LEVEL_DESIGN.md` drift** — hasn't been updated for the arch/wall-run
  geometry work (the continuous wall-run merging covered by
  `tests/level-geometry-validation.mjs`). The doc should describe how that
  geometry is built and merged, same level of detail as the rest of the file.

- **`npm audit` vulnerabilities** — 2 (1 moderate, 1 high), both transitively
  from `esbuild` via `vite`. `npm audit fix --force` would resolve them but
  bumps to `vite@8`, a breaking major version change — needs its own
  dedicated PR to verify the dev server, build, and all `ssrLoadModule`-based
  fast tests still work under it, not a drive-by fix.

- **Missing `AGENTS.md`** — no repo-root `AGENTS.md` describing conventions
  for AI coding agents working on this codebase (this project has been
  developed with heavy AI-agent involvement across multiple tools). Worth
  adding once the current conventions (fast `tests/*.mjs` validation scripts,
  the branch → PR → squash-merge workflow, etc.) have settled a bit more.

- **`rangedCombatSystem`'s per-bolt raycast scans the whole scene graph** —
  `src/ecs/systems/rangedCombat.ts`'s flight loop calls
  `raycaster.intersectObjects(scene.children, true)` once per flying bolt per
  frame, walking every object in the scene rather than a level-geometry-only
  subset. Fine at today's scale (a handful of bolts in flight at once, modest
  scene sizes), but worth narrowing to a dedicated collidable list if ranged
  combat scenes grow or profiling ever shows it as a hot path — this one is a
  performance concern rather than a "confirm it's unused" one, so it's worth
  watching sooner than the others if a level with many props/NPCs starts
  feeling slower to fire into.
