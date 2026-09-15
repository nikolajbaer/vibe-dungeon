import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Procedurally-built bipedal humanoid rig (issue #53) — a hand-authored bone
// skeleton, a single rigid-skinned THREE.SkinnedMesh (box-per-segment, one
// bone weight per vertex, no smooth blending — same "placeholder-grade but
// readable" visual bar as src/assets/furniture/'s props), and four
// hand-keyframed THREE.AnimationClips ("idle", "walk" from issue #53; "hit",
// "death" from issue #58). No external DCC tool, no imported mesh files —
// every vertex and every keyframe here is authored directly in code,
// matching how the rest of this project's art (furniture props, procedural
// stone/wood textures) is built.
//
// This module is intentionally standalone: it is not wired into game.ts or
// npc.ts (see issue #53's "out of scope" — that's a companion PR). Consumers
// call `createHumanoidRig()` once to get a shared bind pose + clip set, then
// `SkeletonUtils.clone(rig.mesh)` per character instance so multiple
// characters reuse one skeleton/skin/clip authoring pass instead of
// rebuilding it per instance (verified in
// src/characters/humanoidRig.cloneTest.ts — see that file's header comment
// for what was actually checked).

/** Overall rig proportions (meters) — loosely matched to game.ts's
 * `NPC_HEIGHT = 1.75` placeholder-cylinder height so a future swap-in reads
 * as "the same size character", though this module has no dependency on
 * that constant (kept standalone per the issue). */
const HIP_JOINT_Y = 0.9; // top of the legs; feet sit at y=0 in the bind pose
const HIPS_Y = 0.95; // pelvis bone (root) — slightly above the hip joints
const SPINE_Y = 1.1;
const CHEST_Y = 1.3;
const HEAD_BASE_Y = 1.45; // neck / base of head bone
const HEAD_TOP_Y = 1.72;

const UPPER_LEG_LEN = 0.45; // hip->knee
const LOWER_LEG_LEN = 0.45; // knee->ankle (upperLeg + lowerLeg == HIP_JOINT_Y - FOOT_Y)
const HIP_WIDTH = 0.1; // half-width: leg bones offset ±this from hips on X
const SHOULDER_WIDTH = 0.2; // half-width: shoulder bones offset ±this from hips on X
const UPPER_ARM_LEN = 0.28; // shoulder->elbow
const FOREARM_LEN = 0.25; // elbow->wrist
const HAND_LEN = 0.14; // wrist->fingertip (no separate fingers, issue says none needed)

/** One entry per bone in the skeleton, in the order `skeleton.bones` is
 * built — every bone after the root names its parent by index into this
 * same array, so the whole tree is declared as a flat, readable list rather
 * than nested object literals. Matches issue #53's hierarchy: hips → spine →
 * chest → head; hips → shoulder → upperArm → forearm → hand (×2 sides);
 * hips → upperLeg → lowerLeg → foot (×2 sides). */
interface BoneSpec {
  name: string;
  parent: number | null; // index into this array, or null for the root
  /** Bind-pose position, as an offset from the parent bone's position
   * (local space) — i.e. exactly what `THREE.Bone.position` expects. */
  offset: THREE.Vector3;
}

const BONE_SPECS: BoneSpec[] = [
  { name: "hips", parent: null, offset: new THREE.Vector3(0, HIPS_Y, 0) },
  { name: "spine", parent: 0, offset: new THREE.Vector3(0, SPINE_Y - HIPS_Y, 0) },
  { name: "chest", parent: 1, offset: new THREE.Vector3(0, CHEST_Y - SPINE_Y, 0) },
  { name: "head", parent: 2, offset: new THREE.Vector3(0, HEAD_BASE_Y - CHEST_Y, 0) },

  // Left arm (+X). Shoulder is a direct child of hips per the issue's
  // hierarchy, but its bind-pose offset jumps straight to chest height, so
  // the arm still reads from the right place visually.
  { name: "shoulder.L", parent: 0, offset: new THREE.Vector3(SHOULDER_WIDTH, CHEST_Y - HIPS_Y, 0) },
  { name: "upperArm.L", parent: 4, offset: new THREE.Vector3(0, -UPPER_ARM_LEN, 0) },
  { name: "forearm.L", parent: 5, offset: new THREE.Vector3(0, -FOREARM_LEN, 0) },
  { name: "hand.L", parent: 6, offset: new THREE.Vector3(0, -HAND_LEN, 0) },

  // Right arm (-X), mirrored.
  { name: "shoulder.R", parent: 0, offset: new THREE.Vector3(-SHOULDER_WIDTH, CHEST_Y - HIPS_Y, 0) },
  { name: "upperArm.R", parent: 8, offset: new THREE.Vector3(0, -UPPER_ARM_LEN, 0) },
  { name: "forearm.R", parent: 9, offset: new THREE.Vector3(0, -FOREARM_LEN, 0) },
  { name: "hand.R", parent: 10, offset: new THREE.Vector3(0, -HAND_LEN, 0) },

  // Left leg (+X).
  { name: "upperLeg.L", parent: 0, offset: new THREE.Vector3(HIP_WIDTH, HIP_JOINT_Y - HIPS_Y, 0) },
  { name: "lowerLeg.L", parent: 12, offset: new THREE.Vector3(0, -UPPER_LEG_LEN, 0) },
  { name: "foot.L", parent: 13, offset: new THREE.Vector3(0, -LOWER_LEG_LEN, 0) },

  // Right leg (-X), mirrored.
  { name: "upperLeg.R", parent: 0, offset: new THREE.Vector3(-HIP_WIDTH, HIP_JOINT_Y - HIPS_Y, 0) },
  { name: "lowerLeg.R", parent: 15, offset: new THREE.Vector3(0, -UPPER_LEG_LEN, 0) },
  { name: "foot.R", parent: 16, offset: new THREE.Vector3(0, -LOWER_LEG_LEN, 0) },
];

/** Index lookup by name, used both when building geometry (below) and when
 * authoring keyframe tracks (further down) — keeps every other part of this
 * file referring to bones by their readable name instead of raw indices. */
function boneIndex(name: string): number {
  const i = BONE_SPECS.findIndex((b) => b.name === name);
  if (i < 0) throw new Error(`humanoidRig: unknown bone "${name}"`);
  return i;
}

function buildSkeleton(): { bones: THREE.Bone[]; skeleton: THREE.Skeleton } {
  const bones = BONE_SPECS.map((spec) => {
    const bone = new THREE.Bone();
    bone.name = spec.name;
    bone.position.copy(spec.offset);
    return bone;
  });
  BONE_SPECS.forEach((spec, i) => {
    if (spec.parent !== null) bones[spec.parent].add(bones[i]);
  });
  bones[0].updateMatrixWorld(true); // so getWorldPosition below is correct
  return { bones, skeleton: new THREE.Skeleton(bones) };
}

let skinMat: THREE.MeshStandardMaterial | undefined;

/** Shared flat placeholder "skin" material, cached the same way
 * `woodMaterial()` is in src/assets/furniture/table.ts. */
function skinMaterial(): THREE.MeshStandardMaterial {
  return (skinMat ??= new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8, metalness: 0 }));
}

