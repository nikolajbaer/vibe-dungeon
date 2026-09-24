import * as THREE from "three";
import { hasComponent, query, type World } from "bitecs";
import { Dead, DeathSector, Door, DoorState, Object3DRef, PhysicsBody, Position, NPC, Item, Carried, PlayerControlled, Readable, Container } from "../components";
import { toggleNpcFollow } from "./npc";
import { pickUpItem, type PickUpResult } from "./items";
import { NPC_REGISTRY } from "../../assets/npcRegistry";
import { dialogueStore } from "../../dialogue/store";
import { hudStore } from "../../hud/store";
import { noticeStore } from "../../notice/store";
import { containerStore } from "../../container/store";
import { doorMaterial } from "../../level/materials";

const OPEN_DURATION = 0.8; // seconds for a door to fully open
const INTERACT_RANGE = 3; // meters
const OPEN_ANGLE = THREE.MathUtils.degToRad(100); // slightly past perpendicular

/** Items are small and, now that they're simulated rigid bodies (see the
 * Rapier physics migration), usually end up resting on the floor rather than
 * at a convenient eye-level height — well below where a camera-forward
 * raycast naturally points. Requiring the player to precisely aim down at a
 * small object near their feet felt bad, so any uncarried item within this
 * (horizontal) distance of the player is pickupable by pressing/tapping
 * interact at all, whether or not the camera is actually aimed at it — see
 * `tryPickupNearbyItem` below. This is in addition to, not instead of, the
 * aim-based raycast: an item further away is still pickupable by looking
 * straight at it, same as a door or NPC. */
const ITEM_PICKUP_RANGE = 1.5; // meters (~5 feet)

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Advances any door leaf currently opening or closing, swinging both its
 * hinge Group (Object3DRef) and its kinematic physics body (PhysicsBody)
 * around Y between closed (0 rad) and `hingeSign * OPEN_ANGLE`. Driving both
 * from the same angle is what keeps the collider exactly where the slab is
 * drawn, so a half-open door blocks exactly as much of the doorway as it
 * looks like it does. Opening and closing share the same progress/easing
 * math, just moving it in opposite directions — that's what retired the old
 * "treat a door as non-solid once it's 90% open" fudge, which only existed
 * because a fixed AABB at the leaf's closed position could never move aside. */
export function doorAnimationSystem(world: World, dt: number): void {
  for (const eid of query(world, [Door, Object3DRef])) {
    const state = Door.state[eid];
    if (state !== DoorState.OPENING && state !== DoorState.CLOSING) continue;

    const direction = state === DoorState.OPENING ? 1 : -1;
    Door.progress[eid] = Math.min(1, Math.max(0, Door.progress[eid] + (direction * dt) / OPEN_DURATION));
    const angle = Door.hingeSign[eid] * OPEN_ANGLE * easeOutCubic(Door.progress[eid]);

    const obj = Object3DRef[eid];
    if (obj) obj.rotation.y = angle;

    // Rapier takes a quaternion; these leaves only ever rotate about Y, so
    // building it directly is cheaper and clearer than routing through a
    // THREE.Quaternion just to copy its components back out.
    const body = PhysicsBody[eid];
    if (body) body.setNextKinematicRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });

    if (state === DoorState.OPENING && Door.progress[eid] >= 1) {
      Door.state[eid] = DoorState.OPEN;
    } else if (state === DoorState.CLOSING && Door.progress[eid] <= 0) {
      Door.state[eid] = DoorState.CLOSED;
    }
  }
}

const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();
const ndc = new THREE.Vector2();

