import * as THREE from "three";
import { addComponent, addEntity, type World } from "bitecs";
import { Position, Collider, Solid, Object3DRef } from "../ecs/components";
import { createTable, createChair, createBarrel, TABLE_FOOTPRINT, CHAIR_FOOTPRINT, BARREL_FOOTPRINT } from "../props/props";

// Hardcoded furniture placement (issue #40) — a small rest-area grouping
// (table + two chairs + a barrel) in a corner of room-a, the same
// "no general placement data format yet" spirit as the hardcoded NPC/item
// spawns in game.ts.
//
// Room-a (great_hall, unrotated, originCell {x:-1,z:0} — see levelData.ts)
// spans world x in [-3,6], z in [0,9], with its one door on the south face
// (world z=0, x in [0,3]) and a header-free interior clear space roughly
// [-2.85,5.85] x [0.15,8.85] once wall thickness is accounted for. Existing
// hardcoded occupants (src/game.ts): the player spawns at (1.5,7.5) and the
// test NPC loiters around (1.5,3.5), wandering within ~1.5m of that point —
// both sit on the room's x=1.5 north-south spine. This grouping is placed in
// the north-east corner instead (x roughly 3.7-5.7, z roughly 6.0-8.6),
// comfortably clear of that spine, clear of the door's swing arc (which only
// reaches a couple meters from the x in [0,3], z=0 doorway), and clear of the
// north wall.

/** Adds one prop's `Position`+`Collider`+`Solid` ECS entity — the same three
 * components a wall segment gets (see tileBuilder.ts's `addWall`) — plus its
 * `Object3DRef`, so it's picked up by the existing generic `Solid` collision
 * path with no changes to collisionSystem. */
function addPropCollider(world: World, mesh: THREE.Object3D, x: number, z: number, hx: number, hz: number): void {
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Collider);
  addComponent(world, eid, Solid);
  addComponent(world, eid, Object3DRef);
  Position.x[eid] = x;
  Position.y[eid] = 0; // group root sits at floor level; children carry their own y offsets
  Position.z[eid] = z;
  Collider.hx[eid] = hx;
  Collider.hz[eid] = hz;
  Object3DRef[eid] = mesh;
}

function addTable(world: World, scene: THREE.Scene, x: number, z: number): void {
  const mesh = createTable();
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  addPropCollider(world, mesh, x, z, TABLE_FOOTPRINT.hx, TABLE_FOOTPRINT.hz);
}

function addChair(world: World, scene: THREE.Scene, x: number, z: number, facingYaw: number): void {
  const mesh = createChair();
  mesh.position.set(x, 0, z);
  mesh.rotation.y = facingYaw;
  scene.add(mesh);
  addPropCollider(world, mesh, x, z, CHAIR_FOOTPRINT.hx, CHAIR_FOOTPRINT.hz);
}

function addBarrel(world: World, scene: THREE.Scene, x: number, z: number): void {
  const mesh = createBarrel();
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  addPropCollider(world, mesh, x, z, BARREL_FOOTPRINT.hx, BARREL_FOOTPRINT.hz);
}

/**
 * Places the level's hardcoded furniture grouping — a table, two chairs, and
 * a barrel — as a small rest area in room-a's north-east corner. Called once
 * from `buildLevel` (src/level/level.ts), after the tile geometry is built,
 * so props render/collide on top of an already-valid level.
 */
export function addDecorations(world: World, scene: THREE.Scene): void {
  const tableX = 4.3;
  const tableZ = 7.2;
  addTable(world, scene, tableX, tableZ);

  // Chair facing north into the table, seated on the table's south side.
  addChair(world, scene, tableX, tableZ - 0.85, 0);
  // Chair facing west into the table, seated on the table's east side.
  addChair(world, scene, tableX + 1.05, tableZ, -Math.PI / 2);

  // Barrel tucked further into the corner, past the table (kept short of
  // the north wall's interior face at z~8.85 — see the room-a note above).
  addBarrel(world, scene, tableX + 1.0, tableZ + 1.2);
}