/**
 * A single rigid-skinned box: every vertex gets skin index `[boneIdx,0,0,0]`
 * and weight `[1,0,0,0]` (full, unblended weight to one bone) — no smooth
 * skinning needed for placeholder-grade box limbs, joints just pivot
 * cleanly at the box edge like the segments of a wooden mannequin.
 *
 * `center` is the box's center in bind-pose world space (the skeleton's
 * rest pose is built in world space directly, so this can be computed from
 * the two bone endpoints a segment spans without any extra transform).
 */
function skinnedBox(
  size: [number, number, number],
  center: THREE.Vector3,
  boneIdx: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(...size);
  geo.translate(center.x, center.y, center.z);

  const count = geo.attributes.position.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    skinIndices[v * 4] = boneIdx;
    skinWeights[v * 4] = 1;
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  return geo;
}

/** World-space bind position of a named bone, read off the already
 * `updateMatrixWorld`'d bone tree. */
function worldPos(bones: THREE.Bone[], name: string): THREE.Vector3 {
  const p = new THREE.Vector3();
  bones[boneIndex(name)].getWorldPosition(p);
  return p;
}

/**
 * Builds the one skinned mesh: a box "segment" between each parent bone and
 * its child (skinned to the parent, so rotating the parent swings that
 * whole segment — the standard convention), plus small terminal caps for
 * the head, hands and feet since those bones have no child to span to.
 */
