import { addComponent, hasComponent, query, type World } from "bitecs";
import { Carried, Combat, Dead, Health, Item, NPC, NpcState, PhysicsCollider, PlayerControlled, Practice, Rotation, Stamina } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import { NPC_REGISTRY } from "../../assets/npcRegistry";
import { cancelViewmodelCharge, isHandSlot, startViewmodelBlock, startViewmodelCharge, stopViewmodelBlock, triggerViewmodelSwing } from "./items";
import { triggerDeathCollapse, triggerHitReaction, triggerParry } from "./npcAnimation";
import { flashCharacterHit, flashWeaponHit } from "./hitboxDebug";
import { isHostileTo, registerMeleeSwing } from "./meleeCollision";
import type { CombatBodyPart } from "../../physics/world";
import type { AttackTypeMultipliers, ItemAssetDef } from "../../assets/types";

/** Two actions, Skyrim-style: `jab` is a quick, weak, instant tap; `swing`
 * is a held power attack -- press to start winding up (see
 * `tryStartSwingCharge`), release to actually throw it (`releaseSwingCharge`),
 * however long that wind-up is held. There used to be a third, `cross`, a
 * plain instant middle-ground attack -- deleted along with the wind-up
 * mechanic replacing it as the reason to ever pick the stronger option over
 * a jab (risk/reward via timing, not via a separate button). */
export type AttackType = "jab" | "swing";
export type WeaponClass = "unarmed" | "dagger" | "oneHanded" | "twoHanded";

export interface AttackProfile {
  damageMultiplier: number;
  recovery: number;
}

/** Shared balance table for players and, later, NPC attack selection.
 * `swing`'s numbers are the old, deleted `chop`'s unchanged -- it was
 * already the strongest/slowest option, exactly the role a held power
 * attack should play. */
export const ATTACK_PROFILES: Record<AttackType, AttackProfile> = {
  jab: { damageMultiplier: 0.7, recovery: 0.5 },
  swing: { damageMultiplier: 1.35, recovery: 1 },
};

/** The melee swing box's shape per attack type (see `meleeCollision.ts`'s
 * `registerMeleeSwing`) -- `reachMultiplier` scales the equipped weapon's
 * own `meleeReach` (or `UNARMED_REACH`), `width`/`height` are absolute
 * meters. A jab thrusts further and narrower; the charged swing trades
 * reach for a wide arc, wide enough to cleave more than one adjacent target
 * (`meleeCollisionSystem`). NPCs (npc.ts) have no jab/charged-swing
 * distinction of their own and use their own separate, neutral generic-swing
 * constants instead (`NPC_ATTACK_SHAPE` below) -- rebalancing what the
 * *player's* two attacks feel like should never silently reshape every
 * NPC's swing too. */
export const ATTACK_SHAPES: Record<AttackType, { reachMultiplier: number; width: number; height: number }> = {
  jab: { reachMultiplier: 1.15, width: 0.5, height: 1.0 },
  swing: { reachMultiplier: 0.85, width: 1.3, height: 1.3 },
};

/** How long (seconds) each attack type's swing box stays active and able to
 * land a hit, once thrown -- a fraction of the attack's own `recovery`
 * above, since the box only needs to cover the actual swing, not the whole
 * windup-to-ready cycle (and, for `swing`, not the held charge either --
 * this only starts counting down from the moment it's released). */
export const ATTACK_ACTIVE_WINDOW: Record<AttackType, number> = {
  jab: 0.15,
  swing: 0.25,
};

/** NPCs have no jab/charged-swing distinction of their own -- every
 * aggressive NPC's single generic attack (npc.ts's `updateAggressive`)
 * reuses this one neutral shape/timing/stamina cost, kept as its own
 * constants independent of the player's own `ATTACK_SHAPES`/
 * `ATTACK_ACTIVE_WINDOW`/`ATTACK_STAMINA_COST` so that simplifying or
 * rebalancing the player's attacks (like deleting `cross` in favor of a
 * held `swing`, above) never silently reshapes or re-costs every NPC's
 * swing too. These are the old, deleted `cross`'s numbers, unchanged. */
