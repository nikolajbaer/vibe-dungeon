import * as THREE from "three";
import { addComponent, addEntity, createWorld, hasComponent } from "bitecs";
import { query } from "bitecs";
import { Position, Velocity, Rotation, Collider, PlayerControlled, Object3DRef, Door, Dead, Health, NPC, NpcState } from "./ecs/components";
import { inputSystem } from "./ecs/systems/input";
import { movementSystem } from "./ecs/systems/movement";
import { collisionSystem } from "./ecs/systems/collision";
import { doorAnimationSystem, tryInteract } from "./ecs/systems/doors";
import { tryMeleeAttack } from "./ecs/systems/combat";
import { npcSystem } from "./ecs/systems/npc";
import { syncSystem } from "./ecs/systems/sync";
import { hudSync } from "./ecs/systems/hudSync";
import { buildLevel } from "./level/level";
import { Keyboard } from "./input/keyboard";
import { PointerLook } from "./input/pointerLook";
import { TouchControls, isTouchDevice } from "./input/touchControls";
import { mountHud } from "./hud/mount";

const EYE_HEIGHT = 1.6;
const PLAYER_HALF_EXTENT = 0.35;
const DEBUG_HEALTH_STEP = 10; // debug-only nudge, see `[`/`]` handling below

// Test NPC (issue #36) — hardcoded spawn inside room-a (x in [-3,6], z in
// [0,9]; see level/levelData.ts), straight ahead of the player's spawn
// point along the path to the door (same x, facing yaw 0 looks directly at
// it) and well clear of the walls. No general NPC-spawn data format yet,
// per the issue.
const NPC_SPAWN = { x: 1.5, z: 3.5 };
const NPC_HALF_EXTENT = 0.4;
const NPC_HEIGHT = 1.75; // roughly humanoid-sized
const NPC_RADIUS = 0.35;
const NPC_INITIAL_WANDER_PAUSE = 2; // seconds before its first idle wander leg
const NPC_HEALTH = 30; // issue #48 — first thing that can actually be damaged; two 15-damage hits kill it

