import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { hasComponent, type World } from "bitecs";
import { NPC, Velocity } from "../components";
import type { HumanoidRig } from "../../characters/humanoidRig";

const MOVING_EPSILON = 0.05; // m/s — Velocity magnitude above this counts as "walking" (issue #54); NpcState
// alone isn't enough since LOITERING covers both a paused-between-legs NPC and one mid-wander-leg.
const CROSSFADE_DURATION = 0.2; // seconds

interface NpcAnimationState {
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction;
  walkAction: THREE.AnimationAction;
  moving: boolean; // which of the two is currently the "target" state, for edge-detecting a transition
}

/** Per-NPC animation state, keyed by eid — module-local side-table rather
 * than a new ECS component, following the precedent of `activeSwings` in
 * items.ts for non-ECS per-entity animation bookkeeping. */
const npcAnimations = new Map<number, NpcAnimationState>();

/**
 * Clones `rig.mesh` (via `SkeletonUtils.clone`, so a shared rig/skeleton can
 * back multiple independently-posed instances) for NPC entity `eid`, wires
 * up an `AnimationMixer` + looped idle/walk actions against the clone, and
 * returns the clone to use as that NPC's `Object3DRef` — it carries
 * `userData.eid` itself (same convention as every other raycastable mesh:
 * doors' slabs, items, the old placeholder cylinder) so `tryInteract`/
 * `tryMeleeAttack`'s raycasts keep working unchanged against it.
 *
 * Both actions are started immediately (weight 0 for walk, 1 for idle) so
 * that later transitions are pure weight crossfades (`crossFadeTo`) rather
 * than needing to (re)start an action mid-game, which would restart its
 * clip time and pop.
 */
export function createAnimatedNpcMesh(rig: HumanoidRig, eid: number): THREE.Object3D {
  const clone = SkeletonUtils.clone(rig.mesh);
  clone.userData.eid = eid;

  const mixer = new THREE.AnimationMixer(clone);
  const idleAction = mixer.clipAction(rig.clips.idle);
  const walkAction = mixer.clipAction(rig.clips.walk);

  idleAction.play();
  walkAction.play();
  idleAction.setEffectiveWeight(1);
  walkAction.setEffectiveWeight(0);

  npcAnimations.set(eid, { mixer, idleAction, walkAction, moving: false });

  return clone;
}

/**
 * Drives every registered NPC's animation mixer each frame (issue #54):
 * plays "walk" (looped) while `Velocity` magnitude is above
 * `MOVING_EPSILON` — true whenever the NPC is actually translating, whether
 * that's `FOLLOWING` and not yet at stop distance or `LOITERING` mid-wander
 * -leg — and "idle" (looped) otherwise, crossfading between the two over
 * `CROSSFADE_DURATION` so a start/stop doesn't hard-cut. Must run every
 * frame (like `viewmodelSwingSystem`) so `mixer.update` keeps advancing
 * whichever clip(s) are currently faded in, not just on state-change frames.
 */
export function npcAnimationSystem(world: World, dt: number): void {
  for (const [eid, state] of npcAnimations) {
    if (!hasComponent(world, eid, NPC)) {
      // The NPC entity is gone; nothing left to drive (never happens today —
      // NPCs aren't destroyed, only marked Dead — but keeps this table from
      // leaking if that ever changes).
      npcAnimations.delete(eid);
      continue;
    }

    const speed = Math.hypot(Velocity.x[eid], Velocity.z[eid]);
    const moving = speed > MOVING_EPSILON;

    if (moving !== state.moving) {
      const from = state.moving ? state.walkAction : state.idleAction;
      const to = moving ? state.walkAction : state.idleAction;
      // `fadeIn`/`fadeOut`'s weight ramp is a *multiplier* on the action's
      // own `.weight`, not an absolute value (see three.js's
      // AnimationAction._updateWeight) — and a fully-faded-out action gets
      // auto-disabled (`.enabled = false`), which then forces every future
      // weight to 0 regardless of the multiplier. So the action being
      // faded in has to have `.enabled` and `.weight` reset to "fully on"
      // *before* crossFadeTo schedules the ramp, or the ramp multiplies
      // against 0 forever and "walk" never visibly plays. This is the same
      // `setWeight(action, 1)`-before-`crossFadeTo` pattern three.js's own
      // animation-blending examples use.
      to.enabled = true;
      to.setEffectiveWeight(1);
      from.crossFadeTo(to, CROSSFADE_DURATION, false);
      state.moving = moving;
    }

    state.mixer.update(dt);
  }
}

/** Debug/test hook (see `window.__vibeDungeonDebug.getNpcAnimationState` in
 * game.ts): the raw action weights and mixer time for NPC `eid`, so
 * automated tests can confirm the walk/idle crossfade actually happened
 * instead of inferring it from position deltas alone. Returns `undefined`
 * for an eid with no registered animation state. */
export function getNpcAnimationDebugState(eid: number):
  | { moving: boolean; idleWeight: number; walkWeight: number; mixerTime: number }
  | undefined {
  const state = npcAnimations.get(eid);
  if (!state) return undefined;
  return {
    moving: state.moving,
    idleWeight: state.idleAction.getEffectiveWeight(),
    walkWeight: state.walkAction.getEffectiveWeight(),
    mixerTime: state.mixer.time,
  };
}