/**
 * Interaction trigger (documented in README under Design Notes so later
 * interaction work builds on the same convention): a raycast hits the
 * nearest interactable within INTERACT_RANGE meters and dispatches on which
 * ECS component the hit entity carries — `Door` toggles it open/closed (see
 * `toggleDoor` below); a dead `NPC` (any archetype) opens the loot panel a
 * barrel does (`containerStore.open`, see `NpcSpawn.contents`); a living one
 * dispatches on its archetype (`NPC_REGISTRY`, `NPC.archetypeId`): an
 * aggressive one ignores the interact entirely (nothing to talk to), a
 * docile one with a `dialogueId` opens that tree (`dialogueStore.open`, see
 * `src/dialogue/`), and a docile one without falls back to the original
 * `toggleNpcFollow` demo toggle; an uncarried
 * `Item` (issue #39) is picked up (see `pickUpItem` in items.ts) — this
 * takes priority over `Readable` below, so a readable item (a scroll) is
 * always picked up rather than read in place; a fixture-only `Readable`
 * (a poster) opens the paged notice reader (`noticeStore.open`, see
 * `src/notice/`) — a readable item is instead read by tapping it in the
 * inventory list (`InventoryList.tsx`); a `Container` (a barrel) opens the
 * container UI (`containerStore.open`, see `src/container/`). Callers
 * decide *when* to fire this — desktop on `KeyE`, touch on a tap outside
 * both joystick pads (see game.ts).
 *
 * The raycast's *origin and direction* depend on `screenPoint`:
 *
 * - **Omitted** (desktop's `KeyE`): straight out from the camera center —
 *   the reticle. This is the only option once pointer lock has engaged,
 *   since pointer lock hides the cursor and only ever reports relative
 *   mouse deltas; there is no real "where on screen did you click" to work
 *   with, which is exactly why FPS games converge on a fixed center
 *   reticle in the first place.
 * - **Given** (a touch tap): `THREE.Raycaster.setFromCamera`, unprojected
 *   through wherever the tap actually landed. A touch, unlike a locked
 *   mouse, always carries a real screen position, so tap-to-interact can
 *   target exactly what's under the finger — a door or NPC off to the side
 *   of the screen doesn't need turning the character to face it first. Note
 *   this is genuinely different math from the reticle case, not the same
 *   ray in disguise: at the exact screen center the two happen to coincide
 *   (which is what lets a center-tap in a touch test double as "look then
 *   interact"), but anywhere else they diverge because a perspective
 *   camera's rays fan out from its position rather than running parallel.
 *
 * Either way `raycaster.far = INTERACT_RANGE` bounds how far the ray
 * reaches, which already gives tap-to-interact the same "must be within
 * reach" limit a distance check against the player's own position would —
 * no separate proximity prefilter needed on top of it.
 *
 * The raycast targets every interactable's `Object3DRef` in one combined
 * list rather than running a separate raycast per interactable type —
 * `intersectObjects` already sorts by distance, so the first hit across all
 * of them is nearest. A door leaf's Object3DRef is a hinge THREE.Group
 * (non-raycastable itself) with the actual slab mesh as a raycastable
 * child; the NPC's Object3DRef is its mesh directly. Either way the
 * raycastable object carries the owning eid in `userData.eid` (recursive
 * intersection finds it on whichever child was actually hit) so a hit maps
 * back to its entity — new interactable types (issue #39's items were the
 * first; future ones like levers should follow) should follow the same
 * `userData.eid` + combined-raycast-list shape rather than adding a second
 * trigger path.
 *
 * Returns true if the hit interactable actually did something (a door
 * opened, a dialogue opened, an NPC's follow toggled, an item picked up).
 *
 * Item pickup gets a second chance beyond the raycast: if nothing was hit
 * (or what was hit didn't do anything), `tryPickupNearbyItem` picks up the
 * nearest uncarried item within `ITEM_PICKUP_RANGE` regardless of where the
 * camera is aimed — see its own doc comment for why. Closing an *open* door
 * gets the same kind of second chance via `tryCloseNearbyOpenDoor`: an open
 * leaf has swung up to ~100° aside (see `OPEN_ANGLE`), so standing in the
 * doorway looking straight through it (the natural way to want to close it)
 * doesn't aim at either leaf at all — see that function's own doc comment.
 */
