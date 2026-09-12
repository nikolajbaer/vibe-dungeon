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

/** A door: a collider that slides straight up out of the opening (into the
 * space above the ceiling line) when opened. See doorSystem.ts. */
export const Door = {
  state: [] as number[], // one of DoorState
  progress: [] as number[], // 0 (closed) .. 1 (fully open)
  closedY: [] as number[], // Position.y when fully closed
  openY: [] as number[], // Position.y when fully open
};

/** Backing three.js Object3D for entities with a visual representation
 * (AoS-by-reference component — see bitECS docs on component storage).
 * Synced from Position/Rotation each frame by syncSystem. */
export const Object3DRef: (THREE.Object3D | undefined)[] = [];
