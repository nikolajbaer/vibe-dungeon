import * as THREE from "three";
import { addComponent, addEntity, type World } from "bitecs";
import { Door, DoorState, Object3DRef, PhysicsBody } from "../ecs/components";
import { UNIT, floorBaseline } from "./tiles";
import type { FaceKind } from "./tiles";
import { TILE_TYPES } from "./tileTypeRegistry";
import type { OccupancyIndex } from "./occupancy";
import { parseWorldCellKey, worldCellKey } from "./occupancy";
import type { LockedDoorSpec } from "./placementTypes";
import { wallMaterial, floorMaterial, ceilingMaterial, doorMaterial } from "./materials";
import { addKinematicBox, addStaticBox, type Physics } from "../physics/world";
import { registerSectorShadowLight, type SectorVisibility } from "./visibility";

// Decomposes a validated tile occupancy index into the wall/floor/ceiling/
// door boxes the old hand-placed src/level/level.ts used to build directly
// (issue #21) — meshes for three.js, plus matching Rapier colliders for
// physics.
//
// Static geometry (walls, floors, ceilings) deliberately gets *no ECS
// entity*: it used to need one purely to carry a `Collider`/`Solid` for the
// old collision pass, and nothing else ever read it — so with Rapier owning
// those colliders, the entities were pure overhead (including a pointless
// per-frame `syncSystem` write of a position that never changes). Doors
// still get one, since `Door` is real per-entity state the interact/
// animation systems drive.

// Exported so `stairBuilder.ts`'s shaft guard walls (see its
// `buildShaftGuardWalls`) can align flush with a stair landing's own
// tile-generated walls above/below them, rather than hardcoding a second
// copy of this that could silently drift out of sync.
export const WALL_THICKNESS = 0.15; // half-thickness of a wall/door slab, meters
const DOOR_HEIGHT = 2.2;

/**
 * Adds a wall box spanning [cx-hx,cx+hx] x [cz-hz,cz+hz], from `baseY` up to
 * `baseY + height` (default `baseY = 0`, i.e. floor-to-height like a regular
 * wall). A header wall above a doorway passes `baseY = DOOR_HEIGHT` to sit
 * above the door leaf instead of starting at the floor.
 *
 * Headers are now solid like any other wall. Under the old XZ-only collision
 * they had to be deliberately non-solid: a collider with no vertical extent
 * would have blocked the doorway at floor level across the header's whole
 * footprint, sealing it shut even with both leaves open. A real 3D box
 * sitting from `DOOR_HEIGHT` up simply doesn't intersect anything walking
 * underneath it.
 */
function addWall(physics: Physics, scene: THREE.Scene, cx: number, cz: number, hx: number, hz: number, height: number, baseY: number = 0): void {
  const centerY = baseY + height / 2;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, height, hz * 2), wallMaterial());
  mesh.position.set(cx, centerY, cz);
  // Issue #64: lets torch PointLights (see addTorch below) actually cast
  // shadows off walls — the moody "pools of light" look falls flat without
  // them, since a flat-lit wall face reads the same near a torch or far
  // from one.
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  addStaticBox(physics, cx, centerY, cz, hx, height / 2, hz);
}

const SLAB_HALF_THICKNESS = 0.1;

/** Adds a floor or ceiling slab. These are now genuinely solid: a floor is
 * the surface characters actually stand on (gravity is real — see
 * physics/world.ts), where the old XZ-only collision had no concept of a
 * ground plane at all and simply pinned everything to a fixed height.
 * `kind` is also stamped onto `userData.slabKind` as an identification tag
 * for external consumers (the level viewer hides ceilings to see inside a
 * room from outside — see `src/viewer/`). */
function addSlab(physics: Physics, scene: THREE.Scene, cx: number, cz: number, hx: number, hz: number, y: number, material: THREE.Material, kind: "floor" | "ceiling"): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, SLAB_HALF_THICKNESS * 2, hz * 2), material);
  mesh.position.set(cx, y, cz);
  mesh.userData.slabKind = kind;
  // Issue #64: floors/ceilings receive torch shadows (a ceiling can also
  // receive from anything below it, harmless either way); neither needs to
  // cast since nothing subsequently placed relies on their shadow.
  mesh.receiveShadow = true;
  scene.add(mesh);

  addStaticBox(physics, cx, y, cz, hx, SLAB_HALF_THICKNESS, hz);
}

