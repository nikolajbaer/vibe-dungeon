# vibe-dungeon

A web-based 3D dungeon crawler in the spirit of *Ultima Underworld*, built with three.js and bitecs. The twist: it's being vibe-coded almost entirely by AI coding agents, coordinated through [GitHub Issues](../../issues), and driven from a phone rather than a workstation.

## Stack

- **TypeScript** + **Vite** — build tooling
- **three.js** — rendering
- **bitecs** — ECS for game state/logic
- **GitHub Actions → GitHub Pages** — CI/CD, deploys on every merge to `main`

## Status

_Last updated: after the player-controller vertical slice ([#2](../../issues/2), [#5](../../issues/5), [#6](../../issues/6), [#9](../../issues/9), and the "open doors" portion of [#7](../../issues/7))._

- **Working:** Vite + TypeScript + three.js scaffold, built on a minimal `bitecs` ECS (position/velocity/collider/door/player-controlled components; input → movement → collision → door-interaction → sync-to-three.js → render pipeline). Playable first-person vertical slice: walk a hand-placed test level (two rooms joined by an L-shaped corridor with one door) using WASD + mouse-look (desktop, click to enable pointer lock) or two virtual joysticks (touch), collide with and slide along walls, and open the door via a short-range raycast (see Design Notes below). Local `npm run build` and `tsc --noEmit` are clean; Playwright smoke tests confirm movement, wall collision, and door interaction all work end-to-end.
- **Outstanding manual step:** repo Settings → Pages → Source needs to be set to "GitHub Actions" before any deploy can actually publish (carried over from [#1](../../issues/1), unchanged by this work).
- **Not started:** enemies/combat, inventory, general item pickup/use (the rest of [#7](../../issues/7)), procedural level generation, real art/audio assets ([#4](../../issues/4), [#11](../../issues/11)), lint/CI beyond the existing build+deploy check ([#3](../../issues/3)).

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

### Door interaction trigger (issues #6 / #7)

Opening a door fires a **raycast straight out from the camera center**; the nearest **closed** door it hits within ~3m opens (slides straight up, past the ceiling line, so it disappears cleanly). What triggers the raycast:

- **Desktop:** press `E`.
- **Touch:** tap anywhere on screen outside both joystick pads.

Doors only open (no auto-close, no "hold to open") — that's the full scope of this pass. The rest of the interaction system (issue #7 — picking up/using general items) should reuse this same "raycast from camera center, triggered by `E`/an outside-the-pads tap" convention for consistency, adding new interactable types rather than inventing a second trigger scheme.

### Procedural stone textures (issue #11)

`src/materials/textures.ts` and `src/materials/dungeonMaterials.ts` are a standalone pair of modules — not imported by anything yet — providing placeholder-grade stone looks with no image assets and no noise library:

- `textures.ts` implements small hashed-noise primitives (a bit-mixing `hash2`, toroidal value noise/fbm, and toroidal Worley/cellular noise) and `createStoneTexture(opts)`, which draws one of three seamlessly-tileable patterns (`"coursed"` block masonry, `"flagstone"` crazy-paving, or `"flat"` low-contrast) onto a `<canvas>` and returns a `THREE.CanvasTexture` with `RepeatWrapping` already set. All the noise sampling wraps toroidally so there's no seam at the tile edges.
- `dungeonMaterials.ts` exports `wallMaterial(repeat?)`, `floorMaterial(repeat?)`, and `ceilingMaterial(repeat?)`, each returning a ready-to-use `THREE.MeshStandardMaterial` (rough, non-metal) built from a cached base texture. Each source texture is authored to represent one 3m project grid unit with individual stone blocks ~0.3-0.6m; `repeat` (default 1, a number or `[x, y]`) is an extra multiplier for surfaces bigger than one grid unit.

**Intended follow-up hookup** (not done here, to stay out of the parallel tile-system work): once the tile-based level system's `src/level/materials.ts` exists with its own `wallMaterial()`/`floorMaterial()`/`ceilingMaterial()` functions (currently flat-colored `MeshStandardMaterial`s), swap their bodies to construct and return `dungeonMaterials.wallMaterial(...)` etc. instead, passing a `repeat` scaled to each tile/face's real size in meters (e.g. `faceSizeMeters / 3`) so stone blocks keep a consistent real-world scale rather than stretching. This should be a small, self-contained change confined to that one file.