/** Wires up the ECS world, level, player entity, input sources, and the
 * core game loop (input -> npc -> movement -> collision -> interact ->
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
  addComponent(world, player, Health);
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
  Health.current[player] = 100;
  Health.max[player] = 100;

  // Test NPC (issue #36): loiters near NPC_SPAWN by default; interacting
  // with it (same raycast dispatch as doors, see doors.ts `tryInteract`)
  // toggles it to follow the player instead. Moves via Velocity, driven
  // through the normal movementSystem/collisionSystem pipeline just like
  // the player — see ecs/systems/npc.ts.
  const npc = addEntity(world);
  addComponent(world, npc, Position);
  addComponent(world, npc, Velocity);
  addComponent(world, npc, Collider);
  addComponent(world, npc, NPC);
  addComponent(world, npc, Object3DRef);
  addComponent(world, npc, Health);
  Position.x[npc] = NPC_SPAWN.x;
  Position.y[npc] = NPC_HEIGHT / 2;
  Position.z[npc] = NPC_SPAWN.z;
  Velocity.x[npc] = 0;
  Velocity.z[npc] = 0;
  Collider.hx[npc] = NPC_HALF_EXTENT;
  Collider.hz[npc] = NPC_HALF_EXTENT;
  NPC.state[npc] = NpcState.LOITERING;
  NPC.homeX[npc] = NPC_SPAWN.x;
  NPC.homeZ[npc] = NPC_SPAWN.z;
  NPC.wanderTargetX[npc] = NPC_SPAWN.x;
  NPC.wanderTargetZ[npc] = NPC_SPAWN.z;
  NPC.wanderTimer[npc] = NPC_INITIAL_WANDER_PAUSE;
  Health.current[npc] = NPC_HEALTH;
  Health.max[npc] = NPC_HEALTH;

  const npcMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(NPC_RADIUS, NPC_RADIUS, NPC_HEIGHT, 12),
    new THREE.MeshStandardMaterial({ color: 0xdd3355 }), // saturated, distinct from the stone environment
  );
  npcMesh.userData.eid = npc; // same userData.eid convention doors' slab meshes use
  scene.add(npcMesh);
  Object3DRef[npc] = npcMesh;

  // Minimal debug hook for manual/automated smoke testing (e.g. Playwright
  // checking that movement and collision actually affect position).
  (window as unknown as { __vibeDungeonDebug: unknown }).__vibeDungeonDebug = {
    getPlayerPosition: () => ({ x: Position.x[player], y: Position.y[player], z: Position.z[player] }),
    getDoorStates: () =>
      Array.from(query(world, [Door])).map((eid) => ({ state: Door.state[eid], progress: Door.progress[eid] })),
    setYaw: (yaw: number) => { Rotation.yaw[player] = yaw; },
    setPitch: (pitch: number) => { Rotation.pitch[player] = pitch; },
    getRotation: () => ({ yaw: Rotation.yaw[player], pitch: Rotation.pitch[player] }),
    getCurrentSector: () => currentSector,
    getHealth: () => ({ current: Health.current[player], max: Health.max[player] }),
    getNpcState: () => ({
      state: NPC.state[npc] === NpcState.FOLLOWING ? "FOLLOWING" : "LOITERING",
      x: Position.x[npc],
      y: Position.y[npc],
      z: Position.z[npc],
      health: Health.current[npc],
      dead: hasComponent(world, npc, Dead),
      meshInScene: npcMesh.parent !== null,
    }),
    // Debug-only direct trigger for automated (Playwright) testing of melee
    // combat (issue #48) without needing to simulate real pointer-lock
    // clicks/touches — fires the exact same `tryMeleeAttack` the real
    // click/touch-button wiring below calls.
    attack: () => tryMeleeAttack(world, camera),
  };

  // Tracks (and logs, on change) the sector the player currently occupies —
  // authoring/tracking data from the tile occupancy index only (see
  // README "Sectors"); no gameplay reads this yet.
  let currentSector: string | undefined;

  const keyboard = new Keyboard();
  const pointerLook = new PointerLook(renderer.domElement);
  const touch = new TouchControls(container);
  setupHint(container, renderer.domElement, pointerLook);
  mountHud(container);

  // Desktop melee attack trigger (issue #48): left-click, but only once
  // pointer lock is already engaged — `PointerLook`'s own click handler
  // requests lock asynchronously (pointer lock only ever activates after
  // this handler returns), so `pointerLook.locked` still reads false on the
  // very click that engages it, meaning that first click never also counts
  // as an attack. Edge-triggered into `attackRequested` and consumed once
  // per frame below, the same "just pressed" shape `interactPressed` uses.
  let attackRequested = false;
  renderer.domElement.addEventListener("mousedown", (e) => {
    if (e.button === 0 && pointerLook.locked) attackRequested = true;
  });

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
      touchLook: touch.lookDrag,
    });
    npcSystem(world, dt);
    movementSystem(world, dt);
    collisionSystem(world);
    doorAnimationSystem(world, dt);

    const interactPressed = keyboard.consumeJustPressed("KeyE") || touch.consumeInteractRequest();
    if (interactPressed) tryInteract(world, camera);

    const attackPressed = attackRequested || touch.consumeAttackRequest();
    attackRequested = false;
    if (attackPressed) tryMeleeAttack(world, camera);

    // Debug-only health nudge (`[`/`]`) so the ECS -> MobX -> HUD plumbing
    // is visibly exercised before real combat (#16) exists. Harmless to
    // leave in permanently as a debug convenience.
    if (keyboard.consumeJustPressed("BracketLeft")) {
      Health.current[player] = Math.max(0, Health.current[player] - DEBUG_HEALTH_STEP);
    }
    if (keyboard.consumeJustPressed("BracketRight")) {
      Health.current[player] = Math.min(Health.max[player], Health.current[player] + DEBUG_HEALTH_STEP);
    }

    const sector = level.sectorAt(Position.x[player], Position.z[player]);
    if (sector !== currentSector) {
      currentSector = sector;
      console.log(`[sector] entered "${currentSector ?? "(none)"}"`);
    }

    syncSystem(world);
    hudSync(world);
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
    ? "Drag the pads to move & look · tap elsewhere to open doors · ATK to attack"
    : "Click to look around · WASD move · E opens doors · click to attack";
  container.appendChild(hint);

  if (isTouchDevice()) return;

  domElement.addEventListener("click", () => hint.classList.add("hidden"));
  document.addEventListener("pointerlockchange", () => {
    hint.classList.toggle("hidden", look.locked);
  });
}