// --- Wall-mounted torches (issue #41) -------------------------------------
// Baked-in level dressing, same spirit as `addSlab`: purely visual geometry
// plus a real `THREE.PointLight`, no ECS entity/Collider/Solid at all — a
// torch is never solid and never interactable. Kept deliberately sparse (see
// the room-selection logic in `emitWalls`) since dynamic point lights aren't
// free in three.js's standard material pipeline.

const TORCH_MOUNT_Y = 2.1; // meters above the floor — readable at both player eye height and above head height in taller rooms
const TORCH_BRACKET_LENGTH = 0.22; // how far the bracket arm juts into the room from the wall face
const TORCH_BRACKET_THICKNESS = 0.06;
const TORCH_FLAME_RADIUS = 0.09;
const TORCH_FLAME_HEIGHT = 0.22;
const TORCH_LIGHT_COLOR = 0xffaa55; // warm torchlight
const TORCH_LIGHT_INTENSITY = 1.82; // +30% over the original 1.4 -- main rooms read too dark with just two of these per room
const TORCH_LIGHT_RANGE = 7.8; // meters, +30% over the original 6 -- still a warm pool, not room-flooding, just a wider one

let torchBracketMaterial: THREE.MeshStandardMaterial | null = null;
function getTorchBracketMaterial(): THREE.MeshStandardMaterial {
  if (!torchBracketMaterial) {
    torchBracketMaterial = new THREE.MeshStandardMaterial({ color: 0x2b1f16, roughness: 0.85, metalness: 0.15 });
  }
  return torchBracketMaterial;
}

let torchFlameMaterial: THREE.MeshStandardMaterial | null = null;
function getTorchFlameMaterial(): THREE.MeshStandardMaterial {
  if (!torchFlameMaterial) {
    torchFlameMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb347,
      emissive: 0xff6a1a,
      emissiveIntensity: 2.2,
      roughness: 0.4,
    });
  }
  return torchFlameMaterial;
}

/**
 * Adds one wall-mounted torch: a small bracket "arm" jutting out from the
 * wall face at `(cx, cz)`, a glowing flame mesh at its tip, and a real
 * `THREE.PointLight` colocated with the flame. `orientation`/`interiorSign`
 * say which axis-aligned direction is "into the room" from the wall plane
 * (walls here are always axis-aligned, so the bracket/flame/light offsets
 * are just added along that one world axis — no rotation math needed).
 * Purely visual: no ECS entity, no Collider/Solid.
 */
