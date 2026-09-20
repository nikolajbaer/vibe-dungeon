import * as THREE from "three";
import { query, type World } from "bitecs";
import { Position, Velocity, Rotation, PlayerControlled } from "../components";
import type { Keyboard } from "../../input/keyboard";
import type { PointerLook } from "../../input/pointerLook";
import type { TouchJoystick } from "../../input/touchJoystick";
import type { TouchLookDrag } from "../../input/touchLookDrag";

const DEFAULT_MOVE_SPEED = 3.2; // meters/second
let moveSpeed = DEFAULT_MOVE_SPEED;
const MAX_PITCH = Math.PI / 2 - 0.05;

export interface InputSources {
  keyboard: Keyboard;
  look: PointerLook;
  moveStick: TouchJoystick | null;
  touchLook: TouchLookDrag | null;
}

const euler = new THREE.Euler(0, 0, 0, "YXZ");
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const moveVec = new THREE.Vector3();

export function getPlayerMoveSpeed(): number {
  return moveSpeed;
}

export function setPlayerMoveSpeed(value: number): void {
  moveSpeed = Math.max(1, Math.min(6, value));
}

/** Reads keyboard/mouse/touch input and writes the player's desired
 * Velocity (world-space, relative to current facing) and updated
 * Rotation (yaw/pitch). Movement is resolved against collision afterwards
 * by collisionSystem. `_dt` is unused now that both look sources
 * (`PointerLook`/`TouchLookDrag`) already accumulate pre-scaled per-frame
 * deltas via `consume()`; kept in the signature for call-site symmetry with
 * the other systems in the pipeline. */
export function inputSystem(world: World, _dt: number, input: InputSources): void {
  for (const eid of query(world, [PlayerControlled, Position, Velocity, Rotation])) {
    // --- Look ---
    const mouse = input.look.consume();
    const touchLook = input.touchLook?.consume();
    let yaw = Rotation.yaw[eid] - mouse.yaw;
    let pitch = Rotation.pitch[eid] - mouse.pitch;

    if (touchLook) {
      yaw -= touchLook.yaw;
      pitch -= touchLook.pitch;
    }

    Rotation.yaw[eid] = yaw;
    Rotation.pitch[eid] = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));

    // --- Move ---
    let mx = 0; // local strafe: right is positive
    let mz = 0; // local forward: forward is positive
    if (input.keyboard.isDown("KeyW") || input.keyboard.isDown("ArrowUp")) mz += 1;
    if (input.keyboard.isDown("KeyS") || input.keyboard.isDown("ArrowDown")) mz -= 1;
    if (input.keyboard.isDown("KeyD") || input.keyboard.isDown("ArrowRight")) mx += 1;
    if (input.keyboard.isDown("KeyA") || input.keyboard.isDown("ArrowLeft")) mx -= 1;
    if (input.moveStick?.active) {
      mx += input.moveStick.x;
      mz += input.moveStick.y;
    }

    const localLen = Math.hypot(mx, mz);
    if (localLen > 1) {
      mx /= localLen;
      mz /= localLen;
    }

    euler.y = Rotation.yaw[eid];
    forward.set(0, 0, -1).applyEuler(euler);
    right.set(1, 0, 0).applyEuler(euler);
    moveVec.set(0, 0, 0).addScaledVector(forward, mz).addScaledVector(right, mx);
    if (moveVec.lengthSq() > 1) moveVec.normalize();

    Velocity.x[eid] = moveVec.x * moveSpeed;
    Velocity.z[eid] = moveVec.z * moveSpeed;
  }
}
