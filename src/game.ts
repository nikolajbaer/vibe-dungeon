import * as THREE from "three";
import { addComponent, addEntity, createWorld, hasComponent } from "bitecs";
import { query } from "bitecs";
import { Position, Velocity, Rotation, Collider, PlayerControlled, Object3DRef, Door, Dead, DeathSector, Health, NPC, Item, Carried } from "./ecs/components";
import { inputSystem } from "./ecs/systems/input";
import { movementSystem } from "./ecs/systems/movement";
import { collisionSystem } from "./ecs/systems/collision";
import { doorAnimationSystem, tryInteract } from "./ecs/systems/doors";
import { tryMeleeAttack } from "./ecs/systems/combat";
import { npcSystem, toggleNpcFollow } from "./ecs/systems/npc";
import { getNpcAnimationDebugState, npcAnimationSystem } from "./ecs/systems/npcAnimation";
import { corpseCleanupSystem, MIN_LINGER_SECONDS } from "./ecs/systems/corpseCleanup";
import { equipItem, equipToOpenHandSlot, unequipItem, viewmodelSwingSystem } from "./ecs/systems/items";
import { syncSystem } from "./ecs/systems/sync";
import { hudSync } from "./ecs/systems/hudSync";
import { buildLevel } from "./level/level";
import { ALL_ITEM_SPAWNS } from "./level/rooms";
import { Keyboard } from "./input/keyboard";
import { PointerLook } from "./input/pointerLook";
import { TouchControls, isTouchDevice } from "./input/touchControls";
import { mountHud } from "./hud/mount";
import { hudStore, type HudActions } from "./hud/store";
import { mountInventory } from "./inventory/mount";
import { inventorySync } from "./inventory/sync";
import { inventoryStore, type InventoryActions } from "./inventory/store";
import { mountDialogue } from "./dialogue/mount";
import { dialogueStore, type DialogueActions } from "./dialogue/store";

const EYE_HEIGHT = 1.6;
const PLAYER_HALF_EXTENT = 0.35;
const DEBUG_HEALTH_STEP = 10; // debug-only nudge, see `[`/`]` handling below

