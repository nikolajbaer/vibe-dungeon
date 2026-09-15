import * as THREE from "three";
import { hasComponent, query, type World } from "bitecs";
import { Dead, Door, DoorState, Object3DRef, NPC, Item, Carried, PlayerControlled } from "../components";
import { toggleNpcFollow } from "./npc";
import { pickUpItem } from "./items";
import { NPC_REGISTRY } from "../../assets/npcRegistry";
import { dialogueStore } from "../../dialogue/store";

const OPEN_DURATION = 0.8; // seconds for a door to fully open
const INTERACT_RANGE = 3; // meters
const OPEN_ANGLE = THREE.MathUtils.degToRad(100); // slightly past perpendicular

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Advances any door leaf currently opening, swinging its hinge Group
 * (Object3DRef) around Y from closed (0 rad) to `hingeSign * OPEN_ANGLE`.
 * Doors only open (no auto-close) — that's the full scope of the "open
 * doors" slice of issue #7. Position is untouched (see components.ts /
 * sync.ts) — only the visual rotation moves. */
export function doorAnimationSystem(world: World, dt: number): void {
  for (const eid of query(world, [Door, Object3DRef])) {
    if (Door.state[eid] !== DoorState.OPENING) continue;

    Door.progress[eid] = Math.min(1, Door.progress[eid] + dt / OPEN_DURATION);

    const obj = Object3DRef[eid];
    if (obj) {
      obj.rotation.y = Door.hingeSign[eid] * OPEN_ANGLE * easeOutCubic(Door.progress[eid]);
    }

    if (Door.progress[eid] >= 1) {
      Door.state[eid] = DoorState.OPEN;
    }
  }
}

const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();

/**
 * Interaction trigger (documented in README under Design Notes so later
 * interaction work builds on the same convention): a raycast straight out
 * from the camera hits the nearest interactable within INTERACT_RANGE
 * meters and dispatches on which ECS component the hit entity carries —
 * `Door` opens it (see `openDoor` below); `NPC` dispatches on its archetype
 * (`NPC_REGISTRY`, `NPC.archetypeId`): an aggressive one ignores the
 * interact entirely (nothing to talk to), a docile one with a `dialogueId`
 * opens that tree (`dialogueStore.open`, see `src/dialogue/`), and a docile
 * one without falls back to the original `toggleNpcFollow` demo toggle; an
 * uncarried `Item` (issue #39) is picked up (see `pickUpItem` in items.ts).
 * Callers decide *when* to fire this — desktop on `KeyE`, touch on a tap
 * outside both joystick pads (see game.ts).
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
 * opened, a dialogue opened, an NPC's follow toggled).
 */
export function tryInteract(world: World, camera: THREE.Camera): boolean {
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
  if (interactables.length === 0) return false;

  camera.getWorldDirection(forward);
  raycaster.set(camera.position, forward);
  raycaster.far = INTERACT_RANGE;

  const hits = raycaster.intersectObjects(interactables, true);
  if (hits.length === 0) return false;

  const hitEid = hits[0].object.userData.eid as number | undefined;
  if (hitEid === undefined) return false;

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
  if (hasComponent(world, hitEid, Item)) {
    const [playerEid] = query(world, [PlayerControlled]);
    if (playerEid === undefined) return false;
    pickUpItem(world, hitEid, playerEid);
    return true;
  }
  return false;
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
