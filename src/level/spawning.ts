import * as THREE from "three";
import { addComponent, addEntity, removeComponent, type World } from "bitecs";
import { Position, Velocity, CharacterBody, DynamicBody, PhysicsBody, PhysicsCollider, PhysicsRotation, Object3DRef, Item, NPC, NpcState, Health, Readable, Container, Carried } from "../ecs/components";
import { ITEM_REGISTRY } from "../assets/itemRegistry";
import type { ItemAssetDef } from "../assets/types";
import { FURNITURE_REGISTRY } from "../assets/furnitureRegistry";
import { NPC_REGISTRY } from "../assets/npcRegistry";
import type { PropPlacement, ItemSpawn, NpcSpawn, ReadablePlacement } from "./placementTypes";
import { floorBaseline } from "./tiles";
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

// Floor for a container-flagged dynamic prop's invisible raycast hitbox
// radius (see below) — only matters for a degenerately small asset; every
// real one so far (a barrel) is sized well past this by its own bounding
// box.
const CONTAINER_HITBOX_MIN_RADIUS = 0.3;

/** Adds one *static* prop's Rapier box — no ECS entity, exactly like a wall
 * segment (see tileBuilder.ts's `addWall`): it never moves and nothing
 * queries it as an entity, so the collider is all it actually needs. Static
 * props sit with their mesh origin on the floor, so the box is centered half
 * its height up. (A dynamic prop takes a different path entirely — see
 * `spawnProps`.) */
