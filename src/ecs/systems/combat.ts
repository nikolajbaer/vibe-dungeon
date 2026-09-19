import * as THREE from "three";
import { addComponent, hasComponent, query, type World } from "bitecs";
import { Carried, Combat, Dead, Health, Item, Object3DRef, PlayerControlled } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import { isHandSlot, triggerViewmodelParry, triggerViewmodelSwing } from "./items";
import { triggerDeathCollapse, triggerHitReaction, triggerParry } from "./npcAnimation";

export type AttackType = "jab" | "cross" | "chop";
export type WeaponClass = "unarmed" | "dagger" | "oneHanded";

export interface AttackProfile {
  damageMultiplier: number;
  recovery: number;
}

/** Shared balance table for players and, later, NPC attack selection. */
export const ATTACK_PROFILES: Record<AttackType, AttackProfile> = {
  jab: { damageMultiplier: 0.7, recovery: 0.5 },
  cross: { damageMultiplier: 1, recovery: 0.75 },
  chop: { damageMultiplier: 1.35, recovery: 1 },
};

export const UNARMED_DAMAGE = 5;
export const PARRY_MITIGATION: Record<WeaponClass, number> = {
  unarmed: 0.3,
  dagger: 0.5,
  oneHanded: 0.75,
};
export const PARRY_STARTUP = 0.1;
export const PARRY_WINDOW = 0.28;
export const PARRY_RECOVERY = 0.75;
const MELEE_RANGE = 2;

const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();

interface EquippedWeapon {
  itemEid: number;
  damage: number;
  weaponClass: WeaponClass;
}

function getEquippedWeapon(world: World, attackerEid: number): EquippedWeapon | undefined {
  let best: EquippedWeapon | undefined;
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== attackerEid || !isHandSlot(Carried.slot[eid])) continue;
    const def = ITEM_REGISTRY[Item.itemTypeId[eid]];
    if (def?.meleeDamage === undefined) continue;
    const candidate: EquippedWeapon = {
      itemEid: eid,
      damage: def.meleeDamage,
      weaponClass: def.id === "dagger" ? "dagger" : "oneHanded",
    };
    if (!best || candidate.damage > best.damage) best = candidate;
  }
  return best;
}

function weaponClassFor(world: World, eid: number): WeaponClass {
  return getEquippedWeapon(world, eid)?.weaponClass ?? "unarmed";
}

/** Advances attack recovery and the startup/active/recovery phases of parry. */
export function combatSystem(world: World, dt: number): void {
  for (const eid of query(world, [Combat])) {
    Combat.attackRecovery[eid] = Math.max(0, Combat.attackRecovery[eid] - dt);
    Combat.parryRecovery[eid] = Math.max(0, Combat.parryRecovery[eid] - dt);
    if (Combat.parryStartup[eid] > 0) {
      Combat.parryStartup[eid] = Math.max(0, Combat.parryStartup[eid] - dt);
      if (Combat.parryStartup[eid] === 0) Combat.parryWindow[eid] = PARRY_WINDOW;
    } else {
      Combat.parryWindow[eid] = Math.max(0, Combat.parryWindow[eid] - dt);
    }
  }
}

/** Starts a timed parry. It cannot be buffered during attack/parry recovery. */
export function tryParry(world: World, defenderEid?: number): boolean {
  const eid = defenderEid ?? query(world, [PlayerControlled, Combat])[0];
  if (eid === undefined || Combat.attackRecovery[eid] > 0 || Combat.parryRecovery[eid] > 0) return false;
  Combat.parryStartup[eid] = PARRY_STARTUP;
  Combat.parryWindow[eid] = 0;
  Combat.parryRecovery[eid] = PARRY_RECOVERY;
  const weapon = getEquippedWeapon(world, eid);
  Combat.parryMitigation[eid] = PARRY_MITIGATION[weapon?.weaponClass ?? "unarmed"];
  if (weapon) triggerViewmodelParry(weapon.itemEid, PARRY_RECOVERY);
  triggerParry(eid);
  return true;
}

/** Applies one resolved hit and returns the actual post-parry damage. */
export function applyMeleeDamage(world: World, targetEid: number, rawDamage: number): number {
  if (!hasComponent(world, targetEid, Health) || hasComponent(world, targetEid, Dead)) return 0;
  if (hasComponent(world, targetEid, Combat)
      && Combat.parryRecovery[targetEid] <= 0
      && Combat.agility[targetEid] > 0
      && Math.random() < Combat.agility[targetEid]) {
    // NPCs detect the incoming wind-up, so their successful reactive parry
    // enters the active window before this strike resolves.
    Combat.parryStartup[targetEid] = 0;
    Combat.parryWindow[targetEid] = PARRY_WINDOW;
    Combat.parryRecovery[targetEid] = PARRY_RECOVERY;
    triggerParry(targetEid);
  }
  const mitigation = hasComponent(world, targetEid, Combat) && Combat.parryWindow[targetEid] > 0
    ? Combat.parryMitigation[targetEid] || PARRY_MITIGATION[weaponClassFor(world, targetEid)]
    : 0;
  const damage = Math.max(1, Math.round(rawDamage * (1 - mitigation)));
  Health.current[targetEid] = Math.max(0, Health.current[targetEid] - damage);

  if (Health.current[targetEid] <= 0) {
    addComponent(world, targetEid, Dead);
    triggerDeathCollapse(targetEid);
  } else if (mitigation === 0) {
    triggerHitReaction(targetEid);
  }
  return damage;
}

/** Attempts a player attack. Damage is immediate in phase 1; recovery gates
 * subsequent attacks and matches the balance table above. */
export function tryMeleeAttack(world: World, camera: THREE.Camera, attackType: AttackType = "jab"): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined || Combat.attackRecovery[attackerEid] > 0 || Combat.parryRecovery[attackerEid] > 0) return false;

  const profile = ATTACK_PROFILES[attackType];
  const weapon = getEquippedWeapon(world, attackerEid);
  Combat.attackRecovery[attackerEid] = profile.recovery;
  if (weapon) triggerViewmodelSwing(weapon.itemEid, attackType, profile.recovery);

  const targets: THREE.Object3D[] = [];
  for (const eid of query(world, [Health, Object3DRef])) {
    if (hasComponent(world, eid, Dead)) continue;
    const obj = Object3DRef[eid];
    if (obj && obj !== (camera as unknown as THREE.Object3D)) targets.push(obj);
  }
  if (targets.length === 0) return false;

  camera.getWorldDirection(forward);
  raycaster.set(camera.position, forward);
  raycaster.far = MELEE_RANGE;
  const hit = raycaster.intersectObjects(targets, true)[0];
  const hitEid = hit?.object.userData.eid as number | undefined;
  if (hitEid === undefined) return false;

  const damage = Math.round((weapon?.damage ?? UNARMED_DAMAGE) * profile.damageMultiplier);
  applyMeleeDamage(world, hitEid, damage);
  return true;
}
