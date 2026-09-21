import * as THREE from "three";
import { hasComponent, query, type World } from "bitecs";
import { Carried, Dead, Health, Item, Object3DRef, PlayerControlled, Viewmodel } from "../components";
import { ITEM_REGISTRY } from "../../assets/itemRegistry";
import { isHandSlot } from "./items";
import { getNpcWeaponMesh } from "./npcAnimation";

/** How long (seconds) a hitbox stays red after a scored hit before fading
 * back to white -- long enough to actually see on a real monitor, short
 * enough that a follow-up hit's own flash is still clearly a new event. */
const FLASH_SECONDS = 0.25;
const WHITE = 0xffffff;
const RED = 0xff0000;

let enabled = false;
/** `char:<eid>` for a combatant's own bounding box, `weapon:<eid>` for the
 * melee weapon *currently equipped by* combatant `eid` -- keyed by the
 * wielder, not the item, since only one such box exists per combatant at a
 * time and the wielder's eid is what a scored hit already carries. */
const helpers = new Map<string, THREE.BoxHelper>();
const flashRemaining = new Map<string, number>();

export function setHitboxDebugEnabled(value: boolean): void {
  enabled = value;
  if (!enabled) {
    for (const helper of helpers.values()) helper.removeFromParent();
    helpers.clear();
    flashRemaining.clear();
  }
}

export function isHitboxDebugEnabled(): boolean {
  return enabled;
}

/** Flashes the struck combatant's own hitbox red -- call only for a hit that
 * actually lands unparried (mirrors `applyMeleeDamage`'s own "was this a
 * real, visible hit" gate, `mitigation === 0`, the same one that decides
 * whether to play the hit-reaction animation). */
export function flashCharacterHit(eid: number): void {
  flashRemaining.set(`char:${eid}`, FLASH_SECONDS);
}

/** Flashes the attacker's currently-equipped melee weapon red. Ranged
 * weapons never call this -- `tryFireRanged`/`rangedCombatSystem` don't
 * import this module at all, matching the "not for ranged weapons" scope of
 * the visualization itself (see `meleeWeaponMesh` below, which only ever
 * finds a weapon with `meleeDamage`, never a `rangedWeapon`). */
export function flashWeaponHit(attackerEid: number): void {
  flashRemaining.set(`weapon:${attackerEid}`, FLASH_SECONDS);
}

/** The world mesh of whatever melee weapon `eid` currently has equipped in
 * a hand slot, or `undefined` if it has none equipped (unarmed, or only a
 * non-melee item like the lantern or crossbow). Deliberately separate from
 * combat.ts's own `getEquippedWeapon` (which also resolves damage/weapon
 * class) rather than exported and shared, so this debug-only module and the
 * real combat system don't end up importing each other. */
function meleeWeaponMesh(world: World, eid: number): THREE.Object3D | undefined {
  let best: { itemEid: number; damage: number } | undefined;
  for (const itemEid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[itemEid] !== eid || !isHandSlot(Carried.slot[itemEid])) continue;
    const def = ITEM_REGISTRY[Item.itemTypeId[itemEid]];
    if (def?.meleeDamage === undefined) continue;
    if (!best || def.meleeDamage > best.damage) best = { itemEid, damage: def.meleeDamage };
  }
  if (!best) return undefined;
  if (hasComponent(world, eid, PlayerControlled)) return Viewmodel[best.itemEid];
  // An NPC's weapon mesh lives inside its own rig (see `createAnimatedNpcMesh`
  // in npcAnimation.ts), toggled visible only once actually drawn -- a
  // sheathed weapon isn't "equipped" in any hitbox-worthy sense yet.
  const mesh = getNpcWeaponMesh(eid);
  return mesh?.visible ? mesh : undefined;
}

function syncHelper(key: string, target: THREE.Object3D | undefined, scene: THREE.Scene, dt: number): void {
  let helper = helpers.get(key);
  if (!target) {
    if (helper) { helper.removeFromParent(); helpers.delete(key); flashRemaining.delete(key); }
    return;
  }
  if (!helper) {
    helper = new THREE.BoxHelper(target, WHITE);
    helpers.set(key, helper);
    scene.add(helper);
  }
  helper.update();
  const remaining = Math.max(0, (flashRemaining.get(key) ?? 0) - dt);
  if (remaining > 0) flashRemaining.set(key, remaining); else flashRemaining.delete(key);
  (helper.material as THREE.LineBasicMaterial).color.setHex(remaining > 0 ? RED : WHITE);
}

/** Keeps a white (red-while-flashing) wireframe box over every living
 * combatant and, separately, over whatever melee weapon each currently has
 * equipped -- a play-testing aid (per the debug-menu toggle) for seeing
 * exactly what `tryMeleeAttack`'s raycast is actually going to hit, not a
 * gameplay system. No-ops entirely while disabled. */
export function hitboxDebugSystem(world: World, scene: THREE.Scene, dt: number): void {
  if (!enabled) return;
  const live = new Set<string>();
  for (const eid of query(world, [Health, Object3DRef])) {
    if (hasComponent(world, eid, Dead)) continue;
    const obj = Object3DRef[eid];
    if (!obj) continue;
    // The player's own `Object3DRef` is the camera itself (see game.ts),
    // not a visible body -- nothing to box around, and no player would ever
    // see their own hitbox in first person anyway. Their weapon (viewmodel)
    // is still worth showing below.
    if (!hasComponent(world, eid, PlayerControlled)) {
      const charKey = `char:${eid}`;
      live.add(charKey);
      syncHelper(charKey, obj, scene, dt);
    }

    const weaponKey = `weapon:${eid}`;
    const weapon = meleeWeaponMesh(world, eid);
    if (weapon) live.add(weaponKey);
    syncHelper(weaponKey, weapon, scene, dt);
  }
  for (const key of Array.from(helpers.keys())) {
    if (!live.has(key)) syncHelper(key, undefined, scene, dt);
  }
}