export function tryInteract(world: World, camera: THREE.Camera, scene: THREE.Scene, screenPoint?: { x: number; y: number }): boolean {
  const interactables: THREE.Object3D[] = [];
  for (const eid of query(world, [Door, Object3DRef])) {
    const obj = Object3DRef[eid];
    if (obj) interactables.push(obj);
  }
  for (const eid of query(world, [NPC, Object3DRef])) {
    // A corpse is interactable too, for looting (`dispatchInteract`'s `Dead`
    // check dispatches it to the loot panel instead of dialogue) -- but only
    // until `corpseCleanupSystem` removes its mesh from the scene, at which
    // point there's nothing left to raycast against or loot. A corpse
    // always has `DeathSector` within the same frame it dies (see game.ts),
    // so `sectorId === undefined` reliably means "already cleaned up," not
    // "hasn't died yet."
    if (hasComponent(world, eid, Dead) && DeathSector.sectorId[eid] === undefined) continue;
    const obj = Object3DRef[eid];
    if (obj) interactables.push(obj);
  }
  for (const eid of query(world, [Item, Object3DRef])) {
    if (hasComponent(world, eid, Carried)) continue; // already picked up — not raycastable
    const obj = Object3DRef[eid];
    if (obj) interactables.push(obj);
  }
  for (const eid of query(world, [Readable, Object3DRef])) {
    // A readable *item* (a scroll — see `ItemSpawn.pages`) is also `Item`,
    // whose own loop above already adds it while uncarried and correctly
    // drops it once picked up; entering it here too would just add the
    // same mesh to `interactables` twice for no benefit, since interacting
    // with it in the world always means "pick it up," never "read it" (see
    // `dispatchInteract`'s `Item` branch, checked first) — reading only
    // ever happens from the inventory list.
    if (hasComponent(world, eid, Item)) continue;
    const obj = Object3DRef[eid];
    if (obj) interactables.push(obj);
  }
  for (const eid of query(world, [Container, Object3DRef])) {
    // A container *item* (a backpack — see `ItemAssetDef.container`) is
    // also `Item`, whose own loop above already adds it while uncarried
    // and correctly drops it once picked up (a hidden, carried backpack
    // still sitting at its old world position would otherwise stay
    // raycastable forever); a world barrel isn't an `Item` at all and
    // still needs adding here. Interacting with a container item in the
    // world always means "pick it up," never "open it" (see
    // `dispatchInteract`'s `Item` branch, checked first) — opening only
    // ever happens from the inventory list (`InventoryList.tsx`).
    if (hasComponent(world, eid, Item)) continue;
    const obj = Object3DRef[eid];
    if (obj) interactables.push(obj);
  }

  if (interactables.length > 0) {
    if (screenPoint) {
      raycaster.setFromCamera(ndc.set(screenPoint.x, screenPoint.y), camera);
    } else {
      camera.getWorldDirection(forward);
      raycaster.set(camera.position, forward);
    }
    raycaster.far = INTERACT_RANGE;

    const hits = raycaster.intersectObjects(interactables, true);
    const hitEid = hits.length > 0 ? (hits[0].object.userData.eid as number | undefined) : undefined;
    if (hitEid !== undefined && dispatchInteract(world, hitEid, scene)) return true;
  }

  if (tryPickupNearbyItem(world, scene)) return true;
  return tryCloseNearbyOpenDoor(world);
}

/** Dispatches a raycast hit on `hitEid` to whichever interactable type it
 * actually is — factored out of `tryInteract` so both the aim-based raycast
 * and (for items) the proximity fallback below can share it. */
function dispatchInteract(world: World, hitEid: number, scene: THREE.Scene): boolean {
  if (hasComponent(world, hitEid, Door)) return toggleDoor(world, hitEid);
  if (hasComponent(world, hitEid, NPC)) {
    // A dead NPC (any archetype, docile or aggressive) opens the same loot
    // panel a barrel does (`container/store.ts`) instead of dialogue/follow
    // — see `NpcSpawn.contents` for how an NPC ends up carrying anything to
    // find there.
    if (hasComponent(world, hitEid, Dead)) {
      containerStore.open(hitEid);
      return true;
    }
    const archetype = NPC_REGISTRY[NPC.archetypeId[hitEid]];
    if (archetype?.behavior === "aggressive") return false; // nothing to talk to
    // A combat-test sparring dummy (`NPC.testStyle` set only by
    // CombatTestSandbox.spawnOpponent, empty for every real dungeon NPC --
    // see that field's own doc comment) keeps whichever archetype it was
    // configured with for its mesh/stats (picking "sword" spawns the same
    // "guard" archetype a real dungeon guard uses, greeting and all), but
    // it's a test target, not someone to talk to -- never opens that
    // archetype's dialogue, regardless of which one it is.
    if (archetype?.dialogueId && NPC.testStyle[hitEid] === undefined) {
      dialogueStore.open(hitEid, archetype.dialogueId);
      return true;
    }
    toggleNpcFollow(hitEid);
    return true;
  }
  if (hasComponent(world, hitEid, Item)) return pickUpItemEid(world, hitEid, scene);
  if (hasComponent(world, hitEid, Readable)) {
    noticeStore.open(hitEid);
    return true;
  }
  if (hasComponent(world, hitEid, Container)) {
    containerStore.open(hitEid);
    return true;
  }
  return false;
}

