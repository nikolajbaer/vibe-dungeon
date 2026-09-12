# vibe-dungeon

A web-based 3D dungeon crawler in the spirit of *Ultima Underworld*, built with three.js and bitecs. The twist: it's being vibe-coded almost entirely by AI coding agents, coordinated through this README, and driven from a phone rather than a workstation.

## Stack

- **TypeScript** + **Vite** — build tooling
- **three.js** — rendering
- **bitecs** — ECS for game state/logic
- **GitHub Actions → GitHub Pages** — CI/CD, deploys on every merge to `main`

## How this project runs

There's no single developer at a keyboard all day — instead, short-lived coding agent sessions pick up one task at a time from the board below, do the work in a feature branch, open a PR, and hand it off. Because sessions are async and phone-driven, tasks need to be scoped small enough that one agent session can take a task from "todo" to a mergeable PR without needing a mid-task clarifying conversation.

Ground rules for keeping multiple agents from tripping over each other:

1. **One task = one PR = one owner.** Claim a task by moving it to "in progress" (with the branch/PR name) before starting.
2. **Small, single-purpose PRs.** Prefer several small merges over one large one — easier to review from a phone, easier for the next agent to build on a stable `main`.
3. **Tasks declare their file/module footprint** where possible, so two agents don't get queued against the same files at the same time.
4. **`main` stays deployable.** CI (build + deploy) must pass before merge; don't merge on red CI.
5. **Design decisions that affect multiple systems get written down here** (in a `## Design Notes` section, once we have any) rather than living only in a chat log or a PR description, since the next agent won't have that context otherwise.

## Agent roles

Each task below is tagged with the role it belongs to. An agent session should generally stay in its lane for the task it picked up, though small cross-cutting fixes are fine.

| Role | Responsibility |
|---|---|
| **Engine/Infra** | Build tooling, CI/CD, deploy pipeline, ECS wiring, performance |
| **Gameplay Systems** | Player controller, camera, combat, inventory, interaction |
| **Game Design** | Core loop, mechanics, progression, balancing |
| **Level Design** | Dungeon layout/generation, encounters, pacing |
| **Art/Asset** | Concept art, models, textures, animations, UI art |
| **Audio** | SFX, music, ambience |
| **QA/Playtest** | Testing, bug triage, regression checks |

## Task board

Status legend: `todo` / `in-progress (owner/branch)` / `done`

### Engine/Infra
- [ ] `in-progress` — Hello-world three.js scene: Vite + TypeScript scaffold, single rotating-cube (or similar) scene, GitHub Actions workflow deploying to GitHub Pages. Goal: prove out the deploy pipeline end-to-end.
- [ ] Add bitecs and stand up a minimal ECS skeleton (a couple of components/systems wired into the render loop)
- [ ] Add lint/format/typecheck to CI (block merge on failure)
- [ ] Basic asset pipeline (loading glTF models/textures)

### Gameplay Systems
- [ ] First-person player controller + camera (Underworld-style: mouse-look or drag-look for touch, WASD/analog movement)
- [ ] Collision/movement against level geometry
- [ ] Basic interaction system (use/open/pick up)

### Game Design
- [ ] One-page design doc: core loop, moment-to-moment goals, what "Underworld-like" means for this project specifically

### Level Design
- [ ] Minimal test level (a few connected rooms/corridors) to exercise the player controller

### Art/Asset
- [ ] Concept art pass to establish look and feel (palette, lighting mood, tile/prop style)
- [ ] Placeholder primitive art set (blockout materials) so gameplay isn't blocked on final art

### QA/Playtest
- [ ] (blocked until there's a build) Smoke-test checklist for each deploy

## Design Notes

_(nothing yet — add architectural or design decisions here as they're made, so future agent sessions have the context)_
