import * as THREE from "three";

// The asset-authoring system: every weapon/potion/curio ("item") and every
// piece of furniture/decor ("prop") is one file under src/assets/items/ or
// src/assets/furniture/ that default-exports one of the Def types below.
// Files are discovered automatically at build time (see itemRegistry.ts/
// furnitureRegistry.ts, one directory up, via `import.meta.glob`) — adding a
// new asset means adding one new file and touching nothing else, ever.
//
// This exists because the old approach collided in practice: a new item
// meant editing a shared `ITEM_TYPES` registry object *and* a shared
// `createViewmodelMesh` if/else chain in ecs/systems/items.ts, and a new
// prop meant editing the shared body of decorations.ts's `addDecorations()`
// — which is exactly where two parallel PRs (the great-hall decorations and
// the dungeon-branch side-chamber clutter) both landed on the same lines and
// had to be merged by hand. See src/level/placementTypes.ts for the other
// half of this system (how assets get placed in the level as data, not
// imperative calls).

/** The only equip-slot *kind* an item can declare today — "hand" means it
 * can go into either `hand-left` or `hand-right` (see `Carried` in
 * ecs/components.ts); `null` means the item has no equip slot at all
 * (inventory/curio only — the gem, or a future potion before a
 * drink-to-consume mechanic exists to make `slot: "hand"` meaningful for
 * one). */
export type EquipSlotKind = "hand" | null;

/**
 * One item asset — a weapon, potion, or curio. `id`/`name`/`icon`/`slot`/
 * `meleeDamage` are exactly the old `ItemType` record's fields (same names,
 * same meaning), so `combat.ts` and `inventory/sync.ts` need no logic
 * changes, just a new import path.
 */
export interface ItemAssetDef {
  /** Unique id — also this module's filename (minus extension) by
   * convention. Indexes `Item.itemTypeId` (ecs/components.ts) and every
   * `ItemSpawn.id` that places this asset in the world. */
  id: string;
  name: string;
  /** Unicode glyph used as this item's icon everywhere in the UI (paper
   * doll, inventory list) — no image/texture assets for items anywhere in
   * this repo. */
  icon: string;
  slot: EquipSlotKind;
  /** Damage `tryMeleeAttack` (ecs/systems/combat.ts) deals while this item
   * is equipped in a hand slot. `undefined` means "not a weapon" — combat.ts
   * falls back to its own unarmed damage constant rather than this being 0,
   * so a non-weapon `slot: "hand"` item (the lantern, a future torch or
   * shield) doesn't accidentally zero out an otherwise-unarmed attack. */
  meleeDamage?: number;
  /** Builds this item's in-world pickup mesh. Call once per usage site —
   * every mesh factory in this repo is cheap enough not to need caching/
   * sharing across instances (each caller may want to scale or reposition
   * its own copy independently, e.g. a viewmodel shrinking it for a closer
   * camera distance). */
  createWorldMesh(): THREE.Object3D;
  /** Builds this item's first-person viewmodel — only needed for a `slot:
   * "hand"` item that should actually render (or do something — the
   * lantern's light) while held. Omit for a `slot: null` item (nothing to
   * equip) or a hand item with no distinct held look yet (falls back to
   * unarmed-handed, same as no weapon at all).
   *
   * Returning a `THREE.Group` rather than a bare mesh lets an item attach
   * extra behavior-bearing children (a `THREE.PointLight`, say) that ride
   * along for free with the camera-attach/detach `equipItem`/`unequipItem`
   * (ecs/systems/items.ts) already does — nothing else needs to know a
   * lit item is lit; the light turns on and off exactly when its group is
   * added to/removed from the camera. */
  createViewmodelMesh?(): THREE.Object3D;
}

/** Half-extents (meters) of the box a furniture asset blocks movement with.
 * `hx`/`hz` are its floor plan; `hy` is how tall it stands, measured from
 * the floor up (a prop's mesh origin sits on the floor), and defaults to a
 * generic table/barrel height when omitted — every existing asset predates
 * real 3D collision and simply doesn't declare one yet. */
export interface Footprint {
  hx: number;
  hz: number;
  hy?: number;
}

