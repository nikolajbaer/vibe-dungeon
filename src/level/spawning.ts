import * as THREE from "three";
import { addComponent, addEntity, type World } from "bitecs";
import { Position, Velocity, CharacterBody, PhysicsBody, PhysicsCollider, Object3DRef, Item, NPC, NpcState, Health } from "../ecs/components";
import { ITEM_REGISTRY } from "../assets/itemRegistry";
import { FURNITURE_REGISTRY } from "../assets/furnitureRegistry";
import { NPC_REGISTRY } from "../assets/npcRegistry";
import type { PropPlacement, ItemSpawn, NpcSpawn } from "./placementTypes";
import { addCharacter, addStaticBox, type Physics } from "../physics/world";

// Generic spawners for the asset-authoring system: turn plain `PropPlacement`/
// `ItemSpawn` data (src/level/rooms/*.ts) into real ECS entities + three.js
// meshes, by looking assets up in the registries (src/assets/*Registry.ts)
// instead of one hand-written function call per prop/item. This is the
// piece that made every previous new asset touch shared code (a
// `addTable`/`addBanner`-style function *and* a call to it inside
// `addDecorations()`) — now it's data in, entities out, once, generically.

const ITEM_HEIGHT = 1; // meters off the floor — roughly a low table/pedestal height

// Generous invisible raycast target radius for item pickup — an item's
// actual visual mesh can be quite thin (the sword's blade, say), which made
// `tryInteract`'s camera-forward raycast (doors.ts) frustratingly precise to
// land on. Wrapping each item's real mesh together with an invisible sphere
// this size means aiming anywhere reasonably close to the item — not
// pixel-perfect on its thin visible geometry — registers a hit, without
// changing the interact raycast's mechanics or its 3m range.
const ITEM_PICKUP_RADIUS = 0.35;

/**
 * Wraps an item's visual mesh in a `THREE.Group` alongside an invisible,
 * generously-sized sphere (see `ITEM_PICKUP_RADIUS`) that's the actual, more
 * forgiving raycast target — three.js's `Raycaster` tests invisible objects
 * exactly like visible ones (`.visible` only affects rendering), so this
 * costs nothing at render time. Both the visual mesh and the hitbox carry
 * `userData.eid` (same convention as every other raycastable mesh — a door
 * leaf's slab, the NPC's mesh) so either one being hit resolves back to the
 * same entity; the returned group (not the bare mesh) becomes the item's
 * `Object3DRef`, so hiding it on pickup (`pickUpItem` in
 * `ecs/systems/items.ts`) still hides both.
 */
function withPickupHitbox(mesh: THREE.Object3D, eid: number): THREE.Group {
  mesh.userData.eid = eid;
  const hitbox = new THREE.Mesh(new THREE.SphereGeometry(ITEM_PICKUP_RADIUS, 8, 6));
  hitbox.visible = false;
  hitbox.userData.eid = eid;
  const group = new THREE.Group();
  group.add(mesh, hitbox);
  return group;
}

/** Height (meters) of a prop's collider when its asset doesn't declare one —
 * roughly table/barrel height, tall enough to block a walking character
 * without being climbable via the character controller's autostep. Only a
 * default: an asset with a `footprint.hy` gets exactly that instead. */
const DEFAULT_PROP_HALF_HEIGHT = 0.6;

/** Adds one prop's static Rapier box — no ECS entity, exactly like a wall
 * segment (see tileBuilder.ts's `addWall`): a prop never moves and nothing
 * queries it as an entity, so the collider is all it actually needs. Props
 * sit with their mesh origin on the floor, so the box is centered half its
 * height up. */
function addPropCollider(physics: Physics, x: number, z: number, hx: number, hy: number, hz: number): void {
  addStaticBox(physics, x, hy, z, hx, hy, hz);
}

/**
 * Places every item spawn as a real `Item` + `Position` + `Object3DRef`
 * entity (no `Carried` component — see `pickUpItem` in
 * `ecs/systems/items.ts` for what picking one up adds), built from its
 * `ItemAssetDef.createWorldMesh()`. Throws if a spawn references an unknown
 * item id — the same "fail loudly at load time" philosophy as
 * `occupancy.ts`'s `validateOccupancy`, rather than silently rendering
 * nothing.
 */
export function spawnItems(world: World, scene: THREE.Scene, spawns: ItemSpawn[]): void {
  for (const spawn of spawns) {
    const def = ITEM_REGISTRY[spawn.id];
    if (!def) throw new Error(`spawnItems: unknown item id "${spawn.id}"`);

    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, Object3DRef);
    addComponent(world, eid, Item);
    Position.x[eid] = spawn.x;
    Position.y[eid] = spawn.y ?? ITEM_HEIGHT;
    Position.z[eid] = spawn.z;
    Item.itemTypeId[eid] = def.id;

    const mesh = def.createWorldMesh();
    const group = withPickupHitbox(mesh, eid);
    scene.add(group);
    Object3DRef[eid] = group;
  }
}

