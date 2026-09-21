import * as THREE from "three";
import { addComponent, addEntity, hasComponent, query, type World } from "bitecs";
import { Carried, Dead, Health, Item, Object3DRef, PlayerControlled, Position, Stackable, Viewmodel } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import type { ItemAssetDef } from "../../assets/types";
import { isHandSlot } from "./items";
import { applyRangedDamage } from "./combat";
import { buildItemWorldBody, withPickupHitbox } from "../../level/spawning";
import type { Physics } from "../../physics/world";
import { hudStore } from "../../hud/store";

interface EquippedRangedWeapon {
  itemEid: number;
  def: ItemAssetDef & { rangedWeapon: NonNullable<ItemAssetDef["rangedWeapon"]> };
}

interface ReloadState {
  remaining: number;
  duration: number;
  basePosition: THREE.Vector3;
  baseRotation: THREE.Euler;
}

interface FlyingBolt {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  distance: number;
  maxRange: number;
  damage: number;
  attackerEid: number;
}

const reloads = new Map<number, ReloadState>();
const flyingBolts: FlyingBolt[] = [];
const raycaster = new THREE.Raycaster();
const UP = new THREE.Vector3(0, 1, 0);
const BOLT_GRAVITY = 4;
// createBoltMesh spans roughly local Z -0.23..+0.32. Placing its origin this
// far behind the contact point leaves 75% of the complete bolt visible.
const BOLT_LENGTH = .55;
const BOLT_TIP_OFFSET = .32;
const BOLT_PROTRUDING_FRACTION = .75;

export function getEquippedRangedWeapon(world: World, ownerEid: number): EquippedRangedWeapon | undefined {
  for (const itemEid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[itemEid] !== ownerEid || !isHandSlot(Carried.slot[itemEid])) continue;
    const def = ITEM_REGISTRY[Item.itemTypeId[itemEid]];
    if (def?.rangedWeapon) return { itemEid, def: def as EquippedRangedWeapon["def"] };
  }
  return undefined;
}

function ammoStack(world: World, ownerEid: number, itemTypeId: string): number | undefined {
  for (const eid of query(world, [Item, Carried, Stackable])) {
    if (Carried.ownerEid[eid] === ownerEid && Item.itemTypeId[eid] === itemTypeId && Stackable.count[eid] > 0) return eid;
  }
  return undefined;
}

export function getRangedAmmoLabel(world: World, ownerEid: number): string | undefined {
  const equipped = getEquippedRangedWeapon(world, ownerEid);
  if (!equipped) return undefined;
  const ammoType = equipped.def.rangedWeapon.ammoItemTypeId;
  const eid = ammoStack(world, ownerEid, ammoType);
  const count = eid === undefined ? 0 : Stackable.count[eid];
  const name = ITEM_REGISTRY[ammoType]?.name ?? ammoType;
  const singular = name.replace(/s$/i, "").toLowerCase();
  return `${count} ${count === 1 ? singular : name.toLowerCase()}`;
}

export function shouldEmbedProjectile(speed: number, hasImpact: boolean): boolean {
  return hasImpact && speed >= .25;
}

export function embeddedBoltOriginOffset(): number {
  const embeddedLength = BOLT_LENGTH * (1 - BOLT_PROTRUDING_FRACTION);
  return embeddedLength - BOLT_TIP_OFFSET;
}

export type RangedFireResult = "not-ranged" | "fired" | "reloading" | "no-ammo";

/** Fires the equipped ranged weapon from the reticle. Damage waits for the
 * visible projectile to arrive; one ammo unit is consumed at release. */
export function tryFireRanged(world: World, camera: THREE.Camera, scene: THREE.Scene): RangedFireResult {
  const playerEid = query(world, [PlayerControlled])[0];
  if (playerEid === undefined) return "not-ranged";
  const equipped = getEquippedRangedWeapon(world, playerEid);
  if (!equipped) return "not-ranged";
  if ((reloads.get(equipped.itemEid)?.remaining ?? 0) > 0) {
    hudStore.showMessage("Reloading…");
    return "reloading";
  }
  const ammoEid = ammoStack(world, playerEid, equipped.def.rangedWeapon.ammoItemTypeId);
  if (ammoEid === undefined) {
    hudStore.showMessage("Out of bolts.");
    return "no-ammo";
  }
  Stackable.count[ammoEid]--;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction).normalize();
  // Begin the swept path at the camera instead of in front of it. The old
  // .45m muzzle offset could place a bolt on the far side of a nearby wall,
  // so the first frame never saw the impact.
  const position = camera.getWorldPosition(new THREE.Vector3());
  const ammoDef = ITEM_REGISTRY[equipped.def.rangedWeapon.ammoItemTypeId];
  const mesh = ammoDef.createWorldMesh();
  mesh.position.copy(position);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  scene.add(mesh);
  flyingBolts.push({
    mesh, position, velocity: direction.multiplyScalar(equipped.def.rangedWeapon.projectileSpeed),
    distance: 0, maxRange: equipped.def.rangedWeapon.maxRange, damage: equipped.def.rangedWeapon.damage, attackerEid: playerEid,
  });

  const viewmodel = Viewmodel[equipped.itemEid];
  reloads.set(equipped.itemEid, {
    remaining: equipped.def.rangedWeapon.reloadSeconds,
    duration: equipped.def.rangedWeapon.reloadSeconds,
    basePosition: viewmodel?.position.clone() ?? new THREE.Vector3(),
    baseRotation: viewmodel?.rotation.clone() ?? new THREE.Euler(),
  });
  return "fired";
}

