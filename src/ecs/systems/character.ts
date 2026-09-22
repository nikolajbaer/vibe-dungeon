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

/** How long (seconds) a character can request meaningfully more horizontal
 * movement than `computeColliderMovement` actually delivers before this
 * concludes it's genuinely wedged, rather than just a single ordinary
 * glancing contact slowing it for a step or two -- confirmed by hand (a
 * chasing NPC's `Velocity` staying correct and continuous toward its target
 * for several real seconds while `Position` simply never advanced, with
 * `computedCollision(0)` reporting a plain floor contact the whole time)
 * that Rapier's kinematic controller can occasionally get into exactly this
 * state on flat, open, obstacle-free ground -- a real character-controller
 * edge case, not an AI or level-geometry bug (it reproduces with AI removed
 * entirely, `Velocity` driven by a raw debug hook). See `STUCK_NUDGE_METERS`
 * for how this recovers without risking a real wall-blocked chase tunneling
 * through. */
const STUCK_THRESHOLD_SECONDS = 0.2;
/** Below this fraction of the requested horizontal distance counts as
 * "didn't really move" for the stuck check above. */
const STUCK_PROGRESS_FRACTION = 0.2;
/** Size (meters) of the direct, collision-unchecked nudge applied once a
 * character has been stuck for `STUCK_THRESHOLD_SECONDS` against what
 * `isNonsenseFloorBlock` below confirms is *not* a real obstacle --
 * deliberately tiny, well under any real wall's thickness, as a second line
 * of defense on top of that check, not instead of it (confirmed by hand:
 * without the normal check, this exact nudge tunnels a character straight
 * through a real wall in well under 10 seconds of sustained pressure). */
const STUCK_NUDGE_METERS = 0.03;
/** A reported blocking contact whose normal is at least this vertical
 * (dot with the up axis) counts as "floor/ceiling-like" for
 * `isNonsenseFloorBlock` -- comfortably steeper than `MAX_SLOPE_CLIMB_DEGREES`
 * (50°, cos ~0.64) ever produces for a real climbable-or-not floor, so a
 * genuine wall or steep obstacle (whose normal is mostly horizontal) never
 * reads as one. */
const FLOOR_NORMAL_MIN_UP_COMPONENT = 0.9;

/**
 * True when the collision `computeColliderMovement` reports blocking pure
 * horizontal movement makes no physical sense -- its normal points
 * essentially straight up (or there's no reported collision at all) rather
 * than having the horizontal component a real wall or obstacle would need
 * to actually stop sideways sliding. A floor's own up-facing normal can
 * never legitimately block walking *along* it; if `computeColliderMovement`
 * says otherwise, that's this session's confirmed character-controller
 * glitch (see `STUCK_THRESHOLD_SECONDS`'s doc comment), not a real
 * obstruction -- so this is the gate that lets the nudge above fire only
 * for that glitch and never for an actual wall (whose reported normal is
 * mostly horizontal, failing this check, so a wall-blocked chase is simply
 * left alone exactly as it should be).
 */
function isNonsenseFloorBlock(physics: Physics): boolean {
  const n = physics.controller.numComputedCollisions();
  if (n === 0) return true; // blocked with nothing even reported as the cause
  const collision = physics.controller.computedCollision(0);
  return Math.abs(collision?.normal1.y ?? 0) >= FLOOR_NORMAL_MIN_UP_COMPONENT;
}

/** Per-character "am I actually getting anywhere" bookkeeping for the
 * stuck-recovery nudge above, keyed by eid -- not an ECS component since
 * it's pure movement bookkeeping with no gameplay meaning of its own. */
const stuckSeconds = new Map<number, number>();

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

    // Confirmed by hand: re-running computeColliderMovement again this same
    // frame with the *identical* input deterministically reproduces the
    // same near-zero result -- this isn't a one-off flaky glitch a retry
    // could shake loose, it's a stable degenerate state for this exact
    // position, and only actually moving (even a little) escapes it. Hence
    // the position nudge below rather than a same-frame retry.
    const requestedHorizontal = Math.hypot(Velocity.x[eid], Velocity.z[eid]) * dt;
    const gotHorizontal = Math.hypot(movement.x, movement.z);
    const blocked = requestedHorizontal > 1e-4 && gotHorizontal < requestedHorizontal * STUCK_PROGRESS_FRACTION;
    const stuck = blocked ? (stuckSeconds.get(eid) ?? 0) + dt : 0;

    let moveX = movement.x;
    let moveZ = movement.z;
    if (stuck >= STUCK_THRESHOLD_SECONDS && isNonsenseFloorBlock(physics)) {
      const dirLen = Math.hypot(Velocity.x[eid], Velocity.z[eid]) || 1;
      moveX += (Velocity.x[eid] / dirLen) * STUCK_NUDGE_METERS;
      moveZ += (Velocity.z[eid] / dirLen) * STUCK_NUDGE_METERS;
      stuckSeconds.set(eid, 0); // one nudge per episode -- see this constant's own doc comment
    } else {
      stuckSeconds.set(eid, stuck);
    }

    const current = body.translation();
    body.setNextKinematicTranslation({
      x: current.x + moveX,
      y: current.y + movement.y,
      z: current.z + moveZ,
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