export const NPC_ATTACK_SHAPE = { reachMultiplier: 1.0, width: 0.8, height: 1.1 };
export const NPC_ATTACK_ACTIVE_WINDOW = 0.2;
export const NPC_ATTACK_STAMINA_COST = 12;

/** Chance a landed, non-lethal ranged hit staggers its NPC target (see
 * `applyRangedDamage`'s own `NPC.staggerRemaining` roll) -- a flat 20% for
 * now, kept as its own named constant since it's an obvious future skill/
 * perk knob (e.g. a marksmanship upgrade boosting it) rather than
 * something to leave as a magic number inline. Melee never staggers -- this
 * is bolt-specific, matching how getting shot reads as more disruptive than
 * a blade's mitigated-by-blocking hit. */
export const RANGED_STAGGER_CHANCE = 0.2;
/** Seconds an NPC stagger freezes its AI for (see
 * `NPC.staggerRemaining`/`npcSystem`) -- long enough to read as a real
 * punish, short enough not to trivialize a fight by itself. */
export const RANGED_STAGGER_SECONDS = 1;

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
  // A two-handed reach weapon (the quarterstaff) trades some of a
  // one-handed weapon's block strength for range/reach elsewhere in its
  // stats -- still a real weapon block, well above dagger, just not the
  // sword's best-in-class guard.
  twoHanded: 0.65,
};

/** Stamina cost of each attack type -- roughly tracks the balance table
 * above (`swing` is the power-attack analog: slow, strong, and the most
 * expensive; charged by *holding*, not by paying more up front -- the cost
 * is still only ever deducted once, on release). Insufficient stamina
 * simply refuses the attack outright (`tryMeleeAttack`/`tryStartSwingCharge`
 * return false), the same as being on cooldown. Sized against the player's
 * 100 max stamina (game.ts's `PLAYER_MAX_STAMINA`) so throwing out attacks
 * back-to-back burns out fast: five jabs in a row exactly zeroes it (5*20),
 * three swings leaves only 1 (100-33-33-33), one short of a fourth --
 * stamina has to actually be managed, not just a light tax on spam. */
export const ATTACK_STAMINA_COST: Record<AttackType, number> = {
  jab: 20,
  swing: 33,
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
  /** `ItemAssetDef.attackMultipliers`, verbatim (`undefined` when the
   * weapon doesn't declare any) -- see `multiplierFor` below for how a
   * specific field is read out of this per attack type, defaulting to 1. */
  attackMultipliers: ItemAssetDef["attackMultipliers"];
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
      weaponClass: def.twoHanded ? "twoHanded" : def.id === "dagger" ? "dagger" : "oneHanded",
      attackMultipliers: def.attackMultipliers,
    };
    if (!best || candidate.damage > best.damage) best = candidate;
  }
  return best;
}

/** Reads one `AttackTypeMultipliers` field for `attackType` off `weapon`,
 * defaulting to 1 (no change) when the weapon has no `attackMultipliers`
 * at all, no entry for this attack type, or leaves this specific field
 * unset -- see that field's own doc comment (types.ts) for the full
 * default-stacking story. */
