import * as THREE from "three";
import type { RigidBody, Collider as RapierCollider } from "@dimforge/rapier3d-compat";

// bitECS components. Following bitECS's recommended structure-of-arrays (SoA)
// style: a component is a plain object of parallel arrays indexed by entity
// id (eid). See https://github.com/NateTheGreatt/bitECS for the pattern.
//
// Kept intentionally small — this is the ECS foundation for the vertical
// slice (player controller + collision + doors), not a general engine.

/** World-space position (meters), all three axes meaningful now that
 * collision is real 3D (Rapier — see src/physics/world.ts). For a character
 * this is its **feet**, not its center or its eye level; see
 * `CharacterBody`. */
export const Position = {
  x: [] as number[],
  y: [] as number[],
  z: [] as number[],
};

/** Planar velocity (m/s). No vertical component — the dungeon floor is flat
 * and there's no jumping/gravity yet. */
export const Velocity = {
  x: [] as number[],
  z: [] as number[],
};

/** Facing. yaw = heading around Y (radians), pitch = look up/down (radians).
 * Only meaningful for the player/camera today. */
export const Rotation = {
  yaw: [] as number[],
  pitch: [] as number[],
};

/** A character's capsule and the controller state that goes with it (see
 * `ecs/systems/character.ts`). Replaces the old XZ-only `Collider`, which
 * described a floor-plan box with no vertical extent at all; a character is
 * now a real 3D capsule owned by Rapier, and this is the ECS-side
 * description of it plus the bits of per-step state the controller produces.
 *
 * `Position` for a character means its **feet** — the capsule's center sits
 * `radius + halfHeight` above that (`capsuleCenterOffset` in
 * physics/world.ts). That's also why the player's camera is offset by
 * `RenderOffsetY` rather than `Position` being eye-level as it used to be:
 * with real ground contact, "where the character stands" is the useful
 * anchor, and it now means the same thing for the player and for NPCs. */
export const CharacterBody = {
  radius: [] as number[],
  /** Half-height of the capsule's straight middle section, excluding the two
   * hemisphere caps — total height is `2 * (halfHeight + radius)`. */
  halfHeight: [] as number[],
  /** Accumulated fall speed (m/s, negative = falling), integrated by
   * `characterSystem` and zeroed on landing. */
  verticalVelocity: [] as number[],
  /** 1 when Rapier's controller reported ground contact on the last step. */
  grounded: [] as number[],
};

/** Tag: the single player-controlled entity. */
export const PlayerControlled: Record<string, never> = {};

/** Vertical offset (meters) added to `Position.y` when `syncSystem` writes
 * this entity's `Object3DRef` — for an entity whose visual origin isn't its
 * physics origin. Only the player uses it today (its `Object3DRef` is the
 * camera, which belongs at eye height rather than at the feet); absent
 * entries read as 0, so nothing else has to opt out. */
export const RenderOffsetY: number[] = [];

export const DoorState = {
  CLOSED: 0,
  OPENING: 1,
  OPEN: 2,
  CLOSING: 3,
} as const;

/** A door leaf that swings open (or closed) on a vertical hinge (see
 * doors.ts). Both its visual `Object3DRef` (a hinge `THREE.Group`, see
 * tileBuilder.ts) and its kinematic `PhysicsBody` sit *at the hinge* and
 * rotate in lockstep as it opens/closes, so the collider genuinely swings
 * with it. That's what retired the old "treat a door as non-solid once it's
 * 90% open" fudge, which only existed because a fixed AABB at the leaf's
 * closed position could never move aside. A door has no `Position` of its
 * own — nothing needs one now that its collider lives on the hinge body. */
export const Door = {
  state: [] as number[], // one of DoorState
  progress: [] as number[], // 0 (closed) .. 1 (fully open)
  hingeSign: [] as number[], // +1 or -1: which way this leaf swings around its hinge
  pairId: [] as number[], // eid shared by both leaves of one doorway, so opening either opens both
  /** 1 if this door requires `requiredItemTypeId` in the player's inventory
   * to open (see doors.ts's `toggleDoor`); 0 for an ordinary door. Once
   * unlocked with the right item it's set back to 0 permanently — there's no
   * re-locking. Authored via `LockedDoorSpec` (placementTypes.ts), not
   * per-leaf: both leaves of a pair always carry the same value. */
  locked: [] as number[],
  /** References an `ItemAssetDef.id` (a key) that unlocks this door —
   * `undefined` for an ordinary (never-locked) door. Stays set even after
   * `locked` flips to 0, purely as a record of what it *was* locked with;
   * nothing reads it once unlocked. */
  requiredItemTypeId: [] as (string | undefined)[],
};

