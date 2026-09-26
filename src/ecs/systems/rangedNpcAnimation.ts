import * as THREE from "three";
import { hasComponent, query, removeEntity, type World } from "bitecs";
import { Carried, Dead, Item, NPC, Rotation, Velocity } from "../components";
import { createRangedRig } from "../../characters/rangedRig";
import daggerAsset from "../../assets/items/dagger";
import { launchNpcProjectile } from "./rangedCombat";
import { registerMeleeSwing } from "./meleeCollision";

type Kind = "crossbow" | "javelin";
type Mode = "hold" | "walk" | "fire" | "throw" | "jab" | "hit" | "death";
interface State {
  kind: Kind;
  rig: ReturnType<typeof createRangedRig>;
  mixer: THREE.AnimationMixer;
  actions: Record<Mode, THREE.AnimationAction>;
  mode: Mode;
  elapsed: number;
  release?: () => void;
  contact?: () => void;
  thrown: boolean;
  dagger?: THREE.Object3D;
}
const states = new Map<number, State>();

export function createRangedNpcMesh(kind: Kind, eid: number): THREE.Object3D {
  const rig = createRangedRig(kind);
  rig.mesh.userData.eid = eid;
  rig.weapon.userData.itemTypeId = kind;
  rig.projectile.visible = false; // the clip's projectile is preview-only; gameplay launches an actual item
  const mixer = new THREE.AnimationMixer(rig.mesh);
  const upper = rig.clips.hold.tracks.filter(t => !/^hips\.|^(upperLeg|lowerLeg|foot|toe)\./.test(t.name));
  const walkLegs = rig.baseClips.walk.tracks.filter(t => /^hips\.|^(upperLeg|lowerLeg|foot|toe)\./.test(t.name));
  const walk = new THREE.AnimationClip("rangedWalk", rig.baseClips.walk.duration, [...walkLegs, ...upper]);
  const clips: Record<string, THREE.AnimationClip> = {
    ...rig.clips, walk, hit: rig.baseClips.hit, death: rig.baseClips.death,
  };
  const actions = {} as Record<Mode, THREE.AnimationAction>;
  for (const name of Object.keys(clips) as Mode[]) {
    actions[name] = mixer.clipAction(clips[name]);
    if (!(["hold", "walk"] as string[]).includes(name)) {
      actions[name].setLoop(THREE.LoopOnce, 1);
      actions[name].clampWhenFinished = true;
    }
  }
  let dagger: THREE.Object3D | undefined;
  if (kind === "javelin") {
    dagger = daggerAsset.createWorldMesh();
    dagger.name = "backupDagger";
    dagger.visible = false;
    const rightHand = rig.skeleton.bones.find(b => b.name === "hand.R")!;
    rightHand.add(dagger);
    dagger.position.set(0, -.075, .035);
    dagger.rotation.x = Math.PI / 2;
  }
  states.set(eid, { kind, rig, mixer, actions, mode: "hold", elapsed: 0, thrown: false, dagger });
  actions.hold.play();
  mixer.update(0);
  return rig.mesh;
}

function play(s: State, mode: Mode): void {
  s.mixer.stopAllAction();
  s.mode = mode;
  s.elapsed = 0;
  s.actions[mode].reset().play();
}

export function rangedNpcWeapon(eid: number): THREE.Object3D | undefined {
  const s = states.get(eid);
  return s?.thrown ? s.dagger : s?.rig.weapon;
}
export function rangedNpcLocked(eid: number): boolean {
  const s = states.get(eid);
  return !!s && !["hold", "walk"].includes(s.mode);
}
export function rangedNpcHasJavelin(eid: number): boolean {
  const s = states.get(eid);
  return !!s && s.kind === "javelin" && !s.thrown;
}

/** The NPC's fire callback runs at the clip's release frame, never at windup. */
export function beginRangedNpcAttack(eid: number, targetEid: number, world: World, scene: THREE.Scene): number | undefined {
  const s = states.get(eid);
  if (!s) return undefined;
  if (rangedNpcLocked(eid)) return 0;
  if (s.kind === "javelin" && s.thrown) {
    play(s, "jab");
    s.contact = () => {
      const yaw = Rotation.yaw[eid];
      registerMeleeSwing(eid, Math.sin(yaw), Math.cos(yaw), 1, .5, 1.1, 8, .15);
    };
    return s.rig.clips.jab.duration + .15;
  }
  const mode = s.kind === "crossbow" ? "fire" : "throw";
  play(s, mode);
  s.release = () => {
    if (hasComponent(world, eid, Dead)) return;
    s.rig.mesh.updateMatrixWorld(true);
    const muzzle = s.rig.weapon.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(s.rig.weapon.getWorldQuaternion(new THREE.Quaternion()));
    muzzle.addScaledVector(forward, s.kind === "javelin" ? .45 : .35);
    if (!hasComponent(world, targetEid, Dead)) launchNpcProjectile(scene, eid, targetEid, s.kind, muzzle);
    if (s.kind === "javelin") {
      s.thrown = true;
      s.rig.weapon.visible = false;
      if (s.dagger) s.dagger.visible = true;
      // The projectile is a new recoverable world item; remove the carried
      // copy so defeating the fighter cannot duplicate an already-thrown spear.
      for (const itemEid of query(world, [Item, Carried])) {
        if (Carried.ownerEid[itemEid] === eid && Item.itemTypeId[itemEid] === "javelin") {
          removeEntity(world, itemEid);
          break;
        }
      }
    }
  };
  return s.kind === "crossbow" ? 5 : s.rig.clips.throw.duration + .25;
}

export function reactRangedNpc(eid: number, event: "hit" | "death"): boolean {
  const s = states.get(eid);
  if (!s) return false;
  if (s.mode === "death") return true;
  s.release = undefined;
  s.contact = undefined;
  s.rig.mesh.updateMatrixWorld(true);
  if (event === "hit" && !s.thrown) s.rig.skeleton.bones.find(b => b.name === "hand.R")!.attach(s.rig.weapon);
  play(s, event);
  return true;
}

export function updateRangedNpcs(world: World, dt: number, paused: boolean): void {
  for (const [eid, s] of states) {
    if (!hasComponent(world, eid, NPC)) { states.delete(eid); continue; }
    if (paused && !["hit", "death"].includes(s.mode)) continue;
    s.elapsed += dt;
    s.mixer.update(dt);
    if (s.release && s.elapsed >= s.rig.releaseTime) {
      const release = s.release;
      s.release = undefined;
      release();
    }
    if (s.contact && s.elapsed >= .4) {
      const contact = s.contact;
      s.contact = undefined;
      contact();
    }
    if (s.mode === "death") continue;
    if (["fire", "throw", "jab", "hit"].includes(s.mode) && s.elapsed < s.actions[s.mode].getClip().duration) continue;
    if (s.rig.weapon.parent !== s.rig.mesh) s.rig.mesh.attach(s.rig.weapon);
    const next: Mode = Math.hypot(Velocity.x[eid] || 0, Velocity.z[eid] || 0) > .05 ? "walk" : "hold";
    if (s.mode !== next) play(s, next);
    // The javelin is gone after release; keep the backup dagger in hand.
    if (s.thrown) s.rig.weapon.visible = false;
  }
}
