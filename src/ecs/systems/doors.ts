import * as THREE from "three";
import { hasComponent, query, type World } from "bitecs";
import { Dead, Door, DoorState, Object3DRef, PhysicsBody, Position, NPC, Item, Carried, PlayerControlled } from "../components";
import { toggleNpcFollow } from "./npc";
import { pickUpItem } from "./items";
import { NPC_REGISTRY } from "../../assets/npcRegistry";
import { dialogueStore } from "../../dialogue/store";

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

/** Advances any door leaf currently opening, swinging both its hinge Group
 * (Object3DRef) and its kinematic physics body (PhysicsBody) around Y from
 * closed (0 rad) to `hingeSign * OPEN_ANGLE`. Driving both from the same
 * angle is what keeps the collider exactly where the slab is drawn, so a
 * half-open door blocks exactly as much of the doorway as it looks like it
 * does. Doors only open (no auto-close) — that's the full scope of the
 * "open doors" slice of issue #7. */
export function doorAnimationSystem(world: World, dt: number): void {
  for (const eid of query(world, [Door, Object3DRef])) {
    if (Door.state[eid] !== DoorState.OPENING) continue;

    Door.progress[eid] = Math.min(1, Door.progress[eid] + dt / OPEN_DURATION);
    const angle = Door.hingeSign[eid] * OPEN_ANGLE * easeOutCubic(Door.progress[eid]);

    const obj = Object3DRef[eid];
    if (obj) obj.rotation.y = angle;

    // Rapier takes a quaternion; these leaves only ever rotate about Y, so
    // building it directly is cheaper and clearer than routing through a
    // THREE.Quaternion just to copy its components back out.
    const body = PhysicsBody[eid];
    if (body) body.setNextKinematicRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });

    if (Door.progress[eid] >= 1) {
      Door.state[eid] = DoorState.OPEN;
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
 * ECS component the hit entity carries — `Door` opens it (see `openDoor`
 * below); `NPC` dispatches on its archetype (`NPC_REGISTRY`,
 * `NPC.archetypeId`): an aggressive one ignores the interact entirely
 * (nothing to talk to), a docile one with a `dialogueId` opens that tree
 * (`dialogueStore.open`, see `src/dialogue/`), and a docile one without
 * falls back to the original `toggleNpcFollow` demo toggle; an uncarried
 * `Item` (issue #39) is picked up (see `pickUpItem` in items.ts). Callers
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
 * camera is aimed — see its own doc comment for why.
 */
export function tryInteract(world: World, camera: THREE.Camera, screenPoint?: { x: number; y: number }): boolean {
  const interactables: THREE.Object3D[] = [];
  for (const eid of query(world, [Door, Object3DRef])) {
    const obj = Object3DRef[eid];
    if (obj) interactables.push(obj);
  }
  for (const eid of query(world, [NPC, Object3DRef])) {
    if (hasComponent(world, eid, Dead)) continue; // corpses aren't interactable (issue #48)
    const obj = Object3DRef[eid];
    if (obj) interactables.push(obj);
  }
  for (const eid of query(world, [Item, Object3DRef])) {
    if (hasComponent(world, eid, Carried)) continue; // already picked up — not raycastable
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
    if (hitEid !== undefined && dispatchInteract(world, hitEid)) return true;
  }

  return tryPickupNearbyItem(world);
}

/** Dispatches a raycast hit on `hitEid` to whichever interactable type it
 * actually is — factored out of `tryInteract` so both the aim-based raycast
 * and (for items) the proximity fallback below can share it. */
function dispatchInteract(world: World, hitEid: number): boolean {
  if (hasComponent(world, hitEid, Door)) return openDoor(world, hitEid);
  if (hasComponent(world, hitEid, NPC)) {
    const archetype = NPC_REGISTRY[NPC.archetypeId[hitEid]];
    if (archetype?.behavior === "aggressive") return false; // nothing to talk to
    if (archetype?.dialogueId) {
      dialogueStore.open(hitEid, archetype.dialogueId);
      return true;
    }
    toggleNpcFollow(hitEid);
    return true;
  }
  if (hasComponent(world, hitEid, Item)) return pickUpItemEid(world, hitEid);
  return false;
}

function pickUpItemEid(world: World, itemEid: number): boolean {
  const [playerEid] = query(world, [PlayerControlled]);
  if (playerEid === undefined) return false;
  pickUpItem(world, itemEid, playerEid);
  return true;
}

/**
 * Picks up the nearest uncarried item within `ITEM_PICKUP_RANGE` of the
 * player, ignoring aim entirely — see `ITEM_PICKUP_RANGE`'s doc comment for
 * why this exists alongside the aim-based raycast above. Horizontal
 * distance only (matching every other proximity check in this codebase,
 * e.g. `npc.ts`'s aggro/leash ranges): an item resting on a tabletop versus
 * the floor shouldn't change whether walking up to it lets you grab it.
 */
function tryPickupNearbyItem(world: World): boolean {
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
  pickUpItem(world, nearestEid, playerEid);
  return true;
}

/** Opens the CLOSED door leaf `hitEid` and, since a doorway is built from
 * two hinge leaves sharing a `Door.pairId` (see tileBuilder.ts), its
 * partner leaf too, so the whole doorway swings open together. */
function openDoor(world: World, hitEid: number): boolean {
  if (Door.state[hitEid] !== DoorState.CLOSED) return false;

  const pairId = Door.pairId[hitEid];
  let opened = false;
  for (const eid of query(world, [Door])) {
    if (Door.pairId[eid] === pairId && Door.state[eid] === DoorState.CLOSED) {
      Door.state[eid] = DoorState.OPENING;
      opened = true;
    }
  }
  return opened;
}