function multiplierFor(weapon: EquippedWeapon | undefined, attackType: AttackType, key: keyof AttackTypeMultipliers): number {
  return weapon?.attackMultipliers?.[attackType]?.[key] ?? 1;
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

/** Stops a freshly-dead character's own movement collider from blocking
 * anyone else -- without this, `CHARACTER_GROUPS` making characters solid
 * to each other (physics/world.ts) means a corpse permanently occupies its
 * death spot as an obstacle, which a living character can shove up against
 * but never truly reach (an interact raycast at point-blank range can end
 * up just short of a corpse it should be standing right next to). Zeroing
 * *this* collider's own collision groups is one-directional: nothing else
 * treats it as an obstacle any more, but the corpse's own still-running
 * `characterSystem` query (which always uses the constant `CHARACTER_GROUPS`
 * for what *it* looks for, independent of its own collider's group) keeps
 * finding the floor and staying grounded exactly as before. */
function disableCorpseCollision(targetEid: number): void {
  PhysicsCollider[targetEid]?.setCollisionGroups(0);
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
 * with the real-time state of the block input (`keyboard.isDown`, or the
 * touch block button's own real held state), not edge-triggered like the
 * old `tryParry` was, since block needs to track "still held" every frame,
 * not just the moment it started.
 *
 * Raising block (the `held && !already blocking` transition) is refused
 * mid-attack-recovery -- the same "can't parry mid-swing" gate the old
 * timed parry had -- or mid-charge (can't raise a shield with both hands
 * committed to winding up a swing; see `tryStartSwingCharge`) -- and raises
 * the weapon into a held guard pose (`startViewmodelBlock`) that stays up
 * for as long as blocking does; releasing it (`!held`) lowers that pose
 * back down (`stopViewmodelBlock`) and always succeeds. Holding it down
 * across frames where it was already up is a no-op, not a repeated trigger.
 */
export function setBlocking(world: World, eid: number, held: boolean): void {
  if (!hasComponent(world, eid, Combat)) return;
  const wasBlocking = Combat.blocking[eid] > 0;
  if (!held) {
    if (wasBlocking) {
      const weapon = getEquippedWeapon(world, eid);
      if (weapon) stopViewmodelBlock(weapon.itemEid);
    }
    Combat.blocking[eid] = 0;
    return;
  }
  if (wasBlocking || Combat.attackRecovery[eid] > 0 || Combat.charging[eid] > 0) return;
  Combat.blocking[eid] = 1;
  const weapon = getEquippedWeapon(world, eid);
  if (weapon) startViewmodelBlock(weapon.itemEid);
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
    disableCorpseCollision(targetEid);
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
  // Melee's own team check lives in meleeCollisionSystem (it decides which
  // targets a swing even resolves against in the first place); a bolt has
  // no equivalent upstream filter, so it's checked here instead. Never
  // affects player-vs-NPC combat -- the player is always team 0 and every
  // NPC defaults to team 1, so they're never equal -- only NPC-vs-NPC.
  if (attackerEid !== undefined && !isHostileTo(world, attackerEid, targetEid)) return 0;
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
    disableCorpseCollision(targetEid);
    triggerDeathCollapse(targetEid);
  } else {
    triggerHitReaction(targetEid);
    // Bolt-only stagger (never melee -- see RANGED_STAGGER_CHANCE's own doc
    // comment): a flat roll per landed hit, independent of the hit-reaction
    // flinch above (that's just the visual; this is what actually freezes
    // the NPC's AI for RANGED_STAGGER_SECONDS, in npcSystem).
    if (hasComponent(world, targetEid, NPC) && Math.random() < RANGED_STAGGER_CHANCE) {
      NPC.staggerRemaining[targetEid] = RANGED_STAGGER_SECONDS;
    }
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
 * enough stamina for this attack type's `ATTACK_STAMINA_COST`.
 *
 * `attackType: "swing"` is normally reached through `releaseSwingCharge`
 * below, never called directly -- game.ts's own input handling always goes
 * through the charge/release pair for a real held power attack. Calling it
 * directly (a debug hook, a test) still works, just without ever having
 * shown the held wind-up pose first: `triggerViewmodelSwing` notices there's
 * no charge already in flight for the weapon and plays the whole
 * windup-and-swing motion as one immediate clip instead. */
export function tryMeleeAttack(world: World, attackType: AttackType = "jab"): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined || Combat.attackRecovery[attackerEid] > 0 || Combat.blocking[attackerEid] > 0) return false;
  const weapon = getEquippedWeapon(world, attackerEid);
  const cost = ATTACK_STAMINA_COST[attackType] * multiplierFor(weapon, attackType, "stamina");
  if (hasComponent(world, attackerEid, Stamina) && Stamina.current[attackerEid] < cost) return false;

  const profile = ATTACK_PROFILES[attackType];
  const shape = ATTACK_SHAPES[attackType];
  const recovery = profile.recovery * multiplierFor(weapon, attackType, "recovery");
  Combat.attackRecovery[attackerEid] = recovery;
  if (hasComponent(world, attackerEid, Stamina)) Stamina.current[attackerEid] -= cost;
  if (weapon) triggerViewmodelSwing(weapon.itemEid, attackType, recovery);

  const reach = (weapon?.reach ?? UNARMED_REACH) * shape.reachMultiplier * multiplierFor(weapon, attackType, "reach");
  const damage = Math.round((weapon?.damage ?? UNARMED_DAMAGE) * profile.damageMultiplier * multiplierFor(weapon, attackType, "damage"));
  // The player has no body mesh at all (`Object3DRef` is the camera --
  // see game.ts), so `Rotation.yaw` here means exactly what inputSystem's
  // own forward vector means: local -Z at yaw 0 (see registerMeleeSwing's
  // doc comment for why this can't be assumed inside that shared function).
  const yaw = Rotation.yaw[attackerEid];
  registerMeleeSwing(attackerEid, -Math.sin(yaw), -Math.cos(yaw), reach, shape.width, shape.height, damage, ATTACK_ACTIVE_WINDOW[attackType]);
  return true;
}

/**
 * Starts charging the held power attack (Skyrim-style: hold to wind up,
 * release to throw it, however long that wind-up ends up being) -- called
 * on press. Raises the equipped weapon into a held windup pose
 * (`items.ts`'s `startViewmodelCharge`) and leaves it there indefinitely,
 * doing nothing else, until `releaseSwingCharge` actually throws the swing
 * or `cancelSwingCharge` drops it. Refuses under the same conditions as any
 * other attack -- on cooldown, blocking, not enough stamina for `swing`'s
 * cost -- plus already charging (holding the button/key down across frames
 * is a no-op here, not a repeated attempt).
 */
export function tryStartSwingCharge(world: World): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined || Combat.attackRecovery[attackerEid] > 0 || Combat.blocking[attackerEid] > 0 || Combat.charging[attackerEid] > 0) return false;
  const weapon = getEquippedWeapon(world, attackerEid);
  const cost = ATTACK_STAMINA_COST.swing * multiplierFor(weapon, "swing", "stamina");
  if (hasComponent(world, attackerEid, Stamina) && Stamina.current[attackerEid] < cost) return false;
  Combat.charging[attackerEid] = 1;
  if (weapon) startViewmodelCharge(weapon.itemEid);
  return true;
}

