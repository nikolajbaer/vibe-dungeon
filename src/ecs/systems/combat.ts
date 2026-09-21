import { addComponent, hasComponent, query, type World } from "bitecs";
import { Carried, Combat, Dead, Health, Item, NPC, NpcState, PlayerControlled, Practice, Rotation, Stamina } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import { NPC_REGISTRY } from "../../assets/npcRegistry";
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
 * no `attackReach` and no `weaponClass` to derive one from) -- the
 * same "sensible unarmed default" role `UNARMED_DAMAGE` already plays for
 * damage. */
export const UNARMED_REACH = 0.9;

/** Fraction of incoming melee damage removed while the defender is
 * blocking -- Skyrim-style: held for as long as the block input is down (or,
 * for an NPC, however long its reactive `agility` roll happens to cover),
 * not a timed window the defender has to land. A bigger weapon/shield
 * blocks better, the same balance the old timed-parry system used, just no
 * longer gated on timing skill. */
export const BLOCK_MITIGATION: Record<WeaponClass, number> = {
  unarmed: 0.3,
  dagger: 0.5,
  oneHanded: 0.75,
};

/** Purely cosmetic -- how long the first-person weapon's "guard raised"
 * flourish plays when block starts (see `setBlocking`). The actual
 * mitigation lasts exactly as long as `Combat.blocking` is set, independent
 * of this; a genuinely held guard *pose* (rather than a brief raise-then-
 * settle animation) is a follow-up animation-system improvement, not
 * something this constant tries to fake. */
const BLOCK_RAISE_ANIMATION_SECONDS = 0.3;

/** Stamina cost of each attack type -- roughly tracks the balance table
 * above (a chop is the "power attack" analog: slow, strong, and the most
 * expensive). NPCs have no jab/cross/chop of their own and pay `cross`'s
 * cost for their one generic swing, same as they reuse its shape/damage
 * multiplier. Insufficient stamina simply refuses the attack outright
 * (`tryMeleeAttack` returns false), the same as being on cooldown. */
export const ATTACK_STAMINA_COST: Record<AttackType, number> = {
  jab: 8,
  cross: 12,
  chop: 20,
};

/** Stamina regenerated per second while not... doing anything special --
 * regen is unconditional and continuous (no post-attack delay) for now,
 * the simplest version of the mechanic. A future leveling/perk system is
 * the intended place to let this vary per character. */
export const STAMINA_REGEN_PER_SECOND = 15;

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

/** What `eid` effectively fights/defends with -- a real carried weapon item
 * if it has one (the player always does, when armed), otherwise, for an
 * NPC, its archetype's own `weaponClass` (NPCs never equip a real weapon
 * item -- see `NpcArchetypeDef.weaponClass`'s doc comment), otherwise
 * unarmed. */
