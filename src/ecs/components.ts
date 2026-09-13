import * as THREE from "three";

// bitECS components. Following bitECS's recommended structure-of-arrays (SoA)
// style: a component is a plain object of parallel arrays indexed by entity
// id (eid). See https://github.com/NateTheGreatt/bitECS for the pattern.
//
// Kept intentionally small — this is the ECS foundation for the vertical
// slice (player controller + collision + doors), not a general engine.

/** World-space position (meters). y is included for completeness (e.g. a
 * door's vertical slide) even though collision only considers x/z. */
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

/** Axis-aligned bounding box collider in the XZ plane, centered on Position.
 * hx/hz are half-extents (full width = 2*hx, full depth = 2*hz). */
export const Collider = {
  hx: [] as number[],
  hz: [] as number[],
};

/** Tag: this entity's collider always blocks movement (walls). */
export const Solid: Record<string, never> = {};

/** Tag: the single player-controlled entity. */
export const PlayerControlled: Record<string, never> = {};

export const DoorState = {
  CLOSED: 0,
  OPENING: 1,
  OPEN: 2,
} as const;

/** A door leaf: a collider that swings open on a vertical hinge (see
 * doors.ts). `Position`/`Collider` stay fixed at the leaf's closed-position
 * center (used for the static collision AABB, same as a wall) — only the
 * leaf's visual `Object3DRef` (a hinge `THREE.Group`, see tileBuilder.ts)
 * rotates as it opens; `syncSystem` skips position-sync for `Door` entities
 * so it doesn't fight that group's fixed hinge-point position. */
export const Door = {
  state: [] as number[], // one of DoorState
  progress: [] as number[], // 0 (closed) .. 1 (fully open)
  hingeSign: [] as number[], // +1 or -1: which way this leaf swings around its hinge
  pairId: [] as number[], // eid shared by both leaves of one doorway, so opening either opens both
};

/** Backing three.js Object3D for entities with a visual representation
 * (AoS-by-reference component — see bitECS docs on component storage).
 * Synced from Position/Rotation each frame by syncSystem. */
export const Object3DRef: (THREE.Object3D | undefined)[] = [];

export const NpcState = {
  LOITERING: 0,
  FOLLOWING: 1,
} as const;

/** A simple follow/loiter NPC (issue #36) — the first non-door consumer of
 * the generalized interact-raycast dispatch (see doors.ts `tryInteract` and
 * README's "Interact dispatch" design note). It moves by writing `Velocity`
 * (see `npc.ts`), same as the player, so it goes through the normal
 * `movementSystem`/`collisionSystem` pipeline rather than being hand-moved.
 * `homeX`/`homeZ` anchor its idle wander while `LOITERING` — re-anchored to
 * wherever it actually stopped when it drops out of `FOLLOWING`, not its
 * original spawn point (see issue #36's acceptance criteria). `wanderTargetX
 * /Z` and `wanderTimer` are `npc.ts`'s own scratch state for that wander. */
export const NPC = {
  state: [] as number[], // one of NpcState
  homeX: [] as number[],
  homeZ: [] as number[],
  wanderTargetX: [] as number[],
  wanderTargetZ: [] as number[],
  wanderTimer: [] as number[], // seconds until the next wander re-target
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