function buildMeshGeometry(bones: THREE.Bone[]): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  const mid = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().add(b).multiplyScalar(0.5);

  const hips = worldPos(bones, "hips");
  const spine = worldPos(bones, "spine");
  const chest = worldPos(bones, "chest");
  const head = worldPos(bones, "head");

  // Torso, built from the ground up: pelvis (hips), waist (spine), chest.
  geometries.push(skinnedBox([0.32, 0.22, 0.2], mid(hips, spine).add(new THREE.Vector3(0, -0.02, 0)), boneIndex("hips")));
  geometries.push(skinnedBox([0.3, 0.22, 0.18], mid(spine, chest), boneIndex("spine")));
  geometries.push(skinnedBox([0.38, 0.28, 0.2], chest.clone().add(new THREE.Vector3(0, 0.06, 0)), boneIndex("chest")));

  // Head: a cap sitting above the head bone, skinned to the head bone itself.
  const headCenter = new THREE.Vector3(head.x, (HEAD_BASE_Y + HEAD_TOP_Y) / 2, head.z);
  geometries.push(skinnedBox([0.22, HEAD_TOP_Y - HEAD_BASE_Y, 0.22], headCenter, boneIndex("head")));

  for (const side of ["L", "R"] as const) {
    const shoulder = worldPos(bones, `shoulder.${side}`);
    const elbow = worldPos(bones, `upperArm.${side}`);
    const wrist = worldPos(bones, `forearm.${side}`);
    const fingertip = worldPos(bones, `hand.${side}`);

    geometries.push(skinnedBox([0.11, UPPER_ARM_LEN, 0.11], mid(shoulder, elbow), boneIndex(`shoulder.${side}`)));
    geometries.push(skinnedBox([0.09, FOREARM_LEN, 0.09], mid(elbow, wrist), boneIndex(`upperArm.${side}`)));
    geometries.push(skinnedBox([0.08, HAND_LEN, 0.05], mid(wrist, fingertip), boneIndex(`forearm.${side}`)));

    const hip = worldPos(bones, `upperLeg.${side}`);
    const knee = worldPos(bones, `lowerLeg.${side}`);
    const ankle = worldPos(bones, `foot.${side}`);

    geometries.push(skinnedBox([0.15, UPPER_LEG_LEN, 0.15], mid(hip, knee), boneIndex(`upperLeg.${side}`)));
    geometries.push(skinnedBox([0.13, LOWER_LEG_LEN, 0.13], mid(knee, ankle), boneIndex(`lowerLeg.${side}`)));
    // Foot: a flat box offset forward (+Z) and down from the ankle so it
    // reads as a foot resting on the ground rather than a cube floating at
    // ankle height.
    const footCenter = ankle.clone().add(new THREE.Vector3(0, -0.03, 0.09));
    geometries.push(skinnedBox([0.11, 0.08, 0.26], footCenter, boneIndex(`foot.${side}`)));
  }

  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error("humanoidRig: failed to merge segment geometries");
  merged.computeVertexNormals();
  return merged;
}

export interface HumanoidRig {
  /** A THREE.SkinnedMesh (per the issue's interface, a single mesh here —
   * no need for a Group of multiple SkinnedMeshes with one rigid-skinned
   * box mesh covering the whole body). */
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  clips: {
    idle: THREE.AnimationClip;
    walk: THREE.AnimationClip;
    hit: THREE.AnimationClip;
    death: THREE.AnimationClip;
  };
}

