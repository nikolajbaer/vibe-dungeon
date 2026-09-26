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
import { applyWorldStoneUV } from "./stoneUV";
import { StoneDressing, addHallwayHanging } from "./stoneDressing";
import { addKinematicBox, addStaticBox, type Physics } from "../physics/world";

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
const DOOR_SPRING_HEIGHT = 1.72;
const DOOR_HEIGHT = 2.35; // apex of the arch
const DOOR_ARCH_RISE = DOOR_HEIGHT - DOOR_SPRING_HEIGHT;
const DOOR_FRAME_WIDTH = 0.16;
const DOUBLE_DOOR_WIDTH = 2.2; // leaves .4m of stone on each side of a 3m cell
const DOUBLE_DOOR_HALF_THICKNESS = .07;

// A `"singleDoor"` (tiles.ts) is a single narrow leaf, inset within the
// cell's own 3m span rather than spanning all of it — flanked by ordinary
// wall on both sides, plus a flat header above (see `addSingleDoor` below),
// rather than the arch/spandrel/stone-frame `addDoorPair` needs to fill a
// *whole*-cell-width doorway. Sized "slightly bigger than an NPC": an NPC's
// own collision footprint is `2 * halfExtent` = 0.8m wide and
// `HUMANOID_HEIGHT` = 1.79m tall (`spawning.ts`) — 1.0m/2.0m leaves a small
// margin on both without reading as a grand doorway.
const SINGLE_DOOR_WIDTH = 1.0;
const SINGLE_DOOR_HEIGHT = 2.0;
const SINGLE_DOOR_THICKNESS = 0.08; // half-thickness of the single leaf slab

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
  applyWorldStoneUV(mesh);
  // Issue #64: lets torch PointLights (see addTorch below) actually cast
  // shadows off walls — the moody "pools of light" look falls flat without
  // them, since a flat-lit wall face reads the same near a torch or far
  // from one.
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.wallRun = true;
  scene.add(mesh);

  addStaticBox(physics, cx, centerY, cz, hx, height / 2, hz);
}

/** Low-poly arched leaf. `hingeSign` also identifies which half of the
 * doorway this is, so the outer edge meets the spring and the inner edge
 * rises to the shared apex. */
export function createArchedDoorLeafGeometry(width: number, depth: number, hingeSign: number): THREE.ExtrudeGeometry {
  const radius = width;
  const centerY = DOOR_HEIGHT / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -centerY);
  shape.lineTo(width / 2, -centerY);
  const samples = 6;
  for (let i = 0; i <= samples; i++) {
    const fromOuter = i / samples;
    const u = hingeSign > 0 ? -radius * fromOuter : radius * (1 - fromOuter);
    const localX = hingeSign > 0 ? u + radius / 2 : u - radius / 2;
    const y = DOOR_SPRING_HEIGHT + DOOR_ARCH_RISE * Math.sqrt(Math.max(0, 1 - (u * u) / (radius * radius))) - centerY;
    shape.lineTo(localX, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 2 });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function addDoorFrame(scene: THREE.Scene, orientation: "x" | "z", planeCoord: number, rangeStart: number, rangeEnd: number, floorBase: number): void {
  const center = (rangeStart + rangeEnd) / 2;
  const radius = (rangeEnd - rangeStart) / 2;
  const depth = WALL_THICKNESS * 2 + .08;
  const group = new THREE.Group();
  group.name = "stoneDoorFrame";
  group.userData.doorFrame = true;
  group.position.set(orientation === "x" ? planeCoord : center, floorBase, orientation === "x" ? center : planeCoord);
  if (orientation === "x") group.rotation.y = Math.PI / 2;

  for (const x of [-radius - DOOR_FRAME_WIDTH / 2, radius + DOOR_FRAME_WIDTH / 2]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(DOOR_FRAME_WIDTH, DOOR_SPRING_HEIGHT, depth), wallMaterial());
    jamb.position.set(x, DOOR_SPRING_HEIGHT / 2, 0);
    jamb.castShadow = jamb.receiveShadow = true;
    group.add(jamb);
    applyWorldStoneUV(jamb);
  }
  const archRadius = radius + DOOR_FRAME_WIDTH / 2;
  const archPoints = Array.from({ length: 13 }, (_, i) => {
    const u = -archRadius + i / 12 * archRadius * 2;
    return new THREE.Vector3(u, DOOR_SPRING_HEIGHT + DOOR_ARCH_RISE * Math.sqrt(Math.max(0, 1 - (u * u) / (archRadius * archRadius))), 0);
  });
  const arch = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPoints), 20, DOOR_FRAME_WIDTH / 2, 4, false),
    wallMaterial(),
  );
  arch.castShadow = arch.receiveShadow = true;
  group.add(arch);
  applyWorldStoneUV(arch);
  scene.add(group);
}

