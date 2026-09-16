import * as THREE from "three";
import { addComponent, addEntity, type World } from "bitecs";
import { Position, Velocity, CharacterBody, DynamicBody, PhysicsBody, PhysicsCollider, PhysicsRotation, Object3DRef, Item, NPC, NpcState, Health } from "../ecs/components";
import { ITEM_REGISTRY } from "../assets/itemRegistry";
import { FURNITURE_REGISTRY } from "../assets/furnitureRegistry";
import { NPC_REGISTRY } from "../assets/npcRegistry";
import type { PropPlacement, ItemSpawn, NpcSpawn } from "./placementTypes";
import { addCharacter, addDynamicBox, addStaticBox, type BoxShape, type Physics } from "../physics/world";

// Generic spawners for the asset-authoring system: turn plain `PropPlacement`/
// `ItemSpawn` data (src/level/rooms/*.ts) into real ECS entities + three.js
// meshes, by looking assets up in the registries (src/assets/*Registry.ts)
// instead of one hand-written function call per prop/item. This is the
// piece that made every previous new asset touch shared code (a
// `addTable`/`addBanner`-style function *and* a call to it inside
// `addDecorations()`) — now it's data in, entities out, once, generically.

/** Height (meters) a world item spawns at when its placement doesn't say
 * otherwise. Items are dynamic bodies now, so this is a *drop* height rather
 * than a resting one — an item authored over open floor falls the last meter
 * and settles, and one authored over the tabletop (room-a's sword) lands on
 * it. */
const ITEM_HEIGHT = 1;

/** Mass (kg) for a world item whose asset doesn't declare one. Light enough
 * that walking into it sends it skittering, which is the whole point. */
const DEFAULT_ITEM_MASS = 1;

/**
 * Measures the box a finished mesh occupies *in its own local space* — half
 * extents plus how far its center sits from the mesh origin.
 *
 * Measured rather than authored because this repo's meshes are built from
 * merged primitives around whatever origin made the asset easiest to write
 * (a prop's sits on the floor; the sword's sits at its grip, with most of
 * its length out along +Z), so hand-authoring a matching collider per asset
 * would be busywork that silently rots the first time a mesh changes shape.
 * `THREE.Box3.setFromObject` already walks the whole hierarchy and does it
 * exactly.
 *
 * The mesh must not have been positioned or rotated yet — this is local
 * space, and the body carries the world transform (see `addDynamicBox`).
 */
function boxShapeOf(object: THREE.Object3D): BoxShape {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  return {
    // Rapier rejects a zero half-extent, and a paper-thin prop (a banner)
    // would otherwise produce one.
    hx: Math.max(size.x / 2, 0.01),
    hy: Math.max(size.y / 2, 0.01),
    hz: Math.max(size.z / 2, 0.01),
    cx: center.x,
    cy: center.y,
    cz: center.z,
  };
}

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

/** Adds one *static* prop's Rapier box — no ECS entity, exactly like a wall
 * segment (see tileBuilder.ts's `addWall`): it never moves and nothing
 * queries it as an entity, so the collider is all it actually needs. Static
 * props sit with their mesh origin on the floor, so the box is centered half
 * its height up. (A dynamic prop takes a different path entirely — see
 * `spawnProps`.) */
function addPropCollider(physics: Physics, x: number, z: number, hx: number, hy: number, hz: number): void {
  addStaticBox(physics, x, hy, z, hx, hy, hz);
}

/**
 * Places every item spawn as a real `Item` + `Position` + `Object3DRef`
 * entity (no `Carried` component — see `pickUpItem` in
 * `ecs/systems/items.ts` for what picking one up adds), built from its
 * `ItemAssetDef.createWorldMesh()`.
 *
 * Every world item is a *dynamic* rigid body: it drops from wherever it was
 * authored, settles on whatever is beneath it (room-a's sword is authored
 * over the tabletop and lands on it), and skitters when a character walks
 * into it. Nothing about pickup changed — the interact raycast still hits
 * the same generous hitbox; it just might not be where it was left.
 *
 * Throws if a spawn references an unknown item id — the same "fail loudly at
 * load time" philosophy as `occupancy.ts`'s `validateOccupancy`, rather than
 * silently rendering nothing.
 */
