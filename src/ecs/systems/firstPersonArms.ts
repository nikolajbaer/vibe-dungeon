import * as THREE from "three";
import { createHumanoidBase } from "../../characters/humanoidBase";
import type { AttackType } from "./combat";
import type { HandSlot } from "./items";

interface ArmsState {
  anchor: THREE.Group;
  camera: THREE.Camera;
  mesh: THREE.SkinnedMesh;
  mixer: THREE.AnimationMixer;
  clips: ReturnType<typeof createHumanoidBase>["clips"];
  bones: Map<string, THREE.Bone>;
  attachedItems: Map<number, THREE.Object3D>;
  armed: boolean;
}

let state: ArmsState | undefined;

function keepArmTriangles(mesh: THREE.SkinnedMesh): void {
  const geometry = mesh.geometry.clone();
  const index = geometry.index;
  const skinIndex = geometry.getAttribute("skinIndex");
  if (!index || !skinIndex) return;
  const allowed = new Set(mesh.skeleton.bones
    .map((bone, i) => /^(clavicle|upperArm|forearm|hand|thumb)\./.test(bone.name) ? i : -1)
    .filter(i => i >= 0));
  const belongsToArm = (vertex: number) => {
    for (let component = 0; component < 4; component++) {
      if (allowed.has(skinIndex.getComponent(vertex, component))) return true;
    }
    return false;
  };
  const kept: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    if (belongsToArm(a) && belongsToArm(b) && belongsToArm(c)) kept.push(a, b, c);
  }
  geometry.setIndex(kept);
  geometry.computeBoundingSphere();
  mesh.geometry = geometry;
}

function renderOnTop(object: THREE.Object3D): void {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.renderOrder = 999;
    const wasArray = Array.isArray(child.material);
    const materials: THREE.Material[] = wasArray ? child.material : [child.material];
    const clones = materials.map(material => {
      const clone = material.clone();
      clone.depthTest = false;
      clone.depthWrite = false;
      clone.side = THREE.DoubleSide;
      return clone;
    });
    child.material = wasArray ? clones : clones[0];
  });
}

function showGuard(): void {
  if (!state) return;
  state.mixer.stopAllAction();
  const clip = state.armed ? state.clips.combatIdle : state.clips.unarmedCross;
  const action = state.mixer.clipAction(clip).reset().play();
  if (!state.armed) {
    action.time = 0;
    action.paused = true;
    state.mixer.update(0);
  }
}

/** Creates one camera-relative skinned humanoid, then removes every triangle
 * not weighted to the clavicles/arms/hands. The full skeleton is retained so
 * the original humanoid AnimationClips bind without special-case tracks. */
export function initFirstPersonArms(camera: THREE.Camera): void {
  state?.anchor.removeFromParent();
  const rig = createHumanoidBase();
  keepArmTriangles(rig.mesh);
  rig.mesh.name = "firstPersonArms";
  // Shoulders sit just below and behind the camera; rotating the humanoid
  // makes its authored +Z forward point down camera -Z. A negative local Z
  // is therefore essential—the previous positive offset placed the entire
  // arm rig behind the first-person camera.
  rig.mesh.scale.setScalar(.75);
  rig.mesh.position.set(0, -1.22, -.55);
  rig.mesh.rotation.y = Math.PI;
  rig.mesh.frustumCulled = false;
  renderOnTop(rig.mesh);
  // Keep the viewmodel in the ordinary scene graph and mirror the camera's
  // world transform through this anchor. Some renderers skip descendants of
  // the active camera during scene projection; a sibling anchor is portable
  // and produces the same camera-relative result.
  const anchor = new THREE.Group();
  anchor.name = "firstPersonAnchor";
  camera.parent?.add(anchor);
  anchor.add(rig.mesh);
  camera.getWorldPosition(anchor.position);
  camera.getWorldQuaternion(anchor.quaternion);
  const mixer = new THREE.AnimationMixer(rig.mesh);
  state = {
    anchor,
    camera,
    mesh: rig.mesh,
    mixer,
    clips: rig.clips,
    bones: new Map(rig.skeleton.bones.map(bone => [bone.name, bone])),
    attachedItems: new Map(),
    armed: false,
  };
  mixer.addEventListener("finished", showGuard);
  showGuard();
}

export function attachFirstPersonWeapon(itemEid: number, slot: HandSlot, weapon: THREE.Object3D, dagger = false): void {
  if (!state) return;
  detachFirstPersonWeapon(itemEid);
  const side = slot === "hand-right" ? "R" : "L";
  const hand = state.bones.get(`hand.${side}`);
  if (!hand) return;
  weapon.name = `firstPersonWeapon.${itemEid}`;
  weapon.scale.setScalar(dagger ? .82 : .72);
  weapon.rotation.set(Math.PI / 2, 0, slot === "hand-left" ? Math.PI : 0);
  weapon.position.set(0, -.065, .014);
  renderOnTop(weapon);
  hand.add(weapon);
  state.attachedItems.set(itemEid, weapon);
  state.armed = true;
  showGuard();
}

export function detachFirstPersonWeapon(itemEid: number): void {
  if (!state) return;
  const weapon = state.attachedItems.get(itemEid);
  if (!weapon) return;
  weapon.removeFromParent();
  state.attachedItems.delete(itemEid);
  state.armed = state.attachedItems.size > 0;
  showGuard();
}

export function isFirstPersonWeapon(itemEid: number): boolean {
  return state?.attachedItems.has(itemEid) ?? false;
}

export function playFirstPersonAttack(attackType: AttackType | "parry", armed: boolean): void {
  if (!state) return;
  state.armed = armed;
  state.mixer.stopAllAction();
  const clip = attackType === "parry"
    ? (armed ? state.clips.parry : state.clips.unarmedParry)
    : armed
      ? attackType === "jab" ? state.clips.weaponJab : attackType === "cross" ? state.clips.weaponCross : state.clips.weaponChop
      : attackType === "jab" ? state.clips.unarmedJab : attackType === "cross" ? state.clips.unarmedCross : state.clips.unarmedChop;
  const action = state.mixer.clipAction(clip);
  action.reset();
  action.enabled = true;
  action.clampWhenFinished = true;
  action.setLoop(THREE.LoopOnce, 1);
  action.play();
}

export function firstPersonArmsSystem(dt: number): void {
  if (!state) return;
  state.camera.getWorldPosition(state.anchor.position);
  state.camera.getWorldQuaternion(state.anchor.quaternion);
  state.mixer.update(dt);
}

export function getFirstPersonArmsDebugState() {
  const handPosition = (name: string) => {
    const bone = state?.bones.get(name);
    if (!bone || !state) return undefined;
    return state.mesh.parent?.worldToLocal(bone.getWorldPosition(new THREE.Vector3())).toArray();
  };
  return state ? {
    visibleTriangles: state.mesh.geometry.index ? state.mesh.geometry.index.count / 3 : 0,
    attachedWeapons: state.attachedItems.size,
    armed: state.armed,
    leftHand: handPosition("hand.L"),
    rightHand: handPosition("hand.R"),
  } : undefined;
}
