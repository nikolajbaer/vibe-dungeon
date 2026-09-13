# vibe-dungeon

A web-based 3D dungeon crawler in the spirit of *Ultima Underworld*, built with three.js and bitecs. The twist: it's being vibe-coded almost entirely by AI coding agents, coordinated through [GitHub Issues](../../issues), and driven from a phone rather than a workstation.

## Stack

- **TypeScript** + **Vite** — build tooling
- **three.js** — rendering
- **bitecs** — ECS for game state/logic
- **GitHub Actions → GitHub Pages** — CI/CD, deploys on every merge to `main`

## Status

_Last updated: after moving level authoring onto the tile-based level format ([#21](../../issues/21))._

- **Working:** Vite + TypeScript + three.js scaffold, built on a minimal `bitecs` ECS (position/velocity/collider/door/player-controlled components; input → movement → collision → door-interaction → sync-to-three.js → render pipeline). The level is now authored as **tile instances** (`src/level/levelData.ts`) against a 3m-grid tile format (`src/level/tiles.ts`, `src/level/occupancy.ts`), loaded through an occupancy index that's validated at load time (adjacent tiles must agree wall-for-wall / open-for-open) and decomposed into the same wall/floor/ceiling/door ECS entities (`src/level/tileBuilder.ts`) the old hand-placed level used to build directly — the player/collision/door/input systems are unchanged. Playable first-person vertical slice: walk a room → corridor → room layout (built from one `hallway` and two `great_hall` tile instances) using WASD + mouse-look (desktop, click to enable pointer lock) or a move stick + Minecraft-style drag-to-look (touch, issue #31), collide with and slide along walls, and open doors via a short-range raycast (see Design Notes below). The player's current sector (from the occupancy index) is tracked and logged to the console as authoring/tracking data — no gameplay depends on it yet. Local `npm run build` and `tsc --noEmit` are clean; Playwright smoke tests confirm movement, wall collision, and door interaction all still work end-to-end, and a standalone check confirms the load-time face-mismatch validation actually throws on bad level data.
- **Outstanding manual step:** repo Settings → Pages → Source needs to be set to "GitHub Actions" before any deploy can actually publish (carried over from [#1](../../issues/1), unchanged by this work).
- **Not started:** enemies/combat, inventory, general item pickup/use (the rest of [#7](../../issues/7)), procedural level generation, a level editor (#14), real art/audio assets ([#4](../../issues/4), [#11](../../issues/11)) — the materials in `src/level/materials.ts` are still flat colors, factored into named functions specifically so a texturing task can swap them in later — sector-based simulation-skipping (tracked as a later optimization, not built yet), stairs/multi-level height, lint/CI beyond the existing build+deploy check ([#3](../../issues/3)).

Update this section as milestones land (what runs, what's live, what's known-broken) — it's meant to be the "what's actually true right now" summary, not a task list.

## How this project runs

There's no single developer at a keyboard all day — instead, short-lived coding agent sessions pick up one task at a time from [Issues](../../issues), do the work in a feature branch, open a PR, and hand it off. Because sessions are async and phone-driven, tasks need to be scoped small enough that one agent session can take a task from "todo" to a mergeable PR without needing a mid-task clarifying conversation.

**Tasks live in GitHub Issues, not here** — one issue per task, labeled by role (see below). This README stays focused on stack, status, and coordination rules.

Ground rules for keeping multiple agents from tripping over each other:

1. **One task = one PR = one owner.** Claim a task by assigning yourself its Issue before starting.
2. **PRs required, reviewed before merging to `main`.** No direct pushes to `main` — every task lands via a PR, even small ones. Feature/task branches are fine to push to directly.
3. **Small, single-purpose PRs.** Prefer several small merges over one large one — easier to review from a phone, easier for the next agent to build on a stable `main`.
4. **One agent session active at a time**, for now — pick the next open Issue off the backlog rather than starting a second one in parallel, until there's enough surface area (non-overlapping files/systems) that running a couple concurrently stops causing merge conflicts.
5. **Tasks declare their file/module footprint** where possible, so two agents don't get queued against the same files at the same time.
6. **`main` stays deployable.** CI (build + deploy) must pass before merge; don't merge on red CI.
7. **Design decisions that affect multiple systems get written down here** (in the `## Design Notes` section below) rather than living only in a chat log or a PR description, since the next agent won't have that context otherwise.

## Agent roles

Each Issue is labeled with the role it belongs to. An agent session should generally stay in its lane for the task it picked up, though small cross-cutting fixes are fine.

| Role | Label | Responsibility |
|---|---|---|
| **Engine/Infra** | `engine-infra` | Build tooling, CI/CD, deploy pipeline, ECS wiring, performance |
| **Gameplay Systems** | `gameplay-systems` | Player controller, camera, combat, inventory, interaction |
| **Game Design** | `game-design` | Core loop, mechanics, progression, balancing |
| **Level Design** | `level-design` | Dungeon layout/generation, encounters, pacing |
| **Art/Asset** | `art-asset` | Concept art, models, textures, animations, UI art |
| **Audio** | `audio` | SFX, music, ambience |
| **QA/Playtest** | `qa-playtest` | Testing, bug triage, regression checks |

## Design Notes

### ECS conventions (`bitecs`)

Components are plain structure-of-arrays objects indexed by entity id (bitECS's recommended pattern), defined in `src/ecs/components.ts`. Systems are plain functions run in a fixed pipeline each frame (`src/game.ts`): **input → movement → collision → door-interaction → sync-to-three.js → render**. A three.js `Object3D` is attached to an entity via the `Object3DRef` component and kept in sync by `syncSystem` — new visual/dynamic entity types should follow that same pattern rather than mutating `Object3D`s directly from other systems.

### Door interaction trigger (issues #6 / #7 / #26)

Opening a door fires a **raycast straight out from the camera center**; the nearest **closed** door leaf it hits within ~3m swings open on a hinge. What triggers the raycast:

- **Desktop:** press `E`.
- **Touch (issue #31):** tap anywhere on screen outside the move pad. Touch controls are now a single move stick (bottom-right) plus Minecraft-style drag-to-look — dragging a finger anywhere outside the move stick's element turns the camera (`src/input/touchLookDrag.ts`, `TouchLookDrag`, mirroring `PointerLook`'s `consume()` pattern) instead of deflecting a second, fixed joystick. Since a tap and the start of a look-drag are indistinguishable until release, each qualifying touch tracks its total displacement from its start point: under ~10px at `touchend` counts as a tap (interact); past that threshold at any point, it's a look-drag and does not interact. Two-finger use works like Minecraft's — one finger on the move stick, the other dragging to look — because `TouchLookDrag` ignores any touch whose target lies inside the move stick's element.

Doors only open (no auto-close, no "hold to open") — that's the full scope of this pass. The rest of the interaction system (issue #7 — picking up/using general items) should reuse this same "raycast from camera center, triggered by `E`/an outside-the-pads tap" convention for consistency, adding new interactable types rather than inventing a second trigger scheme.

**Doors swing on a hinge (issue #26)** — each doorway is built as **two ~1.5m leaves**, hinged on opposite outer edges and swinging outward together like double doors, rather than one 3m slab. A leaf's `Position`/`Collider` stay fixed at its closed-position center throughout — exactly like a wall — so `collisionSystem` needs no door-specific logic beyond the existing `Door.progress` gate (`DOOR_SOLID_UNTIL_PROGRESS`); only the leaf's visual `Object3DRef` moves. That visual is a `THREE.Group` positioned once, at build time, at the leaf's hinge point, with the door slab mesh as a child offset by half the leaf's width — `doorAnimationSystem` (`src/ecs/systems/doors.ts`) then rotates the *group* around Y from 0 to ~100° as `Door.progress` advances, which swings the slab on that hinge instead of spinning it in place. Because a hinge group's position (the hinge point) deliberately differs from `Position` (the leaf center, kept there for collision), `syncSystem` special-cases `Door` entities out of its position-sync loop entirely, the same way it already special-cases rotation-sync to `PlayerControlled` only — otherwise it would stomp the group back onto `Position` every frame. Both leaves of a doorway share a `Door.pairId`, so hitting either one with the interact raycast opens both together.

### Seamless wall corners (issue #26)

`tileBuilder.ts` still emits one box per unit-cell wall segment (`WALL_DIRS`), but a segment's span is no longer always exactly `UNIT`: a second pass (`emitWalls`) first records every wall segment's two corner points, then, for each segment, extends whichever end(s) coincide with a *perpendicular* wall's corner by `WALL_THICKNESS` past the unit-cell boundary. That fills a 90° corner solidly (the two perpendicular segments now overlap in the corner square) instead of the segments only touching edge-to-edge, which is what previously read as a doubled/seamed joint. Ends that border an opening or a door are never extended, so doorway framing is unaffected.

### Tile-based level system (implemented in #21)

Levels are composed from **tiles** on a uniform grid, replacing the hand-placed geometry that used to live directly in `src/level/level.ts` (that file is now just the small orchestrator: place tiles → validate → build geometry — see `src/level/levelData.ts`, `src/level/tiles.ts`, `src/level/occupancy.ts`, `src/level/tileBuilder.ts`).

- **Unit = 3m.** World grid is integer cells `(x, y, z)` (y-up), each cell a 3m cube.
- **Tile type**: a footprint in cells `{w, d, h}` (width×depth×height) plus geometry and a **face map** — for every unit-cell segment on its perimeter, whether that segment is `wall`, `opening`, or `door`. E.g. a hallway is `w=1, d=3, h=1` (3m×9m footprint, 3m ceiling); a great hall is `w=3, d=3, h=2` (9m×9m footprint, 6m ceiling).
- **Doors/openings are always centered on a single unit-cell face**, never spanning a whole multi-unit wall — so a 3-wide wall can have up to three independent connection points, one per unit segment.
- **Tile instance**: `{tileTypeId, originCell, rotation}`, rotation in 90° steps around Y (footprint swaps w/d at 90°/270°).
- **Occupancy index**: built at load time, `cell → tileInstance`, for O(1) "what tile am I in / what's adjacent" lookups. Also used to validate at load time that every pair of adjacent instances agrees at their shared face (both open, or both wall) — a level linter, useful for the future level editor (#14) too.
- **Floors stay at a single baseline for v1** — a tile's height sets ceiling height, not floor offset. Multi-level/stairs is a separate, later feature (real traversal, not just box collision), not part of this pass.
- **Sectors**: each tile instance declares a `sectorId` at authoring time (typically one sector = one room + its alcoves); the player's current sector is derived from the occupancy index every frame. For now this is authoring data only — no entity-activation/culling optimization is built on top of it yet. Add the actual "only simulate entities in/near the current sector" logic later, once enemy/entity counts are high enough for it to show up in profiling; with bitecs's flat typed arrays, iterating everything is cheap at the scale of a couple of rooms.
- Tile types decompose into the same wall/floor/ceiling/door boxes (with `Collider`/`Solid`/`Door`) that `level.ts` used to hand-place, so this only replaces level *authoring* — the player/collision/door ECS systems don't change.

### HUD pattern: Preact + MobX (issue #23)

The HUD (health bar, and future elements like mana/inventory count/rune-spell UI) is built as a small Preact app, layered over the three.js canvas, backed by a MobX store — a separate stack from the ECS/three.js game loop, bridged deliberately rather than having HUD components read ECS state directly:

- **Rendering**: Preact components live under `src/hud/` (`.tsx` files), using the proper JSX transform via `@preact/preset-vite` (`vite.config.ts`) and `"jsx": "react-jsx"` / `"jsxImportSource": "preact"` in `tsconfig.json`. `src/hud/mount.tsx` renders the HUD root (`HUD.tsx`) once into its own overlay DOM node (`#hud-overlay`, `position: fixed; inset: 0; pointer-events: none;`), appended into the same container the touch move stick uses — new HUD elements are added as sibling components under `HUD.tsx`, each opting into pointer events on their own root element only where they actually need clicks/taps.
- **State**: `src/hud/store.ts` holds one MobX store (`hudStore`) built with `makeAutoObservable` — the function-based API, not decorators (`experimentalDecorators` fights Vite's esbuild-based TS transform). Add new HUD state as more observable fields/methods on this store (or a sibling store of the same shape) rather than inventing a second state mechanism.
- **Bridging ECS → MobX**: bitecs has no built-in reactivity, so `src/ecs/systems/hudSync.ts` is a normal system, run once per frame from `game.ts`'s pipeline (after `syncSystem`), that reads relevant player component values and writes them into `hudStore`. MobX only actually re-renders observers on a real value change, so writing unconditionally every frame is cheap. Follow this same shape for new HUD data: read ECS state in `hudSync` (or a sibling sync function), write it into the store, and let components observe the store.
- **Observing in components**: rather than pulling in `mobx-react-lite` (which assumes a React runtime and would need `preact/compat` aliasing), components use a small hand-rolled hook, `useObserved` (`src/hud/useObserved.ts`), that wraps MobX's `autorun` in a Preact `useState`/`useEffect` pair. Read store values through this hook in any new HUD component.
- **Health**: `Health` (`current`/`max`) was added to `src/ecs/components.ts` ahead of real combat (issue #16) specifically so the health bar has something to read; combat should consume this same component rather than adding its own. A debug-only key pair (`[`/`]`, handled in `game.ts`'s frame loop) nudges the player's health up/down so the reactive plumbing is visibly exercised before combat exists — harmless to leave as a permanent debug convenience.
- **Placement/phone-first**: HUD elements are positioned `fixed`, styled in `index.html`'s inline `<style>` block (matching the existing convention for the controls hint / touch joysticks), and account for `env(safe-area-inset-bottom)` since this is a phone-first game. The health bar sits bottom-center; the move-stick pad owns the bottom-right corner (the bottom-left is now free — drag-to-look replaced the left joystick pad in #31), so keep new bottom-row elements narrow enough to fit alongside it.

### Procedural stone textures (issue #11)

`src/materials/textures.ts` and `src/materials/dungeonMaterials.ts` are a standalone pair of modules — not imported by anything yet — providing placeholder-grade stone looks with no image assets and no noise library:

- `textures.ts` implements small hashed-noise primitives (a bit-mixing `hash2`, toroidal value noise/fbm, and toroidal Worley/cellular noise) and `createStoneTexture(opts)`, which draws one of three seamlessly-tileable patterns (`"coursed"` block masonry, `"flagstone"` crazy-paving, or `"flat"` low-contrast) onto a `<canvas>` and returns a `THREE.CanvasTexture` with `RepeatWrapping` already set. All the noise sampling wraps toroidally so there's no seam at the tile edges.
- `dungeonMaterials.ts` exports `wallMaterial(repeat?)`, `floorMaterial(repeat?)`, and `ceilingMaterial(repeat?)`, each returning a ready-to-use `THREE.MeshStandardMaterial` (rough, non-metal) built from a cached base texture. Each source texture is authored to represent one 3m project grid unit with individual stone blocks ~0.3-0.6m; `repeat` (default 1, a number or `[x, y]`) is an extra multiplier for surfaces bigger than one grid unit.

**Intended follow-up hookup** (not done here, to stay out of the parallel tile-system work): now that the tile-based level system's `src/level/materials.ts` exists with its own `wallMaterial()`/`floorMaterial()`/`ceilingMaterial()` functions (currently flat-colored `MeshStandardMaterial`s), swap their bodies to construct and return `dungeonMaterials.wallMaterial(...)` etc. instead, passing a `repeat` scaled to each tile/face's real size in meters (e.g. `faceSizeMeters / 3`) so stone blocks keep a consistent real-world scale rather than stretching. This should be a small, self-contained change confined to that one file.
