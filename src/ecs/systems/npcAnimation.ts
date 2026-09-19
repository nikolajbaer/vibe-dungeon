import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { hasComponent, type World } from "bitecs";
import { NPC, NpcState, Velocity } from "../components";
import type { HumanoidRig } from "../../characters/humanoidRig";

const MOVING_EPSILON = 0.05; // m/s — Velocity magnitude above this counts as "walking" (issue #54); NpcState
// alone isn't enough since LOITERING covers both a paused-between-legs NPC and one mid-wander-leg.
const CROSSFADE_DURATION = 0.2; // seconds

/** Which one-shot clip, if any, is currently overriding locomotion/guard.
 * `attack` and `hit` hand control back when finished; `death` never clears. */
type OneShot = "draw" | "attack" | "parry" | "hit" | "death" | undefined;

interface NpcAnimationState {
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction;
  walkAction: THREE.AnimationAction;
  combatIdleAction: THREE.AnimationAction;
  drawAction: THREE.AnimationAction;
  attackAction: THREE.AnimationAction;
  parryAction: THREE.AnimationAction;
  hitAction: THREE.AnimationAction;
  deathAction: THREE.AnimationAction;
  moving: boolean; // which of idle/walk is currently the "target" state, for edge-detecting a transition
  guarding: boolean;
  oneShot: OneShot;
  weapon: THREE.Object3D | undefined;
  weaponRevealed: boolean;
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
  const combatIdleAction = mixer.clipAction(rig.clips.combatIdle);
  const drawAction = mixer.clipAction(rig.clips.drawWeapon);
  const attackAction = mixer.clipAction(rig.clips.weaponJab);
  const parryAction = mixer.clipAction(rig.clips.parry);

  idleAction.play();
  walkAction.play();
  combatIdleAction.play();
  idleAction.setEffectiveWeight(1);
  walkAction.setEffectiveWeight(0);
  combatIdleAction.setEffectiveWeight(0);

  // All one-shots play once. `attack`/`hit` hand control back
  // out to nothing once it finishes (default `clampWhenFinished = false`) —
  // the `finished` handler below then hands control back to idle/walk.
  // `death` clamps on its last frame instead, so the corpse stays visibly
  // collapsed rather than snapping back to a stand.
  hitAction.setLoop(THREE.LoopOnce, 1);
  attackAction.setLoop(THREE.LoopOnce, 1);
  drawAction.setLoop(THREE.LoopOnce, 1);
  parryAction.setLoop(THREE.LoopOnce, 1);
  deathAction.setLoop(THREE.LoopOnce, 1);
  deathAction.clampWhenFinished = true;

  const weapon = clone.getObjectByName("shortSword") ?? clone.getObjectByName("dagger") ?? clone.getObjectByName("woodenSword");
  if (weapon) weapon.visible = false;
  npcAnimations.set(eid, { mixer, idleAction, walkAction, combatIdleAction, drawAction, attackAction, parryAction, hitAction, deathAction, moving: false, guarding: false, oneShot: undefined, weapon, weaponRevealed: false });

  // Once an attack or hit finishes, resume locomotion/guard at whatever
  // `moving` and `guarding` have become in
  // the meantime (it may have changed mid-flinch) rather than crossfading
  // back in, since the interrupt already popped visually.
  mixer.addEventListener("finished", (e) => {
    const state = npcAnimations.get(eid);
    if (!state || !state.oneShot || state.oneShot === "death") return;
    if (e.action !== state.drawAction && e.action !== state.hitAction && e.action !== state.attackAction && e.action !== state.parryAction) return;
    state.oneShot = undefined;
    const target = state.moving ? state.walkAction : state.guarding ? state.combatIdleAction : state.idleAction;
    const others = [state.idleAction, state.walkAction, state.combatIdleAction].filter(action => action !== target);
    target.stopFading();
    target.enabled = true;
    target.setEffectiveWeight(1);
    for (const other of others) { other.stopFading(); other.setEffectiveWeight(0); }
  });

  return clone;
}

/** Draws a one-handed weapon from the opposite hip before combat begins. */
export function triggerWeaponDraw(eid: number): boolean {
  const state = npcAnimations.get(eid);
  if (!state || !state.weapon) return true; // unarmed fighters need no prop draw
  if (state.weaponRevealed || state.oneShot === "draw") return true;
  if (state.oneShot) return false;
  for (const action of [state.idleAction, state.walkAction, state.combatIdleAction]) {
    action.stopFading(); action.setEffectiveWeight(0);
  }
  state.drawAction.enabled = true;
  state.drawAction.setEffectiveWeight(1);
  state.drawAction.reset().play();
  state.oneShot = "draw";
  return true;
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
  state.idleAction.stopFading();
  state.walkAction.stopFading();
  state.combatIdleAction.stopFading();
  state.drawAction.stop();
  state.attackAction.stop();
  state.parryAction.stop();
  state.idleAction.setEffectiveWeight(0);
  state.walkAction.setEffectiveWeight(0);
  state.combatIdleAction.setEffectiveWeight(0);
  state.drawAction.setEffectiveWeight(0);
  state.attackAction.setEffectiveWeight(0);
  state.parryAction.setEffectiveWeight(0);
  state.hitAction.enabled = true;
  state.hitAction.setEffectiveWeight(1);
  state.hitAction.reset().play();
  state.oneShot = "hit";
}

