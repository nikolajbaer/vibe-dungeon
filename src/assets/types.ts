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

/** Shared shape for "this asset is itself a lootable `Container`" (see
 * `ecs/components.ts`) — used identically by `FurnitureAssetDef` (a barrel)
 * and `ItemAssetDef` (a backpack): either way, `capacity` is how many items
 * it can hold, and the entity it lands on becomes a valid `Carried.ownerEid`
 * other items can point at. */
export interface ContainerSpec {
  capacity: number;
}

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
  /** Reach (meters) of this weapon's melee hit-detection box — see
   * `meleeCollision.ts`'s `registerMeleeSwing`, which scales this by the
   * current attack type's own shape (a jab thrusts further/narrower, a chop
   * covers a wider arc) rather than using it as a flat distance. `undefined`
   * (no weapon, or a non-weapon hand item like the lantern) falls back to
   * `UNARMED_REACH` in combat.ts, the same pattern `meleeDamage` already
   * uses for damage. */
  meleeReach?: number;
  /** Optional ranged-weapon tuning. Ammo is another stackable item type;
   * firing consumes one unit and the weapon cannot fire again until reload. */
  rangedWeapon?: {
    ammoItemTypeId: string;
    damage: number;
    reloadSeconds: number;
    projectileSpeed: number;
    maxRange: number;
  };
  /** True for a `slot: "hand"` item that needs both hands -- equipping one
   * (`ecs/systems/items.ts`'s `equipItem`) unequips whatever's currently in
   * *either* hand first, and while it's equipped `findOpenHandSlot` reports
   * neither hand as open, so nothing else can be equipped alongside it (the
   * crossbow: no bracing a dagger in the off-hand while it's drawn). A
   * one-handed item never needs to check this on itself -- only on whatever
   * it might be displacing. */
  twoHanded?: boolean;
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
  /** Overrides the generic sword-like first-person pose. */
  viewmodelTransform?: { position: THREE.Vector3Tuple; rotation: THREE.EulerTuple };
  /** Mass (kg) of this item's simulated world body. Every world item is a
   * dynamic rigid body — it falls, lands, and skitters when kicked — and
   * this is the only knob an asset needs to feel right, since the collider
   * box itself is measured off the finished mesh (`boxShapeOf` in
   * level/spawning.ts). Defaults to a generic light-object mass when
   * omitted; set it when an item should read as notably heavy (a sword) or
   * notably slight (a gem). */
  mass?: number;
  /** Opts this item into being itself a lootable `Container` (a backpack) —
   * `spawnItems` (level/spawning.ts) adds the ECS `Container` component
   * whenever an entity of this type is created, so it works identically
   * whether the item is lying in the world or already carried. Tapping a
   * container item in the inventory list (`InventoryList.tsx`) opens the
   * same container panel a barrel does (`container/store.ts`), instead of
   * trying to equip it — see `CarriedItemView.isContainer`. */
  container?: ContainerSpec;
  /** Extra carry-weight capacity (kg) this item grants while carried — only
   * meaningful alongside `container` (a backpack raises what you can carry
   * in exchange for its own weight, per `maxCarryWeight` in
   * ecs/systems/items.ts), but declared as its own field rather than folded
   * into `ContainerSpec` since it's specific to an *item* container, not a
   * furniture one (a barrel doesn't travel with you, so it never raises
   * your own cap). Items stored inside the container still count fully
   * toward the player's total — this only ever raises the ceiling, never
   * makes anything weightless. */
  carryCapacityBonus?: number;
  /** Opts this item into being a commodity (coins; arrows and sling rocks
   * would follow the same pattern) — every entity of this type piles into
   * one stack per owner instead of a separate inventory slot per pickup
   * (the ECS `Stackable` component, added by `spawnItems`/`giveItem` in
   * ecs/systems/items.ts). `mass` above is still a *per-unit* weight: a
   * pile of 50 genuinely weighs 50x what one does, it isn't a flat
   * per-slot cost. Mutually exclusive with `container` in practice — a
   * stack of backpacks makes no sense — though nothing enforces that today. */
  stackable?: boolean;
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
  /** Opts this asset into being a *simulated* prop rather than immovable
   * scenery: it falls under gravity, stacks on whatever's beneath it, tips
   * over, and gets shoved by a character walking into it.
   *
   * Omit for anything that should feel like part of the architecture — a
   * wall-mounted banner, a candelabra whose light would swing wildly if it
   * fell over. A dynamic asset ignores `footprint` entirely: its collider is
   * measured off the finished mesh instead (`boxShapeOf` in
   * level/spawning.ts), because a real 3D body needs its true height and
   * center, not just a floor plan.
   *
   * `mass` is in kg and is what actually sets the feel — it's the difference
   * between a chair that scoots and a table that barely budges. */
  dynamic?: { mass: number };
  /** Opts this asset into being a lootable storage container (a barrel) —
   * `spawnProps` (level/spawning.ts) adds the ECS `Container` component and
   * makes the placed instance raycast-interactable, opening the container
   * UI (`container/store.ts`) the same way a door or readable does.
   * `capacity` is how many items it can hold at once. Currently only
   * supported alongside `dynamic` (see `spawnProps`), since every container
   * asset so far is also a shovable physical object; a purely static
   * container (a wall safe) would need that generalized when one shows up. */
  container?: ContainerSpec;
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
 * CHASING/ATTACKING, driven by the `aggro*`/`attack*`/`chaseSpeed` fields
 * below, all required together for that behavior. A chase itself never
 * leashes on distance (see `npc.ts`'s `updateAggressive`) -- it gives up
 * only once the target leaves whatever sector the NPC is currently in.
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
  /** Aggressive only: reach (meters) of this archetype's melee swing box —
   * same meaning as `ItemAssetDef.meleeReach`, since an NPC never actually
   * equips a real weapon item (its `weaponClass` is cosmetic/numeric
   * only — see `createAnimatedNpcMesh`'s rig-baked weapon mesh). Omitted
   * archetypes fall back to a value picked from `weaponClass`, the
   * same "derive a sensible default from the weapon class" pattern
   * `attackDamage`/`attackRange` already fall back to in `npc.ts`. */
  attackReach?: number;
  /** Aggressive only: seconds between attacks while `ATTACKING` and still
   * in range. */
  attackCooldown?: number;
  /** Chance from 0..1 that this NPC is already blocking at the instant an
   * incoming melee hit lands (`combat.ts`'s `applyMeleeDamage`) -- an NPC
   * has no real held-block input of its own, so this stands in for one. */
  agility?: number;
  /** What this NPC effectively fights and defends with -- used both as the
   * `attackDamage`/`attackReach` fallback basis above and to look up its
   * block mitigation (`combat.ts`'s `BLOCK_MITIGATION`) when it blocks a
   * hit, since an NPC never actually equips a real weapon item to read
   * either from directly. */
  weaponClass?: "unarmed" | "dagger" | "oneHanded";
  /** Max stamina (RPG groundwork -- see `ecs/components.ts`'s `Stamina`).
   * Omitted archetypes fall back to `DEFAULT_NPC_MAX_STAMINA` in
   * `level/spawning.ts`. */
  maxStamina?: number;
  /** Aggressive only: movement speed (m/s) while `CHASING` — deliberately a
   * separate field from a docile archetype's (shared, module-level) wander/
   * follow speeds in `npc.ts`, since only aggressive archetypes need to
   * tune it for balance. */
  chaseSpeed?: number;
  /** Builds this instance's mesh. `eid` is threaded through to
   * `createAnimatedNpcMesh` (`ecs/systems/npcAnimation.ts`), which stamps
   * it onto the mesh as `userData.eid` for the interact/melee raycasts. */
  createMesh(eid: number): THREE.Object3D;
}
