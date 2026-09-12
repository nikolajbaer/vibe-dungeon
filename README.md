# vibe-dungeon

A web-based 3D dungeon crawler in the spirit of *Ultima Underworld*, built with three.js and bitecs. The twist: it's being vibe-coded almost entirely by AI coding agents, coordinated through this README, and driven from a phone rather than a workstation.

## Stack

- **TypeScript** + **Vite** — build tooling
- **three.js** — rendering
- **bitecs** — ECS for game state/logic
- **GitHub Actions → GitHub Pages** — CI/CD, deploys on every merge to `main`

## How this project runs

There's no single developer at a keyboard all day — instead, short-lived coding agent sessions pick up one task at a time from the board below, do the work in a feature branch, open a PR, and hand it off. Because sessions are async and phone-driven, tasks need to be scoped small enough that one agent session can take a task from "todo" to a mergeable PR without needing a mid-task clarifying conversation.

Tasks live in two places, kept in sync: this README's task board (quick overview, grouped by role) and [GitHub Issues](../../issues) (one issue per task, labeled by role, for assignment/discussion/linking to PRs). The README is the map; Issues are where the detail and history lives.

Ground rules for keeping multiple agents from tripping over each other:

1. **One task = one PR = one owner.** Claim a task by assigning yourself the Issue and moving its README line to "in progress" (with the branch/PR name) before starting.
2. **PRs required, reviewed before merging to `main`.** No direct pushes to `main` — every task lands via a PR, even small ones. Feature/task branches (like this one) are fine to push to directly.
3. **Small, single-purpose PRs.** Prefer several small merges over one large one — easier to review from a phone, easier for the next agent to build on a stable `main`.
4. **One agent session active at a time**, for now — pick the next `todo` task off the board rather than starting a second one in parallel, until there's enough surface area (non-overlapping files/systems) that running a couple concurrently stops causing merge conflicts.
5. **Tasks declare their file/module footprint** where possible, so two agents don't get queued against the same files at the same time.
6. **`main` stays deployable.** CI (build + deploy) must pass before merge; don't merge on red CI.
7. **Design decisions that affect multiple systems get written down here** (in the `## Design Notes` section below) rather than living only in a chat log or a PR description, since the next agent won't have that context otherwise.

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

Status legend: `todo` / `in-progress (owner/branch)` / `done`. Each line links to its GitHub Issue for details/discussion.

### Engine/Infra
- [x] `done` — [#1](../../issues/1) Hello-world three.js scene + GitHub Pages deploy pipeline
- [ ] [#2](../../issues/2) Stand up minimal bitecs ECS skeleton
- [ ] [#3](../../issues/3) Add lint/format/typecheck gating to CI
- [ ] [#4](../../issues/4) Basic asset pipeline: glTF model/texture loading

### Gameplay Systems
- [ ] [#5](../../issues/5) First-person player controller + camera (Underworld-style: mouse-look or drag-look for touch, WASD/analog movement)
- [ ] [#6](../../issues/6) Collision/movement against level geometry
- [ ] [#7](../../issues/7) Basic interaction system (use/open/pick up)

### Game Design
- [ ] [#8](../../issues/8) One-page design doc: core loop, moment-to-moment goals, what "Underworld-like" means for this project specifically

### Level Design
- [ ] [#9](../../issues/9) Minimal test level (a few connected rooms/corridors) to exercise the player controller

### Art/Asset
- [ ] [#10](../../issues/10) Concept art pass to establish look and feel (palette, lighting mood, tile/prop style)
- [ ] [#11](../../issues/11) Placeholder primitive art set (blockout materials) so gameplay isn't blocked on final art

### QA/Playtest
- [ ] [#12](../../issues/12) Smoke-test checklist for each deploy (unblocked now that the deploy pipeline exists)

## Design Notes

_(nothing yet — add architectural or design decisions here as they're made, so future agent sessions have the context)_