/**
 * One furniture/prop asset — table, chair, barrel, banner, candelabra,
 * crate, etc. `P` is whatever asset-specific extra data this asset's mesh
 * needs (e.g. the banner's primary/accent colors) — each asset module
 * defines and interprets its own shape; the generic placement/spawn system
 * (`level/spawning.ts`) just threads `PropPlacement.params` through
 * opaquely, the same way `TileType.faces` values are opaque to
 * `occupancy.ts`'s generic rotation/validation logic.
 */
export interface FurnitureAssetDef<P = unknown> {
  id: string;
  /** Builds this asset's mesh, already shaped/colored per `params`. Facing
   * is *not* baked in here — `createChair`'s old "faces local +z, caller
   * rotates" convention is now the system-wide rule: every placement's
   * `rotation` (see `PropPlacement`) is applied generically by the spawner,
   * not per-asset. */
  createMesh(params?: P): THREE.Object3D;
  /** Fixed footprint, or omitted for a purely decorative asset with no
   * collider (a wall-mounted banner nothing can physically walk into).
   * Almost always a plain constant; the function form only exists for the
   * rare asset whose footprint genuinely depends on `params`. */
  footprint?: Footprint | ((params?: P) => Footprint | undefined);
}

/**
 * One NPC archetype — a reusable "kind" of character (a villager, a
 * bandit), auto-discovered the same way item/furniture assets are (one file
 * under `src/assets/npcs/`, picked up by `src/assets/npcRegistry.ts`'s
 * `import.meta.glob`). `NPC.archetypeId` (`ecs/components.ts`) indexes this
 * registry for a placed instance's stats/behavior/mesh, the same
 * shared-type-vs-per-instance-state split every other archetype/type
 * registry in this repo uses.
 *
 * `behavior` picks which half of `ecs/systems/npc.ts`'s state machine an
 * instance runs: `"docile"` stays on today's LOITERING/FOLLOWING wander,
 * with `dialogueId` (if set) making an interact open dialogue instead of
 * toggling follow (see `dialogueId`'s own doc comment); `"aggressive"` adds
 * CHASING/ATTACKING, driven by the `aggro*`/`attack*`/`chaseSpeed`/
 * `leashRange` fields below, all required together for that behavior.
 */
export interface NpcArchetypeDef {
  id: string;
  name: string;
  health: number;
  behavior: "docile" | "aggressive";
  /** Radius (meters) of this archetype's physics capsule — how much room it
   * takes up walking through a doorway. */
  halfExtent: number;
  /** Docile only: a dialogue tree id (`src/dialogue/dialogueRegistry.ts`)
   * to open on interact, instead of the legacy `toggleNpcFollow` demo
   * behavior (issue #36) an archetype without one still falls back to. */
  dialogueId?: string;
  /** Aggressive only: distance (meters) from the player, while `LOITERING`,
   * at which this NPC notices the player and starts `CHASING`. No
   * line-of-sight check — a simple radius, matching this project's "v1,
   * simple" bar elsewhere (e.g. sectors have no culling logic yet either). */
  aggroRange?: number;
  /** Aggressive only: once within this distance of the player while
   * `CHASING`, stop and switch to `ATTACKING`. */
  attackRange?: number;
  attackDamage?: number;
  /** Aggressive only: seconds between attacks while `ATTACKING` and still
   * in range. */
  attackCooldown?: number;
  /** Aggressive only: movement speed (m/s) while `CHASING` — deliberately a
   * separate field from a docile archetype's (shared, module-level) wander/
   * follow speeds in `npc.ts`, since only aggressive archetypes need to
   * tune it for balance. */
  chaseSpeed?: number;
  /** Aggressive only: once further than this from `NPC.homeX/homeZ` while
   * `CHASING`/`ATTACKING`, give up and return to `LOITERING` (re-anchoring
   * home where it stopped, same as a docile archetype dropping out of
   * `FOLLOWING`) — otherwise a hostile could chase the player across the
   * entire reachable map once the doors between are open (doors never
   * auto-close; see `ecs/systems/doors.ts`). */
  leashRange?: number;
  /** Builds this instance's mesh. `eid` is threaded through to
   * `createAnimatedNpcMesh` (`ecs/systems/npcAnimation.ts`), which stamps
   * it onto the mesh as `userData.eid` for the interact/melee raycasts. */
  createMesh(eid: number): THREE.Object3D;
}
