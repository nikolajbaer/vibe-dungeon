import * as THREE from "three";
import { addComponent, addEntity, createWorld } from "bitecs";
import { query } from "bitecs";
import { Position, Velocity, Rotation, Collider, PlayerControlled, Object3DRef, Door } from "./ecs/components";
import { inputSystem } from "./ecs/systems/input";
import { movementSystem } from "./ecs/systems/movement";
import { collisionSystem } from "./ecs/systems/collision";
import { doorAnimationSystem, tryInteract } from "./ecs/systems/doors";
import { syncSystem } from "./ecs/systems/sync";
import { buildLevel } from "./level/level";
import { Keyboard } from "./input/keyboard";
import { PointerLook } from "./input/pointerLook";
import { TouchControls, isTouchDevice } from "./input/touchControls";

const EYE_HEIGHT = 1.6;
const PLAYER_HALF_EXTENT = 0.35;

/** Wires up the ECS world, level, player entity, input sources, and the
 * core game loop (input -> movement -> collision -> door interaction ->
 * sync-to-render -> render). This replaces the hello-world "rotate a cube"
 * loop from the scaffold. */
export function startGame(container: HTMLElement): void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11131a);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(5, 10, 3);
  scene.add(sun);

  const world = createWorld();
  const level = buildLevel(world, scene);

  const player = addEntity(world);
  addComponent(world, player, Position);
  addComponent(world, player, Velocity);
  addComponent(world, player, Rotation);
  addComponent(world, player, Collider);
  addComponent(world, player, PlayerControlled);
  addComponent(world, player, Object3DRef);
  Position.x[player] = level.spawn.x;
  Position.y[player] = EYE_HEIGHT;
  Position.z[player] = level.spawn.z;
  Velocity.x[player] = 0;
  Velocity.z[player] = 0;
  Rotation.yaw[player] = level.spawn.yaw;
  Rotation.pitch[player] = 0;
  Collider.hx[player] = PLAYER_HALF_EXTENT;
  Collider.hz[player] = PLAYER_HALF_EXTENT;
  Object3DRef[player] = camera;

  // Minimal debug hook for manual/automated smoke testing (e.g. Playwright
  // checking that movement and collision actually affect position).
  (window as unknown as { __vibeDungeonDebug: unknown }).__vibeDungeonDebug = {
    getPlayerPosition: () => ({ x: Position.x[player], y: Position.y[player], z: Position.z[player] }),
    getDoorStates: () =>
      Array.from(query(world, [Door])).map((eid) => ({ state: Door.state[eid], progress: Door.progress[eid] })),
    setYaw: (yaw: number) => { Rotation.yaw[player] = yaw; },
  };

  const keyboard = new Keyboard();
  const pointerLook = new PointerLook(renderer.domElement);
  const touch = new TouchControls(container);
  setupHint(container, renderer.domElement, pointerLook);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);

    inputSystem(world, dt, {
      keyboard,
      look: pointerLook,
      moveStick: touch.moveStick,
      lookStick: touch.lookStick,
    });
    movementSystem(world, dt);
    collisionSystem(world);
    doorAnimationSystem(world, dt);

    const interactPressed = keyboard.consumeJustPressed("KeyE") || touch.consumeInteractRequest();
    if (interactPressed) tryInteract(world, camera);

    syncSystem(world);
    renderer.render(scene, camera);
  }
  frame();
}

/** A small "click to enable mouse-look" hint, shown until pointer lock
 * engages (or immediately hidden on touch devices, which don't use it). */
function setupHint(container: HTMLElement, domElement: HTMLElement, look: PointerLook): void {
  const hint = document.createElement("div");
  hint.id = "controls-hint";
  hint.textContent = isTouchDevice()
    ? "Drag the pads to move & look · tap elsewhere to open doors"
    : "Click to look around · WASD move · E opens doors";
  container.appendChild(hint);

  if (isTouchDevice()) return;

  domElement.addEventListener("click", () => hint.classList.add("hidden"));
  document.addEventListener("pointerlockchange", () => {
    hint.classList.toggle("hidden", look.locked);
  });
}