/** Backing three.js Object3D for entities with a visual representation
 * (AoS-by-reference component — see bitECS docs on component storage).
 * Synced from Position/Rotation each frame by syncSystem. */
export const Object3DRef: (THREE.Object3D | undefined)[] = [];

/** Backing Rapier rigid body, for entities the physics world actually moves
 * or is moved by: characters (kinematic, driven by `characterSystem`), door
 * leaves (kinematic, rotated by `doorAnimationSystem`), and dynamic props and
 * world items (simulated — see `DynamicBody`). Static level geometry — walls,
 * floors, ceilings, and any prop that doesn't declare itself dynamic —
 * deliberately has *no* ECS entity at all: Rapier owns those colliders
 * outright, and nothing else ever needed them as entities (see
 * `buildGeometryFromOccupancy`).
 *
 * Same AoS-by-reference shape as `Object3DRef`, for the same reason: these
 * are object handles, not numeric component data. */
export const PhysicsBody: (RigidBody | undefined)[] = [];

/** A character's own Rapier collider — held separately from `PhysicsBody`
 * because `KinematicCharacterController.computeColliderMovement` takes the
 * *collider*, not the body. */
export const PhysicsCollider: (RapierCollider | undefined)[] = [];

/** Marks an entity whose transform is produced by the physics simulation
 * rather than written by gameplay code — a pushable prop, a dropped sword.
 * The direction of data flow is the whole point of the tag and is the
 * opposite of a character's: a character's `Velocity` is an *input* Rapier
 * resolves, whereas a dynamic body is moved entirely by gravity, contacts,
 * and shoves, and `Position`/`PhysicsRotation` are read back out of it
 * afterward (`ecs/systems/dynamics.ts`).
 *
 * Which assets get this is authored data, not a code path: see
 * `FurnitureAssetDef.dynamic` in assets/types.ts (every world item is
 * dynamic; a prop opts in). */
export const DynamicBody: Record<string, never> = {};

/** Full orientation as a quaternion, for entities that can rotate about any
 * axis — which `Rotation`'s yaw/pitch pair deliberately can't express. Only
 * dynamic bodies have it: a chair knocked over lands on its side, and no
 * amount of yaw describes that.
 *
 * Kept as a component rather than written straight onto the `Object3DRef`
 * from the physics step so that `syncSystem` stays the single place any
 * three.js transform is written, the same as every other visual property. */
export const PhysicsRotation = {
  x: [] as number[],
  y: [] as number[],
  z: [] as number[],
  w: [] as number[],
};

export const NpcState = {
  LOITERING: 0,
  FOLLOWING: 1,
  /** Aggressive archetypes only (see `src/assets/npcRegistry.ts`): spotted
   * the player and closing the distance. */
  CHASING: 2,
  /** Aggressive archetypes only: in range, dealing damage on a cooldown. */
  ATTACKING: 3,
} as const;

/** An NPC entity (issue #36, extended for archetypes) — the first non-door
 * consumer of the generalized interact-raycast dispatch (see doors.ts
 * `tryInteract` and README's "Interact dispatch" design note). It moves by
 * writing `Velocity` (see `npc.ts`), same as the player, so it goes through
 * the normal `movementSystem`/`collisionSystem` pipeline rather than being
 * hand-moved. `homeX`/`homeZ` anchor its idle wander while `LOITERING` —
 * re-anchored to wherever it actually stopped when it drops out of
 * `FOLLOWING`/`CHASING` (see issue #36's acceptance criteria, extended the
 * same way for a de-aggro'd hostile). `wanderTargetX`/`Z` and `wanderTimer`
 * are `npc.ts`'s own scratch state for that wander.
 *
 * `archetypeId` indexes `NPC_REGISTRY` (`src/assets/npcRegistry.ts`) for
 * this instance's stats/behavior/mesh — the same per-instance-state-here,
 * shared-type-data-in-its-own-registry split `Item.itemTypeId` uses.
 * `attackCooldownRemaining` is an aggressive archetype's own scratch state
 * (seconds until it can land another hit), unused by docile archetypes. */
export const NPC = {
  state: [] as number[], // one of NpcState
  homeX: [] as number[],
  homeZ: [] as number[],
  wanderTargetX: [] as number[],
  wanderTargetZ: [] as number[],
  wanderTimer: [] as number[], // seconds until the next wander re-target
  archetypeId: [] as string[],
  attackCooldownRemaining: [] as number[],
};