const NPC_INITIAL_WANDER_PAUSE = 2; // seconds before its first idle wander leg

/** Total height (meters) of the humanoid rig every NPC archetype currently
 * shares — matches `HEAD_TOP_Y` in characters/humanoidRig.ts. Used to size
 * the physics capsule; an archetype with a genuinely different body would
 * want this on `NpcArchetypeDef` instead. */
const HUMANOID_HEIGHT = 1.75;

/**
 * Places every NPC spawn as a real `NPC` + `Position` + `Velocity` +
 * `CharacterBody` + `Health` + `Object3DRef` entity, starting `LOITERING` at
 * its spawn point (its own initial "home" for wandering — see `NPC`'s doc
 * comment in `ecs/components.ts`), built from its `NpcArchetypeDef.createMesh()`.
 * Each also gets a kinematic capsule body driven by the same character
 * controller the player uses (`ecs/systems/character.ts`), so an NPC walks
 * into walls, stands on floors and falls under gravity exactly like the
 * player does. Throws if a spawn references an unknown archetype id.
 */
export function spawnNpcs(world: World, physics: Physics, scene: THREE.Scene, spawns: NpcSpawn[]): void {
  for (const spawn of spawns) {
    const archetype = NPC_REGISTRY[spawn.id];
    if (!archetype) throw new Error(`spawnNpcs: unknown NPC archetype id "${spawn.id}"`);

    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, Velocity);
    addComponent(world, eid, CharacterBody);
    addComponent(world, eid, PhysicsBody);
    addComponent(world, eid, PhysicsCollider);
    addComponent(world, eid, NPC);
    addComponent(world, eid, Object3DRef);
    addComponent(world, eid, Health);
    Position.x[eid] = spawn.x;
    Position.y[eid] = 0; // the humanoid rig's origin is at its feet
    Position.z[eid] = spawn.z;
    Velocity.x[eid] = 0;
    Velocity.z[eid] = 0;

    const radius = archetype.halfExtent;
    const halfHeight = Math.max(0.05, HUMANOID_HEIGHT / 2 - radius);
    CharacterBody.radius[eid] = radius;
    CharacterBody.halfHeight[eid] = halfHeight;
    CharacterBody.verticalVelocity[eid] = 0;
    CharacterBody.grounded[eid] = 0;
    const handles = addCharacter(physics, spawn.x, 0, spawn.z, radius, halfHeight);
    PhysicsBody[eid] = handles.body;
    PhysicsCollider[eid] = handles.collider;

    NPC.state[eid] = NpcState.LOITERING;
    NPC.homeX[eid] = spawn.x;
    NPC.homeZ[eid] = spawn.z;
    NPC.wanderTargetX[eid] = spawn.x;
    NPC.wanderTargetZ[eid] = spawn.z;
    NPC.wanderTimer[eid] = NPC_INITIAL_WANDER_PAUSE;
    NPC.archetypeId[eid] = archetype.id;
    NPC.attackCooldownRemaining[eid] = 0;
    Health.current[eid] = archetype.health;
    Health.max[eid] = archetype.health;

    const mesh = archetype.createMesh(eid);
    scene.add(mesh);
    Object3DRef[eid] = mesh;
  }
}

/**
 * Places every prop placement as a mesh in the scene, plus a matching static
 * collider for any asset that declares a `footprint` — unless the placement
 * is elevated (`y` > 0), e.g. the second crate of a stack, which would
 * otherwise get a redundant collider sitting inside the one beneath it.
 * (Stacked props are visual-only for now: giving each its own collider at
 * its real height is a small follow-up, not something this physics migration
 * needed to change.) Throws if a placement references an unknown furniture id.
 */
export function spawnProps(physics: Physics, scene: THREE.Scene, placements: PropPlacement[]): void {
  for (const placement of placements) {
    const def = FURNITURE_REGISTRY[placement.id];
    if (!def) throw new Error(`spawnProps: unknown furniture id "${placement.id}"`);

    const mesh = def.createMesh(placement.params);
    const y = placement.y ?? 0;
    mesh.position.set(placement.x, y, placement.z);
    mesh.rotation.y = placement.rotation ?? 0;
    scene.add(mesh);

    if (y === 0 && def.footprint) {
      const footprint = typeof def.footprint === "function" ? def.footprint(placement.params) : def.footprint;
      if (footprint) {
        addPropCollider(physics, placement.x, placement.z, footprint.hx, footprint.hy ?? DEFAULT_PROP_HALF_HEIGHT, footprint.hz);
      }
    }
  }
}