// Mirrors `NpcState` (ecs/components.ts) by index, for the debug hook below —
// `getNpcState` reports every NPC entity now (archetypes), not one hardcoded
// test NPC, so it needs a human-readable name per state rather than a single
// FOLLOWING/LOITERING ternary.
const NPC_STATE_NAMES = ["LOITERING", "FOLLOWING", "CHASING", "ATTACKING"];

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

  // NPCs (issue #36, extended into archetypes: docile villager + aggressive
  // bandit — src/assets/npcs/*.ts) are spawned generically by `buildLevel`
  // (level/level.ts's `spawnNpcs`) from `level/rooms/*.ts`'s data, same as
  // world items/props. Nothing left to wire up here.

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

  // Dialogue UI -> ECS action wiring, same shape as inventoryActions above:
  // the only ECS mutation a dialogue choice can trigger today is the
  // "toggleFollow" effect (see src/dialogue/store.ts, src/dialogue/types.ts).
  const dialogueActions: DialogueActions = {
    toggleFollow(npcEid) {
      toggleNpcFollow(npcEid);
    },
  };
  dialogueStore.bindActions(dialogueActions);

  // Player death/respawn UI -> ECS action wiring, same shape again: resets
  // the player back to the level's spawn point, full health, once the
  // DeathOverlay's respawn button is tapped (hudStore.respawn()).
  const hudActions: HudActions = {
    respawn() {
      Position.x[player] = level.spawn.x;
      Position.y[player] = EYE_HEIGHT;
      Position.z[player] = level.spawn.z;
      Rotation.yaw[player] = level.spawn.yaw;
      Rotation.pitch[player] = 0;
      Velocity.x[player] = 0;
      Velocity.z[player] = 0;
      Health.current[player] = Health.max[player];
    },
  };
  hudStore.bindActions(hudActions);

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
    // Debug-only direct health set, for automated (Playwright) testing that
    // needs the player's health to hit 0 in one step (e.g. forcing the
    // death overlay open at a precise moment) rather than through many
    // separate `[`-key nudges, each a real round-trip.
    setHealth: (current: number) => { Health.current[player] = Math.max(0, Math.min(Health.max[player], current)); },
    // Issue #36, extended for archetypes (multiple NPCs, not one hardcoded
    // test NPC) — one entry per NPC entity rather than a single object.
    getNpcState: () =>
      Array.from(query(world, [NPC, Position])).map((eid) => ({
        eid,
        archetypeId: NPC.archetypeId[eid],
        state: NPC_STATE_NAMES[NPC.state[eid]] ?? "UNKNOWN",
        x: Position.x[eid],
        y: Position.y[eid],
        z: Position.z[eid],
        health: Health.current[eid],
        dead: hasComponent(world, eid, Dead),
        meshInScene: Object3DRef[eid]?.parent !== null,
        // Issue #59: the sector it died in (until corpseCleanupSystem clears
        // it back to undefined once cleaned up), for confirming the corpse
        // cleanup lifecycle end-to-end.
        deathSector: hasComponent(world, eid, DeathSector) ? DeathSector.sectorId[eid] : undefined,
      })),
    // Issue #54: exposes an NPC's animation-mixer state (which of idle/walk
    // is fading in, and the mixer's own clock) so automated (Playwright)
    // tests can confirm the walk/idle crossfade actually happens instead of
    // only inferring it from position deltas. Takes an eid (see
    // `getNpcState` above) now that there's more than one NPC.
    getNpcAnimationState: (eid: number) => getNpcAnimationDebugState(eid),
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
    // Dialogue debug hooks, for automated (Playwright) testing of the
    // villager's dialogue tree without needing a real raycast + click.
    getDialogueState: () => ({
      isOpen: dialogueStore.isOpen,
      npcName: dialogueStore.npcName,
      nodeId: dialogueStore.currentNodeId,
      line: dialogueStore.currentNode?.line,
      choices: dialogueStore.currentNode?.choices.map((c) => c.text) ?? [],
    }),
    chooseDialogue: (index: number) => dialogueStore.choose(index),
    // Player death/respawn debug hooks (aggressive NPC archetypes can now
    // actually kill the player).
    isPlayerDefeated: () => hudStore.playerDefeated,
    respawn: () => hudStore.respawn(),
  };

  // Tracks (and logs, on change) the sector the player currently occupies —
  // originally authoring/tracking data only (see README "Sectors"); as of
  // issue #59 it also drives `corpseCleanupSystem` below.
  let currentSector: string | undefined;

  const keyboard = new Keyboard();
  const pointerLook = new PointerLook(renderer.domElement);
  const touch = new TouchControls(container, renderer.domElement);
  setupHint(container, renderer.domElement, pointerLook);
  mountHud(container);
  mountInventory(container);
  mountDialogue(container);

  // Desktop melee attack trigger (issue #48): left-click, but only once
  // pointer lock is already engaged — `PointerLook`'s own click handler
  // requests lock asynchronously (pointer lock only ever activates after
  // this handler returns), so `pointerLook.locked` still reads false on the
  // very click that engages it, meaning that first click never also counts
  // as an attack. Edge-triggered into `attackRequested` and consumed once
  // per frame below, the same "just pressed" shape `interactPressed` uses.
  //
  // Desktop-only: on a touch device attacking is the dedicated ATK button
  // (`touch.consumeAttackRequest()` below) alone. Mobile browsers still
  // synthesize compatibility mouse events (mousedown/click) some time after
  // a real touch, and some also grant Pointer Lock from a touch gesture, so
  // without this guard a plain tap-to-interact could silently also land a
  // melee hit on whatever the player was just trying to talk to.
  let attackRequested = false;
  if (!isTouchDevice()) {
    renderer.domElement.addEventListener("mousedown", (e) => {
      if (e.button === 0 && pointerLook.locked) attackRequested = true;
    });
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);

    // A dialogue panel or the death overlay is a modal — a real pause, not
    // just a movement freeze: nothing in the world should be able to hurt
    // (or be hurt by) the player while either is up, so the whole
    // simulation stands still except look/camera rotation (harmless) and
    // whatever's needed to render the modal itself. Re-checked fresh at
    // each gate below, rather than snapshotted once, since `tryInteract`
    // can open a dialogue mid-frame — an attack later in that same frame
    // must see the just-opened dialogue, not a stale "not open yet" value
    // (this was the actual villager-killing bug: a tap that opened dialogue
    // and a same-frame attack both used one value computed before the
    // dialogue existed).
    const isModalActive = () => dialogueStore.isOpen || hudStore.playerDefeated;

    const modalActive = isModalActive();
    if (modalActive) {
      Velocity.x[player] = 0;
      Velocity.z[player] = 0;
    } else {
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
    }
    // Runs every frame regardless of `modalActive` — see its own doc
    // comment for why a death/hit one-shot has to keep playing through a
    // pause even though ambient idle/walk freezes with everything else.
    npcAnimationSystem(world, dt, modalActive);

    const interactRequested = keyboard.consumeJustPressed("KeyE") || touch.consumeInteractRequest();
    if (interactRequested && !isModalActive()) tryInteract(world, camera);

    const attackRequestedThisFrame = attackRequested || touch.consumeAttackRequest();
    attackRequested = false;
    if (attackRequestedThisFrame && !isModalActive()) tryMeleeAttack(world, camera);
    viewmodelSwingSystem(dt);

    // Belt-and-suspenders alongside the pause above: if the NPC a dialogue
    // is open for ends up Dead by any other means, drop the dialogue rather
    // than leave it showing lines for a corpse.
    if (dialogueStore.isOpen && dialogueStore.activeNpcEid !== null && hasComponent(world, dialogueStore.activeNpcEid, Dead)) {
      dialogueStore.close();
    }

    // Issue #59, extended for archetypes (issue #36 follow-up): any NPC that
    // just became Dead and doesn't have a `DeathSector` yet gets one
    // recorded once — `tryMeleeAttack` (combat.ts) adds `Dead` but has no
    // access to `level`, so this one-time recording has to happen back here
    // instead, right after the call below. Checking "no DeathSector yet"
    // rather than an edge-detected boolean works the same for any number of
    // NPCs, not just one hardcoded test NPC.
    for (const eid of query(world, [NPC, Dead])) {
      if (!hasComponent(world, eid, DeathSector)) {
        addComponent(world, eid, DeathSector);
        DeathSector.sectorId[eid] = level.sectorAt(Position.x[eid], Position.z[eid]);
        DeathSector.lingerRemaining[eid] = MIN_LINGER_SECONDS;
      }
    }

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
    // Skipped during a pause along with everything else in the `modalActive`
    // branch above — a corpse's linger timer shouldn't burn down while the
    // game is sitting on a dialogue or the death overlay.
    if (!modalActive) corpseCleanupSystem(world, sector, dt);

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
