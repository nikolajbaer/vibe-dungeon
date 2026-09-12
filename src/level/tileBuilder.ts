import * as THREE from "three";
import { addComponent, addEntity, type World } from "bitecs";
import { Position, Collider, Solid, Door, DoorState, Object3DRef } from "../ecs/components";
import { UNIT } from "./tiles";
import type { FaceKind } from "./tiles";
import type { OccupancyIndex } from "./occupancy";
import { wallMaterial, floorMaterial, ceilingMaterial, doorMaterial } from "./materials";

// Decomposes a validated tile occupancy index into the same kind of
// wall/floor/ceiling/door boxes (with Collider/Solid/Door ECS components)
// that the old hand-placed src/level/level.ts used to build directly. This
// is the only thing issue #21 replaces — the collision, door-interaction,
// movement, and input ECS systems are untouched and don't know or care
// that geometry now comes from tiles.

const WALL_THICKNESS = 0.15; // half-thickness of a wall/door slab, meters
const DOOR_HEIGHT = 2.2;

/** Adds a static, solid wall collider box spanning [cx-hx,cx+hx] x [cz-hz,cz+hz]. */
function addWall(world: World, scene: THREE.Scene, cx: number, cz: number, hx: number, hz: number, height: number): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, height, hz * 2), wallMaterial());
  mesh.position.set(cx, height / 2, cz);
  scene.add(mesh);

  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Collider);
  addComponent(world, eid, Solid);
  addComponent(world, eid, Object3DRef);
  Position.x[eid] = cx;
  Position.y[eid] = height / 2;
  Position.z[eid] = cz;
  Collider.hx[eid] = hx;
  Collider.hz[eid] = hz;
  Object3DRef[eid] = mesh;
}

/** Adds a purely visual floor or ceiling slab (no collider — collision is
 * wall/door geometry only, and these never move so they need no ECS entity). */
function addSlab(scene: THREE.Scene, cx: number, cz: number, hx: number, hz: number, y: number, material: THREE.Material): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.2, hz * 2), material);
  mesh.position.set(cx, y, cz);
  scene.add(mesh);
}

/** Adds a door: a collider + mesh that slides straight up (past this tile's
 * ceiling line, so it disappears cleanly) when opened. */
function addDoor(world: World, scene: THREE.Scene, cx: number, cz: number, hx: number, hz: number, wallHeight: number): void {
  const closedY = DOOR_HEIGHT / 2;
  const openY = wallHeight + DOOR_HEIGHT / 2;

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, DOOR_HEIGHT, hz * 2), doorMaterial());
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

interface InstanceBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  heightCells: number;
}

/** Direction helpers for wall/door emission. `owner: true` means this is
 * the direction from which a *shared* boundary (one with an occupied
 * neighbor) gets emitted, so each interior wall/door is built exactly once
 * instead of twice (once per side). Outer boundaries (no neighbor) are
 * unaffected by this — each (cell, direction) pair is only ever visited
 * once regardless. */
const WALL_DIRS: Array<{
  dx: number;
  dz: number;
  side: "negX" | "posX" | "negZ" | "posZ";
  opposite: "negX" | "posX" | "negZ" | "posZ";
  owner: boolean;
}> = [
  { dx: 1, dz: 0, side: "posX", opposite: "negX", owner: true },
  { dx: -1, dz: 0, side: "negX", opposite: "posX", owner: false },
  { dx: 0, dz: 1, side: "posZ", opposite: "negZ", owner: true },
  { dx: 0, dz: -1, side: "negZ", opposite: "posZ", owner: false },
];

/** A door on either side of a shared boundary wins over a plain opening —
 * a level author can put the "door" segment on whichever tile type
 * declares the connection (see GREAT_HALL's face map) and it still renders
 * as a single door either way. Wall always wins over open (should never
 * actually happen here since validateOccupancy already rejects that
 * mismatch, but this keeps the function total). */
function combineKind(mine: FaceKind, theirs: FaceKind): FaceKind {
  if (mine === "wall" || theirs === "wall") return "wall";
  if (mine === "door" || theirs === "door") return "door";
  return "opening";
}

/**
 * Builds wall/floor/ceiling/door geometry + ECS entities for every tile
 * placed in `index`. Call `validateOccupancy(index)` first — this function
 * assumes the occupancy index is already known-good.
 */
export function buildGeometryFromOccupancy(world: World, scene: THREE.Scene, index: OccupancyIndex): void {
  // --- Floors & ceilings: one slab per tile instance, spanning its full
  // footprint (matches how the old level.ts built one slab per room). ---
  const bounds = new Map<string, InstanceBounds>();
  for (const [key, cell] of index) {
    const [x, z] = key.split(",").map(Number);
    const b = bounds.get(cell.instanceId);
    if (!b) {
      bounds.set(cell.instanceId, { minX: x, maxX: x, minZ: z, maxZ: z, heightCells: cell.heightCells });
    } else {
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
    }
  }
  for (const b of bounds.values()) {
    const hx = ((b.maxX - b.minX + 1) * UNIT) / 2;
    const hz = ((b.maxZ - b.minZ + 1) * UNIT) / 2;
    const cx = b.minX * UNIT + hx;
    const cz = b.minZ * UNIT + hz;
    const ceilingY = b.heightCells * UNIT;
    addSlab(scene, cx, cz, hx, hz, -0.1, floorMaterial());
    addSlab(scene, cx, cz, hx, hz, ceilingY + 0.1, ceilingMaterial());
  }

  // --- Walls & doors, one box per unit-cell face segment. A shared
  // boundary between two instances is only emitted once (from the "owner"
  // +x/+z direction); an outer boundary (facing empty space) is emitted
  // from whichever direction actually has geometry there. ---
  for (const [key, cell] of index) {
    const [x, z] = key.split(",").map(Number);
    const wallHeight = cell.heightCells * UNIT;

    for (const dir of WALL_DIRS) {
      const kind = cell.sides[dir.side];
      if (kind === null) continue; // interior to this tile instance

      const neighbor = index.get(`${x + dir.dx},${z + dir.dz}`);
      if (neighbor) {
        if (!dir.owner) continue; // the neighbor's opposite pass owns this boundary
        const effective = combineKind(kind, neighbor.sides[dir.opposite] ?? "wall");
        emit(effective, x, z, dir, wallHeight);
      } else {
        // Outer boundary — validateOccupancy guarantees this is "wall".
        emit(kind, x, z, dir, wallHeight);
      }
    }
  }

  function emit(kind: FaceKind, x: number, z: number, dir: (typeof WALL_DIRS)[number], wallHeight: number): void {
    if (kind === "opening") return; // just empty space, no geometry

    let cx: number;
    let cz: number;
    let hx: number;
    let hz: number;
    if (dir.dx !== 0) {
      // +x or -x boundary: a plane of constant X, spanning this cell's Z extent.
      cx = (dir.dx > 0 ? x + 1 : x) * UNIT;
      cz = z * UNIT + UNIT / 2;
      hx = WALL_THICKNESS;
      hz = UNIT / 2;
    } else {
      // +z or -z boundary: a plane of constant Z, spanning this cell's X extent.
      cx = x * UNIT + UNIT / 2;
      cz = (dir.dz > 0 ? z + 1 : z) * UNIT;
      hx = UNIT / 2;
      hz = WALL_THICKNESS;
    }

    if (kind === "wall") addWall(world, scene, cx, cz, hx, hz, wallHeight);
    else addDoor(world, scene, cx, cz, hx, hz, wallHeight);
  }
}