function owningEid(object: THREE.Object3D): number | undefined {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (typeof current.userData.eid === "number") return current.userData.eid;
  }
  return undefined;
}

function makeRecoverableBolt(world: World, physics: Physics, scene: THREE.Scene, bolt: FlyingBolt, hit?: THREE.Intersection): void {
  bolt.mesh.removeFromParent();
  const eid = addEntity(world);
  addComponent(world, eid, Item);
  addComponent(world, eid, Stackable);
  Item.itemTypeId[eid] = "bolt";
  Stackable.count[eid] = 1;

  if (hit && shouldEmbedProjectile(bolt.velocity.length(), true)) {
    addComponent(world, eid, Position);
    addComponent(world, eid, Object3DRef);
    const direction = bolt.velocity.clone().normalize();
    const group = withPickupHitbox(bolt.mesh, eid);
    group.position.copy(hit.point).addScaledVector(direction, embeddedBoltOriginOffset());
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    Position.x[eid] = group.position.x;
    Position.y[eid] = group.position.y;
    Position.z[eid] = group.position.z;
    scene.add(group);
    hit.object.attach(group); // follows any moving surface while embedded
    Object3DRef[eid] = group;
  } else {
    const p = hit?.point ?? bolt.position;
    buildItemWorldBody(world, physics, scene, eid, ITEM_REGISTRY.bolt, p.x, p.y, p.z);
  }
}

/** Advances reload poses and short-range projectile flight. */
export function rangedCombatSystem(world: World, physics: Physics, scene: THREE.Scene, dt: number): void {
  for (const [itemEid, state] of reloads) {
    state.remaining = Math.max(0, state.remaining - dt);
    const mesh = Viewmodel[itemEid];
    if (mesh) {
      const progress = 1 - state.remaining / state.duration;
      const dip = Math.sin(progress * Math.PI);
      mesh.position.copy(state.basePosition).addScaledVector(UP, -.13 * dip);
      mesh.rotation.copy(state.baseRotation);
      mesh.rotation.x += .22 * dip;
    }
    if (state.remaining === 0) {
      if (mesh) { mesh.position.copy(state.basePosition); mesh.rotation.copy(state.baseRotation); }
      reloads.delete(itemEid);
    }
  }

  for (let i = flyingBolts.length - 1; i >= 0; i--) {
    const bolt = flyingBolts[i];
    const previous = bolt.position.clone();
    bolt.velocity.y -= BOLT_GRAVITY * dt;
    const step = bolt.velocity.clone().multiplyScalar(dt);
    const stepLength = step.length();
    const direction = step.clone().normalize();
    raycaster.set(previous, direction);
    raycaster.far = stepLength;
    const hit = raycaster.intersectObjects(scene.children, true).find(candidate => {
      for (let current: THREE.Object3D | null = candidate.object; current; current = current.parent) {
        if (current === bolt.mesh || current instanceof THREE.Camera) return false;
      }
      return candidate.object.visible;
    });
    if (hit) {
      const targetEid = owningEid(hit.object);
      if (targetEid !== undefined && hasComponent(world, targetEid, Health) && !hasComponent(world, targetEid, Dead)) {
        applyRangedDamage(world, targetEid, bolt.damage, bolt.attackerEid);
      }
      makeRecoverableBolt(world, physics, scene, bolt, hit);
      flyingBolts.splice(i, 1);
      continue;
    }
    bolt.position.add(step);
    bolt.distance += stepLength;
    bolt.mesh.position.copy(bolt.position);
    bolt.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), bolt.velocity.clone().normalize());
    if (bolt.distance >= bolt.maxRange) {
      makeRecoverableBolt(world, physics, scene, bolt);
      flyingBolts.splice(i, 1);
    }
  }
}

export function getRangedCombatDebugState(): { flyingBolts: number; reloads: number } {
  return { flyingBolts: flyingBolts.length, reloads: reloads.size };
}
