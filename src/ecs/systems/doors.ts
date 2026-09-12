import * as THREE from "three";
import { query, type World } from "bitecs";
import { Position, Door, DoorState, Object3DRef } from "../components";

const OPEN_DURATION = 0.8; // seconds for a door to fully open
const INTERACT_RANGE = 3; // meters

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Advances any door currently opening. Doors only open (no auto-close) —
 * that's the full scope of the "open doors" slice of issue #7. */
export function doorAnimationSystem(world: World, dt: number): void {
  for (const eid of query(world, [Door, Position])) {
    if (Door.state[eid] !== DoorState.OPENING) continue;

    Door.progress[eid] = Math.min(1, Door.progress[eid] + dt / OPEN_DURATION);
    Position.y[eid] = THREE.MathUtils.lerp(
      Door.closedY[eid],
      Door.openY[eid],
      easeOutCubic(Door.progress[eid]),
    );

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
 * from the camera opens the nearest CLOSED door it hits within
 * INTERACT_RANGE meters. Callers decide *when* to fire this — desktop on
 * `KeyE`, touch on a tap outside both joystick pads (see game.ts).
 *
 * Returns true if a door was opened.
 */
export function tryInteract(world: World, camera: THREE.Camera): boolean {
  const doorMeshes: THREE.Object3D[] = [];
  const doorEids: number[] = [];
  for (const eid of query(world, [Door, Object3DRef])) {
    const obj = Object3DRef[eid];
    if (obj) {
      doorMeshes.push(obj);
      doorEids.push(eid);
    }
  }
  if (doorMeshes.length === 0) return false;

  camera.getWorldDirection(forward);
  raycaster.set(camera.position, forward);
  raycaster.far = INTERACT_RANGE;

  const hits = raycaster.intersectObjects(doorMeshes, false);
  if (hits.length === 0) return false;

  const eid = doorEids[doorMeshes.indexOf(hits[0].object)];
  if (Door.state[eid] === DoorState.CLOSED) {
    Door.state[eid] = DoorState.OPENING;
    return true;
  }
  return false;
}