function addTorch(
  scene: THREE.Scene,
  cx: number,
  cz: number,
  wallHeight: number,
  orientation: "x" | "z",
  interiorSign: 1 | -1,
  floorBase: number,
  sectorId: string,
  vis: SectorVisibility,
): void {
  const mountY = floorBase + Math.min(TORCH_MOUNT_Y, wallHeight - 0.4);
  const offsetX = orientation === "x" ? interiorSign : 0;
  const offsetZ = orientation === "z" ? interiorSign : 0;

  const group = new THREE.Group();
  group.position.set(cx, mountY, cz);
  scene.add(group);

  const bracket = new THREE.Mesh(
    new THREE.BoxGeometry(
      orientation === "x" ? TORCH_BRACKET_LENGTH : TORCH_BRACKET_THICKNESS,
      TORCH_BRACKET_THICKNESS,
      orientation === "z" ? TORCH_BRACKET_LENGTH : TORCH_BRACKET_THICKNESS,
    ),
    getTorchBracketMaterial(),
  );
  bracket.position.set(offsetX * (TORCH_BRACKET_LENGTH / 2), 0, offsetZ * (TORCH_BRACKET_LENGTH / 2));
  group.add(bracket);

  const flame = new THREE.Mesh(new THREE.ConeGeometry(TORCH_FLAME_RADIUS, TORCH_FLAME_HEIGHT, 8), getTorchFlameMaterial());
  flame.position.set(offsetX * TORCH_BRACKET_LENGTH, TORCH_FLAME_HEIGHT / 2 + 0.03, offsetZ * TORCH_BRACKET_LENGTH);
  group.add(flame);

  const light = new THREE.PointLight(TORCH_LIGHT_COLOR, TORCH_LIGHT_INTENSITY, TORCH_LIGHT_RANGE, 2);
  light.position.set(offsetX * TORCH_BRACKET_LENGTH, TORCH_FLAME_HEIGHT / 2, offsetZ * TORCH_BRACKET_LENGTH);
  // Issue #64: cast real shadows off the walls/floor/ceiling (see addWall/
  // addSlab) so torchlight actually reads as directional, not just a lit
  // sphere floating in space. Only a handful of torches ever exist at once
  // (TORCHES_PER_ROOM, room-sized instances only), so a modest per-light
  // shadow map is cheap; `shadow.camera.far` matches the light's own falloff
  // range since nothing past it is lit brightly enough for a missing shadow
  // to be visible anyway.
  light.castShadow = true;
  light.shadow.mapSize.set(256, 256);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = TORCH_LIGHT_RANGE;
  light.shadow.bias = -0.002;
  group.add(light);

  // Perf investigation (see visibility.ts's header comment): a shadow-casting
  // PointLight costs a full extra shadow-map render pass every frame it's
  // enabled for, whether or not the player is anywhere near it. Registering
  // it here — rather than leaving `castShadow` permanently true — lets
  // `level.ts`'s `updateVisibility` gate it off for every sector that isn't
  // the player's current one or one open connection away, with zero visual
  // change to whichever room(s) actually matter right now.
  registerSectorShadowLight(vis, sectorId, light);
}

/**
 * Adds one door leaf as a matched pair of hinges — a visual `THREE.Group`
 * and a kinematic Rapier body — both positioned at the world hinge point
 * `(hingeX, hingeZ)`, each carrying the slab offset by half the leaf's width
 * so that rotating the hinge swings the slab rather than spinning it in
 * place. `doorAnimationSystem` (doors.ts) drives both in lockstep, so the
 * collider tracks exactly what's on screen.
 *
 * That collider-on-the-hinge arrangement is what the old static-AABB version
 * couldn't do: its collider sat at the leaf's *closed* position and never
 * moved, so passing through an open doorway needed collisionSystem to
 * special-case "ignore a door that's ≥90% open". Here the door is simply
 * not in the way any more once it's swung aside.
 */
function addDoorLeaf(
  world: World,
  physics: Physics,
  scene: THREE.Scene,
  leafCx: number,
  leafCz: number,
  hx: number,
  hz: number,
  hingeX: number,
  hingeZ: number,
  hingeSign: number,
  floorBase: number,
  requiredItemTypeId: string | undefined,
): number {
  const closedY = floorBase + DOOR_HEIGHT / 2;
  const offsetX = leafCx - hingeX;
  const offsetZ = leafCz - hingeZ;

  const group = new THREE.Group();
  group.position.set(hingeX, closedY, hingeZ);
  scene.add(group);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, DOOR_HEIGHT, hz * 2), doorMaterial(!!requiredItemTypeId));
  mesh.position.set(offsetX, 0, offsetZ);
  group.add(mesh);

  const eid = addEntity(world);
  addComponent(world, eid, Door);
  addComponent(world, eid, Object3DRef);
  addComponent(world, eid, PhysicsBody);
  Door.state[eid] = DoorState.CLOSED;
  Door.progress[eid] = 0;
  Door.hingeSign[eid] = hingeSign;
  Door.pairId[eid] = eid; // fixed up by addDoorPair to the shared pair id
  Door.locked[eid] = requiredItemTypeId ? 1 : 0;
  Door.requiredItemTypeId[eid] = requiredItemTypeId;
  Object3DRef[eid] = group;
  PhysicsBody[eid] = addKinematicBox(physics, hingeX, closedY, hingeZ, offsetX, 0, offsetZ, hx, DOOR_HEIGHT / 2, hz);
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
 * `wallHeight <= DOOR_HEIGHT` (no gap to fill). It's an ordinary solid wall
 * box — a real 3D collider sitting from `DOOR_HEIGHT` up simply doesn't
 * intersect anything walking underneath it, so unlike under the old XZ-only
 * collision it no longer has to be built non-solid to avoid sealing the
 * doorway (see `addWall`). It's a separate box from the door leaves and
 * never affects leaf swinging, which still only occupies `0..DOOR_HEIGHT`.
 */
