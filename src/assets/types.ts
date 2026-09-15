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

/** Floor-plan half-extents (meters) for a furniture asset's `Collider` —
 * matches the axis-aligned-box shape `ecs/components.ts`'s `Collider`
 * already only supports. */
export interface Footprint {
  hx: number;
  hz: number;
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