/** Stone infill between the curved opening and the rectangular wall above. */
function addArchSpandrels(physics: Physics, scene: THREE.Scene, orientation: "x" | "z", planeCoord: number, rangeStart: number, rangeEnd: number, wallHeight: number, floorBase: number): void {
  const radius = (rangeEnd - rangeStart) / 2;
  const center = (rangeStart + rangeEnd) / 2;
  const depth = WALL_THICKNESS * 2;
  const shapeFor = (side: -1 | 1) => {
    const shape = new THREE.Shape();
    const outer = side * radius;
    shape.moveTo(outer, DOOR_SPRING_HEIGHT);
    shape.lineTo(outer, DOOR_HEIGHT);
    shape.lineTo(0, DOOR_HEIGHT);
    for (let i = 0; i <= 6; i++) {
      const u = side * radius * (i / 6);
      shape.lineTo(u, DOOR_SPRING_HEIGHT + DOOR_ARCH_RISE * Math.sqrt(Math.max(0, 1 - (u * u) / (radius * radius))));
    }
    shape.closePath();
    return shape;
  };
  const geometry = new THREE.ExtrudeGeometry([shapeFor(-1), shapeFor(1)], { depth, bevelEnabled: false, steps: 1, curveSegments: 2 });
  geometry.translate(0, 0, -depth / 2);
  if (orientation === "x") geometry.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, wallMaterial());
  mesh.name = "archedDoorSpandrel";
  mesh.position.set(orientation === "x" ? planeCoord : center, floorBase, orientation === "x" ? center : planeCoord);
  applyWorldStoneUV(mesh);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  // Approximate the curved underside with narrow columns. A single box from
  // spring to apex would invisibly turn the arch back into a low rectangular
  // doorway for the character controller.
  const columns = 8;
  const columnWidth = radius * 2 / columns;
  for (let i = 0; i < columns; i++) {
    const u = -radius + (i + .5) * columnWidth;
    const curveY = DOOR_SPRING_HEIGHT + DOOR_ARCH_RISE * Math.sqrt(Math.max(0, 1 - (u * u) / (radius * radius)));
    const columnHeight = DOOR_HEIGHT - curveY;
    if (columnHeight <= 0) continue;
    const along = center + u;
    const y = floorBase + curveY + columnHeight / 2;
    if (orientation === "x") addStaticBox(physics, planeCoord, y, along, WALL_THICKNESS, columnHeight / 2, columnWidth / 2);
    else addStaticBox(physics, along, y, planeCoord, columnWidth / 2, columnHeight / 2, WALL_THICKNESS);
  }
  const headerHeight = wallHeight - DOOR_HEIGHT;
  if (headerHeight > 0) {
    if (orientation === "x") addWall(physics, scene, planeCoord, center, WALL_THICKNESS, radius, headerHeight, floorBase + DOOR_HEIGHT);
    else addWall(physics, scene, center, planeCoord, radius, WALL_THICKNESS, headerHeight, floorBase + DOOR_HEIGHT);
  }
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
  applyWorldStoneUV(mesh);
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
  castShadows = true,
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
  light.castShadow = castShadows;
  light.shadow.mapSize.set(256, 256);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = TORCH_LIGHT_RANGE;
  light.shadow.bias = -0.002;
  group.add(light);
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
  group.userData.doubleDoor = true;
  scene.add(group);

  const leafWidth = Math.max(hx * 2, hz * 2);
  const mesh = new THREE.Mesh(createArchedDoorLeafGeometry(leafWidth, DOUBLE_DOOR_HALF_THICKNESS * 2, hingeSign), doorMaterial(!!requiredItemTypeId));
  mesh.userData.surfaceMaterial = "wood";
  if (hz > hx) mesh.rotation.y = -Math.PI / 2;
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
 * Builds a doorway as two 1.1m leaves inset into the 3m cell. Short stone
 * piers flank the frame, leaving clear swing room at a corridor junction.
 * Both leaves share a `Door.pairId` and open together.
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
function addDoorPair(world: World, physics: Physics, scene: THREE.Scene, orientation: "x" | "z", planeCoord: number, rangeStart: number, rangeEnd: number, wallHeight: number, floorBase: number, requiredItemTypeId: string | undefined, dressing: StoneDressing): void {
  const center = (rangeStart + rangeEnd) / 2;
  const doorwayStart = center - DOUBLE_DOOR_WIDTH / 2;
  const doorwayEnd = center + DOUBLE_DOOR_WIDTH / 2;
  const leafHalf = DOUBLE_DOOR_WIDTH / 4;
  const outerStart = doorwayStart - DOOR_FRAME_WIDTH;
  const outerEnd = doorwayEnd + DOOR_FRAME_WIDTH;

  // The stone piers stop at the *outside* of the visible jambs, preventing
  // coplanar wall faces from drawing through the frame's front surface.
  if (orientation === "x") {
    addWall(physics, scene, planeCoord, (rangeStart + outerStart) / 2, WALL_THICKNESS, (outerStart - rangeStart) / 2, wallHeight, floorBase);
    addWall(physics, scene, planeCoord, (outerEnd + rangeEnd) / 2, WALL_THICKNESS, (rangeEnd - outerEnd) / 2, wallHeight, floorBase);
  } else {
    addWall(physics, scene, (rangeStart + outerStart) / 2, planeCoord, (outerStart - rangeStart) / 2, WALL_THICKNESS, wallHeight, floorBase);
    addWall(physics, scene, (outerEnd + rangeEnd) / 2, planeCoord, (rangeEnd - outerEnd) / 2, WALL_THICKNESS, wallHeight, floorBase);
  }

  // Above each jamb, fill the narrow strip between the inset arch and the
  // full-height pier. The arched spandrels only cover doorwayStart..doorwayEnd;
  // leaving these strips out exposes two slots over the shoulders of the door.
  const shoulderHeight = wallHeight - DOOR_SPRING_HEIGHT;
  if (shoulderHeight > 0) {
    const shoulderY = floorBase + DOOR_SPRING_HEIGHT;
    for (const [start, end] of [[outerStart, doorwayStart], [doorwayEnd, outerEnd]]) {
      if (orientation === "x") addWall(physics, scene, planeCoord, (start + end) / 2, WALL_THICKNESS, (end - start) / 2, shoulderHeight, shoulderY);
      else addWall(physics, scene, (start + end) / 2, planeCoord, (end - start) / 2, WALL_THICKNESS, shoulderHeight, shoulderY);
    }
  }

  let eidA: number;
  let eidB: number;
  if (orientation === "x") {
    // Wall plane at constant X (a +x/-x boundary); leaves split the Z span,
    // slab thickness runs along X.
    eidA = addDoorLeaf(world, physics, scene, planeCoord, doorwayStart + leafHalf, DOUBLE_DOOR_HALF_THICKNESS, leafHalf, planeCoord, doorwayStart, 1, floorBase, requiredItemTypeId);
    eidB = addDoorLeaf(world, physics, scene, planeCoord, doorwayEnd - leafHalf, DOUBLE_DOOR_HALF_THICKNESS, leafHalf, planeCoord, doorwayEnd, -1, floorBase, requiredItemTypeId);
  } else {
    // Wall plane at constant Z (a +z/-z boundary); leaves split the X span,
    // slab thickness runs along Z.
    eidA = addDoorLeaf(world, physics, scene, doorwayStart + leafHalf, planeCoord, leafHalf, DOUBLE_DOOR_HALF_THICKNESS, doorwayStart, planeCoord, 1, floorBase, requiredItemTypeId);
    eidB = addDoorLeaf(world, physics, scene, doorwayEnd - leafHalf, planeCoord, leafHalf, DOUBLE_DOOR_HALF_THICKNESS, doorwayEnd, planeCoord, -1, floorBase, requiredItemTypeId);
  }
  Door.pairId[eidA] = eidA;
  Door.pairId[eidB] = eidA;
  addArchSpandrels(physics, scene, orientation, planeCoord, doorwayStart, doorwayEnd, wallHeight, floorBase);
  addDoorFrame(scene, orientation, planeCoord, doorwayStart, doorwayEnd, floorBase);
  dressing.doorFrame(orientation, planeCoord, center, DOUBLE_DOOR_WIDTH / 2, DOOR_SPRING_HEIGHT, DOOR_ARCH_RISE, floorBase);
}

