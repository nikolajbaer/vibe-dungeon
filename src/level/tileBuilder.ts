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

/**
 * Adds a wall box spanning [cx-hx,cx+hx] x [cz-hz,cz+hz], from `baseY` up to
 * `baseY + height` (default `baseY = 0`, i.e. floor-to-height like a regular
 * wall). A header wall above a doorway passes `baseY = DOOR_HEIGHT` to sit
 * above the door leaf instead of starting at the floor.
 *
 * `solid` (default `true`) controls whether it also gets a static
 * `Collider`/`Solid` ECS entity. A **header** wall passes `solid = false`:
 * `Position`/`Collider` are XZ-only (see components.ts — "collision only
 * considers x/z") with no notion of vertical extent, so a Solid collider
 * placed above a doorway would still block the player at floor level across
 * its full XZ footprint — i.e. it would seal the doorway shut even with both
 * leaves open. A header is purely decorative geometry filling the visual gap
 * to the ceiling; nothing can reach that height to require colliding with
 * it anyway.
 */
function addWall(world: World, scene: THREE.Scene, cx: number, cz: number, hx: number, hz: number, height: number, baseY: number = 0, solid: boolean = true): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, height, hz * 2), wallMaterial());
  mesh.position.set(cx, baseY + height / 2, cz);
  scene.add(mesh);

  if (!solid) return;

  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Collider);
  addComponent(world, eid, Solid);
  addComponent(world, eid, Object3DRef);
  Position.x[eid] = cx;
  Position.y[eid] = baseY + height / 2;
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

/**
 * Adds one door leaf: a collider (static AABB, centered at the leaf's
 * closed-position center `(leafCx, leafCz)` — exactly like a wall) plus a
 * visual hinge: a `THREE.Group` positioned at the world hinge point
 * `(hingeX, hingeZ)` with the slab mesh as a child offset by half the
 * leaf's width, so rotating the *group* around Y swings the slab on that
 * hinge instead of spinning it in place. `Position`/`Collider` never move —
 * `doorAnimationSystem` only ever rotates the group (see doors.ts), and
 * `syncSystem` knows to leave a `Door` entity's Object3DRef position alone
 * (see sync.ts) so it doesn't stomp the group back onto `Position` (the
 * leaf center, not the hinge point) every frame.
 */
function addDoorLeaf(
  world: World,
  scene: THREE.Scene,
  leafCx: number,
  leafCz: number,
  hx: number,
  hz: number,
  hingeX: number,
  hingeZ: number,
  hingeSign: number,
): number {
  const closedY = DOOR_HEIGHT / 2;

  const group = new THREE.Group();
  group.position.set(hingeX, closedY, hingeZ);
  scene.add(group);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, DOOR_HEIGHT, hz * 2), doorMaterial());
  mesh.position.set(leafCx - hingeX, 0, leafCz - hingeZ);
  group.add(mesh);

  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, Collider);
  addComponent(world, eid, Door);
  addComponent(world, eid, Object3DRef);
  Position.x[eid] = leafCx;
  Position.y[eid] = closedY;
  Position.z[eid] = leafCz;
  Collider.hx[eid] = hx;
  Collider.hz[eid] = hz;
  Door.state[eid] = DoorState.CLOSED;
  Door.progress[eid] = 0;
  Door.hingeSign[eid] = hingeSign;
  Door.pairId[eid] = eid; // fixed up by addDoorPair to the shared pair id
  Object3DRef[eid] = group;
  mesh.userData.eid = eid; // lets tryInteract's recursive raycast find the eid

  return eid;
}

/**
 * Builds a doorway as **two hinge leaves** (~1.5m each) rather than one
 * 3m slab, hinged on opposite outer edges and swinging outward like double
 * doors — avoids one wide slab sweeping a big arc, and reads more like a
 * real door. Both leaves share a `Door.pairId` so `tryInteract` opens them
 * together (see doors.ts).
 *
 * Also emits a **header wall**: a wall segment spanning the same width as
 * the doorway, from `DOOR_HEIGHT` up to `wallHeight` (the room's actual
 * ceiling height), so the doorway doesn't leave an open gap to the ceiling
 * in tall rooms (e.g. a 6m great_hall vs. a 2.2m door leaf). Skipped when
 * `wallHeight <= DOOR_HEIGHT` (no gap to fill). It's built with
 * `addWall(..., solid: false)` — visual geometry only, no ECS entity — since
 * XZ-only collision would otherwise treat its footprint as blocking the
 * doorway at floor level even though it sits well above head height (see
 * `addWall`'s doc comment). It's otherwise a separate static mesh from the
 * door leaves and never affects leaf swinging, which still only occupies
 * `0..DOOR_HEIGHT`.
 */