/** Builds a `THREE.QuaternionKeyframeTrack` for one bone across evenly
 * spaced keyframe times, rotating around a single local axis at each time
 * by the given angle (radians) — every idle/walk rotation in this rig is a
 * simple single-axis swing, so this covers all of them without repeating
 * axis-angle-to-quaternion boilerplate per bone. */
function rotationTrack(
  boneName: string,
  times: number[],
  axis: THREE.Vector3,
  anglesRad: number[],
): THREE.QuaternionKeyframeTrack {
  if (times.length !== anglesRad.length) {
    throw new Error(`humanoidRig: rotationTrack length mismatch for ${boneName}`);
  }
  const values: number[] = [];
  const q = new THREE.Quaternion();
  for (const angle of anglesRad) {
    q.setFromAxisAngle(axis, angle);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values);
}

/**
 * Builds a `THREE.QuaternionKeyframeTrack` for one bone that rotates around
 * more than one local axis at once (e.g. a shoulder both swinging forward
 * and splaying outward). Two separate `rotationTrack` calls for the same
 * bone do NOT compose — `AnimationMixer` binds one `PropertyMixer` per
 * property path, and a clip with two tracks both targeting
 * `${boneName}.quaternion` has the second silently clobber the first each
 * frame rather than combining them (confirmed empirically, not assumed —
 * see the death clip's original single-axis-per-track version, which
 * quietly dropped half of every multi-axis rotation). This composes the
 * axes into one quaternion per keyframe instead, in the given order
 * (`axes[0]` applied first, i.e. innermost).
 */
function combinedRotationTrack(
  boneName: string,
  times: number[],
  axes: { axis: THREE.Vector3; anglesRad: number[] }[],
): THREE.QuaternionKeyframeTrack {
  for (const { anglesRad } of axes) {
    if (times.length !== anglesRad.length) {
      throw new Error(`humanoidRig: combinedRotationTrack length mismatch for ${boneName}`);
    }
  }
  const values: number[] = [];
  const q = new THREE.Quaternion();
  const part = new THREE.Quaternion();
  for (let i = 0; i < times.length; i++) {
    q.identity();
    for (const { axis, anglesRad } of axes) {
      part.setFromAxisAngle(axis, anglesRad[i]);
      q.multiply(part);
    }
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values);
}

/** Builds a `THREE.VectorKeyframeTrack` for one bone's position, offset
 * from its bind-pose position by `deltas[i]` (meters) at `times[i]`. Used
 * for the small vertical hips bob in both clips. */
