import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { hasComponent, type World } from "bitecs";
import { NPC, Velocity } from "../components";
import type { HumanoidRig } from "../../characters/humanoidRig";

const MOVING_EPSILON = 0.05; // m/s — Velocity magnitude above this counts as "walking" (issue #54); NpcState
// alone isn't enough since LOITERING covers both a paused-between-legs NPC and one mid-wander-leg.
const CROSSFADE_DURATION = 0.2; // seconds

/** Which one-shot clip, if any, is currently overriding idle/walk. `hit`
 * clears itself (back to idle/walk) once its clip finishes; `death` never
 * clears — the corpse stays frozen on its final frame forever (issue #59). */
type OneShot = "hit" | "death" | undefined;

interface NpcAnimationState {
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction;
  walkAction: THREE.AnimationAction;
  hitAction: THREE.AnimationAction;
  deathAction: THREE.AnimationAction;
  moving: boolean; // which of idle/walk is currently the "target" state, for edge-detecting a transition
  oneShot: OneShot;
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
  const hitAction = mixer.clipAction(rig.clips.hit);
  const deathAction = mixer.clipAction(rig.clips.death);

  idleAction.play();
  walkAction.play();
  idleAction.setEffectiveWeight(1);
  walkAction.setEffectiveWeight(0);

  // Both one-shots (issue #59): played once, not looped. `hit` fades back
  // out to nothing once it finishes (default `clampWhenFinished = false`) —
  // the `finished` handler below then hands control back to idle/walk.
  // `death` clamps on its last frame instead, so the corpse stays visibly
  // collapsed rather than snapping back to a stand.
  hitAction.setLoop(THREE.LoopOnce, 1);
  deathAction.setLoop(THREE.LoopOnce, 1);
  deathAction.clampWhenFinished = true;

  npcAnimations.set(eid, { mixer, idleAction, walkAction, hitAction, deathAction, moving: false, oneShot: undefined });

  // `hit` is the only one-shot that needs to hand control back afterward —
  // once it finishes, resume idle/walk at whatever `moving` has become in
  // the meantime (it may have changed mid-flinch) rather than crossfading
  // back in, since the interrupt already popped visually.
  mixer.addEventListener("finished", (e) => {
    const state = npcAnimations.get(eid);
    if (!state || e.action !== state.hitAction) return;
    state.oneShot = undefined;
    const target = state.moving ? state.walkAction : state.idleAction;
    const other = state.moving ? state.idleAction : state.walkAction;
    target.enabled = true;
    target.setEffectiveWeight(1);
    other.setEffectiveWeight(0);
  });

  return clone;
}

/**
 * Interrupts whatever's currently playing (idle or walk) with a one-shot
 * "hit" flinch (issue #59) — called from `tryMeleeAttack` (combat.ts) on
 * non-lethal damage, mirroring how that same function already triggers
 * `triggerViewmodelSwing` on the *attacker's* weapon, just for the
 * *defender*'s reaction instead. No-ops for an eid with no registered
 * animation state (e.g. the player, who has no animated mesh here).
 * Restarts from frame 0 if a hit reaction is already mid-flight, same as
 * `triggerViewmodelSwing`'s re-trigger behavior.
 */
export function triggerHitReaction(eid: number): void {
  const state = npcAnimations.get(eid);
  if (!state || state.oneShot === "death") return; // a corpse doesn't flinch
  state.idleAction.setEffectiveWeight(0);
  state.walkAction.setEffectiveWeight(0);
  state.hitAction.enabled = true;
  state.hitAction.setEffectiveWeight(1);
  state.hitAction.reset().play();
  state.oneShot = "hit";
}

/**
 * Plays the one-shot "death" collapse (issue #59), overriding idle/walk (and
 * any hit reaction mid-flight) permanently — `deathAction.clampWhenFinished`
 * (set in `createAnimatedNpcMesh`) freezes it on its final frame once it
 * finishes, and nothing in this module ever hands control back afterward, so
 * the corpse just lies there. Called from `tryMeleeAttack` on a kill, in
 * place of the old immediate `removeFromParent()`. No-ops for an eid with no
 * registered animation state.
 */
export function triggerDeathCollapse(eid: number): void {
  const state = npcAnimations.get(eid);
  if (!state) return;
  state.idleAction.setEffectiveWeight(0);
  state.walkAction.setEffectiveWeight(0);
  state.hitAction.setEffectiveWeight(0);
  state.deathAction.enabled = true;
  state.deathAction.setEffectiveWeight(1);
  state.deathAction.reset().play();
  state.oneShot = "death";
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

    // While a one-shot (hit/death, issue #59) is overriding idle/walk, keep
    // tracking `moving` (so `hit`'s `finished` handler resumes into the
    // right one once it's done) but don't crossfade idle/walk themselves —
    // their weights are pinned at 0 for the duration of the interrupt.
    if (moving !== state.moving) {
      if (!state.oneShot) {
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
      }
      state.moving = moving;
    }

    state.mixer.update(dt);
  }
}

/** Debug/test hook (see `window.__vibeDungeonDebug.getNpcAnimationState` in
 * game.ts): the raw action weights and mixer time for NPC `eid`, so
 * automated tests can confirm the walk/idle crossfade — and, as of issue
 * #59, the hit/death one-shots — actually happened instead of inferring it
 * from position deltas alone. `activeClip` names whichever clip is
 * currently in control: `"hit"`/`"death"` while that one-shot is playing
 * (`oneShot` set), else `"walk"`/`"idle"` per `moving`. Returns `undefined`
 * for an eid with no registered animation state. */
export function getNpcAnimationDebugState(eid: number):
  | {
      moving: boolean;
      idleWeight: number;
      walkWeight: number;
      hitWeight: number;
      deathWeight: number;
      mixerTime: number;
      /** The death action's own clip time (seconds) — unlike `mixerTime`
       * (the mixer's global clock, which always keeps advancing), this is
       * what `clampWhenFinished` actually freezes once the clip ends, so
       * it's the right field to assert "frozen on the final frame" against. */
      deathClipTime: number;
      activeClip: "idle" | "walk" | "hit" | "death";
    }
  | undefined {
  const state = npcAnimations.get(eid);
  if (!state) return undefined;
  return {
    moving: state.moving,
    idleWeight: state.idleAction.getEffectiveWeight(),
    walkWeight: state.walkAction.getEffectiveWeight(),
    hitWeight: state.hitAction.getEffectiveWeight(),
    deathWeight: state.deathAction.getEffectiveWeight(),
    mixerTime: state.mixer.time,
    deathClipTime: state.deathAction.time,
    activeClip: state.oneShot ?? (state.moving ? "walk" : "idle"),
  };
}