/**
 * Adds one `"singleDoor"` leaf — a plain rectangular slab (no arch; a
 * single narrow door doesn't need one the way a whole-cell-wide doorway
 * does) hinged on one vertical edge, the same hinge-group-plus-kinematic-
 * body shape `addDoorLeaf` uses for a double door's leaves, just simpler
 * geometry and `SINGLE_DOOR_HEIGHT` instead of `DOOR_HEIGHT`. Unlike
 * `addDoorPair`'s two leaves, a single door is never paired with another —
 * `Door.pairId[eid] = eid` (its own default) is left as-is, since nothing
 * else ever shares this doorway.
 */
function addSingleDoorLeaf(
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
  const closedY = floorBase + SINGLE_DOOR_HEIGHT / 2;
  const offsetX = leafCx - hingeX;
  const offsetZ = leafCz - hingeZ;

  const group = new THREE.Group();
  group.position.set(hingeX, closedY, hingeZ);
  scene.add(group);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, SINGLE_DOOR_HEIGHT, hz * 2), doorMaterial(!!requiredItemTypeId));
  mesh.userData.surfaceMaterial = "wood";
  mesh.position.set(offsetX, 0, offsetZ);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  const eid = addEntity(world);
  addComponent(world, eid, Door);
  addComponent(world, eid, Object3DRef);
  addComponent(world, eid, PhysicsBody);
  Door.state[eid] = DoorState.CLOSED;
  Door.progress[eid] = 0;
  Door.hingeSign[eid] = hingeSign;
  Door.pairId[eid] = eid;
  Door.locked[eid] = requiredItemTypeId ? 1 : 0;
  Door.requiredItemTypeId[eid] = requiredItemTypeId;
  Object3DRef[eid] = group;
  PhysicsBody[eid] = addKinematicBox(physics, hingeX, closedY, hingeZ, offsetX, 0, offsetZ, hx, SINGLE_DOOR_HEIGHT / 2, hz);
  mesh.userData.eid = eid;

  return eid;
}