/**
 * Releases a charge started by `tryStartSwingCharge`, actually throwing the
 * swing through the normal `tryMeleeAttack` resolution path (recovery,
 * stamina deduction, the real hit-detection box -- all of it happens here,
 * not at charge-start, in case anything changed while it was held). A
 * stray release with nothing charging (already cancelled, or one that
 * arrives twice) is a harmless no-op.
 */
export function releaseSwingCharge(world: World): boolean {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined || !(Combat.charging[attackerEid] > 0)) return false;
  Combat.charging[attackerEid] = 0;
  return tryMeleeAttack(world, "swing");
}

/**
 * Drops a charge started by `tryStartSwingCharge` without ever swinging --
 * e.g. a modal (dialogue, death) opening mid-charge (game.ts). No stamina
 * was ever spent to reach this point (that only happens on an actual
 * release), so there's nothing to refund; this just snaps the viewmodel
 * back to its resting pose (`items.ts`'s `cancelViewmodelCharge`).
 */
export function cancelSwingCharge(world: World): void {
  const [attackerEid] = query(world, [PlayerControlled, Combat]);
  if (attackerEid === undefined || !(Combat.charging[attackerEid] > 0)) return;
  Combat.charging[attackerEid] = 0;
  const weapon = getEquippedWeapon(world, attackerEid);
  if (weapon) cancelViewmodelCharge(weapon.itemEid);
}
