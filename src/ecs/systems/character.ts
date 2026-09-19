import { query, type World } from "bitecs";
import { CharacterBody, PhysicsBody, PhysicsCollider, Position, Velocity } from "../components";
import { CHARACTER_GROUPS, GRAVITY_Y, capsuleCenterOffset, type Physics } from "../../physics/world";

// Moves every character (the player, every NPC) through Rapier's
// `KinematicCharacterController`, replacing the old `movementSystem` +
// `collisionSystem` pair. Those integrated `Position` directly and then
// shoved it back out of any overlapping wall along whichever XZ axis
// overlapped less; this instead hands Rapier a *desired* movement and takes
// back the movement that actually fits — which is what gets sliding along
// walls, ground contact, and step-ups for free, in three dimensions.
//
// Input is unchanged on purpose: `inputSystem` and `npcSystem` still just
// write a desired horizontal `Velocity`, exactly as before. Only what
// happens to that velocity changed.

/** Downward speed a grounded character keeps, rather than letting gravity
 * accumulate to zero on contact. A little constant push into the floor is
 * what keeps `computedGrounded()` reporting true while walking (and keeps
 * snap-to-ground engaged over small dips) instead of flickering. */
// Snap-to-ground does most of the work. A large downward request is projected
// against an uphill ramp by the character controller and steals horizontal
// speed, so keep this just strong enough to stabilize the grounded flag.
const GROUNDED_STICK_SPEED = -0.5;

/** Fall speed is capped so a long drop can't build up enough speed to
 * tunnel through a floor in a single step. */
const TERMINAL_FALL_SPEED = -40;

export function characterSystem(world: World, physics: Physics, dt: number): void {
  for (const eid of query(world, [CharacterBody, Position, Velocity])) {
    const body = PhysicsBody[eid];
    const collider = PhysicsCollider[eid];
    if (!body || !collider) continue;

    const grounded = CharacterBody.grounded[eid] === 1;
    const fallSpeed = grounded
      ? GROUNDED_STICK_SPEED
      : Math.max(TERMINAL_FALL_SPEED, CharacterBody.verticalVelocity[eid] + GRAVITY_Y * dt);

    physics.controller.computeColliderMovement(
      collider,
      { x: Velocity.x[eid] * dt, y: fallSpeed * dt, z: Velocity.z[eid] * dt },
      undefined,
      CHARACTER_GROUPS,
    );
    const movement = physics.controller.computedMovement();
    const nowGrounded = physics.controller.computedGrounded();

    const current = body.translation();
    body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });

    CharacterBody.grounded[eid] = nowGrounded ? 1 : 0;
    CharacterBody.verticalVelocity[eid] = nowGrounded ? 0 : fallSpeed;
  }
}

/**
 * Copies Rapier's authoritative transforms back into `Position`, converting
 * each capsule's center back down to the feet position `Position` means for
 * a character. Runs right after `world.step()`, because that's the point at
 * which a kinematic body has actually moved to the translation
 * `characterSystem` queued for it.
 *
 * Only characters need this: static geometry never moves, and a door leaf's
 * mesh is driven straight from its own rotation rather than from `Position`
 * (see `doorAnimationSystem`).
 */
export function physicsSyncSystem(world: World): void {
  for (const eid of query(world, [CharacterBody, Position])) {
    const body = PhysicsBody[eid];
    if (!body) continue;
    const t = body.translation();
    Position.x[eid] = t.x;
    Position.y[eid] = t.y - capsuleCenterOffset(CharacterBody.radius[eid], CharacterBody.halfHeight[eid]);
    Position.z[eid] = t.z;
  }
}

/**
 * Hard-teleports a character (the respawn path in game.ts), as opposed to
 * the incremental, collision-resolved movement `characterSystem` does.
 * Writes both the Rapier body and `Position` so nothing reads a stale value
 * in the window before the next physics step, and clears the fall state so
 * the character doesn't arrive still carrying the speed it died with.
 */
export function teleportCharacter(eid: number, x: number, feetY: number, z: number): void {
  const body = PhysicsBody[eid];
  if (body) {
    body.setTranslation(
      { x, y: feetY + capsuleCenterOffset(CharacterBody.radius[eid], CharacterBody.halfHeight[eid]), z },
      true,
    );
  }
  Position.x[eid] = x;
  Position.y[eid] = feetY;
  Position.z[eid] = z;
  CharacterBody.verticalVelocity[eid] = 0;
  CharacterBody.grounded[eid] = 0;
}