/**
 * Builds a `"singleDoor"` boundary: a `SINGLE_DOOR_WIDTH`-wide doorway
 * centered in the cell, one hinged leaf, and ordinary solid wall filling
 * the rest of the cell's span on both sides plus a flat header above —
 * unlike `addDoorPair`, no arch/spandrel/stone-frame is needed, since a
 * plain rectangular doorway narrower than the cell is already fully framed
 * by ordinary wall geometry on every side (`addWall` fills each side and
 * the header; the floor slab and the leaf itself close the rest).
 */
function addSingleDoor(world: World, physics: Physics, scene: THREE.Scene, orientation: "x" | "z", planeCoord: number, rangeStart: number, rangeEnd: number, wallHeight: number, floorBase: number, requiredItemTypeId: string | undefined, dressing: StoneDressing): void {
  const center = (rangeStart + rangeEnd) / 2;
  const doorwayHalf = SINGLE_DOOR_WIDTH / 2;
  const doorwayStart = center - doorwayHalf;
  const doorwayEnd = center + doorwayHalf;

  if (orientation === "x") {
    addWall(physics, scene, planeCoord, (rangeStart + doorwayStart) / 2, WALL_THICKNESS, (doorwayStart - rangeStart) / 2, wallHeight, floorBase);
    addWall(physics, scene, planeCoord, (doorwayEnd + rangeEnd) / 2, WALL_THICKNESS, (rangeEnd - doorwayEnd) / 2, wallHeight, floorBase);
  } else {
    addWall(physics, scene, (rangeStart + doorwayStart) / 2, planeCoord, (doorwayStart - rangeStart) / 2, WALL_THICKNESS, wallHeight, floorBase);
    addWall(physics, scene, (doorwayEnd + rangeEnd) / 2, planeCoord, (rangeEnd - doorwayEnd) / 2, WALL_THICKNESS, wallHeight, floorBase);
  }

  const headerHeight = wallHeight - SINGLE_DOOR_HEIGHT;
  if (headerHeight > 0) {
    if (orientation === "x") addWall(physics, scene, planeCoord, center, WALL_THICKNESS, doorwayHalf, headerHeight, floorBase + SINGLE_DOOR_HEIGHT);
    else addWall(physics, scene, center, planeCoord, doorwayHalf, WALL_THICKNESS, headerHeight, floorBase + SINGLE_DOOR_HEIGHT);
  }

  if (orientation === "x") {
    addSingleDoorLeaf(world, physics, scene, planeCoord, doorwayStart + doorwayHalf, SINGLE_DOOR_THICKNESS, doorwayHalf, planeCoord, doorwayStart, 1, floorBase, requiredItemTypeId);
  } else {
    addSingleDoorLeaf(world, physics, scene, doorwayStart + doorwayHalf, planeCoord, doorwayHalf, SINGLE_DOOR_THICKNESS, doorwayStart, planeCoord, 1, floorBase, requiredItemTypeId);
  }
  dressing.singleFrame(orientation, planeCoord, center, doorwayHalf, SINGLE_DOOR_HEIGHT, floorBase);
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
  corridor: boolean; // long, one-cell-wide passage eligible for sparse dressing
  interiorSign: 1 | -1; // which way, along this segment's perpendicular axis, the owning cell's interior (the room) lies relative to the wall plane
  /** Which floor the owning cell is on — sets the world Y this segment's
   * wall (and any torch on it) is actually built at (`floorBaseline`). */
  floor: number;
}