function addDoorPair(world: World, scene: THREE.Scene, orientation: "x" | "z", planeCoord: number, rangeStart: number, rangeEnd: number, wallHeight: number): void {
  const leafHalf = (rangeEnd - rangeStart) / 4; // half-width of each ~1.5m leaf

  let eidA: number;
  let eidB: number;
  if (orientation === "x") {
    // Wall plane at constant X (a +x/-x boundary); leaves split the Z span,
    // slab thickness runs along X.
    eidA = addDoorLeaf(world, scene, planeCoord, rangeStart + leafHalf, WALL_THICKNESS, leafHalf, planeCoord, rangeStart, 1);
    eidB = addDoorLeaf(world, scene, planeCoord, rangeEnd - leafHalf, WALL_THICKNESS, leafHalf, planeCoord, rangeEnd, -1);
  } else {
    // Wall plane at constant Z (a +z/-z boundary); leaves split the X span,
    // slab thickness runs along Z.
    eidA = addDoorLeaf(world, scene, rangeStart + leafHalf, planeCoord, leafHalf, WALL_THICKNESS, rangeStart, planeCoord, 1);
    eidB = addDoorLeaf(world, scene, rangeEnd - leafHalf, planeCoord, leafHalf, WALL_THICKNESS, rangeEnd, planeCoord, -1);
  }
  Door.pairId[eidA] = eidA;
  Door.pairId[eidB] = eidA;

  const headerHeight = wallHeight - DOOR_HEIGHT;
  if (headerHeight > 0) {
    const cRange = (rangeStart + rangeEnd) / 2;
    const hRange = (rangeEnd - rangeStart) / 2;
    if (orientation === "x") {
      addWall(world, scene, planeCoord, cRange, WALL_THICKNESS, hRange, headerHeight, DOOR_HEIGHT, false);
    } else {
      addWall(world, scene, cRange, planeCoord, hRange, WALL_THICKNESS, headerHeight, DOOR_HEIGHT, false);
    }
  }
}

interface InstanceBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  heightCells: number;
}

/** A pending wall or door segment, collected in cell-grid units during the
 * main perimeter walk and only turned into actual geometry afterward, once
 * every segment is known — that second pass is what lets wall segments
 * check whether a perpendicular wall meets them at a corner (see
 * `emitWalls` below) before deciding how far to extend. */
