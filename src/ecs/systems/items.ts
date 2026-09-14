import * as THREE from "three";
import { addComponent, hasComponent, query, type World } from "bitecs";
import { Carried, Item, Object3DRef, Viewmodel, type CarriedSlot } from "../components";
import { ITEM_TYPES } from "../../items/itemTypes";
import { createSwordMesh } from "../../items/swordModel";
import { createLanternMesh, LANTERN_LIGHT_LOCAL_POSITION } from "../../items/lanternModel";

export type HandSlot = "hand-left" | "hand-right";

/** Exported for combat.ts (checking whether an item is equipped in *a* hand,
 * not which one) as well as internal use here. */
export function isHandSlot(slot: CarriedSlot): slot is HandSlot {
  return slot === "hand-left" || slot === "hand-right";
}

/**
 * Picks up a world item: called from the `Item` branch of `tryInteract`
 * (doors.ts) when the interact raycast hits an `Item` entity that has no
 * `Carried` component yet. Adds `Carried` (slot `"inventory"`, owned by
 * `ownerEid`) and hides the item's in-world pickup mesh — hidden rather than
 * removed from the scene/ECS so a future "drop" could just flip it back to
 * visible, and so it stops showing up in `tryInteract`'s own interactable
 * list (that list explicitly skips any `Item` that already has `Carried`).
 */
export function pickUpItem(world: World, itemEid: number, ownerEid: number): void {
  addComponent(world, itemEid, Carried);
  Carried.ownerEid[itemEid] = ownerEid;
  Carried.slot[itemEid] = "inventory";

  const obj = Object3DRef[itemEid];
  if (obj) obj.visible = false;
}

/** Camera-relative offsets for each hand's viewmodel — lower corners of the
 * view, angled slightly inward, so a mesh in either hand reads as "held" up
 * close to the camera without covering the center of the screen.
 *
 * Retuned for issue #65's new sword shape (see swordModel.ts): unlike the
 * old flat symmetric plank, the sword mesh's origin sits at its grip and
 * most of its length is the blade extending away from that origin, so a
 * naive Euler tilt (the old values) left almost the entire weapon — blade,
 * crossguard, grip — off-frame, with only the tip poking into view. These
 * `rot` values instead came from actually posing the mesh: put its grip at
 * `pos`, call `Object3D.prototype.lookAt` to aim the blade at a point up and
 * into the scene ahead of the camera, screenshot it, and read back the
 * resulting Euler angles (see this issue's PR description for the exact
 * before/after renders) — repeat for any future viewmodel mesh whose shape
 * changes enough to need this redone, rather than hand-picking numbers. */
const VIEWMODEL_OFFSET: Record<HandSlot, { pos: THREE.Vector3Tuple; rot: THREE.EulerTuple }> = {
  "hand-right": { pos: [0.26, -0.3, -0.4], rot: [-2.6135, -0.4198, -2.9082] },
  "hand-left": { pos: [-0.26, -0.3, -0.4], rot: [-2.6135, 0.4198, 2.9082] },
};

// Issue #75: lantern viewmodel light params. Sanity-checked against
// tileBuilder.ts's `TORCH_LIGHT_*` (a wall-mounted torch: color 0xffaa55,
// intensity 1.4, range 6, decay 2) and against a genuinely dark stretch of
// corridor in-game (no nearby torch) — see this issue's PR description for
// the before/after pixel-brightness sample. A shade warmer/whiter than the
// torch (0xffd9a0 vs 0xffaa55) so the two read as distinct light sources
// side by side, slightly brighter/longer-reaching than one torch since,
// unlike a torch, this is meant to be the player's *only* light source deep
// in corridors that don't get one — but still low enough, at the range the
// mesh actually sits from the camera, to avoid blowing out nearby geometry
// under this scene's ACESFilmicToneMapping (game.ts).
const LANTERN_LIGHT_COLOR = 0xffd9a0;
const LANTERN_LIGHT_INTENSITY = 1.6;
const LANTERN_LIGHT_RANGE = 7; // meters
const LANTERN_VIEWMODEL_SCALE = 0.8; // matches the sword's own "shrink a touch for the closer camera" scale-down
const LANTERN_VIEWMODEL_TILT = Math.PI / 4; // see its use below