function weaponClassFor(world: World, eid: number): WeaponClass {
  const equipped = getEquippedWeapon(world, eid);
  if (equipped) return equipped.weaponClass;
  if (hasComponent(world, eid, NPC)) return NPC_REGISTRY[NPC.archetypeId[eid]]?.weaponClass ?? "unarmed";
  return "unarmed";
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

/** Advances attack recovery and regenerates stamina. */
export function combatSystem(world: World, dt: number): void {
  for (const eid of query(world, [Combat])) {
    Combat.attackRecovery[eid] = Math.max(0, Combat.attackRecovery[eid] - dt);
    if (hasComponent(world, eid, Stamina)) {
      Stamina.current[eid] = Math.min(Stamina.max[eid], Stamina.current[eid] + STAMINA_REGEN_PER_SECOND * dt);
    }
  }
}

/**
 * Sets whether `eid` is currently holding block (Skyrim-style: a plain held
 * state, not a timed window to land) -- called every frame from game.ts
 * with the real-time state of the block input (`keyboard.isDown`, or a
 * touch block gesture's own pulse), not edge-triggered like the old
 * `tryParry` was, since block needs to track "still held" every frame, not
 * just the moment it started.
 *
 * Raising block (the `held && !already blocking` transition) is refused
 * mid-attack-recovery -- the same "can't parry mid-swing" gate the old
 * timed parry had -- and plays the brief "weapon comes up" flourish once;
 * releasing it (`!held`) always succeeds. Holding it down across frames
 * where it was already up is a no-op, not a repeated trigger.
 */
export function setBlocking(world: World, eid: number, held: boolean): void {
  if (!hasComponent(world, eid, Combat)) return;
  const wasBlocking = Combat.blocking[eid] > 0;
  if (!held) {
    Combat.blocking[eid] = 0;
    return;
  }
  if (wasBlocking || Combat.attackRecovery[eid] > 0) return;
  Combat.blocking[eid] = 1;
  const weapon = getEquippedWeapon(world, eid);
  if (weapon) triggerViewmodelParry(weapon.itemEid, BLOCK_RAISE_ANIMATION_SECONDS);
  triggerParry(eid);
}

/** Applies one resolved hit and returns the actual post-block damage. */
export function applyMeleeDamage(world: World, targetEid: number, rawDamage: number, attackerEid?: number, part?: CombatBodyPart): number {
  if (!hasComponent(world, targetEid, Health) || hasComponent(world, targetEid, Dead)) return 0;
  // The player's own `Combat.blocking` is a real held key/gesture, tracked
  // every frame by `setBlocking` -- there's nothing to roll for. An NPC has
  // no such input, so it instead rolls once, right here, whether it happens
  // to be blocking at the exact instant this swing lands, using `agility` as
  // that chance (the same role it played reacting into the old timed parry
  // window, just without a window to react into anymore).
  const isPlayerDefender = hasComponent(world, targetEid, PlayerControlled);
  const npcReactiveBlock = !isPlayerDefender && hasComponent(world, targetEid, Combat)
    && Combat.agility[targetEid] > 0 && Math.random() < Combat.agility[targetEid];
  const isBlocking = (hasComponent(world, targetEid, Combat) && Combat.blocking[targetEid] > 0) || npcReactiveBlock;
  if (npcReactiveBlock) triggerParry(targetEid);
  const mitigation = isBlocking ? BLOCK_MITIGATION[weaponClassFor(world, targetEid)] : 0;
  const damage = Math.max(1, Math.round(rawDamage * (1 - mitigation)));
  // A blocked hit (mitigation > 0) is already its own visual feedback --
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

/** Projectile damage bypasses melee blocking entirely (no shield-raise for
 * an incoming bolt yet) but shares death/hit reactions and practice-health
 * semantics with hand-to-hand attacks, plus the same hitbox-debug flash --
 * `rawDamage` already carries the struck body part's multiplier by the time
 * it gets here (see rangedCombat.ts), `part` is only for the flash. */
export function applyRangedDamage(world: World, targetEid: number, rawDamage: number, attackerEid?: number, part?: CombatBodyPart): number {
  if (!hasComponent(world, targetEid, Health) || hasComponent(world, targetEid, Dead)) return 0;
  const damage = Math.max(1, Math.round(rawDamage));
  flashCharacterHit(targetEid, part);
  if (attackerEid !== undefined) flashWeaponHit(attackerEid);
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
 * a chance to overlap a target. Refuses outright -- same as being on
 * cooldown -- while blocking (can't swing with your guard up) or without
 * enough stamina for this attack type's `ATTACK_STAMINA_COST`. */
export function tryMeleeAttack(world: World, attackType: AttackType = "jab"): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined || Combat.attackRecovery[attackerEid] > 0 || Combat.blocking[attackerEid] > 0) return false;
  const cost = ATTACK_STAMINA_COST[attackType];
  if (hasComponent(world, attackerEid, Stamina) && Stamina.current[attackerEid] < cost) return false;

  const profile = ATTACK_PROFILES[attackType];
  const shape = ATTACK_SHAPES[attackType];
  const weapon = getEquippedWeapon(world, attackerEid);
  Combat.attackRecovery[attackerEid] = profile.recovery;
  if (hasComponent(world, attackerEid, Stamina)) Stamina.current[attackerEid] -= cost;
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