interface Segment {
  orientation: "x" | "z"; // "x" = plane at constant X (a +x/-x boundary); "z" = plane at constant Z
  planeCell: number; // grid-cell integer coordinate of the plane
  rangeStartCell: number; // grid-cell integer start of the segment's span (span is always exactly 1 cell pre-extension)
  wallHeight: number;
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

function cornerKey(cellX: number, cellZ: number): string {
  return `${cellX},${cellZ}`;
}

/**
 * Turns collected wall segments into actual wall boxes. Where a segment's
 * end meets a perpendicular wall segment (a real 90° corner), that end is
 * extended by `WALL_THICKNESS` past the unit-cell boundary so the two
 * segments fully overlap at the corner instead of only touching in a thin
 * `WALL_THICKNESS`-ish square — the standard "extend into the corner" miter
 * trick, applied per-segment rather than rewriting wall emission into
 * merged per-instance loops. Ends that border an opening/door are never
 * extended, so doorways keep their exact framing.
 */
function emitWalls(world: World, scene: THREE.Scene, segments: Segment[]): void {
  const xWallCorners = new Set<string>(); // corners touched by an x-oriented (plane-at-constant-X) wall
  const zWallCorners = new Set<string>(); // corners touched by a z-oriented (plane-at-constant-Z) wall

  for (const seg of segments) {
    if (seg.orientation === "x") {
      xWallCorners.add(cornerKey(seg.planeCell, seg.rangeStartCell));
      xWallCorners.add(cornerKey(seg.planeCell, seg.rangeStartCell + 1));
    } else {
      zWallCorners.add(cornerKey(seg.rangeStartCell, seg.planeCell));
      zWallCorners.add(cornerKey(seg.rangeStartCell + 1, seg.planeCell));
    }
  }

  for (const seg of segments) {
    let rangeStart = seg.rangeStartCell * UNIT;
    let rangeEnd = (seg.rangeStartCell + 1) * UNIT;
    const planeCoord = seg.planeCell * UNIT;

    if (seg.orientation === "x") {
      if (zWallCorners.has(cornerKey(seg.planeCell, seg.rangeStartCell))) rangeStart -= WALL_THICKNESS;
      if (zWallCorners.has(cornerKey(seg.planeCell, seg.rangeStartCell + 1))) rangeEnd += WALL_THICKNESS;
      const cz = (rangeStart + rangeEnd) / 2;
      const hz = (rangeEnd - rangeStart) / 2;
      addWall(world, scene, planeCoord, cz, WALL_THICKNESS, hz, seg.wallHeight);
    } else {
      if (xWallCorners.has(cornerKey(seg.rangeStartCell, seg.planeCell))) rangeStart -= WALL_THICKNESS;
      if (xWallCorners.has(cornerKey(seg.rangeStartCell + 1, seg.planeCell))) rangeEnd += WALL_THICKNESS;
      const cx = (rangeStart + rangeEnd) / 2;
      const hx = (rangeEnd - rangeStart) / 2;
      addWall(world, scene, cx, planeCoord, hx, WALL_THICKNESS, seg.wallHeight);
    }
  }
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

  // --- Walls & doors, one segment per unit-cell face. A shared boundary
  // between two instances is only emitted once (from the "owner" +x/+z
  // direction); an outer boundary (facing empty space) is emitted from
  // whichever direction actually has geometry there. Walls are collected
  // and emitted in a second pass (emitWalls) so corner-mitering can see
  // every segment; doors are built immediately since they never need
  // mitering against their neighbors. ---
  const wallSegments: Segment[] = [];

  for (const [key, cell] of index) {
    const [x, z] = key.split(",").map(Number);
    const wallHeight = cell.heightCells * UNIT;

    for (const dir of WALL_DIRS) {
      const kind = cell.sides[dir.side];
      if (kind === null) continue; // interior to this tile instance

      const neighbor = index.get(`${x + dir.dx},${z + dir.dz}`);
      let effective: FaceKind;
      if (neighbor) {
        if (!dir.owner) continue; // the neighbor's opposite pass owns this boundary
        effective = combineKind(kind, neighbor.sides[dir.opposite] ?? "wall");
      } else {
        // Outer boundary — validateOccupancy guarantees this is "wall".
        effective = kind;
      }

      if (effective === "opening") continue; // just empty space, no geometry

      // A door's header must reach the taller of the two rooms it connects
      // (e.g. a great_hall door opening onto a lower-ceilinged hallway) —
      // otherwise the boundary is emitted from whichever side "owns" it
      // (see `owner` above) and a header sized only to the *shorter* side's
      // `wallHeight` would still leave the taller room's gap open above it.
      const doorHeaderHeight = neighbor ? Math.max(wallHeight, neighbor.heightCells * UNIT) : wallHeight;

      if (dir.dx !== 0) {
        // +x or -x boundary: a plane of constant X, spanning this cell's Z extent.
        const planeCell = dir.dx > 0 ? x + 1 : x;
        if (effective === "wall") {
          wallSegments.push({ orientation: "x", planeCell, rangeStartCell: z, wallHeight });
        } else {
          addDoorPair(world, scene, "x", planeCell * UNIT, z * UNIT, (z + 1) * UNIT, doorHeaderHeight);
        }
      } else {
        // +z or -z boundary: a plane of constant Z, spanning this cell's X extent.
        const planeCell = dir.dz > 0 ? z + 1 : z;
        if (effective === "wall") {
          wallSegments.push({ orientation: "z", planeCell, rangeStartCell: x, wallHeight });
        } else {
          addDoorPair(world, scene, "z", planeCell * UNIT, x * UNIT, (x + 1) * UNIT, doorHeaderHeight);
        }
      }
    }
  }

  emitWalls(world, scene, wallSegments);
}