function addPropCollider(physics: Physics, x: number, z: number, hx: number, hy: number, hz: number, floorY: number): void {
  addStaticBox(physics, x, floorY + hy, z, hx, hy, hz);
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
 *
 * A spawn with `pages` (a scroll) also gets a `Readable` component — see
 * `ItemSpawn.pages`'s doc comment, and `InventoryList.tsx` for where
 * tapping it in the inventory actually opens the reader, since a readable
 * item is never read via the world interact raycast the way a poster is
 * (that raycast picks it up instead — see `tryInteract`, `doors.ts`).
 */
/**
 * Gives an `Item` entity its actual world presence — mesh, pickup hitbox,
 * and dynamic physics body — at `(x, y, z)`. Factored out of `spawnItems`
 * below so `dropCarriedItem` can build the exact same thing for an item
 * that's never had one before (a container-seeded one, dropped for the
 * first time): same mesh, same hitbox, same physics, just triggered at drop
 * time instead of level-load time. Assumes `eid` already has `Item` (with
 * `itemTypeId` set) — everything else (`Position`/`Object3DRef`/
 * `DynamicBody`/`PhysicsBody`/`PhysicsRotation`) is added here.
 */
function buildItemWorldBody(world: World, physics: Physics, scene: THREE.Scene, eid: number, def: ItemAssetDef, x: number, y: number, z: number): void {
  addComponent(world, eid, Position);
  addComponent(world, eid, Object3DRef);
  addComponent(world, eid, DynamicBody);
  addComponent(world, eid, PhysicsBody);
  addComponent(world, eid, PhysicsRotation);

  const mesh = def.createWorldMesh();
  // Measured before the group gets a transform, and off the item's real
  // mesh rather than the group, so the invisible pickup hitbox sphere
  // (which is deliberately far more generous than the item) doesn't become
  // the collider.
  const shape = boxShapeOf(mesh);
  const group = withPickupHitbox(mesh, eid);

  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  group.position.set(x, y, z);
  PhysicsRotation.w[eid] = 1; // identity until the first physics step
  scene.add(group);
  Object3DRef[eid] = group;

  PhysicsBody[eid] = addDynamicBox(physics, x, y, z, 0, shape, def.mass ?? DEFAULT_ITEM_MASS);
}

export function spawnItems(world: World, physics: Physics, scene: THREE.Scene, spawns: ItemSpawn[]): void {
  for (const spawn of spawns) {
    const def = ITEM_REGISTRY[spawn.id];
    if (!def) throw new Error(`spawnItems: unknown item id "${spawn.id}"`);

    const eid = addEntity(world);
    addComponent(world, eid, Item);
    Item.itemTypeId[eid] = def.id;

    // A `pages`-bearing spawn (a scroll) is *also* Readable — see
    // `ItemSpawn.pages`'s doc comment. Ordinary items simply never add
    // this component at all.
    if (spawn.pages) {
      addComponent(world, eid, Readable);
      Readable.title[eid] = spawn.title;
      Readable.pages[eid] = spawn.pages;
    }

    // An item type that declares `container` (a backpack) is *also*
    // `Container` — unlike `Readable`'s per-placement title/pages, this is
    // per-*type* data (every backpack has the same capacity), so it comes
    // from the registered `ItemAssetDef` rather than the placement.
    if (def.container) {
      addComponent(world, eid, Container);
      Container.capacity[eid] = def.container.capacity;
    }

    const x = spawn.x;
    const y = floorBaseline(spawn.floor ?? 0) + (spawn.y ?? ITEM_HEIGHT);
    const z = spawn.z;
    buildItemWorldBody(world, physics, scene, eid, def, x, y, z);
  }
}

/**
 * Drops a `Carried` item back into the world at `(x, y, z)` — the reverse of
 * `pickUpItem` (ecs/systems/items.ts). Removes `Carried` so it's raycastable
 * again, then either:
 *
 * - **Already has a world body** (picked up from the floor at some point,
 *   even if via a container in between): reuses its existing mesh/physics
 *   body rather than building a new one — same "hide, don't destroy"
 *   principle `pickUpItem`'s own doc comment describes for the reverse
 *   direction. Re-enables the body, makes the mesh visible again, and resets
 *   its transform/velocity so it doesn't still think it's mid-flight from
 *   however it was last shoved before being picked up.
 * - **Never had one** (a container-seeded item — `PropPlacement.contents` —
 *   dropped for the first time, having gone straight from a barrel/backpack
 *   into the player's hands without ever passing through the world): builds
 *   one fresh via `buildItemWorldBody`, identically to how a room file's own
 *   `ItemSpawn` would have.
 *
 * Called from game.ts's `InventoryActions.drop`, itself triggered by the
 * inventory panel's drop zone (`inventory/DropZone.tsx`).
 */
export function dropCarriedItem(world: World, physics: Physics, scene: THREE.Scene, itemEid: number, x: number, y: number, z: number): void {
  removeComponent(world, itemEid, Carried);

  const existingBody = PhysicsBody[itemEid];
  const existingMesh = Object3DRef[itemEid];
  if (existingBody && existingMesh) {
    existingBody.setTranslation({ x, y, z }, true);
    existingBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    existingBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    existingBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    existingBody.setEnabled(true);
    existingMesh.visible = true;
    return;
  }

  const def = ITEM_REGISTRY[Item.itemTypeId[itemEid]];
  if (!def) throw new Error(`dropCarriedItem: unknown item id "${Item.itemTypeId[itemEid]}"`);
  buildItemWorldBody(world, physics, scene, itemEid, def, x, y, z);
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
    const floorY = floorBaseline(spawn.floor ?? 0);
    Position.x[eid] = spawn.x;
    Position.y[eid] = floorY; // the humanoid rig's origin is at its feet
    Position.z[eid] = spawn.z;
    Velocity.x[eid] = 0;
    Velocity.z[eid] = 0;

    const radius = archetype.halfExtent;
    const halfHeight = Math.max(0.05, HUMANOID_HEIGHT / 2 - radius);
    CharacterBody.radius[eid] = radius;
    CharacterBody.halfHeight[eid] = halfHeight;
    CharacterBody.verticalVelocity[eid] = 0;
    CharacterBody.grounded[eid] = 0;
    const handles = addCharacter(physics, spawn.x, floorY, spawn.z, radius, halfHeight);
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
    if (placement.contents && !def.container) {
      throw new Error(`spawnProps: "${placement.id}" placement specifies contents but isn't a container`);
    }

    const mesh = def.createMesh(placement.params);
    const x = placement.x;
    const y = floorBaseline(placement.floor ?? 0) + (placement.y ?? 0);
    const z = placement.z;
    const yaw = placement.rotation ?? 0;

    if (def.dynamic) {
      // Measured before the mesh is transformed — `boxShapeOf` is local
      // space, and the body carries the world placement.
      const shape = boxShapeOf(mesh);

      // A container-flagged asset (a barrel) also gets an invisible hitbox
      // child, added here while `mesh` is still in local space (mirrors
      // `spawnReadables`' bbox-centering fix below) so it ends up centered
      // on the barrel's actual visible bulk rather than floating at its
      // local origin. `userData.eid` can't be set until `eid` exists
      // (below), but the hitbox's *position* has to be fixed now, before
      // `mesh` gets transformed to its world placement — as a child it then
      // rides along with that transform automatically. A raw
      // `mesh.userData.eid` alone wouldn't work here the way it does for a
      // single-mesh interactable: `createBarrelMesh` returns a *group* of
      // several cylinders, and three.js raycasts only ever hit an actual
      // leaf `Mesh`'s geometry, never an empty `Group` — so without this
      // sphere, a hit lands on some cylinder that never got `userData.eid`
      // set on it at all.
      let containerHitbox: THREE.Mesh | undefined;
      if (def.container) {
        const bounds = new THREE.Box3().setFromObject(mesh);
        // Half the bounding box's own diagonal is the smallest sphere
        // guaranteed to fully enclose it regardless of aspect ratio — a
        // fixed radius tuned by eye (the original approach here) covers the
        // middle of a tall, narrow shape like a barrel but leaves its top
        // and bottom rims sticking out past the sphere, which is exactly
        // where a tap would then hit the barrel's own (un-eid'd) mesh
        // instead of this hitbox and silently do nothing.
        const radius = Math.max(CONTAINER_HITBOX_MIN_RADIUS, bounds.getSize(new THREE.Vector3()).length() / 2);
        containerHitbox = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6));
        containerHitbox.position.copy(bounds.getCenter(new THREE.Vector3()));
        containerHitbox.visible = false;
        mesh.add(containerHitbox);
      }

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

      if (def.container && containerHitbox) {
        addComponent(world, eid, Container);
        Container.capacity[eid] = def.container.capacity;
        containerHitbox.userData.eid = eid;

        // Loot the barrel starts with (placement.contents, validated
        // against def.container above) — each entry is a normal `Item`,
        // already `Carried` by this container, exactly like one the player
        // stored themselves. No `Position`/`Object3DRef`/physics body: a
        // carried item never needs its own world presence (see `pickUpItem`
        // in ecs/systems/items.ts hiding a picked-up item's mesh instead of
        // ever creating one fresh) here it simply never gets one at all.
        for (const itemTypeId of placement.contents ?? []) {
          const itemDef = ITEM_REGISTRY[itemTypeId];
          if (!itemDef) throw new Error(`spawnProps: "${placement.id}" contents reference unknown item id "${itemTypeId}"`);
          const itemEid = addEntity(world);
          addComponent(world, itemEid, Item);
          addComponent(world, itemEid, Carried);
          Item.itemTypeId[itemEid] = itemTypeId;
          Carried.ownerEid[itemEid] = eid;
          Carried.slot[itemEid] = "inventory";
          // Same as spawnItems above: a container-typed item (a backpack)
          // pre-seeded as another container's loot is still itself a
          // Container, capacity and all.
          if (itemDef.container) {
            addComponent(world, itemEid, Container);
            Container.capacity[itemEid] = itemDef.container.capacity;
          }
        }
      }
      continue;
    }

    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    scene.add(mesh);

    // Compared against the *placement's own* relative height, not the
    // absolute world `y` above — a ground-level prop on the upper floor has
    // `placement.y` unset (0) but an absolute `y` of `floorBaseline(1)` (6m),
    // and still wants its floor-plan collider exactly like one on floor 0.
    if ((placement.y ?? 0) === 0 && def.footprint) {
      const footprint = typeof def.footprint === "function" ? def.footprint(placement.params) : def.footprint;
      if (footprint) {
        addPropCollider(physics, x, z, footprint.hx, footprint.hy ?? DEFAULT_PROP_HALF_HEIGHT, footprint.hz, floorBaseline(placement.floor ?? 0));
      }
    }
  }
}