/** A tile instance counts as "room-sized" (torch-eligible) when its footprint
 * is more than one cell wide in both directions — a 1-wide corridor like
 * `hallway` (w=1) never qualifies, per issue #41 ("skip corridors
 * entirely"), without hardcoding tile type ids here. */
function isRoomSizedTileType(tileTypeId: string): boolean {
  const type = TILE_TYPES[tileTypeId];
  return !!type && type.w > 1 && type.d > 1;
}

function isCorridorTileType(tileTypeId: string): boolean {
  const type = TILE_TYPES[tileTypeId];
  return !!type && ((type.w === 1 && type.d >= 3) || (type.d === 1 && type.w >= 3));
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
 * mismatch, but this keeps the function total). `"door"` (double-leaf)
 * outranks `"singleDoor"` in turn — a boundary authored as a grand double
 * door on one side and a mere opening on the other should still read as a
 * full double door, not get quietly downgraded — though in practice a
 * boundary's two sides are always authored to agree on which kind of door
 * it is. */
function combineKind(mine: FaceKind, theirs: FaceKind): FaceKind {
  if (mine === "wall" || theirs === "wall") return "wall";
  if (mine === "door" || theirs === "door") return "door";
  if (mine === "singleDoor" || theirs === "singleDoor") return "singleDoor";
  return "opening";
}

function cornerKey(cellX: number, cellZ: number, floor: number): string {
  return `${cellX},${cellZ},${floor}`;
}

