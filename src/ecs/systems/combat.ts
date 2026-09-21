import { addComponent, hasComponent, query, type World } from "bitecs";
import { Carried, Combat, Dead, Health, Item, NPC, NpcState, PlayerControlled, Practice, Rotation } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import { isHandSlot, triggerViewmodelSwing, triggerViewmodelParry } from "./items";
import { triggerDeathCollapse, triggerHitReaction, triggerParry } from "./npcAnimation";
import { flashCharacterHit, flashWeaponHit } from "./hitboxDebug";
import { registerMeleeSwing } from "./meleeCollision";
import type { CombatBodyPart } from "../../physics/world";

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

/** The melee swing box's shape per attack type (see `meleeCollision.ts`'s
 * `registerMeleeSwing`) -- `reachMultiplier` scales the equipped weapon's
 * own `meleeReach` (or `UNARMED_REACH`), `width`/`height` are absolute
 * meters. A jab thrusts further and narrower; a chop trades reach for a
 * wide arc; a cross sits between the two on every axis. NPCs (npc.ts) have
 * no jab/cross/chop distinction of their own and just reuse `cross` as a
 * neutral generic swing. */
export const ATTACK_SHAPES: Record<AttackType, { reachMultiplier: number; width: number; height: number }> = {
  jab: { reachMultiplier: 1.15, width: 0.5, height: 1.0 },
  cross: { reachMultiplier: 1.0, width: 0.8, height: 1.1 },
  chop: { reachMultiplier: 0.85, width: 1.3, height: 1.3 },
};

/** How long (seconds) each attack type's swing box stays active and able to
 * land a hit -- a fraction of the attack's own `recovery` above, since the
 * box only needs to cover the actual swing, not the whole windup-to-ready
 * cycle. Exported for npc.ts, whose generic attack reuses `cross`'s. */
export const ATTACK_ACTIVE_WINDOW: Record<AttackType, number> = {
  jab: 0.15,
  cross: 0.2,
  chop: 0.25,
};

export const UNARMED_DAMAGE = 5;
/** Reach (meters) for an attacker with no weapon equipped (or, for an NPC,
 * no `attackReach` and no `parryWeaponClass` to derive one from) -- the
 * same "sensible unarmed default" role `UNARMED_DAMAGE` already plays for
 * damage. */
export const UNARMED_REACH = 0.9;
export const PARRY_MITIGATION: Record<WeaponClass, number> = {
  unarmed: 0.3,
  dagger: 0.5,
  oneHanded: 0.75,
};
export const PARRY_STARTUP = 0.1;
export const PARRY_WINDOW = 0.28;
export const PARRY_RECOVERY = 0.75;

interface EquippedWeapon {
  itemEid: number;
  damage: number;
  reach: number;
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
      reach: def.meleeReach ?? UNARMED_REACH,
      weaponClass: def.id === "dagger" ? "dagger" : "oneHanded",
    };
    if (!best || candidate.damage > best.damage) best = candidate;
  }
  return best;
}

function weaponClassFor(world: World, eid: number): WeaponClass {
  return getEquippedWeapon(world, eid)?.weaponClass ?? "unarmed";
}

