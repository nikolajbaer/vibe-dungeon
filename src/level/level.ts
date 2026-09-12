import * as THREE from "three";
import { addComponent, addEntity, type World } from "bitecs";
import { Position, Collider, Solid, Door, DoorState, Object3DRef } from "../ecs/components";

// Hand-placed minimal test level (see issue #9): Room A -> a corridor with
// one turn -> a door -> Room B. Coordinates are in meters, XZ ground plane,
// +Y up. No procedural generation — this is deliberately a fixed layout.

const WALL_THICKNESS = 0.15; // half-thickness of a wall/door slab
const WALL_HEIGHT = 3;
const DOOR_HEIGHT = 2.2;

const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x5a4a3a });
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x888d96 });
const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0x24262c });
const doorMaterial = new THREE.MeshStandardMaterial({ color: 0xa5622f });

export interface LevelSpawn {
  x: number;
  z: number;
  yaw: number;
}

export interface Level {
  spawn: LevelSpawn;
}

/** Adds a static, solid wall collider box spanning [cx-hx,cx+hx] x [cz-hz,cz+hz]. */
function addWall(
  world: World,
  scene: THREE.Scene,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(hx * 2, WALL_HEIGHT, hz * 2),
    wallMaterial,
  );
  mesh.position.set(cx, WALL_HEIGHT / 2, cz);
  scene.add(mesh);

  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Collider);
  addComponent(world, eid, Solid);
  addComponent(world, eid, Object3DRef);
  Position.x[eid] = cx;
  Position.y[eid] = WALL_HEIGHT / 2;
  Position.z[eid] = cz;
  Collider.hx[eid] = hx;
  Collider.hz[eid] = hz;
  Object3DRef[eid] = mesh;
}

/** Adds a purely visual floor or ceiling slab (no collider — collision is
 * wall/door geometry only, and these never move so they need no ECS entity). */
function addSlab(
  scene: THREE.Scene,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  y: number,
  material: THREE.Material,
): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.2, hz * 2), material);
  mesh.position.set(cx, y, cz);
  scene.add(mesh);
}

/** Adds a door: a collider + mesh that slides straight up (past the ceiling
 * line, so it disappears cleanly rather than clipping) when opened. */
function addDoor(world: World, scene: THREE.Scene, cx: number, cz: number, hx: number, hz: number): void {
  const closedY = DOOR_HEIGHT / 2;
  const openY = WALL_HEIGHT + DOOR_HEIGHT / 2;

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, DOOR_HEIGHT, hz * 2), doorMaterial);
  mesh.position.set(cx, closedY, cz);
  scene.add(mesh);

  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Collider);
  addComponent(world, eid, Door);
  addComponent(world, eid, Object3DRef);
  Position.x[eid] = cx;
  Position.y[eid] = closedY;
  Position.z[eid] = cz;
  Collider.hx[eid] = hx;
  Collider.hz[eid] = hz;
  Door.state[eid] = DoorState.CLOSED;
  Door.progress[eid] = 0;
  Door.closedY[eid] = closedY;
  Door.openY[eid] = openY;
  Object3DRef[eid] = mesh;
}

export function buildLevel(world: World, scene: THREE.Scene): Level {
  // --- Room A: 8x8, spans x:[-4,4] z:[-4,4]. South wall has a 2m gap for
  // the corridor at x:[-1,1]. ---
  addWall(world, scene, -2.5, -4, 1.5, WALL_THICKNESS); // south wall, west of gap
  addWall(world, scene, 2.5, -4, 1.5, WALL_THICKNESS); // south wall, east of gap
  addWall(world, scene, 0, 4, 4, WALL_THICKNESS); // north wall
  addWall(world, scene, -4, 0, WALL_THICKNESS, 4); // west wall
  addWall(world, scene, 4, 0, WALL_THICKNESS, 4); // east wall
  addSlab(scene, 0, 0, 4, 4, -0.1, floorMaterial);
  addSlab(scene, 0, 0, 4, 4, WALL_HEIGHT + 0.1, ceilingMaterial);

  // --- Corridor: a 2m-wide, north-south leg from Room A down to z=-8, then
  // (the turn) an east-west leg from x=-9 to x=1. ---
  addWall(world, scene, -1, -6, WALL_THICKNESS, 2); // corridor west wall (leaves the turn open at z<-8)
  addWall(world, scene, 1, -7, WALL_THICKNESS, 3); // corridor east wall (full length: dead end, no opening)
  addWall(world, scene, -5, -8, 4, WALL_THICKNESS); // turn's north wall
  addWall(world, scene, -4, -10, 5, WALL_THICKNESS); // turn's south wall
  addSlab(scene, 0, -6.5, 1, 2.5, -0.1, floorMaterial);
  addSlab(scene, 0, -6.5, 1, 2.5, WALL_HEIGHT + 0.1, ceilingMaterial);
  addSlab(scene, -4, -9, 5, 1, -0.1, floorMaterial);
  addSlab(scene, -4, -9, 5, 1, WALL_HEIGHT + 0.1, ceilingMaterial);

  // --- Door blocking the passage from the corridor into Room B, at x=-9. ---
  addDoor(world, scene, -9, -9, WALL_THICKNESS, 1);

  // --- Room B: 6x4, spans x:[-15,-9] z:[-11,-7]. East wall has a 2m gap
  // (filled by the door above) at z:[-10,-8]. ---
  addWall(world, scene, -9, -10.5, WALL_THICKNESS, 0.5); // east wall, south of gap
  addWall(world, scene, -9, -7.5, WALL_THICKNESS, 0.5); // east wall, north of gap
  addWall(world, scene, -15, -9, WALL_THICKNESS, 2); // west wall
  addWall(world, scene, -12, -7, 3, WALL_THICKNESS); // north wall
  addWall(world, scene, -12, -11, 3, WALL_THICKNESS); // south wall
  addSlab(scene, -12, -9, 3, 2, -0.1, floorMaterial);
  addSlab(scene, -12, -9, 3, 2, WALL_HEIGHT + 0.1, ceilingMaterial);

  return { spawn: { x: 0, z: 2, yaw: 0 } };
}