/** Hit points. Added ahead of real combat (#16) so the HUD health bar (#23)
 * has something to read; combat should consume this same component rather
 * than inventing its own. `current` may exceed 0..max only transiently
 * (e.g. a debug nudge) — consumers should clamp when displaying. */
export const Health = {
  current: [] as number[],
  max: [] as number[],
};

/** Tag: this entity's `Health.current` has reached 0 (see `tryMeleeAttack`
 * in combat.ts). Systems that treat entities as alive and interactable —
 * `npcSystem`'s wander/follow, `tryInteract`'s interactable list, and
 * `tryMeleeAttack`'s own target list — skip anything already `Dead` so a
 * corpse doesn't keep moving, respond to interact, or get hit again. */
export const Dead: Record<string, never> = {};

/** Sector (see `level.sectorAt` in `level/level.ts`/`occupancy.ts`) an entity
 * died in — issue #59. Set once, in `game.ts`, at the moment an entity
 * transitions to `Dead` (`sectorAt` isn't reachable from `combat.ts`'s
 * `tryMeleeAttack`, which only has `world`/`camera`, not the level). Drives
 * `corpseCleanupSystem` (`ecs/systems/corpseCleanup.ts`): once the player's
 * current sector no longer matches this, the corpse's `Object3DRef` mesh is
 * removed from the scene and this is cleared back to `undefined` — a
 * one-way cleanup, not a presence toggle (the corpse never reappears). */
export const DeathSector = {
  sectorId: [] as (string | undefined)[],
  /** Seconds left before `corpseCleanupSystem` will even consider removing
   * this corpse, regardless of sector — see that module's `MIN_LINGER_SECONDS`
   * doc comment for why a pure sector-mismatch check isn't enough on its
   * own. */
  lingerRemaining: [] as number[],
};

/** A pickup-able item (issue #39) — sword, gem, etc. `itemTypeId` indexes
 * `ITEM_REGISTRY` (`src/assets/itemRegistry.ts`), the auto-discovered
 * registry of item asset data (name/icon/equip slot/mesh factories), the
 * same way `NPC`/`Door` keep their per-instance state in components here
 * while `src/level/tileTypeRegistry.ts` keeps shared *type* data
 * (`TILE_TYPES`) in its own module. An item lying in the
 * world has `Item` + `Position` + `Object3DRef` but no `Carried` — see
 * `Carried` below for what picking it up adds. */
export const Item = {
  itemTypeId: [] as string[],
};

/** Every slot a `Carried` item can occupy: the freeform inventory list, one
 * of the three non-functional paper-doll slots (kept for a complete data
 * model even though they have no gameplay/visual effect yet), or one of the
 * two hand slots (the only slots that currently do anything — see
 * `equipItem`/`Viewmodel` in `ecs/systems/items.ts`). */
export type CarriedSlot = "inventory" | "head" | "torso" | "legs" | "hand-left" | "hand-right";

/** Added to an `Item` entity once it's picked up (the `tryInteract` `Item`
 * branch in doors.ts) — `ownerEid` is who's carrying it (always the player
 * today, but deliberately its own field rather than an assumption, so a
 * future container item that's also `Carried`-*by* something else fits this
 * same shape later without rework) and `slot` is where in that owner's
 * paper-doll/inventory it currently sits. Equipping/unequipping
 * (`ecs/systems/items.ts`) only ever changes `slot` in place — the item
 * entity itself is never destroyed or recreated by moving between slots,
 * mirroring how `Door`/`NPC` are first-class entities rather than fields on
 * the player. */
export const Carried = {
  ownerEid: [] as number[],
  slot: [] as CarriedSlot[],
};

/** Backing three.js Object3D for a `Carried` item's first-person viewmodel
 * (issue #39) — set only while the item sits in a hand slot, parented
 * directly to the camera (`camera.add(...)`, not the scene) at a fixed
 * camera-relative offset, so it rides rigidly with the view like a classic
 * FPS weapon. Deliberately distinct from `Object3DRef`, which for an `Item`
 * entity is always that item's in-world pickup mesh (hidden via
 * `.visible = false` while carried, not repurposed as the viewmodel) — the
 * two meshes live in different parts of the scene graph (world-space vs.
 * camera-local) and the world mesh should still be there, un-reused, if the
 * item is ever droppable later. */
export const Viewmodel: (THREE.Object3D | undefined)[] = [];