/** Builds a first-person viewmodel mesh for an item type, or `undefined` if
 * that type has no viewmodel look defined yet (only equippable — `slot:
 * "hand"` — item types need one). Placeholder-grade geometry only, matching
 * the world-item meshes in game.ts (no texture assets). */
function createViewmodelMesh(itemTypeId: string): THREE.Object3D | undefined {
  if (itemTypeId === "sword") {
    // Same shared shape as the world pickup mesh (game.ts), scaled down a
    // touch since it sits much closer to the camera here — an unscaled
    // sword held at VIEWMODEL_OFFSET's distance reads as oversized.
    const mesh = createSwordMesh();
    mesh.scale.setScalar(0.85);
    return mesh;
  }
  if (itemTypeId === "lantern") {
    // Issue #75: a `THREE.Group` holding the lantern mesh *and* a real
    // `THREE.PointLight`, so equipItem's `camera.add(mesh)` /
    // unequipItem's `mesh.removeFromParent()` (this file) turn the light on
    // and off for free — nothing else needs to know the lantern is lit.
    // The *world pickup* mesh (game.ts, via the same `createLanternMesh`)
    // never goes through this function, so it never gets a live light —
    // only an equipped lantern actually shines, per the issue.
    const mesh = createLanternMesh();
    mesh.scale.setScalar(LANTERN_VIEWMODEL_SCALE);
    // In-hand-only framing tilt (found the same way swordModel.ts's header
    // comment describes for VIEWMODEL_OFFSET's rot: render candidate
    // angles at the real hand offset/scale and pick by eye) — set on
    // `mesh` itself, a child of the returned group, rather than baked into
    // `createLanternMesh`'s shared geometry, so the *world pickup* mesh
    // (game.ts, same factory function) stays upright; only the viewmodel
    // gets tilted. Unrotated (matching the world mesh) reads as a mostly
    // edge-on sliver at VIEWMODEL_OFFSET's close, off-to-the-side hand
    // position — this angles the lantern's front/handle enough to actually
    // read as a lantern there.
    mesh.rotation.x = LANTERN_VIEWMODEL_TILT;

    const light = new THREE.PointLight(LANTERN_LIGHT_COLOR, LANTERN_LIGHT_INTENSITY, LANTERN_LIGHT_RANGE, 2);
    // `mesh` is scaled but sits at the group's own origin, so the light's
    // local position needs no rescaling: `LANTERN_LIGHT_LOCAL_POSITION` is
    // `(0,0,0)` (the mesh's own origin, unaffected by scaling about it).
    light.position.copy(LANTERN_LIGHT_LOCAL_POSITION);

    const group = new THREE.Group();
    group.add(mesh, light);
    return group;
  }
  return undefined;
}

/**
 * Finds an open hand slot (`hand-left` before `hand-right`) among
 * everything `ownerEid` currently carries, or `undefined` if both are
 * occupied.
 */
export function findOpenHandSlot(world: World, ownerEid: number): HandSlot | undefined {
  let leftOpen = true;
  let rightOpen = true;
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] !== ownerEid) continue;
    const slot = Carried.slot[eid];
    if (slot === "hand-left") leftOpen = false;
    else if (slot === "hand-right") rightOpen = false;
  }
  return leftOpen ? "hand-left" : rightOpen ? "hand-right" : undefined;
}

/**
 * Equips a carried, equippable item into a specific hand slot: moves
 * `Carried.slot` there and, if the item type has a viewmodel look, attaches
 * it directly to the camera (`camera.add`, not the scene) at a fixed
 * camera-relative offset (see `VIEWMODEL_OFFSET`) — see `Viewmodel` in
 * components.ts for why this is a separate mesh from the item's in-world
 * `Object3DRef`. No-ops if the item isn't carried or isn't a `slot: "hand"`
 * item type. Does not check whether `slot` is actually open — callers
 * (`equipToOpenHandSlot` below) are expected to have picked an open one.
 */
export function equipItem(world: World, camera: THREE.Camera, itemEid: number, slot: HandSlot): void {
  if (!hasComponent(world, itemEid, Carried)) return;
  const itemType = ITEM_TYPES[Item.itemTypeId[itemEid]];
  if (!itemType || itemType.slot !== "hand") return;

  Carried.slot[itemEid] = slot;

  const mesh = createViewmodelMesh(itemType.id);
  if (mesh) {
    const { pos, rot } = VIEWMODEL_OFFSET[slot];
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    camera.add(mesh);
    Viewmodel[itemEid] = mesh;
  }
}

