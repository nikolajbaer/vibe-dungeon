import * as THREE from "three";
import { query, type World } from "bitecs";
import { Door, DoorState, Object3DRef } from "../components";

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
 * from the camera hits the nearest CLOSED door leaf within INTERACT_RANGE
 * meters and opens it — and, since a doorway is built from two hinge leaves
 * sharing a `Door.pairId` (see tileBuilder.ts), opens its partner leaf too
 * so the whole doorway swings open together. Callers decide *when* to fire
 * this — desktop on `KeyE`, touch on a tap outside both joystick pads (see
 * game.ts).
 *
 * Each leaf's Object3DRef is a hinge THREE.Group (non-raycastable itself);
 * the raycast is recursive and the actual slab mesh child carries the
 * owning eid in `userData.eid` so a hit can be mapped back to its entity.
 *
 * Returns true if a door was opened.
 */
export function tryInteract(world: World, camera: THREE.Camera): boolean {
  const doorGroups: THREE.Object3D[] = [];
  for (const eid of query(world, [Door, Object3DRef])) {
    const obj = Object3DRef[eid];
    if (obj) doorGroups.push(obj);
  }
  if (doorGroups.length === 0) return false;

  camera.getWorldDirection(forward);
  raycaster.set(camera.position, forward);
  raycaster.far = INTERACT_RANGE;

  const hits = raycaster.intersectObjects(doorGroups, true);
  if (hits.length === 0) return false;

  const hitEid = hits[0].object.userData.eid as number | undefined;
  if (hitEid === undefined || Door.state[hitEid] !== DoorState.CLOSED) return false;

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