/**
 * Turns collected wall segments into actual wall boxes. Where a segment's
 * end meets a perpendicular wall segment, only X-plane walls extend through
 * the corner. The Z-plane wall's end cap terminates inside that continuous
 * run. Extending *both* directions made coincident outer faces across the
 * overlap, which shimmered even though the geometry was watertight.
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

export function mergeCollinearWallSegments(segments: Segment[]): Array<{ seg: Segment; start: number; end: number }> {
  const grouped = new Map<string, Segment[]>();
  for (const seg of segments) {
    const key = `${seg.orientation}:${seg.planeCell}:${seg.floor}:${seg.wallHeight}`;
    const list = grouped.get(key);
    if (list) list.push(seg); else grouped.set(key, [seg]);
  }
  const runs: Array<{ seg: Segment; start: number; end: number }> = [];
  for (const list of grouped.values()) {
    list.sort((a, b) => a.rangeStartCell - b.rangeStartCell);
    let previous: { seg: Segment; start: number; end: number } | undefined;
    for (const seg of list) {
      if (previous?.end === seg.rangeStartCell) {
        previous.end++;
      } else {
        previous = { seg, start: seg.rangeStartCell, end: seg.rangeStartCell + 1 };
        runs.push(previous);
      }
    }
  }
  return runs;
}

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

function emitWalls(physics: Physics, scene: THREE.Scene, segments: Segment[], dressing: StoneDressing): void {
  const zWallCorners = new Set<string>(); // corners touched by a z-oriented (plane-at-constant-Z) wall
  const xWallCorners = new Map<string, number>();
  const zWallHeights = new Map<string, number>();

  for (const seg of segments) {
    if (seg.orientation === "z") {
      zWallCorners.add(cornerKey(seg.rangeStartCell, seg.planeCell, seg.floor));
      zWallCorners.add(cornerKey(seg.rangeStartCell + 1, seg.planeCell, seg.floor));
      for (const x of [seg.rangeStartCell, seg.rangeStartCell + 1]) {
        const key = cornerKey(x, seg.planeCell, seg.floor);
        zWallHeights.set(key, Math.max(zWallHeights.get(key) ?? 0, seg.wallHeight));
      }
    } else {
      for (const z of [seg.rangeStartCell, seg.rangeStartCell + 1]) {
        const key = cornerKey(seg.planeCell, z, seg.floor);
        xWallCorners.set(key, Math.max(xWallCorners.get(key) ?? 0, seg.wallHeight));
      }
    }
  }

  for (const [key, xHeight] of xWallCorners) {
    const zHeight = zWallHeights.get(key);
    if (!zHeight) continue;
    const [x, z, floor] = key.split(",").map(Number);
    dressing.corner(x * UNIT, z * UNIT, Math.min(xHeight, zHeight), floorBaseline(floor));
  }

  const torchSegments = pickTorchSegments(segments);

  // Collapse adjacent collinear unit segments into one continuous box.
  // Besides reducing draw calls/colliders, this removes the coincident end
  // caps that used to shimmer as z-fighting seams down otherwise-flat walls.
  const runs = mergeCollinearWallSegments(segments);

  for (const { seg, start, end } of runs) {
    let rangeStart = start * UNIT;
    let rangeEnd = end * UNIT;
    const planeCoord = seg.planeCell * UNIT;
    const floorBase = floorBaseline(seg.floor);

    if (seg.orientation === "x") {
      if (zWallCorners.has(cornerKey(seg.planeCell, start, seg.floor))) rangeStart -= WALL_THICKNESS;
      if (zWallCorners.has(cornerKey(seg.planeCell, end, seg.floor))) rangeEnd += WALL_THICKNESS;
      const cz = (rangeStart + rangeEnd) / 2;
      const hz = (rangeEnd - rangeStart) / 2;
      addWall(physics, scene, planeCoord, cz, WALL_THICKNESS, hz, seg.wallHeight, floorBase);
      dressing.wallTrim("x", planeCoord, rangeStart, rangeEnd, seg.wallHeight, floorBase);
    } else {
      const cx = (rangeStart + rangeEnd) / 2;
      const hx = (rangeEnd - rangeStart) / 2;
      addWall(physics, scene, cx, planeCoord, hx, WALL_THICKNESS, seg.wallHeight, floorBase);
      dressing.wallTrim("z", planeCoord, rangeStart, rangeEnd, seg.wallHeight, floorBase);
    }
  }

  // Torch ownership remains tied to the original authored room segments,
  // even though their underlying stone is now emitted as longer runs.
  for (const seg of torchSegments) {
    const along = (seg.rangeStartCell + .5) * UNIT;
    const floorBase = floorBaseline(seg.floor);
    if (seg.orientation === "x") addTorch(scene, seg.planeCell * UNIT + seg.interiorSign * WALL_THICKNESS, along, seg.wallHeight, "x", seg.interiorSign, floorBase);
    else addTorch(scene, along, seg.planeCell * UNIT + seg.interiorSign * WALL_THICKNESS, seg.wallHeight, "z", seg.interiorSign, floorBase);
  }

  // One feature every few corridor cells, alternating a torch and a cloth
  // hanging. Select a solid wall first so no dressing lands across a door.
  const corridorWalls = new Map<string, Segment[]>();
  for (const seg of segments) {
    if (!seg.corridor) continue;
    const list = corridorWalls.get(seg.instanceId) ?? [];
    list.push(seg);
    corridorWalls.set(seg.instanceId, list);
  }
  for (const list of corridorWalls.values()) {
    list.sort((a, b) => a.rangeStartCell - b.rangeStartCell || a.planeCell - b.planeCell);
    const used = new Set<string>();
    let decoration = 0;
    for (const seg of list) {
      if (seg.wallHeight < 2.6) continue;
      const cellX = seg.orientation === "x" ? seg.planeCell - (seg.interiorSign < 0 ? 1 : 0) : seg.rangeStartCell;
      const cellZ = seg.orientation === "z" ? seg.planeCell - (seg.interiorSign < 0 ? 1 : 0) : seg.rangeStartCell;
      const key = `${cellX}:${cellZ}`;
      if (used.has(key) || seg.rangeStartCell % 2 !== 0) continue;
      used.add(key);
      const along = (seg.rangeStartCell + .5) * UNIT;
      const plane = seg.planeCell * UNIT + seg.interiorSign * WALL_THICKNESS;
      const base = floorBaseline(seg.floor);
      if (decoration++ % 2 === 0) addTorch(scene, seg.orientation === "x" ? plane : along, seg.orientation === "z" ? plane : along, seg.wallHeight, seg.orientation, seg.interiorSign, base, false);
      else addHallwayHanging(scene, seg.orientation === "x" ? plane : along, seg.orientation === "z" ? plane : along, seg.orientation, seg.interiorSign, base);
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
export function buildGeometryFromOccupancy(world: World, physics: Physics, scene: THREE.Scene, index: OccupancyIndex, lockedDoors: LockedDoorSpec[] = []): void {
  const dressing = new StoneDressing();
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

      if (effective === "opening") {
        // A plain opening (no door leaf, so none of `addDoorPair`'s own
        // header-capping logic below ever runs for it) still needs sealing
        // above the shorter side's own wall height when the two tiles it
        // joins have different `h` -- otherwise the taller side's ceiling
        // simply never gets closed off on this boundary at all, leaving a
        // real hole straight through to empty world space (the scene's flat
        // background color) rather than a wall or a ceiling.
        //
        // Every "opening" this level had before the cellar wing happened to
        // join same-height tiles (a hallway/nook/landing next to another of
        // the same or a matching `h: 1`), so this gap never showed up in
        // practice. `room-b` (`great_hall_branch`, `h: 2`) opening directly
        // into `stair_upper` (`h: 1`) is the first mismatch — found by
        // actually looking through that opening from inside room-b and
        // seeing straight through to the background rather than a sealed
        // ceiling transition.
        if (neighbor && neighbor.heightCells !== cell.heightCells) {
          const neighborWallHeight = neighbor.heightCells * UNIT;
          const loHeight = Math.min(wallHeight, neighborWallHeight);
          const hiHeight = Math.max(wallHeight, neighborWallHeight);
          if (dir.dx !== 0) {
            const planeCell = dir.dx > 0 ? x + 1 : x;
            addWall(physics, scene, planeCell * UNIT, (z + 0.5) * UNIT, WALL_THICKNESS, UNIT / 2, hiHeight - loHeight, floorBase + loHeight);
          } else {
            const planeCell = dir.dz > 0 ? z + 1 : z;
            addWall(physics, scene, (x + 0.5) * UNIT, planeCell * UNIT, UNIT / 2, WALL_THICKNESS, hiHeight - loHeight, floorBase + loHeight);
          }
        }
        continue; // still no geometry across the opening's own walkable height
      }

      // A shared boundary must reach the taller of the two rooms it joins
      // (e.g. a great_hall door opening onto a lower-ceilinged hallway, or a
      // solid wall between a 9m great hall and the 3m corridor beside it) —
      // otherwise the boundary is emitted from whichever side "owns" it (see
      // `owner` above), and sizing it to only the *owning* side's own
      // `wallHeight` would leave the taller room's own wall/header gap open
      // above it whenever the *shorter* side happens to be the owner. Used
      // for both a door's header (via `addDoorPair` below) and a plain solid
      // "wall" segment (via `wallSegments` below) — a solid wall is no
      // different from a door's header here: either way, the boundary has to
      // reach whichever ceiling is higher, regardless of which side's cell
      // happened to own the boundary in the occupancy walk.
      const sharedBoundaryHeight = neighbor ? Math.max(wallHeight, neighbor.heightCells * UNIT) : wallHeight;

      const requiredItemTypeId = lockedDoorLookup.get(lockedDoorKey(x, z, dir.side));

      if (dir.dx !== 0) {
        // +x or -x boundary: a plane of constant X, spanning this cell's Z extent.
        const planeCell = dir.dx > 0 ? x + 1 : x;
        if (effective === "wall") {
          wallSegments.push({
            orientation: "x",
            planeCell,
            rangeStartCell: z,
            wallHeight: sharedBoundaryHeight,
            instanceId: cell.instanceId,
            roomSized: isRoomSizedTileType(cell.tileTypeId),
            corridor: isCorridorTileType(cell.tileTypeId),
            interiorSign: (dir.dx > 0 ? -1 : 1) as 1 | -1,
            floor: cell.floor,
          });
        } else if (effective === "singleDoor") {
          addSingleDoor(world, physics, scene, "x", planeCell * UNIT, z * UNIT, (z + 1) * UNIT, sharedBoundaryHeight, floorBase, requiredItemTypeId, dressing);
        } else {
          addDoorPair(world, physics, scene, "x", planeCell * UNIT, z * UNIT, (z + 1) * UNIT, sharedBoundaryHeight, floorBase, requiredItemTypeId, dressing);
        }
      } else {
        // +z or -z boundary: a plane of constant Z, spanning this cell's X extent.
        const planeCell = dir.dz > 0 ? z + 1 : z;
        if (effective === "wall") {
          wallSegments.push({
            orientation: "z",
            planeCell,
            rangeStartCell: x,
            wallHeight: sharedBoundaryHeight,
            instanceId: cell.instanceId,
            roomSized: isRoomSizedTileType(cell.tileTypeId),
            corridor: isCorridorTileType(cell.tileTypeId),
            interiorSign: (dir.dz > 0 ? -1 : 1) as 1 | -1,
            floor: cell.floor,
          });
        } else if (effective === "singleDoor") {
          addSingleDoor(world, physics, scene, "z", planeCell * UNIT, x * UNIT, (x + 1) * UNIT, sharedBoundaryHeight, floorBase, requiredItemTypeId, dressing);
        } else {
          addDoorPair(world, physics, scene, "z", planeCell * UNIT, x * UNIT, (x + 1) * UNIT, sharedBoundaryHeight, floorBase, requiredItemTypeId, dressing);
        }
      }
    }
  }

  emitWalls(physics, scene, wallSegments, dressing);
  dressing.flush(scene);
}
