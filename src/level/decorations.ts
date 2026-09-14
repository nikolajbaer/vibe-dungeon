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

  addSideChamberClutter(world, scene);
}

// --- Side-chamber clutter (issue #71) --------------------------------------
// A one-off decorative touch for the new "side-chamber" room (see
// src/level/levelData.ts/tiles.ts) — a small stack of supply crates, kept as
// its own function (called once above) rather than folded into
// addDecorations()'s body, so this and any parallel furniture/decoration
// work (issue #70) land on different lines.
//
// Side-chamber (side_chamber, unrotated, originCell {x:4,z:-2}) spans world
// x in [12,18], z in [-6,0], with its one door on the west face's near
// (z<0 half) segment — world x=12, z in [-6,-3]. This clutter sits in the
// room's south-east corner (x roughly 16-17.4, z roughly -5.6 to -4.6),
// clear of the door and its swing arc, clear of the room's other three
// walls, and clear of the branch corridor's approach.

let crateMat: THREE.MeshStandardMaterial | undefined;
function crateMaterial(): THREE.MeshStandardMaterial {
  return (crateMat ??= new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9, metalness: 0 }));
}

const CRATE_SIZE = 0.6;

/** A simple slatted-look crate: one box plus thin raised edge strips on its
 * top face (so it doesn't read as a bare cube next to the room's stone
 * walls), stackable by its exact `CRATE_SIZE` height. */
function createCrate(): THREE.Group {
  const group = new THREE.Group();
  const mat = crateMaterial();

  const body = new THREE.Mesh(new THREE.BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE), mat);
  body.position.y = CRATE_SIZE / 2;
  group.add(body);

  const stripThickness = 0.035;
  const stripY = CRATE_SIZE - stripThickness / 2;
  for (const axis of ["x", "z"] as const) {
    for (const sign of [-1, 1]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(
          axis === "x" ? CRATE_SIZE : stripThickness,
          stripThickness,
          axis === "z" ? CRATE_SIZE : stripThickness,
        ),
        mat,
      );
      strip.position.set(axis === "x" ? 0 : sign * (CRATE_SIZE / 2 - stripThickness / 2), stripY, axis === "z" ? 0 : sign * (CRATE_SIZE / 2 - stripThickness / 2));
      group.add(strip);
    }
  }

  return group;
}

function addCrate(world: World, scene: THREE.Scene, x: number, y: number, z: number, yaw: number): void {
  const mesh = createCrate();
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  scene.add(mesh);
  if (y === 0) {
    // Only the bottom-most crate of a stack gets a collider — a stacked
    // crate on top has nothing at floor level to collide with, matching how
    // props.ts callers only ever collide the object actually touching the
    // floor.
    addPropCollider(world, mesh, x, z, CRATE_SIZE / 2, CRATE_SIZE / 2);
  }
}

/** Places a small stack of supply crates in side-chamber's south-east
 * corner — a quiet, unpopulated storeroom-style detail (no NPC/item here;
 * see docs/LEVEL_DESIGN.md's pacing pillar) that also gives the room a
 * distinct look from room-a's table-and-chairs furniture grouping. */
function addSideChamberClutter(world: World, scene: THREE.Scene): void {
  const baseX = 16.7;
  const baseZ = -5.0;

  addCrate(world, scene, baseX, 0, baseZ, 0.15);
  addCrate(world, scene, baseX - 0.05, CRATE_SIZE, baseZ + 0.05, -0.35);
  addBarrel(world, scene, baseX - 0.9, baseZ - 0.3);
}
