# vibe-dungeon

A web-based 3D dungeon crawler in the spirit of *Ultima Underworld*, built with three.js and bitecs. The twist: it's being vibe-coded almost entirely by AI coding agents, coordinated through [GitHub Issues](../../issues), and driven from a phone rather than a workstation.

## Stack

- **TypeScript** + **Vite** — build tooling
- **three.js** — rendering
- **bitecs** — ECS for game state/logic
- **GitHub Actions → GitHub Pages** — CI/CD, deploys on every merge to `main`

## Status

_Last updated: after the hello-world scaffold ([#1](../../issues/1))._

- **Working:** Vite + TypeScript + three.js project scaffold, rendering a single rotating cube (smoke-test scene, no gameplay). Local `npm run build` verified clean.
- **In progress / not yet merged:** the scaffold above and its GitHub Actions Pages-deploy workflow exist on a branch but haven't been merged to `main` yet, so nothing is live at `https://nikolajbaer.github.io/vibe-dungeon/` yet.
- **Outstanding manual step:** repo Settings → Pages → Source needs to be set to "GitHub Actions" before any deploy can actually publish.
- **Not started:** ECS wiring, player controller, levels, art, audio, everything gameplay-related.

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

_(nothing yet — add architectural or design decisions here as they're made, so future agent sessions have the context)_