/** Plays the short defensive weapon deflection for a successful NPC parry. */
export function triggerParry(eid: number): void {
  const state = npcAnimations.get(eid);
  if (!state || state.oneShot === "death") return;
  for (const action of [state.idleAction, state.walkAction, state.combatIdleAction, state.drawAction, state.attackAction, state.hitAction]) {
    action.stopFading();
    action.stop();
    action.setEffectiveWeight(0);
  }
  state.parryAction.enabled = true;
  state.parryAction.setEffectiveWeight(1);
  state.parryAction.reset().play();
  state.oneShot = "parry";
}

/** Plays the humanoid's right-handed lunge for an NPC melee strike. */
export function triggerAttack(eid: number): void {
  const state = npcAnimations.get(eid);
  if (!state || state.oneShot) return;
  for (const action of [state.idleAction, state.walkAction, state.combatIdleAction]) {
    action.stopFading();
    action.setEffectiveWeight(0);
  }
  state.attackAction.enabled = true;
  state.attackAction.setEffectiveWeight(1);
  state.attackAction.reset().play();
  state.oneShot = "attack";
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
  if (!state || state.oneShot === "death") return;
  state.idleAction.stopFading();
  state.walkAction.stopFading();
  state.combatIdleAction.stopFading();
  state.hitAction.stop();
  state.drawAction.stop();
  state.attackAction.stop();
  state.parryAction.stop();
  state.idleAction.setEffectiveWeight(0);
  state.walkAction.setEffectiveWeight(0);
  state.combatIdleAction.setEffectiveWeight(0);
  state.hitAction.setEffectiveWeight(0);
  state.drawAction.setEffectiveWeight(0);
  state.attackAction.setEffectiveWeight(0);
  state.parryAction.setEffectiveWeight(0);
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
 *
 * `paused` is game.ts's dialogue/death-overlay modal flag: ambient idle/walk
 * freezes along with the rest of the sim while it's true (`npcSystem`/
 * `movementSystem` are skipped too, so a walking NPC's `Position` genuinely
 * stops — letting its walk-cycle mixer keep advancing here would desync legs
 * still cycling from feet no longer actually moving). A `hit`/`death`
 * one-shot already in flight is the one exception: it always keeps playing
 * to completion regardless of `paused`, since it's a purely cosmetic
 * override with no further gameplay effect — freezing a death collapse
 * mid-fall (e.g. the killing blow and the player's own death/respawn
 * landing in the same instant) used to leave a corpse stuck in an
 * unfinished, not-lying-flat pose once the pause outlived the clip.
 */
export function npcAnimationSystem(world: World, dt: number, paused: boolean): void {
  for (const [eid, state] of npcAnimations) {
    if (!hasComponent(world, eid, NPC)) {
      // The NPC entity is gone; nothing left to drive (never happens today —
      // NPCs aren't destroyed, only marked Dead — but keeps this table from
      // leaking if that ever changes).
      npcAnimations.delete(eid);
      continue;
    }

    if (paused && !state.oneShot) continue; // ambient idle/walk freezes with the rest of the sim

    const speed = Math.hypot(Velocity.x[eid], Velocity.z[eid]);
    const moving = speed > MOVING_EPSILON;
    const guarding = !moving && NPC.state[eid] === NpcState.ATTACKING;

    if (state.oneShot === "draw" && state.weapon && !state.weaponRevealed && state.drawAction.time >= .2) {
      state.weapon.visible = true;
      state.weaponRevealed = true;
    }

    // While a one-shot is overriding the base pose, keep tracking movement
    // and guard state so its finished handler resumes into the right action,
    // but don't crossfade those base actions themselves —
    // their weights are pinned at 0 for the duration of the interrupt.
    if (moving !== state.moving || guarding !== state.guarding) {
      if (!state.oneShot) {
        const from = state.moving ? state.walkAction : state.guarding ? state.combatIdleAction : state.idleAction;
        const to = moving ? state.walkAction : guarding ? state.combatIdleAction : state.idleAction;
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
      state.guarding = guarding;
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
      attackWeight: number;
      parryWeight: number;
      deathWeight: number;
      weaponVisible: boolean;
      mixerTime: number;
      /** The death action's own clip time (seconds) — unlike `mixerTime`
       * (the mixer's global clock, which always keeps advancing), this is
       * what `clampWhenFinished` actually freezes once the clip ends, so
       * it's the right field to assert "frozen on the final frame" against. */
      deathClipTime: number;
      activeClip: "idle" | "walk" | "combatIdle" | "draw" | "attack" | "parry" | "hit" | "death";
    }
  | undefined {
  const state = npcAnimations.get(eid);
  if (!state) return undefined;
  return {
    moving: state.moving,
    idleWeight: state.idleAction.getEffectiveWeight(),
    walkWeight: state.walkAction.getEffectiveWeight(),
    hitWeight: state.hitAction.getEffectiveWeight(),
    attackWeight: state.attackAction.getEffectiveWeight(),
    parryWeight: state.parryAction.getEffectiveWeight(),
    deathWeight: state.deathAction.getEffectiveWeight(),
    weaponVisible: state.weapon?.visible ?? false,
    mixerTime: state.mixer.time,
    deathClipTime: state.deathAction.time,
    activeClip: state.oneShot ?? (state.moving ? "walk" : state.guarding ? "combatIdle" : "idle"),
  };
}