function positionTrack(
  boneName: string,
  bindPos: THREE.Vector3,
  times: number[],
  deltasY: number[],
): THREE.VectorKeyframeTrack {
  const values: number[] = [];
  for (const dy of deltasY) {
    values.push(bindPos.x, bindPos.y + dy, bindPos.z);
  }
  return new THREE.VectorKeyframeTrack(`${boneName}.position`, times, values);
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const deg = (d: number) => (d * Math.PI) / 180;

/**
 * "Standing around": a slow, seamless-looping breathing/weight-shift sway —
 * a small hips sway on X, a subtle chest counter-rotation, and a faint arm
 * swing, all easing back to the exact bind pose at t=0 and t=duration so
 * the clip loops without a pop.
 */
function buildIdleClip(bones: THREE.Bone[]): THREE.AnimationClip {
  const duration = 3.2;
  const times = [0, duration * 0.5, duration];

  const tracks: THREE.KeyframeTrack[] = [
    rotationTrack("hips", times, Z_AXIS, [deg(0), deg(1.5), deg(0)]),
    rotationTrack("chest", times, Z_AXIS, [deg(0), deg(-2), deg(0)]),
    rotationTrack("head", times, X_AXIS, [deg(0), deg(1.5), deg(0)]),
    rotationTrack("shoulder.L", times, X_AXIS, [deg(0), deg(3), deg(0)]),
    rotationTrack("shoulder.R", times, X_AXIS, [deg(0), deg(-3), deg(0)]),
    positionTrack("hips", bones[boneIndex("hips")].position, times, [0, 0.015, 0]),
  ];

  return new THREE.AnimationClip("idle", duration, tracks);
}

/**
 * A walk cycle: opposite-phase leg swings (thigh forward/back, knee bends
 * only on the back-swing half like a real gait), opposite-phase arm swings,
 * and a small double-bump hips vertical bob (two bounces per full stride,
 * one per footfall) — all four keyframe times land exactly on bind pose at
 * both ends of the loop.
 */
function buildWalkClip(bones: THREE.Bone[]): THREE.AnimationClip {
  const duration = 1.0; // one full stride cycle (both legs), seconds
  const t = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration];

  const THIGH_SWING = deg(28);
  const KNEE_BEND = deg(40);
  const ARM_SWING = deg(24);
  const FOOT_TILT = deg(12);

  // Left leg leads (forward at t=0), right leg is exactly half a cycle out
  // of phase — sin-shaped forward/back swing for the thigh, and a knee bend
  // that only kicks in while that leg is the one swinging through (its
  // "back" half of the cycle) so the foot clears the ground.
  const thighL = [THIGH_SWING, 0, -THIGH_SWING, 0, THIGH_SWING];
  const thighR = [-THIGH_SWING, 0, THIGH_SWING, 0, -THIGH_SWING];
  const kneeL = [0, KNEE_BEND, 0, 0, 0];
  const kneeR = [0, 0, 0, KNEE_BEND, 0];
  const footL = [-FOOT_TILT, FOOT_TILT * 0.5, FOOT_TILT, 0, -FOOT_TILT];
  const footR = [FOOT_TILT, 0, -FOOT_TILT, FOOT_TILT * 0.5, FOOT_TILT];

  // Arms swing opposite their same-side leg (natural counter-swing gait).
  const armL = thighR.map((v) => v * (ARM_SWING / THIGH_SWING));
  const armR = thighL.map((v) => v * (ARM_SWING / THIGH_SWING));

  const hipsBob = [0, -0.03, 0, -0.03, 0]; // dips slightly at each mid-stride

  const tracks: THREE.KeyframeTrack[] = [
    rotationTrack("upperLeg.L", t, X_AXIS, thighL),
    rotationTrack("upperLeg.R", t, X_AXIS, thighR),
    rotationTrack("lowerLeg.L", t, X_AXIS, kneeL),
    rotationTrack("lowerLeg.R", t, X_AXIS, kneeR),
    rotationTrack("foot.L", t, X_AXIS, footL),
    rotationTrack("foot.R", t, X_AXIS, footR),
    rotationTrack("shoulder.L", t, X_AXIS, armL),
    rotationTrack("shoulder.R", t, X_AXIS, armR),
    rotationTrack("hips", t, Z_AXIS, [deg(2), deg(-2), deg(2), deg(-2), deg(2)]),
    positionTrack("hips", bones[boneIndex("hips")].position, t, hipsBob),
  ];

  return new THREE.AnimationClip("walk", duration, tracks);
}

/**
 * A short, sharp hit reaction (issue #58): head and chest snap backward,
 * shoulders/elbows flinch inward, and the hips take a small backward
 * stagger step — all reaching a hard peak quickly (t=0.1s of a 0.4s clip)
 * then easing partway back. Unlike idle/walk this does *not* return to bind
 * pose at its end: per the issue, a consumer plays this once
 * (`THREE.LoopOnce`) as an interrupt and decides how to blend back to
 * idle/walk on its own, so the clip only needs to sell the recoil itself.
 */
