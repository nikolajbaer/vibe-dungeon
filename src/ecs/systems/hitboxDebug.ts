import * as THREE from "three";
import { getCombatHitboxColliders, getPendingSwingBoxes } from "./meleeCollision";
import type { CombatBodyPart, MeleeSwingBox } from "../../physics/world";

// Draws the *real* melee collision geometry meleeCollision.ts actually tests
// against -- a wireframe cylinder per combat hitbox (reading each collider's
// own live translation/rotation/radius/halfHeight straight from Rapier, so
// this can never drift out of sync with what a swing is really testing) and
// a wireframe box for every currently-active swing. A play-testing aid (the
// debug-menu toggle), not a gameplay system.

/** How long (seconds) a hitbox stays red after a scored hit before fading
 * back to white -- long enough to actually see on a real monitor, short
 * enough that a follow-up hit's own flash is still clearly a new event. */
const FLASH_SECONDS = 0.25;
const WHITE = 0xffffff;
const RED = 0xff0000;
const CYLINDER_SEGMENTS = 12;

let enabled = false;
const cylinderHelpers = new Map<string, THREE.LineSegments>(); // key: `${eid}:${part}`
const boxHelpers = new Map<number, THREE.LineSegments>(); // key: attackerEid
/** A swing's box after it's no longer pending (resolved or expired) --
 * kept around only so a landed hit's box can keep rendering, red, for its
 * flash's remaining lifetime instead of vanishing the instant it connects. */
const lastBoxByAttacker = new Map<number, MeleeSwingBox>();
/** Shared flash-timer namespace: `char:<eid>:<part>` and `weapon:<attackerEid>`. */
const flashRemaining = new Map<string, number>();

export function setHitboxDebugEnabled(value: boolean): void {
  enabled = value;
  if (!enabled) {
    for (const helper of cylinderHelpers.values()) disposeHelper(helper);
    for (const helper of boxHelpers.values()) disposeHelper(helper);
    cylinderHelpers.clear();
    boxHelpers.clear();
    lastBoxByAttacker.clear();
    flashRemaining.clear();
  }
}

export function isHitboxDebugEnabled(): boolean {
  return enabled;
}

/** Flashes the struck combatant's hitbox red -- call only for a hit that
 * actually lands unparried (mirrors `applyMeleeDamage`'s own "was this a
 * real, visible hit" gate, `mitigation === 0`, the same one that decides
 * whether to play the hit-reaction animation). Flashes just the struck
 * `part`'s own cylinder when known (the real swing-resolution path always
 * knows this); omitted entirely, flashes all three -- keeps this useful for
 * the handful of direct `applyMeleeDamage` calls in tests that have no real
 * swing (and thus no body part) behind them at all. */
export function flashCharacterHit(eid: number, part?: CombatBodyPart): void {
  const parts: CombatBodyPart[] = part ? [part] : ["head", "torso", "legs"];
  for (const p of parts) flashRemaining.set(`char:${eid}:${p}`, FLASH_SECONDS);
}

/** Flashes the attacker's just-landed swing box red. Ranged weapons never
 * call this -- `tryFireRanged`/`rangedCombatSystem` don't import this
 * module at all, matching the "not for ranged weapons" scope of the whole
 * visualization (melee-only `registerMeleeSwing`/`meleeCollisionSystem` are
 * this module's only source of boxes to draw in the first place). */
export function flashWeaponHit(attackerEid: number): void {
  flashRemaining.set(`weapon:${attackerEid}`, FLASH_SECONDS);
}

function disposeHelper(helper: THREE.LineSegments): void {
  helper.removeFromParent();
  helper.geometry.dispose();
  (helper.material as THREE.Material).dispose();
}

/** Decrements `key`'s flash timer by `dt` and colors `helper` accordingly --
 * shared by both the cylinder and box helpers below. */
function applyFlash(helper: THREE.LineSegments, key: string, dt: number): void {
  const remaining = Math.max(0, (flashRemaining.get(key) ?? 0) - dt);
  if (remaining > 0) flashRemaining.set(key, remaining); else flashRemaining.delete(key);
  (helper.material as THREE.LineBasicMaterial).color.setHex(remaining > 0 ? RED : WHITE);
}

function syncBoxHelper(attackerEid: number, box: MeleeSwingBox, scene: THREE.Scene, dt: number): void {
  let helper = boxHelpers.get(attackerEid);
  if (!helper) {
    helper = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: WHITE }));
    boxHelpers.set(attackerEid, helper);
    scene.add(helper);
  }
  // A swing's box dimensions can differ from the last one this same
  // attacker threw (a different weapon or attack type), so the geometry
  // itself -- not just position/rotation -- has to be rebuilt every time.
  helper.geometry.dispose();
  helper.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(box.hx * 2, box.hy * 2, box.hz * 2));
  helper.position.set(box.cx, box.cy, box.cz);
  helper.quaternion.set(box.rotation.x, box.rotation.y, box.rotation.z, box.rotation.w);
  applyFlash(helper, `weapon:${attackerEid}`, dt);
}

/** Keeps a white (red-while-flashing) wireframe cylinder over every combat
 * hitbox and a wireframe box over every currently-active melee swing --
 * both real collision geometry, read straight from Rapier, not an
 * approximation of it. No-ops entirely while disabled. */
export function hitboxDebugSystem(scene: THREE.Scene, dt: number): void {
  if (!enabled) return;

  const liveCylinderKeys = new Set<string>();
  for (const { eid, part, collider } of getCombatHitboxColliders()) {
    const key = `char:${eid}:${part}`;
    liveCylinderKeys.add(key);
    let helper = cylinderHelpers.get(key);
    if (!helper) {
      const geometry = new THREE.EdgesGeometry(new THREE.CylinderGeometry(collider.radius(), collider.radius(), collider.halfHeight() * 2, CYLINDER_SEGMENTS));
      helper = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: WHITE }));
      cylinderHelpers.set(key, helper);
      scene.add(helper);
    }
    const t = collider.translation();
    const r = collider.rotation();
    helper.position.set(t.x, t.y, t.z);
    helper.quaternion.set(r.x, r.y, r.z, r.w);
    applyFlash(helper, key, dt);
  }
  for (const [key, helper] of Array.from(cylinderHelpers)) {
    if (!liveCylinderKeys.has(key)) {
      disposeHelper(helper);
      cylinderHelpers.delete(key);
      flashRemaining.delete(key);
    }
  }

  const liveAttackerEids = new Set<number>();
  for (const { attackerEid, box } of getPendingSwingBoxes()) {
    liveAttackerEids.add(attackerEid);
    lastBoxByAttacker.set(attackerEid, box);
    syncBoxHelper(attackerEid, box, scene, dt);
  }
  for (const [attackerEid, box] of Array.from(lastBoxByAttacker)) {
    if (liveAttackerEids.has(attackerEid)) continue;
    // No longer pending (resolved or expired this tick or earlier) -- if it
    // just landed, flashWeaponHit already armed this key's timer, so keep
    // showing its last box, red, for that flash's remaining lifetime rather
    // than yanking it away the instant it connects. A miss (never flashed)
    // has nothing left to show and disappears immediately.
    if ((flashRemaining.get(`weapon:${attackerEid}`) ?? 0) > 0) {
      syncBoxHelper(attackerEid, box, scene, dt);
    } else {
      const helper = boxHelpers.get(attackerEid);
      if (helper) disposeHelper(helper);
      boxHelpers.delete(attackerEid);
      lastBoxByAttacker.delete(attackerEid);
    }
  }
}
