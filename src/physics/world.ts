import type { Collider, KinematicCharacterController, RigidBody, World } from "@dimforge/rapier3d-compat";

/** A plain quaternion `{x,y,z,w}` — used instead of importing `THREE.Quaternion`
 * here, since this module deliberately stays framework-free (three.js and
 * bitecs both live above it); callers building one with three.js (see
 * `level/stairBuilder.ts`) just spread its `.x/.y/.z/.w` fields. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

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
// Everything here is deliberately kept to two shapes — cuboids for level
// geometry and props, capsules for characters — because this dungeon is built
// entirely from axis-aligned boxes, which cuboid colliders represent exactly
// and cheaply.
//
// There are three body kinds, and which one a thing gets is a gameplay
// decision rather than a technical one:
//
// - **Fixed** (`addStaticBox`) — walls, floors, ceilings, and any prop that
//   should feel like part of the architecture.
// - **Kinematic** (`addKinematicBox`, `addCharacter`) — moved by explicit
//   code rather than by simulation: door leaves, and the player/NPCs, who
//   run through Rapier's `KinematicCharacterController` because raw rigid-body
//   dynamics feel floaty and bouncy for FPS movement.
// - **Dynamic** (`addDynamicBox`) — genuinely simulated: furniture and loose
//   world items, which fall, stack, tip over, and get shoved around by a
//   character walking into them.

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
 * "write a bespoke traversal system". Exported so `level/stairBuilder.ts`
 * can size real riser geometry with a safety margin under this value rather
 * than hardcoding a second copy of it that could silently drift out of sync
 * with the controller's actual configuration. */
export const AUTOSTEP_MAX_HEIGHT = 0.4;
/** Minimum horizontal tread width autostep needs to engage on a step —
 * exported for the same reason as `AUTOSTEP_MAX_HEIGHT` above. */
export const AUTOSTEP_MIN_WIDTH = 0.2;

/** Keeps a character glued to the floor when walking down a small drop
 * rather than briefly going ballistic off every edge. */
const SNAP_TO_GROUND_DISTANCE = 0.3;

/** Exported (alongside `AUTOSTEP_MAX_HEIGHT`/`AUTOSTEP_MIN_WIDTH` above) so
 * `level/stairBuilder.ts` can size a ramp's angle with a real margin under
 * this instead of a second hardcoded copy. */
export const MAX_SLOPE_CLIMB_DEGREES = 50;

// Collision groups. Rapier packs these into one 32-bit int: the high 16 bits
// are "which groups am I a member of", the low 16 are "which groups do I
// interact with".
//
// Characters deliberately do NOT interact with each other — the pre-Rapier
// collision pass resolved movers against level geometry only, never against
// one another (an NPC and the player could overlap freely), and the migration
// kept that. Making characters solid to each other is a one-line change here
// rather than a system rewrite, but it's a gameplay decision, not a physics
// one. Everything else interacts with everything: props collide with the
// level, with characters (who push them), and with each other (so they
// stack).
const GROUP_LEVEL = 0x0001;
const GROUP_CHARACTER = 0x0002;
const GROUP_PROP = 0x0004;
const LEVEL_GROUPS = (GROUP_LEVEL << 16) | (GROUP_LEVEL | GROUP_CHARACTER | GROUP_PROP);
export const CHARACTER_GROUPS = (GROUP_CHARACTER << 16) | (GROUP_LEVEL | GROUP_PROP);
const PROP_GROUPS = (GROUP_PROP << 16) | (GROUP_LEVEL | GROUP_CHARACTER | GROUP_PROP);

/** What a character "weighs" when it shoves a dynamic body. Not a real mass
 * — the character controller is kinematic and never itself pushed — just the
 * impulse budget it gets to push with, tuned so walking into a chair scoots
 * it convincingly while a loaded table barely shifts. */
const CHARACTER_MASS = 80;

/** Props are damped well past realism: an undamped box shoved across a
 * frictionless-feeling stone floor slides for meters and reads as ice.
 * These bleed off momentum fast enough that a nudged chair travels a
 * believable few centimeters and settles (at which point Rapier sleeps the
 * body, so a room full of furniture costs nothing once it's at rest). */