function buildHitClip(): THREE.AnimationClip {
  const duration = 0.4;
  const t = [0, 0.1, duration];

  const tracks: THREE.KeyframeTrack[] = [
    // Head snaps back hardest and fastest (whiplash), chest follows with a
    // smaller snap, hips take a slight backward stagger.
    rotationTrack("head", t, X_AXIS, [deg(0), deg(-32), deg(-9)]),
    rotationTrack("chest", t, X_AXIS, [deg(0), deg(-18), deg(-5)]),
    rotationTrack("hips", t, X_AXIS, [deg(0), deg(-7), deg(-2)]),
    // Arms flinch inward/up defensively: shoulders pull back, elbows bend.
    rotationTrack("shoulder.L", t, X_AXIS, [deg(0), deg(-22), deg(-6)]),
    rotationTrack("shoulder.R", t, X_AXIS, [deg(0), deg(-22), deg(-6)]),
    rotationTrack("forearm.L", t, X_AXIS, [deg(0), deg(38), deg(12)]),
    rotationTrack("forearm.R", t, X_AXIS, [deg(0), deg(38), deg(12)]),
  ];

  return new THREE.AnimationClip("hit", duration, tracks);
}

/**
 * A collapse to the ground (issue #58): the hips (skeleton root) pitch
 * backward ~90° about the X axis while dropping in height, so the whole
 * body swings from standing to lying-on-its-back over the clip — legs end
 * up extended roughly where the character stood (world +Z) and the
 * torso/head extend behind (world -Z), both settling near ground level.
 * Knees buckle first (a brief bend as balance is lost) then relax out
 * straight-ish for the sprawl; elbows bend and shoulders splay outward
 * (rotated about their local Z axis, which at bind pose = world Z, i.e.
 * sideways abduction) so the final frame doesn't read as a stiff plank.
 *
 * The LAST keyframe is what a consumer freezes on forever
 * (`clampWhenFinished = true`) as the corpse pose, so it gets the most
 * deliberate shaping of any pose in this file: hips pitched a full -90°
 * and dropped to just above ground height, knees loosely bent, arms
 * splayed and slightly bent, head lolled to one side.
 */
function buildDeathClip(bones: THREE.Bone[]): THREE.AnimationClip {
  const duration = 1.3;
  const t = [0, 0.3, 0.65, 1.0, duration];

  // Hips: the falling pitch (X axis) plus the vertical drop that keeps the
  // pivot (and everything hanging off it) from floating at standing height
  // once it's rotated flat. HIPS_Y (bind height) - hipsDy[last] lands the
  // pelvis just above y=0, matching the ~half-thickness of a torso box
  // lying on its side (see buildMeshGeometry's box sizes).
  const hipsFallDeg = [deg(0), deg(-14), deg(-48), deg(-80), deg(-90)];
  const hipsDy = [0, -0.03, -0.32, -0.68, -0.87];

  const tracks: THREE.KeyframeTrack[] = [
    rotationTrack("hips", t, X_AXIS, hipsFallDeg),
    positionTrack("hips", bones[boneIndex("hips")].position, t, hipsDy),

    // Knees buckle as balance goes, then loosen into a relaxed sprawl bend
    // rather than snapping back straight.
    rotationTrack("lowerLeg.L", t, X_AXIS, [deg(0), deg(22), deg(16), deg(14), deg(18)]),
    rotationTrack("lowerLeg.R", t, X_AXIS, [deg(0), deg(14), deg(20), deg(16), deg(20)]),
    // Feet relax off their bind flex once they leave the ground. Kept small
    // — the foot box's bind-pose forward offset means a bigger swing here
    // visibly untethers it from the shin once compounded with the knee bend
    // and the root's fall rotation.
    rotationTrack("foot.L", t, X_AXIS, [deg(0), deg(0), deg(-4), deg(-6), deg(-6)]),
    rotationTrack("foot.R", t, X_AXIS, [deg(0), deg(0), deg(-3), deg(-5), deg(-5)]),

    // Torso arches slightly independent of the rigid hips pitch, and the
    // head lolls to one side (Z axis) as well as trailing the fall (X axis)
    // — a limp neck rather than staying perfectly rigid with the spine.
    rotationTrack("spine", t, X_AXIS, [deg(0), deg(2), deg(6), deg(8), deg(8)]),
    rotationTrack("chest", t, X_AXIS, [deg(0), deg(4), deg(10), deg(12), deg(12)]),
    combinedRotationTrack("head", t, [
      { axis: X_AXIS, anglesRad: [deg(0), deg(6), deg(14), deg(10), deg(8)] },
      { axis: Z_AXIS, anglesRad: [deg(0), deg(3), deg(10), deg(16), deg(18)] },
    ]),

    // Arms splay outward (local Z = sideways abduction at bind pose) and go
    // loose at the elbow, unevenly between sides so the pose reads as a
    // limp fall rather than a symmetric, deliberate one.
    combinedRotationTrack("shoulder.L", t, [
      { axis: Z_AXIS, anglesRad: [deg(0), deg(-10), deg(-35), deg(-55), deg(-60)] },
      { axis: X_AXIS, anglesRad: [deg(0), deg(-4), deg(-12), deg(-15), deg(-15)] },
    ]),
    combinedRotationTrack("shoulder.R", t, [
      { axis: Z_AXIS, anglesRad: [deg(0), deg(8), deg(30), deg(45), deg(48)] },
      { axis: X_AXIS, anglesRad: [deg(0), deg(6), deg(18), deg(24), deg(26)] },
    ]),
    rotationTrack("forearm.L", t, X_AXIS, [deg(0), deg(10), deg(28), deg(38), deg(40)]),
    rotationTrack("forearm.R", t, X_AXIS, [deg(0), deg(8), deg(20), deg(26), deg(28)]),
  ];

  return new THREE.AnimationClip("death", duration, tracks);
}

