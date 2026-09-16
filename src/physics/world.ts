import type { Collider, KinematicCharacterController, RigidBody, World } from "@dimforge/rapier3d-compat";

// Real 3D physics, via Rapier (Rust, compiled to WASM), replacing the
// original XZ-only AABB collision pass (the old `ecs/systems/collision.ts`,
// deleted with this module's arrival). The old system had no vertical extent
// at all — a wall blocked by its floor-plan footprint alone, `Position.y` was
// set once at spawn and never moved, and a doorway's header had to be built
// as *non-solid* geometry specifically because an XZ-only collider above head
// height would still have sealed the doorway shut (see `addWall`'s doc
// comment in level/tileBuilder.ts). None of those compromises exist here:
// colliders are real boxes, floors are surfaces you actually stand on, and a
// door's collider genuinely swings on its hinge.
//
// Everything here is deliberately kept to two shapes — static cuboids for
// level geometry, capsules for characters — because this dungeon is built
// entirely from axis-aligned boxes, which cuboid colliders represent exactly
// and cheaply. No dynamic (force-simulated) bodies exist yet: the player and
// NPCs are *kinematic* bodies driven by Rapier's `KinematicCharacterController`,
// which is the right primitive for FPS-style movement (raw rigid-body
// dynamics feel floaty and bounce off walls). Adding genuinely dynamic props
// (pushable crates, thrown items) later is a matter of adding a third factory
// here, not reworking this.

/** Physics runs on a fixed timestep — Rapier's solver is only stable with a
 * constant `dt`, unlike the old hand-rolled integration which just took
 * whatever the frame took. `game.ts` accumulates real frame time and steps
 * this many seconds at a time (see its `frame` loop). */
export const PHYSICS_DT = 1 / 60;

/** Deliberately well above real-world 9.81: a realistic fall arc feels
 * mushy and slow in a first-person game at this scale. Only matters for how
 * fast a character settles onto the floor today; becomes load-bearing once
 * stairs/multi-floor traversal lands. */
export const GRAVITY_Y = -24;

/** How much the character controller keeps between a character and the world.
 * Must be non-zero for numerical stability, but small enough not to read as
 * a visible gap (Rapier's own guidance). */
const CHARACTER_SKIN = 0.01;

/** Max height a character steps up without jumping. Sized for the doorway
 * lips and slab seams that exist today; it's also exactly the knob a future
 * stair tile leans on, so stairs become "author the geometry" rather than
 * "write a bespoke traversal system". */
const AUTOSTEP_MAX_HEIGHT = 0.4;
const AUTOSTEP_MIN_WIDTH = 0.2;

/** Keeps a character glued to the floor when walking down a small drop
 * rather than briefly going ballistic off every edge. */
const SNAP_TO_GROUND_DISTANCE = 0.3;

const MAX_SLOPE_CLIMB_DEGREES = 50;

// Collision groups. Rapier packs these into one 32-bit int: the high 16 bits
// are "which groups am I a member of", the low 16 are "which groups do I
// interact with".
//
// Characters deliberately do NOT interact with each other — the pre-Rapier
// collision pass resolved movers against level geometry only, never against
// one another (an NPC and the player could overlap freely), and this
// migration is meant to be behavior-neutral. Making characters solid to each
// other is now a one-line change here rather than a system rewrite, but it's
// a gameplay decision, not a migration one.
const GROUP_LEVEL = 0x0001;
const GROUP_CHARACTER = 0x0002;
const LEVEL_GROUPS = (GROUP_LEVEL << 16) | (GROUP_LEVEL | GROUP_CHARACTER);
export const CHARACTER_GROUPS = (GROUP_CHARACTER << 16) | GROUP_LEVEL;

type RapierModule = typeof import("@dimforge/rapier3d-compat");

let RAPIER: RapierModule | undefined;

/**
 * Loads the Rapier WASM module. Must be awaited before anything else here is
 * called — which is why `main.ts` awaits it before showing the menu, rather
 * than every call site having to care. Idempotent, so the level viewer and
 * the game can each ask for it independently.
 *
 * Deliberately a dynamic `import()`: the `-compat` build inlines its WASM as
 * base64, which is what makes it painless to bundle (no Vite WASM plugin
 * needed) but would otherwise add well over a megabyte to the *initial*
 * download. Importing it here instead lets Vite split it into its own chunk,
 * so the entry bundle stays roughly the size it was before physics existed
 * and the engine loads while the player is still looking at the menu.
 */