function addDoorPair(world: World, physics: Physics, scene: THREE.Scene, orientation: "x" | "z", planeCoord: number, rangeStart: number, rangeEnd: number, wallHeight: number, floorBase: number, requiredItemTypeId: string | undefined): void {
  const leafHalf = (rangeEnd - rangeStart) / 4; // half-width of each ~1.5m leaf

  let eidA: number;
  let eidB: number;
  if (orientation === "x") {
    // Wall plane at constant X (a +x/-x boundary); leaves split the Z span,
    // slab thickness runs along X.
    eidA = addDoorLeaf(world, physics, scene, planeCoord, rangeStart + leafHalf, WALL_THICKNESS, leafHalf, planeCoord, rangeStart, 1, floorBase, requiredItemTypeId);
    eidB = addDoorLeaf(world, physics, scene, planeCoord, rangeEnd - leafHalf, WALL_THICKNESS, leafHalf, planeCoord, rangeEnd, -1, floorBase, requiredItemTypeId);
  } else {
    // Wall plane at constant Z (a +z/-z boundary); leaves split the X span,
    // slab thickness runs along Z.
    eidA = addDoorLeaf(world, physics, scene, rangeStart + leafHalf, planeCoord, leafHalf, WALL_THICKNESS, rangeStart, planeCoord, 1, floorBase, requiredItemTypeId);
    eidB = addDoorLeaf(world, physics, scene, rangeEnd - leafHalf, planeCoord, leafHalf, WALL_THICKNESS, rangeEnd, planeCoord, -1, floorBase, requiredItemTypeId);
  }
  Door.pairId[eidA] = eidA;
  Door.pairId[eidB] = eidA;

  const headerHeight = wallHeight - DOOR_HEIGHT;
  if (headerHeight > 0) {
    const cRange = (rangeStart + rangeEnd) / 2;
    const hRange = (rangeEnd - rangeStart) / 2;
    if (orientation === "x") {
      addWall(physics, scene, planeCoord, cRange, WALL_THICKNESS, hRange, headerHeight, floorBase + DOOR_HEIGHT);
    } else {
      addWall(physics, scene, cRange, planeCoord, hRange, WALL_THICKNESS, headerHeight, floorBase + DOOR_HEIGHT);
    }
  }
}

interface InstanceBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  heightCells: number;
  /** Which floor this instance is on (see `TileInstance.floor`) — sets the
   * world Y its floor/ceiling slabs actually sit at (`floorBaseline`). */
  floor: number;
  /** The instance's tile type id, so its floor/ceiling slabs can be skipped
   * per `TileType.skipFloorSlab`/`skipCeilingSlab` (a staircase's landings —
   * see `stair_lower.ts`/`stair_upper.ts`). */
  tileTypeId: string;
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
  instanceId: string; // owning tile instance (the cell this segment was emitted from) — used to place torches per-room, not per-segment
  roomSized: boolean; // true for a "room-sized" tile instance (both footprint dimensions > 1 cell) — corridors (e.g. hallway, 1 cell wide) are never torch-eligible
  interiorSign: 1 | -1; // which way, along this segment's perpendicular axis, the owning cell's interior (the room) lies relative to the wall plane
  /** Which floor the owning cell is on — sets the world Y this segment's
   * wall (and any torch on it) is actually built at (`floorBaseline`). */
  floor: number;
  /** The owning cell's sector — threaded through so a torch built on this
   * segment (see `pickTorchSegments`/`emitWalls`) registers under the right
   * sector for `visibility.ts`'s shadow gating. */
  sectorId: string;
}

/** A tile instance counts as "room-sized" (torch-eligible) when its footprint
 * is more than one cell wide in both directions — a 1-wide corridor like
 * `hallway` (w=1) never qualifies, per issue #41 ("skip corridors
 * entirely"), without hardcoding tile type ids here. */
