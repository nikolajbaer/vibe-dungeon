import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { hasComponent, type World } from "bitecs";
import { NPC, Velocity } from "../components";

/**
 * Shape of the reusable humanoid rig module issue #53 is building in
 * parallel (`src/characters/humanoidRig.ts` — a procedural humanoid
 * skeleton/mesh with real "idle"/"walk" clips). That module doesn't exist
 * yet, and this file deliberately does NOT create `src/characters/` itself
 * (would collide with #53's in-flight work) — instead this interface is
 * duplicated here and `createStubHumanoidRig` below stands in for it so the
 * animation state machine can be built and tested end to end now. Once #53
 * lands, whoever integrates it should be able to replace the
 * `createStubHumanoidRig()` call in game.ts with a `createHumanoidRig()`
 * import from that module — nothing else here needs to change as long as
 * the shape below still matches.
 */
export interface HumanoidRig {
  mesh: THREE.SkinnedMesh; // or a THREE.Group containing one or more SkinnedMeshes
  skeleton: THREE.Skeleton;
  clips: { idle: THREE.AnimationClip; walk: THREE.AnimationClip };
}

/**
 * A trivial two-bone-skinned-box rig satisfying the `HumanoidRig` shape
 * above — just enough real skinning plus two minimal (but genuine)
 * `AnimationClip`s for `AnimationMixer`/`clipAction`/`crossFadeTo` to have
 * something real to play and blend. Not meant to look like anything; it
 * exists purely so this PR's state-machine/wiring logic can be built and
 * verified without waiting on #53.
 */
export function createStubHumanoidRig(): HumanoidRig {
  const rootBone = new THREE.Bone();
  rootBone.name = "Root";
  const tipBone = new THREE.Bone();
  tipBone.name = "Tip";
  tipBone.position.y = 1;
  rootBone.add(tipBone);
  rootBone.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton([rootBone, tipBone]);

  const geometry = new THREE.BoxGeometry(0.4, 2, 0.4, 1, 4, 1);
  geometry.translate(0, 1, 0); // base at y=0, matching the bones above

  const position = geometry.attributes.position;
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  for (let i = 0; i < position.count; i++) {
    // Everything below the midpoint rides the root bone, everything above
    // rides the tip bone — enough for the box to visibly bend when a clip
    // rotates the tip, which is all a stub needs.
    const boneIndex = position.getY(i) >= 1 ? 1 : 0;
    skinIndices.push(boneIndex, 0, 0, 0);
    skinWeights.push(1, 0, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));

  const material = new THREE.MeshStandardMaterial({ color: 0xdd3355 });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(rootBone);
  mesh.bind(skeleton);

  const upright = new THREE.Quaternion();
  const leanForward = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.08);
  const leanBack = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.35);
  const leanFwdWalk = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35);

  const idle = new THREE.AnimationClip("idle", 2, [
    new THREE.QuaternionKeyframeTrack(
      "Tip.quaternion",
      [0, 1, 2],
      [...upright.toArray(), ...leanForward.toArray(), ...upright.toArray()],
    ),
  ]);

  const walk = new THREE.AnimationClip("walk", 0.6, [
    new THREE.QuaternionKeyframeTrack(
      "Tip.quaternion",
      [0, 0.3, 0.6],
      [...leanBack.toArray(), ...leanFwdWalk.toArray(), ...leanBack.toArray()],
    ),
  ]);

  return { mesh, skeleton, clips: { idle, walk } };
}

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