export async function initPhysics(): Promise<void> {
  if (RAPIER) return;
  const module = await import("@dimforge/rapier3d-compat");
  await module.init();
  RAPIER = module;
}

/** The loaded Rapier module, or a clear error instead of a confusing
 * `undefined` dereference if something skipped `initPhysics`. */
function rapier(): RapierModule {
  if (!RAPIER) throw new Error("physics: initPhysics() must be awaited before building a physics world");
  return RAPIER;
}

export interface Physics {
  world: World;
  /** One shared controller: it holds no state between calls (each
   * `computeColliderMovement` result is read immediately afterward), so
   * every character can safely borrow the same instance. */
  controller: KinematicCharacterController;
}

export function createPhysics(): Physics {
  const world = new (rapier().World)({ x: 0, y: GRAVITY_Y, z: 0 });
  world.timestep = PHYSICS_DT;

  const controller = world.createCharacterController(CHARACTER_SKIN);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.enableAutostep(AUTOSTEP_MAX_HEIGHT, AUTOSTEP_MIN_WIDTH, true);
  controller.enableSnapToGround(SNAP_TO_GROUND_DISTANCE);
  controller.setMaxSlopeClimbAngle((MAX_SLOPE_CLIMB_DEGREES * Math.PI) / 180);
  controller.setApplyImpulsesToDynamicBodies(false); // nothing dynamic to push yet

  return { world, controller };
}

/**
 * A fixed, immovable box — walls, floors, ceilings, and props. Takes the box's
 * *center* and half-extents, matching how `THREE.BoxGeometry` meshes are
 * already positioned in tileBuilder.ts, so a collider can be created from the
 * exact same numbers as its mesh with no translation gymnastics.
 */
export function addStaticBox(
  physics: Physics,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
): void {
  const R = rapier();
  const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(cx, cy, cz));
  physics.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setCollisionGroups(LEVEL_GROUPS), body);
}

/**
 * A box that moves under explicit control rather than simulation — a door
 * leaf. The body sits at the *hinge* and the collider is offset to where the
 * slab actually is, so rotating the body swings the collider around the hinge
 * exactly like the three.js hinge `Group` it mirrors (see `addDoorLeaf`).
 * That's what lets the old "treat a door as non-solid once it's 90% open"
 * fudge go away: the collider genuinely moves out of the doorway.
 */
export function addKinematicBox(
  physics: Physics,
  hingeX: number,
  hingeY: number,
  hingeZ: number,
  offsetX: number,
  offsetY: number,
  offsetZ: number,
  hx: number,
  hy: number,
  hz: number,
): RigidBody {
  const R = rapier();
  const body = physics.world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(hingeX, hingeY, hingeZ),
  );
  physics.world.createCollider(
    R.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(offsetX, offsetY, offsetZ)
      .setCollisionGroups(LEVEL_GROUPS),
    body,
  );
  return body;
}

export interface CharacterHandles {
  body: RigidBody;
  collider: Collider;
}

/**
 * A character: a capsule on a kinematic body, moved by
 * `ecs/systems/character.ts` via the shared controller. Capsule rather than
 * box so a character slides around corners and doorframes instead of
 * catching on them.
 *
 * `feetY` is the character's *ground* position, matching what `Position`
 * means for every character entity (see `CharacterBody` in
 * `ecs/components.ts`) — this converts to the capsule's center internally so
 * no caller has to think about capsule geometry.
 */
export function addCharacter(
  physics: Physics,
  x: number,
  feetY: number,
  z: number,
  radius: number,
  halfHeight: number,
): CharacterHandles {
  const R = rapier();
  const centerY = feetY + capsuleCenterOffset(radius, halfHeight);
  const body = physics.world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, centerY, z),
  );
  const collider = physics.world.createCollider(
    R.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(CHARACTER_GROUPS),
    body,
  );
  return { body, collider };
}

/** Distance from a character's feet to its capsule's center — the capsule is
 * `halfHeight` of straight cylinder plus a `radius` hemisphere cap on each
 * end, and Rapier positions it from the center. */
export function capsuleCenterOffset(radius: number, halfHeight: number): number {
  return halfHeight + radius;
}