export function spawnItems(world: World, physics: Physics, scene: THREE.Scene, spawns: ItemSpawn[]): void {
  for (const spawn of spawns) {
    const def = ITEM_REGISTRY[spawn.id];
    if (!def) throw new Error(`spawnItems: unknown item id "${spawn.id}"`);

    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, Object3DRef);
    addComponent(world, eid, Item);
    addComponent(world, eid, DynamicBody);
    addComponent(world, eid, PhysicsBody);
    addComponent(world, eid, PhysicsRotation);
    Item.itemTypeId[eid] = def.id;

    const mesh = def.createWorldMesh();
    // Measured before the group gets a transform, and off the item's real
    // mesh rather than the group, so the invisible pickup hitbox sphere
    // (which is deliberately far more generous than the item) doesn't
    // become the collider.
    const shape = boxShapeOf(mesh);
    const group = withPickupHitbox(mesh, eid);

    const x = spawn.x;
    const y = spawn.y ?? ITEM_HEIGHT;
    const z = spawn.z;
    Position.x[eid] = x;
    Position.y[eid] = y;
    Position.z[eid] = z;
    group.position.set(x, y, z);
    PhysicsRotation.w[eid] = 1; // identity until the first physics step
    scene.add(group);
    Object3DRef[eid] = group;

    PhysicsBody[eid] = addDynamicBox(physics, x, y, z, 0, shape, def.mass ?? DEFAULT_ITEM_MASS);
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
 * Places every prop placement as a mesh in the scene, plus physics to match,
 * in one of two ways depending on what the asset declares (see
 * `FurnitureAssetDef.dynamic`):
 *
 * - **Dynamic** (table, chairs, barrel, crates) — a simulated rigid body,
 *   and therefore the one kind of prop that needs a real ECS entity, since
 *   something has to carry the transform Rapier produces back to the mesh
 *   each frame (`dynamicSyncSystem`). Its collider is measured off the mesh
 *   rather than taken from `footprint`, because a body that can tip over
 *   needs its true height and center, not a floor plan.
 * - **Static** (banners, the candelabra) — a fixed collider from `footprint`
 *   and no entity at all, exactly like a wall segment.
 *
 * Elevated placements (`y` > 0, e.g. the second crate of a stack) used to be
 * skipped entirely to avoid burying a redundant collider inside the one
 * beneath them. A dynamic prop needs no such guard: the upper crate is a real
 * body resting on the lower one, which is what a stack always should have
 * been — knock the bottom one out and the top one falls.
 *
 * Throws if a placement references an unknown furniture id.
 */
export function spawnProps(world: World, physics: Physics, scene: THREE.Scene, placements: PropPlacement[]): void {
  for (const placement of placements) {
    const def = FURNITURE_REGISTRY[placement.id];
    if (!def) throw new Error(`spawnProps: unknown furniture id "${placement.id}"`);

    const mesh = def.createMesh(placement.params);
    const x = placement.x;
    const y = placement.y ?? 0;
    const z = placement.z;
    const yaw = placement.rotation ?? 0;

    if (def.dynamic) {
      // Measured before the mesh is transformed — `boxShapeOf` is local
      // space, and the body carries the world placement.
      const shape = boxShapeOf(mesh);
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      scene.add(mesh);

      const eid = addEntity(world);
      addComponent(world, eid, Position);
      addComponent(world, eid, Object3DRef);
      addComponent(world, eid, DynamicBody);
      addComponent(world, eid, PhysicsBody);
      addComponent(world, eid, PhysicsRotation);
      Position.x[eid] = x;
      Position.y[eid] = y;
      Position.z[eid] = z;
      PhysicsRotation.y[eid] = Math.sin(yaw / 2);
      PhysicsRotation.w[eid] = Math.cos(yaw / 2);
      Object3DRef[eid] = mesh;
      PhysicsBody[eid] = addDynamicBox(physics, x, y, z, yaw, shape, def.dynamic.mass);
      continue;
    }

    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    scene.add(mesh);

    if (y === 0 && def.footprint) {
      const footprint = typeof def.footprint === "function" ? def.footprint(placement.params) : def.footprint;
      if (footprint) {
        addPropCollider(physics, x, z, footprint.hx, footprint.hy ?? DEFAULT_PROP_HALF_HEIGHT, footprint.hz);
      }
    }
  }
}