/** Shows the right HUD message for a refused `pickUpItem` — a no-op for
 * `"picked-up"`. Shared by both pickup paths below. */
function showPickUpRefusal(result: PickUpResult): void {
  if (result === "too-heavy") hudStore.showMessage("Too heavy to carry.");
  else if (result === "inventory-full") hudStore.showMessage("Inventory is full.");
}

function pickUpItemEid(world: World, itemEid: number, scene: THREE.Scene): boolean {
  const [playerEid] = query(world, [PlayerControlled]);
  if (playerEid === undefined) return false;
  showPickUpRefusal(pickUpItem(world, itemEid, playerEid, scene));
  return true; // handled either way — don't fall through to something else
}

/**
 * Picks up the nearest uncarried item within `ITEM_PICKUP_RANGE` of the
 * player, ignoring aim entirely — see `ITEM_PICKUP_RANGE`'s doc comment for
 * why this exists alongside the aim-based raycast above. Horizontal
 * distance only (matching every other proximity check in this codebase,
 * e.g. `npc.ts`'s aggro/leash ranges): an item resting on a tabletop versus
 * the floor shouldn't change whether walking up to it lets you grab it.
 */
function tryPickupNearbyItem(world: World, scene: THREE.Scene): boolean {
  const [playerEid] = query(world, [PlayerControlled]);
  if (playerEid === undefined) return false;
  const px = Position.x[playerEid];
  const pz = Position.z[playerEid];

  let nearestEid: number | undefined;
  let nearestDist = ITEM_PICKUP_RANGE;
  for (const eid of query(world, [Item, Position])) {
    if (hasComponent(world, eid, Carried)) continue;
    const dist = Math.hypot(Position.x[eid] - px, Position.z[eid] - pz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestEid = eid;
    }
  }
  if (nearestEid === undefined) return false;
  showPickUpRefusal(pickUpItem(world, nearestEid, playerEid, scene));
  return true; // handled either way — don't fall through to something else
}

/** How close the player has to be to an open door leaf's *hinge* (not the
 * swung-aside slab itself — see below) to close it via proximity rather
 * than aim. Tighter than `ITEM_PICKUP_RANGE`: this is meant to trigger only
 * for "you are standing right at this doorway," not any open door
 * anywhere nearby. */
const DOOR_CLOSE_PROXIMITY_RANGE = 2.5; // meters

/**
 * Closes the nearest `OPEN` door within `DOOR_CLOSE_PROXIMITY_RANGE` of the
 * player, regardless of aim — the proximity-fallback counterpart to
 * `tryPickupNearbyItem`, for the same underlying reason: an open door leaf
 * has swung up to ~100° aside from its closed position (`OPEN_ANGLE`), so a
 * player standing in the doorway and looking straight through it — the
 * obvious way to try to close it — isn't aiming at either leaf, both of
 * which are now off to the sides. Distance is measured to each leaf's own
 * `Object3DRef` (a hinge `THREE.Group` whose *position* never moves, only
 * its rotation, as it swings — see tileBuilder.ts's `addDoorLeaf`), which
 * doubles as "how close to this doorway" regardless of which way the leaf
 * happens to have swung.
 */