// Generous invisible raycast target radius for readable fixtures (narration
// devices) — same idea and reason as `ITEM_PICKUP_RADIUS` above: a poster's
// thin panel would otherwise be frustrating to land a precise
// camera-forward raycast on.
const READABLE_HITBOX_RADIUS = 0.4;

/**
 * Places every readable *fixture* placement (a poster — a readable item like
 * a scroll instead goes through `spawnItems` below, see `ItemSpawn.pages`)
 * as a `Readable` + `Object3DRef` entity, built from its furniture asset's
 * `createMesh()` wrapped in a generous invisible hitbox (see
 * `READABLE_HITBOX_RADIUS`). No physics body of any kind — unlike a prop, a
 * readable fixture is never something a character could walk into or that
 * could move, so there's nothing for Rapier to own here at all.
 *
 * Throws if a placement references an unknown furniture id or has no
 * pages — the same "fail loudly at load time" philosophy as
 * `occupancy.ts`'s `validateOccupancy`.
 */
export function spawnReadables(world: World, scene: THREE.Scene, placements: ReadablePlacement[]): void {
  for (const placement of placements) {
    const def = FURNITURE_REGISTRY[placement.id];
    if (!def) throw new Error(`spawnReadables: unknown furniture id "${placement.id}"`);
    if (placement.pages.length === 0) throw new Error(`spawnReadables: "${placement.title ?? placement.id}" has no pages`);

    const eid = addEntity(world);
    addComponent(world, eid, Object3DRef);
    addComponent(world, eid, Readable);
    Readable.title[eid] = placement.title;
    Readable.pages[eid] = placement.pages;

    const mesh = def.createMesh(placement.params);
    mesh.userData.eid = eid;
    // Centered on the mesh's own local bounding box, not the group's
    // origin — a poster's mesh (like a banner's) is built well above the
    // group origin (its bottom edge sits at head height on the wall, not
    // the floor), so a hitbox at (0,0,0) would float uselessly down at the
    // floor instead of actually covering the visible poster.
    const bounds = new THREE.Box3().setFromObject(mesh);
    const hitboxCenter = bounds.getCenter(new THREE.Vector3());
    const hitbox = new THREE.Mesh(new THREE.SphereGeometry(READABLE_HITBOX_RADIUS, 8, 6));
    hitbox.position.copy(hitboxCenter);
    hitbox.visible = false;
    hitbox.userData.eid = eid;
    const group = new THREE.Group();
    group.add(mesh, hitbox);

    const x = placement.x;
    const y = floorBaseline(placement.floor ?? 0) + (placement.y ?? 0);
    const z = placement.z;
    group.position.set(x, y, z);
    group.rotation.y = placement.rotation ?? 0;
    scene.add(group);
    Object3DRef[eid] = group;
  }
}