/**
 * Builds one fresh humanoid rig: skeleton, rigid-skinned box mesh bound to
 * it, and the "idle"/"walk" clips authored against this skeleton's bone
 * names. Call this once and `SkeletonUtils.clone(rig.mesh)` per character
 * instance (see this module's header comment) — `rig.clips` is plain
 * keyframe data keyed by bone name and is safe to reuse, unmodified, across
 * every clone's own `THREE.AnimationMixer`.
 */
export function createHumanoidRig(): HumanoidRig {
  const { bones, skeleton } = buildSkeleton();
  const geometry = buildMeshGeometry(bones);

  const mesh = new THREE.SkinnedMesh(geometry, skinMaterial());
  mesh.add(bones[0]); // root bone must live in the mesh's scene graph
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return {
    mesh,
    skeleton,
    clips: {
      idle: buildIdleClip(bones),
      walk: buildWalkClip(bones),
      hit: buildHitClip(),
      death: buildDeathClip(bones),
    },
  };
}

let sharedRig: HumanoidRig | undefined;

/** The one `HumanoidRig` every NPC archetype's `createMesh` clones from
 * (`ecs/systems/npcAnimation.ts`'s `createAnimatedNpcMesh` does the actual
 * `SkeletonUtils.clone`) — built once and cached, since `createHumanoidRig`
 * does real skeleton/geometry/clip construction work that every archetype
 * sharing one visual doesn't need to repeat. A future archetype wanting a
 * genuinely different base body would call `createHumanoidRig()` directly
 * instead of this. */
export function getSharedHumanoidRig(): HumanoidRig {
  return (sharedRig ??= createHumanoidRig());
}

/**
 * Recolors a cloned rig mesh (e.g. one `createAnimatedNpcMesh` built from
 * `getSharedHumanoidRig()`) by multiplying `color` onto its material — a
 * cheap way for an NPC archetype to read as visually distinct from another
 * sharing the same base rig, without separate geometry. Clones the material
 * first: every clone from the shared rig starts out pointing at the same
 * cached `skinMaterial()` instance (see that function above), so mutating
 * it in place would recolor every other NPC using the shared rig too.
 */
export function tintClonedMesh(mesh: THREE.Object3D, color: number): void {
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = (Array.isArray(child.material) ? child.material[0] : child.material) as THREE.MeshStandardMaterial;
    const cloned = material.clone();
    cloned.color.multiply(new THREE.Color(color));
    child.material = cloned;
  });
}