function tryCloseNearbyOpenDoor(world: World): boolean {
  const [playerEid] = query(world, [PlayerControlled]);
  if (playerEid === undefined) return false;
  const px = Position.x[playerEid];
  const pz = Position.z[playerEid];

  let nearestEid: number | undefined;
  let nearestDist = DOOR_CLOSE_PROXIMITY_RANGE;
  for (const eid of query(world, [Door, Object3DRef])) {
    if (Door.state[eid] !== DoorState.OPEN) continue;
    const obj = Object3DRef[eid];
    if (!obj) continue;
    const dist = Math.hypot(obj.position.x - px, obj.position.z - pz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestEid = eid;
    }
  }
  if (nearestEid === undefined) return false;
  return setPairState(world, nearestEid, DoorState.OPEN, DoorState.CLOSING);
}

/** Toggles the door leaf `hitEid` — opens it if `CLOSED`, closes it if
 * `OPEN`, ignores the interact entirely if it's mid-swing (`OPENING`/
 * `CLOSING`, e.g. a second tap before the first finishes). Either way moves
 * both leaves of the doorway (they share a `Door.pairId`, see
 * tileBuilder.ts) together, so the whole doorway swings as one.
 *
 * A `CLOSED` door that's locked (`Door.locked`) won't open without
 * `Door.requiredItemTypeId` somewhere in the interacting player's inventory
 * — instead of opening, it shows a "Door is locked." message
 * (`hudStore.showMessage`) and still counts as a handled interact (so the
 * same press doesn't also fall through to picking up a nearby item). Once
 * opened with the right item, a door stays unlocked permanently — there's no
 * mechanic that re-locks it. */
function toggleDoor(world: World, hitEid: number): boolean {
  const state = Door.state[hitEid];
  if (state === DoorState.CLOSED) {
    if (Door.locked[hitEid]) {
      const requiredItemTypeId = Door.requiredItemTypeId[hitEid];
      const [playerEid] = query(world, [PlayerControlled]);
      if (playerEid === undefined || requiredItemTypeId === undefined || !playerCarries(world, playerEid, requiredItemTypeId)) {
        hudStore.showMessage("Door is locked.");
        return true;
      }
      setPairLocked(world, hitEid, false);
    }
    return setPairState(world, hitEid, DoorState.CLOSED, DoorState.OPENING);
  }
  if (state === DoorState.OPEN) {
    return setPairState(world, hitEid, DoorState.OPEN, DoorState.CLOSING);
  }
  return false; // mid-swing — ignore
}

/** True if `ownerEid` currently carries (in any slot, not just equipped) an
 * `Item` whose `itemTypeId` is `itemTypeId` — used to check for a door's key
 * without caring whether it's equipped, in the paper-doll, or just sitting
 * in the freeform inventory list. */
function playerCarries(world: World, ownerEid: number, itemTypeId: string): boolean {
  for (const eid of query(world, [Item, Carried])) {
    if (Carried.ownerEid[eid] === ownerEid && Item.itemTypeId[eid] === itemTypeId) return true;
  }
  return false;
}

/** Sets `Door.locked` to `locked` on every leaf sharing `hitEid`'s pairId,
 * and (only ever called with `locked: false`, on a successful unlock) swaps
 * each leaf's slab back to the normal door material so it doesn't keep
 * reading as locked once it isn't. */
function setPairLocked(world: World, hitEid: number, locked: boolean): void {
  const pairId = Door.pairId[hitEid];
  for (const eid of query(world, [Door])) {
    if (Door.pairId[eid] !== pairId) continue;
    Door.locked[eid] = locked ? 1 : 0;
    if (!locked) {
      const group = Object3DRef[eid] as THREE.Group | undefined;
      const mesh = group?.children[0] as THREE.Mesh | undefined;
      if (mesh) mesh.material = doorMaterial(false);
    }
  }
}

/** Moves every leaf sharing `hitEid`'s pairId currently in `from` to `to`.
 * Returns whether anything actually changed state. */
function setPairState(world: World, hitEid: number, from: number, to: number): boolean {
  const pairId = Door.pairId[hitEid];
  let changed = false;
  for (const eid of query(world, [Door])) {
    if (Door.pairId[eid] === pairId && Door.state[eid] === from) {
      Door.state[eid] = to;
      changed = true;
    }
  }
  return changed;
}
