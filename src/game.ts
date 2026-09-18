import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { addComponent, addEntity, createWorld, hasComponent } from "bitecs";
import { query } from "bitecs";
import { Position, Velocity, Rotation, CharacterBody, DynamicBody, PhysicsBody, PhysicsCollider, PhysicsRotation, RenderOffsetY, PlayerControlled, Object3DRef, Door, Dead, DeathSector, Health, NPC, Item, Carried, Readable, Container, Stackable } from "./ecs/components";
import { inputSystem } from "./ecs/systems/input";
import { characterSystem, physicsSyncSystem, teleportCharacter } from "./ecs/systems/character";
import { dynamicSyncSystem } from "./ecs/systems/dynamics";
import { addCharacter, createPhysics, PHYSICS_DT } from "./physics/world";
import { doorAnimationSystem, tryInteract } from "./ecs/systems/doors";
import { tryMeleeAttack } from "./ecs/systems/combat";
import { npcSystem, toggleNpcFollow } from "./ecs/systems/npc";
import { getNpcAnimationDebugState, npcAnimationSystem } from "./ecs/systems/npcAnimation";
import { corpseCleanupSystem, MIN_LINGER_SECONDS } from "./ecs/systems/corpseCleanup";
import { equipItem, equipToOpenHandSlot, giveItem, isHandSlot, unequipItem, viewmodelSwingSystem, wouldExceedCarryWeight, wouldExceedInventorySlots } from "./ecs/systems/items";
import { syncSystem } from "./ecs/systems/sync";
import { hudSync } from "./ecs/systems/hudSync";
import { buildLevel } from "./level/level";
import { dropCarriedItem } from "./level/spawning";
import { refreshDynamicShadows } from "./level/visibility";
import { floorForY } from "./level/tiles";
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
import { mountNotice } from "./notice/mount";
import { noticeStore } from "./notice/store";
import { mountContainer } from "./container/mount";
import { containerSync } from "./container/sync";
import { containerStore, type ContainerActions } from "./container/store";

const EYE_HEIGHT = 1.6; // camera height above the player's feet
// How far in front of the player (meters) and how far above their feet a
// dropped item lands/falls from -- close enough to immediately walk back
// onto if you change your mind, falling from just above head height like a
// freshly-authored `ItemSpawn` (see `ITEM_HEIGHT` in level/spawning.ts).
const DROP_DISTANCE = 0.8;
const DROP_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.35;
const PLAYER_HEIGHT = 1.8;
/** Half-height of the capsule's straight section; the two `PLAYER_RADIUS`
 * caps make up the rest of `PLAYER_HEIGHT`. */
const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
const DEBUG_HEALTH_STEP = 10; // debug-only nudge, see `[`/`]` handling below

/** Ceiling on physics steps per rendered frame — see the accumulator in
 * `frame` for why (spiral-of-death guard). */
const MAX_PHYSICS_STEPS_PER_FRAME = 5;

/** Padding (meters) added to a torch's own light range when deciding
 * whether the player/an NPC is close enough to need a fresh shadow-map
 * render this frame — see `level/visibility.ts`'s `refreshDynamicShadows`.
 * Covers a mover's own size (its shadow can start forming slightly before
 * its center point is within the light's nominal range); the humanoid rig's
 * total height (`HUMANOID_HEIGHT`, level/spawning.ts) is 1.75m, so this
 * comfortably covers a mover at any point along its own height/width. */