const PROP_LINEAR_DAMPING = 0.9;
const PROP_ANGULAR_DAMPING = 1.4;
const PROP_FRICTION = 0.8;
const PROP_RESTITUTION = 0; // dungeon furniture does not bounce

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
  // Walking into a chair should move the chair. Without this the controller
  // treats every dynamic body as immovable scenery and the player just stops
  // dead against it.
  controller.setApplyImpulsesToDynamicBodies(true);
  controller.setCharacterMass(CHARACTER_MASS);

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
 * A fixed box at an arbitrary `rotation` — the collider a sloped ramp needs
 * (see `level/stairBuilder.ts`), which a plain axis-aligned `addStaticBox`
 * can't express. Takes a full quaternion rather than a single pitch angle
 * plus an assumed rotation axis specifically because getting a pitch's
 * *sign* right for an arbitrary climb direction (does climbing toward +X or
 * -X need a positive or negative rotation around Z?) is easy to get backwards
 * — `stairBuilder.ts` instead builds the quaternion with three.js's
 * `Quaternion.setFromUnitVectors`, which sidesteps sign bookkeeping entirely
 * by just pointing the box's local climb axis at the real world direction
 * from the ramp's entry to its exit.
 *
 * `hx`/`hy`/`hz` are the box's half-extents *before* rotation is applied —
 * critically, whichever one runs along the climb direction must be half the
 * ramp's *slope length* (`sqrt(run² + rise²) / 2`), **not** half its
 * horizontal run. Passing half the horizontal run here instead — an easy
 * mistake, since horizontal run is the number a level author actually has
 * to hand — under-sizes the rotated box along its own local axis, which
 * projects to an even *shorter* horizontal run once rotated and leaves the
 * ramp's near/far edges floating off the actual floor levels by a wrong
 * amount (confirmed by an actual Playwright walk-up: at a shallow angle the
 * error was small enough to not matter, but at a steeper one it floated the
 * ramp's entrance edge into a small vertical cliff the character couldn't
 * climb at all).
 */
export function addStaticRampBox(
  physics: Physics,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  rotation: Quat,
): void {
  const R = rapier();
  const body = physics.world.createRigidBody(
    R.RigidBodyDesc.fixed().setTranslation(cx, cy, cz).setRotation(rotation),
  );
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

/**
 * The box a mesh occupies, in that mesh's own local space: half-extents plus
 * the center's offset from the mesh origin. Most assets in this repo are
 * built around an origin that isn't their visual center (a prop's origin sits
 * on the floor; the sword's sits at its grip, with most of its length out
 * along +Z), so a collider needs both numbers, not just a size.
 *
 * Measured off the finished mesh rather than authored per asset — see
 * `boxShapeOf` in level/spawning.ts.
 */
export interface BoxShape {
  hx: number;
  hy: number;
  hz: number;
  cx: number;
  cy: number;
  cz: number;
}

/**
 * A genuinely simulated box — furniture and loose world items. Falls under
 * gravity, stacks, tips, and gets shoved by a character walking into it.
 *
 * `x`/`y`/`z` is where the *mesh origin* goes and `yaw` is its heading, so a
 * caller passes exactly the transform it would have given the mesh; the
 * collider is offset within the body by `shape`'s center, which keeps the
 * body's own frame aligned with the mesh's and makes syncing the two back
 * (`ecs/systems/dynamics.ts`) a straight copy of translation and rotation
 * with no per-asset correction.
 *
 * `mass` is set explicitly rather than derived from Rapier's default density,
 * which would make a table-sized box weigh most of a tonne and turn every
 * prop into immovable scenery.
 */
export function addDynamicBox(
  physics: Physics,
  x: number,
  y: number,
  z: number,
  yaw: number,
  shape: BoxShape,
  mass: number,
): RigidBody {
  const R = rapier();
  const body = physics.world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(PROP_LINEAR_DAMPING)
      .setAngularDamping(PROP_ANGULAR_DAMPING)
      // A light item shoved hard can cover more ground in one 1/60s step
      // than a floor slab is thick; CCD sweeps the motion instead of
      // sampling its endpoints, so nothing squirts through the floor. Cheap
      // at this body count.
      .setCcdEnabled(true),
  );
  physics.world.createCollider(
    R.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz)
      .setTranslation(shape.cx, shape.cy, shape.cz)
      .setMass(mass)
      .setFriction(PROP_FRICTION)
      .setRestitution(PROP_RESTITUTION)
      .setCollisionGroups(PROP_GROUPS),
    body,
  );
  return body;
}