/**
 * Equips `itemEid` into whichever hand slot is open for its owner, or does
 * nothing if both hands are already full (or the item can't be equipped at
 * all). This is what the inventory UI's "tap an inventory item to equip it"
 * action actually calls (see `src/inventory/store.ts`) — the UI never picks
 * a slot itself. Returns whether it actually equipped anything.
 */
export function equipToOpenHandSlot(world: World, camera: THREE.Camera, itemEid: number): boolean {
  if (!hasComponent(world, itemEid, Carried)) return false;
  const ownerEid = Carried.ownerEid[itemEid];
  const slot = findOpenHandSlot(world, ownerEid);
  if (!slot) return false;
  equipItem(world, camera, itemEid, slot);
  return true;
}

/**
 * Unequips a carried item back to the inventory list, removing its
 * viewmodel mesh (if it had one) from the camera. No-ops for an item that
 * isn't carried or isn't currently in a hand slot.
 */
export function unequipItem(world: World, itemEid: number): void {
  if (!hasComponent(world, itemEid, Carried)) return;
  if (!isHandSlot(Carried.slot[itemEid])) return;

  Carried.slot[itemEid] = "inventory";

  const mesh = Viewmodel[itemEid];
  if (mesh) {
    mesh.removeFromParent();
    Viewmodel[itemEid] = undefined;
  }
}

const SWING_DURATION = 0.22; // seconds, roundtrip

interface SwingState {
  itemEid: number;
  elapsed: number;
}

/** Items currently mid-swing (see `triggerViewmodelSwing`/
 * `viewmodelSwingSystem` below) — a plain array since there's realistically
 * at most one or two entries (one per hand) at once. */
const activeSwings: SwingState[] = [];

/** Starts (or restarts, if already swinging) a weapon-swing animation for
 * `itemEid`'s viewmodel — called from `tryMeleeAttack` (combat.ts) on every
 * attack attempt, hit or miss, since the swing is what the player *did*,
 * not a reaction to a hit. No-ops harmlessly next frame in
 * `viewmodelSwingSystem` if the item turns out not to have a viewmodel
 * (unarmed) or gets unequipped mid-swing. */
export function triggerViewmodelSwing(itemEid: number): void {
  const existing = activeSwings.find((s) => s.itemEid === itemEid);
  if (existing) existing.elapsed = 0;
  else activeSwings.push({ itemEid, elapsed: 0 });
}

/**
 * Advances every active weapon swing (issue: sword swing animation),
 * animating each swinging item's `Viewmodel` mesh in an arc away from its
 * resting `VIEWMODEL_OFFSET` pose and back — a forward/downward chop that
 * eases in and out via `sin(t * PI)` (0 at both ends, 1 at the midpoint) so
 * it doesn't snap at either end. Reads `Carried.slot` each frame (rather
 * than caching the hand at swing-start) so re-equipping mid-swing doesn't
 * leave the mesh animating around a stale offset. Must run every frame
 * (called unconditionally from game.ts's loop, not just when attacking) so
 * a swing already in progress keeps advancing on frames with no new input.
 */
export function viewmodelSwingSystem(dt: number): void {
  for (let i = activeSwings.length - 1; i >= 0; i--) {
    const swing = activeSwings[i];
    const slot = Carried.slot[swing.itemEid];
    const mesh = Viewmodel[swing.itemEid];
    if (!mesh || !isHandSlot(slot)) {
      activeSwings.splice(i, 1);
      continue;
    }

    swing.elapsed += dt;
    const t = Math.min(1, swing.elapsed / SWING_DURATION);
    const arc = Math.sin(t * Math.PI);
    const side = slot === "hand-right" ? -1 : 1;
    const base = VIEWMODEL_OFFSET[slot];

    mesh.position.set(base.pos[0], base.pos[1] - arc * 0.05, base.pos[2] - arc * 0.2);
    mesh.rotation.set(base.rot[0] - arc * 0.9, base.rot[1], base.rot[2] + side * arc * 0.6);

    if (t >= 1) activeSwings.splice(i, 1);
  }
}
