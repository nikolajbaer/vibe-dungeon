import * as THREE from "three";
import { addComponent, addEntity, createWorld, hasComponent } from "bitecs";
import { query } from "bitecs";
import { Position, Velocity, Rotation, Collider, PlayerControlled, Object3DRef, Door, Dead, DeathSector, Health, NPC, NpcState, Item, Carried } from "./ecs/components";
import { inputSystem } from "./ecs/systems/input";
import { movementSystem } from "./ecs/systems/movement";
import { collisionSystem } from "./ecs/systems/collision";
import { doorAnimationSystem, tryInteract } from "./ecs/systems/doors";
import { tryMeleeAttack } from "./ecs/systems/combat";
import { npcSystem } from "./ecs/systems/npc";
import { createAnimatedNpcMesh, getNpcAnimationDebugState, npcAnimationSystem } from "./ecs/systems/npcAnimation";
import { corpseCleanupSystem } from "./ecs/systems/corpseCleanup";
import { createHumanoidRig } from "./characters/humanoidRig";
import { equipItem, equipToOpenHandSlot, unequipItem, viewmodelSwingSystem } from "./ecs/systems/items";
import { syncSystem } from "./ecs/systems/sync";
import { hudSync } from "./ecs/systems/hudSync";
import { buildLevel } from "./level/level";
import { ALL_ITEM_SPAWNS } from "./level/rooms";
import { Keyboard } from "./input/keyboard";
import { PointerLook } from "./input/pointerLook";
import { TouchControls, isTouchDevice } from "./input/touchControls";
import { mountHud } from "./hud/mount";
import { mountInventory } from "./inventory/mount";
import { inventorySync } from "./inventory/sync";
import { inventoryStore, type InventoryActions } from "./inventory/store";

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
const NPC_INITIAL_WANDER_PAUSE = 2; // seconds before its first idle wander leg
const NPC_HEALTH = 30; // issue #48 — first thing that can actually be damaged; two 15-damage hits kill it

/** Wires up the ECS world, level, player entity, input sources, and the
 * core game loop (input -> npc -> npc-animation -> movement -> collision ->
 * interact -> sync-to-render -> hud/inventory-sync -> render). This replaces
 * the hello-world "rotate a cube" loop from the scaffold. */