function isRoomSizedTileType(tileTypeId: string): boolean {
  const type = TILE_TYPES[tileTypeId];
  return !!type && type.w > 1 && type.d > 1;
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
 *
 * Also decides **torch placement** (issue #41) here, since this is where
 * every wall segment for the whole level is known at once: `pickTorchSegments`
 * groups segments by owning tile instance and picks up to `TORCHES_PER_ROOM`
 * of a room-sized instance's segments, spread apart by taking from opposite
 * ends of its segment list (which in practice tend to land on different
 * walls). Corridors are excluded via `roomSized`, keeping the total
 * torch/light count to roughly one or two per room, never per wall segment.
 */
const TORCHES_PER_ROOM = 2;

function pickTorchSegments(segments: Segment[]): Set<Segment> {
  const byInstance = new Map<string, Segment[]>();
  for (const seg of segments) {
    if (!seg.roomSized) continue;
    const list = byInstance.get(seg.instanceId);
    if (list) list.push(seg);
    else byInstance.set(seg.instanceId, [seg]);
  }

  const chosen = new Set<Segment>();
  for (const list of byInstance.values()) {
    if (list.length === 0) continue;
    chosen.add(list[0]);
    if (TORCHES_PER_ROOM > 1 && list.length > 1) {
      chosen.add(list[Math.floor(list.length / 2)]);
    }
  }
  return chosen;
}

function emitWalls(physics: Physics, scene: THREE.Scene, segments: Segment[], vis: SectorVisibility): void {
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

  const torchSegments = pickTorchSegments(segments);

  for (const seg of segments) {
    let rangeStart = seg.rangeStartCell * UNIT;
    let rangeEnd = (seg.rangeStartCell + 1) * UNIT;
    const planeCoord = seg.planeCell * UNIT;
    // Torch position uses the segment's original (pre-extension) midpoint so
    // corner mitering never nudges it visibly off-center on its wall face.
    const along = (seg.rangeStartCell + 0.5) * UNIT;

    const floorBase = floorBaseline(seg.floor);

    if (seg.orientation === "x") {
      if (zWallCorners.has(cornerKey(seg.planeCell, seg.rangeStartCell))) rangeStart -= WALL_THICKNESS;
      if (zWallCorners.has(cornerKey(seg.planeCell, seg.rangeStartCell + 1))) rangeEnd += WALL_THICKNESS;
      const cz = (rangeStart + rangeEnd) / 2;
      const hz = (rangeEnd - rangeStart) / 2;
      addWall(physics, scene, planeCoord, cz, WALL_THICKNESS, hz, seg.wallHeight, floorBase);
      if (torchSegments.has(seg)) {
        addTorch(scene, planeCoord + seg.interiorSign * WALL_THICKNESS, along, seg.wallHeight, "x", seg.interiorSign, floorBase, seg.sectorId, vis);
      }
    } else {
      if (xWallCorners.has(cornerKey(seg.rangeStartCell, seg.planeCell))) rangeStart -= WALL_THICKNESS;
      if (xWallCorners.has(cornerKey(seg.rangeStartCell + 1, seg.planeCell))) rangeEnd += WALL_THICKNESS;
      const cx = (rangeStart + rangeEnd) / 2;
      const hx = (rangeEnd - rangeStart) / 2;
      addWall(physics, scene, cx, planeCoord, hx, WALL_THICKNESS, seg.wallHeight, floorBase);
      if (torchSegments.has(seg)) {
        addTorch(scene, along, planeCoord + seg.interiorSign * WALL_THICKNESS, seg.wallHeight, "z", seg.interiorSign, floorBase, seg.sectorId, vis);
      }
    }
  }
}

function lockedDoorKey(x: number, z: number, side: string): string {
  return `${x},${z},${side}`;
}

/**
 * Builds wall/floor/ceiling/door geometry + ECS entities for every tile
 * placed in `index`. Call `validateOccupancy(index)` first — this function
 * assumes the occupancy index is already known-good. `lockedDoors` (usually
 * `ALL_LOCKED_DOORS`, see `rooms.ts`) marks which already-authored door
 * faces should be built locked — see `LockedDoorSpec`'s doc comment.
 */
export function buildGeometryFromOccupancy(world: World, physics: Physics, scene: THREE.Scene, index: OccupancyIndex, lockedDoors: LockedDoorSpec[] = [], vis: SectorVisibility): void {
  const lockedDoorLookup = new Map<string, string>(); // cell+side key -> requiredItemTypeId
  for (const spec of lockedDoors) {
    lockedDoorLookup.set(lockedDoorKey(spec.x, spec.z, spec.side), spec.requiredItemTypeId);
  }
  // --- Floors & ceilings: one slab per tile instance, spanning its full
  // footprint (matches how the old level.ts built one slab per room). ---
  const bounds = new Map<string, InstanceBounds>();
  for (const [key, cell] of index) {
    const { x, z } = parseWorldCellKey(key);
    const b = bounds.get(cell.instanceId);
    if (!b) {
      bounds.set(cell.instanceId, { minX: x, maxX: x, minZ: z, maxZ: z, heightCells: cell.heightCells, floor: cell.floor, tileTypeId: cell.tileTypeId });
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
    const floorBase = floorBaseline(b.floor);
    const ceilingY = floorBase + b.heightCells * UNIT;
    const type = TILE_TYPES[b.tileTypeId];
    // Issue #86: a staircase's two landings each skip one of their own
    // slabs — the lower landing has no ceiling (the shaft continues up
    // through where one would sit) and the upper landing has no floor (it
    // stands on riser geometry instead — see `stairBuilder.ts`). Every other
    // tile type leaves both flags unset and gets the normal pair of slabs.
    if (!type?.skipFloorSlab) addSlab(physics, scene, cx, cz, hx, hz, floorBase - 0.1, floorMaterial(), "floor");
    if (!type?.skipCeilingSlab) addSlab(physics, scene, cx, cz, hx, hz, ceilingY + 0.1, ceilingMaterial(), "ceiling");
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
    const { x, z } = parseWorldCellKey(key);
    const wallHeight = cell.heightCells * UNIT;
    const floorBase = floorBaseline(cell.floor);

    for (const dir of WALL_DIRS) {
      const kind = cell.sides[dir.side];
      if (kind === null) continue; // interior to this tile instance

      // Same-floor neighbor only — see validateOccupancy's identical
      // reasoning for why a wall/door boundary never crosses floors.
      const neighbor = index.get(worldCellKey(x + dir.dx, z + dir.dz, cell.floor));
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

      const requiredItemTypeId = lockedDoorLookup.get(lockedDoorKey(x, z, dir.side));

      if (dir.dx !== 0) {
        // +x or -x boundary: a plane of constant X, spanning this cell's Z extent.
        const planeCell = dir.dx > 0 ? x + 1 : x;
        if (effective === "wall") {
          wallSegments.push({
            orientation: "x",
            planeCell,
            rangeStartCell: z,
            wallHeight,
            instanceId: cell.instanceId,
            roomSized: isRoomSizedTileType(cell.tileTypeId),
            interiorSign: (dir.dx > 0 ? -1 : 1) as 1 | -1,
            floor: cell.floor,
            sectorId: cell.sectorId,
          });
        } else {
          addDoorPair(world, physics, scene, "x", planeCell * UNIT, z * UNIT, (z + 1) * UNIT, doorHeaderHeight, floorBase, requiredItemTypeId);
        }
      } else {
        // +z or -z boundary: a plane of constant Z, spanning this cell's X extent.
        const planeCell = dir.dz > 0 ? z + 1 : z;
        if (effective === "wall") {
          wallSegments.push({
            orientation: "z",
            planeCell,
            rangeStartCell: x,
            wallHeight,
            instanceId: cell.instanceId,
            roomSized: isRoomSizedTileType(cell.tileTypeId),
            interiorSign: (dir.dz > 0 ? -1 : 1) as 1 | -1,
            floor: cell.floor,
            sectorId: cell.sectorId,
          });
        } else {
          addDoorPair(world, physics, scene, "z", planeCell * UNIT, x * UNIT, (x + 1) * UNIT, doorHeaderHeight, floorBase, requiredItemTypeId);
        }
      }
    }
  }

  emitWalls(physics, scene, wallSegments, vis);
}