function recordFriendlyFire(world: World, targetEid: number, attackerEid?: number): void {
  if (attackerEid === undefined || !hasComponent(world, attackerEid, PlayerControlled)
      || !hasComponent(world, targetEid, NPC) || NPC.provoked[targetEid] !== 0) return;
  NPC.provocationHits[targetEid] = (NPC.provocationHits[targetEid] || 0) + 1;
  if (NPC.provocationHits[targetEid] >= 2) {
    NPC.provoked[targetEid] = 1;
    NPC.state[targetEid] = NpcState.CHASING;
    NPC.drawRemaining[targetEid] = .5;
  }
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
export function applyMeleeDamage(world: World, targetEid: number, rawDamage: number, attackerEid?: number, part?: CombatBodyPart): number {
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
  // A parried hit (mitigation > 0) is already its own visual feedback --
  // this is the same "did it land clean" gate `triggerHitReaction` below
  // uses, shared here so the hitbox debug overlay's red flash (play-testing
  // aid only, see hitboxDebug.ts) never fires for a hit the defender
  // actually blocked.
  if (mitigation === 0) {
    flashCharacterHit(targetEid, part);
    if (attackerEid !== undefined) flashWeaponHit(attackerEid);
  }
  if (hasComponent(world, targetEid, Practice) && Practice.active[targetEid]) {
    Practice.points[targetEid] = Math.max(0, Practice.points[targetEid] - damage);
    if (mitigation === 0) triggerHitReaction(targetEid);
    return damage;
  }
  Health.current[targetEid] = Math.max(0, Health.current[targetEid] - damage);

  // Friendly NPCs tolerate one accidental strike. A second real hit makes
  // them defend themselves using the same chase/attack path as hostiles.
  recordFriendlyFire(world, targetEid, attackerEid);

  if (Health.current[targetEid] <= 0) {
    addComponent(world, targetEid, Dead);
    triggerDeathCollapse(targetEid);
  } else if (mitigation === 0) {
    triggerHitReaction(targetEid);
  }
  return damage;
}

/** Projectile damage bypasses melee parry detection but shares death/hit
 * reactions and practice-health semantics with hand-to-hand attacks. */
export function applyRangedDamage(world: World, targetEid: number, rawDamage: number, attackerEid?: number): number {
  if (!hasComponent(world, targetEid, Health) || hasComponent(world, targetEid, Dead)) return 0;
  const damage = Math.max(1, Math.round(rawDamage));
  if (hasComponent(world, targetEid, Practice) && Practice.active[targetEid]) {
    Practice.points[targetEid] = Math.max(0, Practice.points[targetEid] - damage);
    triggerHitReaction(targetEid);
    return damage;
  }
  Health.current[targetEid] = Math.max(0, Health.current[targetEid] - damage);
  recordFriendlyFire(world, targetEid, attackerEid);
  if (Health.current[targetEid] <= 0) {
    addComponent(world, targetEid, Dead);
    triggerDeathCollapse(targetEid);
  } else {
    triggerHitReaction(targetEid);
  }
  return damage;
}

/** Attempts a player attack: on success, queues a melee swing box (see
 * `meleeCollision.ts`) along the player's current facing (`Rotation.yaw`,
 * which `inputSystem` already keeps in lockstep with the camera — no camera
 * parameter needed here anymore). Recovery gates subsequent attacks and
 * matches the balance table above; whether the swing actually connects is
 * resolved later, by `meleeCollisionSystem`, once its active window has had
 * a chance to overlap a target. */
export function tryMeleeAttack(world: World, attackType: AttackType = "jab"): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined || Combat.attackRecovery[attackerEid] > 0 || Combat.parryRecovery[attackerEid] > 0) return false;

  const profile = ATTACK_PROFILES[attackType];
  const shape = ATTACK_SHAPES[attackType];
  const weapon = getEquippedWeapon(world, attackerEid);
  Combat.attackRecovery[attackerEid] = profile.recovery;
  if (weapon) triggerViewmodelSwing(weapon.itemEid, attackType, profile.recovery);

  const reach = (weapon?.reach ?? UNARMED_REACH) * shape.reachMultiplier;
  const damage = Math.round((weapon?.damage ?? UNARMED_DAMAGE) * profile.damageMultiplier);
  // The player has no body mesh at all (`Object3DRef` is the camera --
  // see game.ts), so `Rotation.yaw` here means exactly what inputSystem's
  // own forward vector means: local -Z at yaw 0 (see registerMeleeSwing's
  // doc comment for why this can't be assumed inside that shared function).
  const yaw = Rotation.yaw[attackerEid];
  registerMeleeSwing(attackerEid, -Math.sin(yaw), -Math.cos(yaw), reach, shape.width, shape.height, damage, ATTACK_ACTIVE_WINDOW[attackType]);
  return true;
}