export function startGame(container: HTMLElement): void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11131a);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Issue #64: ACES so the warm torch PointLights (tileBuilder.ts) roll off
  // into highlights instead of clipping to flat white under the default
  // NoToneMapping, which read flat/blown-out once the flat daylight-style
  // lights below were dimmed down to let them actually read as the dominant
  // light source. Exposure tuned by eye against rendered screenshots (see
  // PR) — noticeably higher (~1.4+) blows the torch cones out again, lower
  // buries the point lights' falloff too far into black.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  // Issue #64: point-light shadows off a handful of torches sell "moody"
  // far better than lit-but-flat walls (see PR screenshots). Enabling the
  // shadow map at all measurably cost frame time in this dev container's
  // software (no-GPU) rendering path, so this deliberately stays on three's
  // cheaper default (PCFShadowMap, left implicit) rather than
  // PCFSoftShadowMap, and each torch's shadow map is kept small (256x256,
  // see addTorch below) — the level's geometry is simple (a handful of
  // rooms, at most ~2 torches visible at once), so this should be cheap on
  // real GPU hardware, but there's no perf-profiling infra to confirm that
  // number here (see PR description).
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Issue #64 ("moody dungeon lighting"): the old flat white AmbientLight(0.55)
  // + outdoor-style DirectionalLight(0.85) lit every room evenly, washing out
  // the warm torch PointLights (tileBuilder.ts's addTorch/TORCH_* — issue
  // #41) that were supposed to be the dungeon's actual light source. Dropped
  // to a dim, cool blue-grey AmbientLight (a "never fully pitch black" floor,
  // not real illumination) and a very dim HemisphereLight standing in for
  // soft bounce/sky fill instead of a directional "sun", which doesn't
  // belong pointed at an indoor dungeon ceiling. Torches now read as the
  // dominant light in every screenshot (see PR) — pools of warm light around
  // each one, real darkness in corridors and between rooms.
  //
  // The first-landed values here (Ambient 0.22 / Hemisphere ground 0x0f0c09
  // at 0.3) still measured as literal (0,0,0)-(3,1,1) pixels — not just
  // "very dark" but fully clipped to black — on a door a couple meters away
  // with no torch nearby, once run through ACESFilmicToneMapping's shadow
  // rolloff (verified by sampling the actual rendered screenshot's raw
  // pixels, not by eyeballing a thumbnail). That fails the "still readable"
  // bar: a player standing in front of a door they need to open shouldn't
  // see undifferentiated black. Raised the ambient intensity and lightened
  // the hemisphere's ground color so there's a real, if dim, non-zero floor
  // everywhere. Raised once more after user feedback that the overall level
  // still read as too dark day-to-day (own play-testing, not a pixel-clipping
  // bug this time) — torch-adjacent walls stay dramatically brighter by
  // comparison either way, so the mood/contrast holds at both settings.
  // Doubled again (1.3->2.6, 0.8->1.6) per further "still too dark" feedback.
  scene.add(new THREE.AmbientLight(0x3a4a6b, 2.6));
  const skyFill = new THREE.HemisphereLight(0x3a4a6b, 0x241f1a, 1.6);
  scene.add(skyFill);

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
  Position.y[npc] = 0; // the humanoid rig's origin is at its feet, unlike the old cylinder's centered origin
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

  // Issue #54: animated idle/walk mesh instead of the old plain
  // CylinderGeometry placeholder, backed by the procedural humanoid rig
  // (issue #53, src/characters/humanoidRig.ts), which also carries the
  // hit/death one-shots (issue #58) `createAnimatedNpcMesh` wires up.
  const humanoidRig = createHumanoidRig();
  const npcMesh = createAnimatedNpcMesh(humanoidRig, npc); // same userData.eid convention doors' slab meshes use
  scene.add(npcMesh);
  Object3DRef[npc] = npcMesh;

  // World items (issue #39: sword + gem; #75: lantern) are spawned generically
  // by `buildLevel` (level/level.ts's `spawnItems`) from `level/rooms/*.ts`'s
  // data — see `src/assets/types.ts`'s header comment for the full
  // asset-authoring system. Nothing left to wire up here.

  // Inventory UI -> ECS action wiring (issue #39): the store can't mutate
  // the ECS world/camera itself (same as everything else under
  // src/inventory/, mirroring src/hud/'s ECS-agnostic components), so
  // game.ts hands it a small actions object closing over both. See
  // README Design Notes ("Inventory pattern") for why this exists — the
  // HUD only ever needed the opposite (ECS -> store) direction.
  const inventoryActions: InventoryActions = {
    equip(itemEid) {
      equipToOpenHandSlot(world, camera, itemEid);
    },
    // Issue #47: lets the inventory UI put an item in a specific hand
    // (rather than whichever one `equipToOpenHandSlot` picks) once the
    // player has tapped a paper-doll slot for it — the store only ever
    // calls this after confirming that slot is open.
    equipToSlot(itemEid, slot) {
      equipItem(world, camera, itemEid, slot);
    },
    unequip(itemEid) {
      unequipItem(world, itemEid);
    },
  };
  inventoryStore.bindActions(inventoryActions);

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
      // Issue #59: the sector it died in (until corpseCleanupSystem clears
      // it back to undefined once cleaned up), for confirming the corpse
      // cleanup lifecycle end-to-end.
      deathSector: hasComponent(world, npc, DeathSector) ? DeathSector.sectorId[npc] : undefined,
    }),
    // Issue #54: exposes the NPC's animation-mixer state (which of
    // idle/walk is fading in, and the mixer's own clock) so automated
    // (Playwright) tests can confirm the walk/idle crossfade actually
    // happens instead of only inferring it from position deltas.
    getNpcAnimationState: () => getNpcAnimationDebugState(npc),
    // Debug-only direct trigger for automated (Playwright) testing of melee
    // combat (issue #48) without needing to simulate real pointer-lock
    // clicks/touches — fires the exact same `tryMeleeAttack` the real
    // click/touch-button wiring below calls.
    attack: () => tryMeleeAttack(world, camera),
    // Item/inventory debug hooks (issue #39) for manual/automated smoke
    // testing — world item positions to walk to, and each item's current
    // carry/equip state and world-mesh visibility.
    getItemSpawns: () => Object.fromEntries(ALL_ITEM_SPAWNS.map((s) => [s.id, { x: s.x, z: s.z }])),
    getItemStates: () =>
      Array.from(query(world, [Item])).map((eid) => ({
        eid,
        itemTypeId: Item.itemTypeId[eid],
        carried: hasComponent(world, eid, Carried),
        slot: hasComponent(world, eid, Carried) ? Carried.slot[eid] : null,
        worldMeshVisible: Object3DRef[eid]?.visible ?? false,
      })),
    // Only equipped-item viewmodel meshes are ever parented to the camera
    // (see equipItem in ecs/systems/items.ts), so its child count doubles
    // as "how many viewmodels are currently shown".
    getViewmodelCount: () => camera.children.length,
  };

  // Tracks (and logs, on change) the sector the player currently occupies —
  // originally authoring/tracking data only (see README "Sectors"); as of
  // issue #59 it also drives `corpseCleanupSystem` below.
  let currentSector: string | undefined;

  // Edge-detects the NPC's Dead transition (issue #59), the same "was it
  // already in that state last frame" shape `npcAnimation.ts`'s `moving`
  // field uses for idle/walk — `tryMeleeAttack` (combat.ts) adds `Dead` but
  // has no access to `level`, so the one-time `DeathSector` recording has to
  // happen back here instead, right after the call below.
  let npcWasDead = false;

  const keyboard = new Keyboard();
  const pointerLook = new PointerLook(renderer.domElement);
  const touch = new TouchControls(container);
  setupHint(container, renderer.domElement, pointerLook);
  mountHud(container);
  mountInventory(container);

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
    npcAnimationSystem(world, dt);
    movementSystem(world, dt);
    collisionSystem(world);
    doorAnimationSystem(world, dt);

    const interactPressed = keyboard.consumeJustPressed("KeyE") || touch.consumeInteractRequest();
    if (interactPressed) tryInteract(world, camera);

    const attackPressed = attackRequested || touch.consumeAttackRequest();
    attackRequested = false;
    if (attackPressed) tryMeleeAttack(world, camera);
    viewmodelSwingSystem(dt);

    // Issue #59: the NPC just became Dead this frame (edge-detected against
    // `npcWasDead`) — record the sector it died in once, so
    // `corpseCleanupSystem` below knows when the player has left it.
    const npcIsDead = hasComponent(world, npc, Dead);
    if (npcIsDead && !npcWasDead) {
      addComponent(world, npc, DeathSector);
      DeathSector.sectorId[npc] = level.sectorAt(Position.x[npc], Position.z[npc]);
    }
    npcWasDead = npcIsDead;

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
    corpseCleanupSystem(world, sector);

    syncSystem(world);
    hudSync(world);
    inventorySync(world);
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