const SHADOW_REFRESH_MARGIN = 2;

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
  // Issue #64 originally enabled point-light shadows here for "moody"
  // atmosphere. Perf investigation follow-up: in actual play, the shadows
  // this produced were never really visible (torches are small, close to
  // the walls they're mounted on, and the geometry they'd shadow onto is
  // mostly flat wall/floor right behind them) -- real, ongoing user
  // feedback confirmed this rather than a one-off screenshot. A real-time
  // shadow map is a full extra render pass per shadow-casting light, every
  // frame it's active, which is a genuinely large cost for essentially zero
  // visible payoff. Disabled globally here rather than per-light: every
  // individual torch still declares `castShadow = true`/its own shadow-map
  // settings (tileBuilder.ts's `addTorch`), and `level/visibility.ts`'s
  // sector-based gating of that flag still runs -- both are simply inert
  // while this is `false`, so flipping it back to `true` alone is enough to
  // restore shadows (with all of that machinery already in place) if a
  // future lighting pass finds a way to make them actually read on screen.
  renderer.shadowMap.enabled = false;
  container.appendChild(renderer.domElement);

  // Perf-profiling infra -- three's own stock FPS/ms/MB panel (click to
  // cycle panels), top-left by its own default fixed positioning. Exists
  // specifically to give the "no perf-profiling infra to confirm that
  // number" gap noted above (and any future room-culling/instancing work) a
  // real, always-visible number instead of eyeballing framerate by feel.
  const stats = new Stats();
  container.appendChild(stats.dom);

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
  const physics = createPhysics();
  const level = buildLevel(world, physics, scene);

  const player = addEntity(world);
  addComponent(world, player, Position);
  addComponent(world, player, Velocity);
  addComponent(world, player, Rotation);
  addComponent(world, player, CharacterBody);
  addComponent(world, player, PhysicsBody);
  addComponent(world, player, PhysicsCollider);
  addComponent(world, player, PlayerControlled);
  addComponent(world, player, Object3DRef);
  addComponent(world, player, Health);
  // `Position` is the player's *feet* now, not the camera — see
  // `CharacterBody` in components.ts. The camera is offset back up to eye
  // height by `RenderOffsetY` at sync time, which also makes the player's
  // position mean the same thing an NPC's does (it never did before).
  Position.x[player] = level.spawn.x;
  Position.y[player] = 0;
  Position.z[player] = level.spawn.z;
  Velocity.x[player] = 0;
  Velocity.z[player] = 0;
  Rotation.yaw[player] = level.spawn.yaw;
  Rotation.pitch[player] = 0;
  CharacterBody.radius[player] = PLAYER_RADIUS;
  CharacterBody.halfHeight[player] = PLAYER_HALF_HEIGHT;
  CharacterBody.verticalVelocity[player] = 0;
  CharacterBody.grounded[player] = 0;
  const playerBody = addCharacter(physics, level.spawn.x, 0, level.spawn.z, PLAYER_RADIUS, PLAYER_HALF_HEIGHT);
  PhysicsBody[player] = playerBody.body;
  PhysicsCollider[player] = playerBody.collider;
  RenderOffsetY[player] = EYE_HEIGHT;
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
      // Unequipping lands in the main inventory list (slot "inventory"),
      // same cap a fresh pickup or a container take respects
      // (`wouldExceedInventorySlots` in items.ts) -- a hand slot isn't part
      // of that list, so putting an item back into it can push it over.
      if (wouldExceedInventorySlots(world, player, itemEid)) {
        hudStore.showMessage("Inventory is full.");
        return;
      }
      unequipItem(world, itemEid);
    },
    // Drop zone (issue: item drop) -- unequip first (detaches the
    // viewmodel/frees the hand slot) if it's currently equipped, then drop
    // it a short distance in front of wherever the player's currently
    // facing, falling from just above head height like a freshly-authored
    // `ItemSpawn` would.
    drop(itemEid) {
      if (isHandSlot(Carried.slot[itemEid])) unequipItem(world, itemEid);

      const yaw = Rotation.yaw[player];
      const dropX = Position.x[player] - Math.sin(yaw) * DROP_DISTANCE;
      const dropZ = Position.z[player] - Math.cos(yaw) * DROP_DISTANCE;
      const dropY = Position.y[player] + DROP_HEIGHT;
      // Resolved via the same `level.sectorAt` the frame loop already uses
      // for sector tracking, so a dropped item's mesh gets (re)tagged to
      // wherever it's actually landing, not wherever it happened to be
      // spawned or picked up (see `dropCarriedItem`'s own doc comment).
      const dropSector = level.sectorAt(dropX, dropY, dropZ);
      dropCarriedItem(world, physics, scene, level.visibility, dropSector, itemEid, dropX, dropY, dropZ);
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

  // Container UI -> ECS action wiring, same shape again: moving an item
  // between the player's inventory and an open container is just
  // repointing `Carried.ownerEid`/`slot` — no viewmodel/physics side
  // effects either way, since a carried item's mesh is already hidden and
  // its physics body already disabled the moment it's first picked up (see
  // `pickUpItem` in items.ts), regardless of which entity currently owns it.
  const containerActions: ContainerActions = {
    moveToContainer(itemEid, containerEid, quantity) {
      if (!hasComponent(world, itemEid, Carried)) return;
      // No nesting a container inside another container (a backpack inside
      // a barrel, or inside itself) -- `ContainerPanel.tsx` already hides
      // this button for a container item, but guard it here too since this
      // is also reachable directly from the debug hooks.
      if (hasComponent(world, itemEid, Container)) return;
      // Looting is take-only -- can't leave something on a corpse.
      // `ContainerPanel.tsx` already disables this button when
      // `containerStore.isLootOnly`, same belt-and-suspenders reasoning.
      if (hasComponent(world, containerEid, Dead)) return;
      // No weight check here -- storing into any container the player
      // controls never increases their own total: a barrel isn't carried by
      // them at all (the item's weight simply leaves their pool), and a
      // backpack they're already carrying already counts its contents
      // recursively (`carriedWeight` in items.ts), so moving something into
      // it is weight-neutral regardless of quantity.
      giveItem(world, itemEid, containerEid, quantity);
    },
    moveToPlayer(itemEid, quantity) {
      if (!hasComponent(world, itemEid, Carried)) return;
      // Same cap a fresh world pickup enforces (see `wouldExceedCarryWeight`
      // in items.ts) — otherwise it could be dodged by stashing items in a
      // *world* container first and unloading them all back out at once.
      // A no-op for an item already counted toward the player's total (one
      // sitting in a backpack they're already carrying) -- moving it to the
      // main inventory list doesn't change how much they're carrying.
      if (wouldExceedCarryWeight(world, player, itemEid, quantity)) {
        hudStore.showMessage("Too heavy to carry.");
        return;
      }
      // Same inventory-list slot cap a fresh pickup enforces
      // (`wouldExceedInventorySlots`) -- taking something out of a barrel or
      // a backpack still lands in slot "inventory", so it's just as capped
      // as picking it up off the floor would be (merging into a stack the
      // player already carries never counts against this, quantity or not).
      if (wouldExceedInventorySlots(world, player, itemEid)) {
        hudStore.showMessage("Inventory is full.");
        return;
      }
      giveItem(world, itemEid, player, quantity);
    },
  };
  containerStore.bindActions(containerActions);

  // Player death/respawn UI -> ECS action wiring, same shape again: resets
  // the player back to the level's spawn point, full health, once the
  // DeathOverlay's respawn button is tapped (hudStore.respawn()).
  const hudActions: HudActions = {
    respawn() {
      // Has to go through the physics body, not just `Position` — Rapier is
      // the authority on where a character is, so writing `Position` alone
      // would be overwritten by the next `physicsSyncSystem` and the player
      // would snap right back to where they died.
      teleportCharacter(player, level.spawn.x, 0, level.spawn.z);
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
    // `y` is the player's feet (see `CharacterBody`), not the camera — the
    // camera sits EYE_HEIGHT above it.
    getPlayerPosition: () => ({ x: Position.x[player], y: Position.y[player], z: Position.z[player] }),
    // The player entity's own eid, so a test can tell "carried by the
    // player" (getItemStates' `ownerEid`) apart from "carried by some
    // other owner" (a barrel, a corpse) without hardcoding an assumed id.
    getPlayerEid: () => player,
    // Physics state, for confirming the character controller is actually
    // resting on the floor rather than falling through it or hovering.
    getPlayerPhysics: () => ({
      grounded: CharacterBody.grounded[player] === 1,
      verticalVelocity: CharacterBody.verticalVelocity[player],
      cameraY: camera.position.y,
    }),
    getDoorStates: () =>
      Array.from(query(world, [Door])).map((eid) => {
        const obj = Object3DRef[eid];
        return {
          eid,
          state: Door.state[eid],
          progress: Door.progress[eid],
          locked: Door.locked[eid] === 1,
          requiredItemTypeId: Door.requiredItemTypeId[eid],
          x: obj?.position.x,
          z: obj?.position.z,
        };
      }),
    // Every simulated prop/item body, for confirming things actually settle
    // on the floor, stack, and move when shoved rather than hovering at
    // their authored spawn transform.
    getDynamicBodies: () =>
      Array.from(query(world, [DynamicBody, Position, PhysicsRotation])).map((eid) => {
        const body = PhysicsBody[eid];
        const linvel = body?.linvel();
        return {
          eid,
          itemTypeId: hasComponent(world, eid, Item) ? Item.itemTypeId[eid] : undefined,
          x: Position.x[eid],
          y: Position.y[eid],
          z: Position.z[eid],
          quat: [PhysicsRotation.x[eid], PhysicsRotation.y[eid], PhysicsRotation.z[eid], PhysicsRotation.w[eid]],
          speed: linvel ? Math.hypot(linvel.x, linvel.y, linvel.z) : 0,
          sleeping: body?.isSleeping() ?? false,
          enabled: body?.isEnabled() ?? false,
        };
      }),
    setYaw: (yaw: number) => { Rotation.yaw[player] = yaw; },
    setPitch: (pitch: number) => { Rotation.pitch[player] = pitch; },
    // Debug-only hard teleport (bypasses normal movement/collision
    // resolution entirely), for automated tests that need to reach specific
    // coordinates directly rather than walk there -- e.g. confirming a wall
    // exists in space that ordinary ramp-walking can't reach, or skipping
    // past pure transit to the area actually under test (see
    // tests/integration/stairwell-wall-gaps.spec.mjs and bandit-combat.spec.mjs).
    teleportPlayer: (x: number, feetY: number, z: number) => { teleportCharacter(player, x, feetY, z); },
    // Projects a world position to CSS pixel coordinates on the canvas —
    // for automated (Playwright) testing of tap-to-interact-off-center,
    // which needs to compute exactly where an object renders on screen
    // without duplicating three.js's own projection math in the test.
    worldToScreen: (x: number, y: number, z: number) => {
      const ndcPoint = new THREE.Vector3(x, y, z).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + ((ndcPoint.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - ndcPoint.y) / 2) * rect.height,
      };
    },
    getRotation: () => ({ yaw: Rotation.yaw[player], pitch: Rotation.pitch[player] }),
    getCurrentSector: () => currentSector,
    // Issue #86 (multi-level/stairs): which floor the player's current Y
    // resolves to (see `floorForY`, level/tiles.ts) — for automated
    // (Playwright) verification that climbing a staircase actually lands on
    // the upper floor, not just "moved upward some amount".
    getPlayerFloor: () => floorForY(Position.y[player]),
    getHealth: () => ({ current: Health.current[player], max: Health.max[player] }),
    // Debug-only direct health set, for automated (Playwright) testing that
    // needs the player's health to hit 0 in one step (e.g. forcing the
    // death overlay open at a precise moment) rather than through many
    // separate `[`-key nudges, each a real round-trip.
    setHealth: (current: number) => { Health.current[player] = Math.max(0, Math.min(Health.max[player], current)); },
    // Same idea as setHealth above, but for any NPC eid (getNpcState) --
    // lets automated (Playwright) testing kill an NPC instantly (for
    // lootable-corpse testing) rather than simulating a full combat
    // encounter just to get a body on the ground.
    setNpcHealth: (eid: number, current: number) => { Health.current[eid] = Math.max(0, Math.min(Health.max[eid], current)); },
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
        // Whoever currently `Carried`s it -- the player, a barrel, a
        // backpack, or a corpse (see `Carried.ownerEid`) -- so a test can
        // tell "carried by the player" apart from "carried by a container",
        // both of which are `carried: true` above. `null` for an uncarried
        // world item.
        ownerEid: hasComponent(world, eid, Carried) ? Carried.ownerEid[eid] : null,
        slot: hasComponent(world, eid, Carried) ? Carried.slot[eid] : null,
        worldMeshVisible: Object3DRef[eid]?.visible ?? false,
        // `undefined` for an ordinary item, and 0 for a `Stackable` entity
        // that's been fully merged away into another stack (never
        // destroyed -- see `Stackable`'s doc comment in ecs/components.ts).
        count: hasComponent(world, eid, Stackable) ? Stackable.count[eid] : undefined,
      })),
    // Carry-weight debug hook (phase 3 of the inventory expansion), for
    // automated (Playwright) testing of the carry-weight cap (`maxCarryWeight`
    // in ecs/systems/items.ts) without reading it off the rendered readout
    // (`WeightReadout.tsx`).
    getCarryWeight: () => ({ weight: inventoryStore.weight, maxWeight: inventoryStore.maxWeight }),
    // Only equipped-item viewmodel meshes are ever parented to the camera
    // (see equipItem in ecs/systems/items.ts), so its child count doubles
    // as "how many viewmodels are currently shown".
    getViewmodelCount: () => camera.children.length,
    // Every current viewmodel's camera-relative transform plus its
    // renderOrder -- for automated (Playwright) testing of attack
    // animations (e.g. confirming a weapon's rotation stays fixed through a
    // stab rather than swinging) and of `makeRenderOnTop` (ecs/systems/
    // items.ts) actually having applied.
    getViewmodelTransforms: () =>
      camera.children.map((child) => ({
        position: { x: child.position.x, y: child.position.y, z: child.position.z },
        rotation: { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z },
        renderOrder: child.renderOrder,
      })),
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
    // Lets an automated test dismiss a dialogue it opened incidentally —
    // e.g. while walking past the villager pressing E to open doors, which
    // is exactly what a real player mashing interact would do too.
    closeDialogue: () => dialogueStore.close(),
    // Every placed readable (poster/scroll)'s position plus its content, so
    // an automated test can find and walk to one without hand-deriving
    // world coordinates from a room file.
    getReadableStates: () =>
      Array.from(query(world, [Readable, Object3DRef])).map((eid) => {
        const obj = Object3DRef[eid];
        return {
          eid,
          title: Readable.title[eid],
          pageCount: Readable.pages[eid].length,
          x: obj?.position.x,
          z: obj?.position.z,
        };
      }),
    // Notice-reader debug hooks, mirroring the dialogue ones above, for
    // automated (Playwright) testing of posters/scrolls without a real
    // raycast + click.
    getNoticeState: () => ({
      isOpen: noticeStore.isOpen,
      title: noticeStore.title,
      page: noticeStore.currentPage,
      pageIndex: noticeStore.pageIndex,
      pageCount: noticeStore.pages.length,
    }),
    noticeNext: () => noticeStore.next(),
    noticePrev: () => noticeStore.prev(),
    closeNotice: () => noticeStore.close(),
    // Every placed container (a barrel)'s position plus capacity, so an
    // automated test can find and walk to one without hand-deriving world
    // coordinates from a room file.
    getContainerEntities: () =>
      Array.from(query(world, [Container, Object3DRef])).map((eid) => {
        const obj = Object3DRef[eid];
        return { eid, capacity: Container.capacity[eid], x: obj?.position.x, z: obj?.position.z };
      }),
    // Container-panel debug hooks, mirroring the notice/dialogue ones
    // above, for automated (Playwright) testing of storing/taking items
    // without a real raycast + click.
    getContainerState: () => ({
      isOpen: containerStore.isOpen,
      activeEid: containerStore.activeEid,
      capacity: containerStore.capacity,
      contents: containerStore.contents.map((item) => ({ eid: item.eid, itemTypeId: item.itemTypeId, count: item.count })),
    }),
    // `quantity` lets a test move part of a stack (a coin pile) without
    // going through the quantity-picker UI (`ContainerPanel.tsx`'s
    // `pendingTransfer`) -- omitted, this moves the item's entire current
    // count, same as tapping a non-stackable item.
    storeItemInContainer: (itemEid: number, quantity?: number) => containerStore.store(itemEid, Item.itemTypeId[itemEid], quantity),
    takeItemFromContainer: (itemEid: number, quantity?: number) => containerStore.take(itemEid, quantity),
    closeContainer: () => containerStore.close(),
    // Player death/respawn debug hooks (aggressive NPC archetypes can now
    // actually kill the player).
    isPlayerDefeated: () => hudStore.playerDefeated,
    respawn: () => hudStore.respawn(),
    // Perf-profiling debug hooks (see level/visibility.ts and the Stats
    // panel above) — `renderer.info`'s draw-call/triangle counts are
    // hardware-independent facts about what's being asked of the GPU each
    // frame, unlike raw FPS (meaningless in a software-rendered CI/sandbox
    // browser). `getVisibilityDebugCounts` lets an automated (Playwright)
    // test confirm sector-based shadow/geometry gating is actually doing
    // something (a real, measured drop when the player walks away from a
    // sector) rather than only trusting the code path ran.
    getRendererInfo: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      lines: renderer.info.render.lines,
      points: renderer.info.render.points,
    }),
    getVisibilityDebugCounts: () => level.getVisibilityDebugCounts(),
    // How many lights `refreshDynamicShadows` flagged `needsUpdate = true`
    // for on the *previous* rendered frame -- dormant along with the rest of
    // the shadow system while `renderer.shadowMap.enabled` is `false` (see
    // that flag's own comment above), but harmless and cheap to keep
    // reporting in case shadows come back.
    getShadowRefreshCount: () => lastShadowRefreshCount,
  };

  // Tracks (and logs, on change) the sector the player currently occupies —
  // originally authoring/tracking data only (see README "Sectors"); as of
  // issue #59 it also drives `corpseCleanupSystem` below.
  let currentSector: string | undefined;
  // Last frame's `refreshDynamicShadows` return value -- purely a debug/
  // measurement number (see `getShadowRefreshCount` below), not read by
  // anything else.
  let lastShadowRefreshCount = 0;

  const keyboard = new Keyboard();
  const pointerLook = new PointerLook(renderer.domElement);
  const touch = new TouchControls(container, renderer.domElement);
  mountHud(container);
  mountInventory(container);
  mountDialogue(container);
  mountNotice(container);
  mountContainer(container);

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
  let accumulator = 0;
  function frame() {
    requestAnimationFrame(frame);
    stats.begin();
    const dt = Math.min(clock.getDelta(), 0.1);

    // A dialogue panel, the notice reader, or the death overlay is a modal
    // — a real pause, not just a movement freeze: nothing in the world
    // should be able to hurt (or be hurt by) the player while any is up, so
    // the whole simulation stands still except look/camera rotation
    // (harmless) and whatever's needed to render the modal itself.
    // Re-checked fresh at each gate below, rather than snapshotted once,
    // since `tryInteract` can open a dialogue mid-frame — an attack later
    // in that same frame must see the just-opened dialogue, not a stale
    // "not open yet" value (this was the actual villager-killing bug: a tap
    // that opened dialogue and a same-frame attack both used one value
    // computed before the dialogue existed).
    const isModalActive = () => dialogueStore.isOpen || noticeStore.isOpen || containerStore.isOpen || hudStore.playerDefeated;

    const modalActive = isModalActive();
    if (modalActive) {
      Velocity.x[player] = 0;
      Velocity.z[player] = 0;
      // Don't bank real time while paused, or the sim would fast-forward
      // through the backlog the instant the dialogue closes.
      accumulator = 0;
    } else {
      // Look/move input is read once per rendered frame (it consumes
      // accumulated mouse/touch deltas), not once per physics step.
      inputSystem(world, dt, {
        keyboard,
        look: pointerLook,
        moveStick: touch.moveStick,
        touchLook: touch.lookDrag,
      });

      // Rapier needs a fixed timestep to stay stable, so real frame time is
      // accumulated and spent in constant-size steps. The step cap stops a
      // long frame (a tab regaining focus, a slow software-rendered frame)
      // from queueing up more simulation than the next frame can afford and
      // spiralling; the leftover is dropped rather than paid back.
      accumulator += dt;
      let steps = 0;
      while (accumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS_PER_FRAME) {
        accumulator -= PHYSICS_DT;
        steps++;
        npcSystem(world, PHYSICS_DT);
        characterSystem(world, physics, PHYSICS_DT);
        doorAnimationSystem(world, PHYSICS_DT);
        physics.world.step();
        physicsSyncSystem(world);
        dynamicSyncSystem(world);
      }
      if (steps === MAX_PHYSICS_STEPS_PER_FRAME) accumulator = 0;
    }
    // Runs every frame regardless of `modalActive` — see its own doc
    // comment for why a death/hit one-shot has to keep playing through a
    // pause even though ambient idle/walk freezes with everything else.
    npcAnimationSystem(world, dt, modalActive);

    // Consumed unconditionally (not inside the `||` below) so a pending
    // touch tap is never left unconsumed by short-circuit evaluation — not
    // that desktop and touch input are ever live at once, but there's no
    // reason to rely on that.
    const touchInteractPoint = touch.consumeInteractRequest();
    const interactRequested = keyboard.consumeJustPressed("KeyE") || touchInteractPoint !== null;
    // A touch tap raycasts from wherever it actually landed on screen
    // (letting you interact with something off to the side without turning
    // to face it); `KeyE` has no such point — under pointer lock there's no
    // real cursor position to give it — so it falls back to the reticle.
    // See `tryInteract`'s own doc comment for why these are genuinely
    // different rays, not the same one in disguise.
    if (interactRequested && !isModalActive()) tryInteract(world, camera, touchInteractPoint ?? undefined);

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
        DeathSector.sectorId[eid] = level.sectorAt(Position.x[eid], Position.y[eid], Position.z[eid]);
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

    const sector = level.sectorAt(Position.x[player], Position.y[player], Position.z[player]);
    if (sector !== currentSector) {
      currentSector = sector;
      console.log(`[sector] entered "${currentSector ?? "(none)"}"`);
    }
    // Perf investigation (see level/visibility.ts): gates shadow-casting
    // torches and static level geometry (walls/floors/ceilings/doors/
    // staircases/props/items/readables) down to the player's current sector
    // plus whatever's one open connection away.
    // Called every frame rather than only inside the `sector !== currentSector`
    // branch above on purpose — `updateVisibility` already no-ops internally
    // when the active set hasn't changed, and calling it unconditionally
    // means it self-corrects if `currentSector`'s bookkeeping and the actual
    // active set ever drift apart, rather than trusting they always move in
    // lockstep.
    level.updateVisibility(sector);
    // Skipped during a pause along with everything else in the `modalActive`
    // branch above — a corpse's linger timer shouldn't burn down while the
    // game is sitting on a dialogue or the death overlay.
    if (!modalActive) corpseCleanupSystem(world, sector, dt);

    syncSystem(world);
    hudSync(world);
    inventorySync(world);
    containerSync(world);
    // Perf follow-up on shadow gating (see level/visibility.ts's
    // `refreshDynamicShadows`): every currently-active torch has
    // `shadow.autoUpdate = false` (tileBuilder.ts's `addTorch`), so its
    // shadow map only gets re-rendered when this says to -- either because
    // it just turned on (handled inside `applySectorVisibility`) or because
    // something that actually casts a shadow (the player, an NPC) is close
    // enough that a stale shadow would be visible. Gathered fresh every
    // frame since these are exactly the entities that move.
    const shadowMovers = [{ x: Position.x[player], y: Position.y[player], z: Position.z[player] }];
    for (const eid of query(world, [NPC, Position])) {
      shadowMovers.push({ x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] });
    }
    lastShadowRefreshCount = refreshDynamicShadows(level.visibility, shadowMovers, SHADOW_REFRESH_MARGIN);
    renderer.render(scene, camera);
    stats.end();
  }
  frame();
}

