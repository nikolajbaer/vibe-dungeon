import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Freestanding stone column (great-hall wing task) — a floor-to-ceiling
// support pillar for flanking a hall's central aisle, the way `fireplace.ts`
// flanks a wall. Unlike every other furniture asset, a column's height is
// genuinely room-dependent (it has to actually reach the ceiling to read as
// structural rather than a stray prop), so `ColumnParams.height` is required
// rather than a fixed constant — pass the placing room's own ceiling height
// (`UNIT * TileType.h`, level/tiles.ts) minus a hair of clearance.
//
// No rotation convention to worry about (unlike a wall-mounted asset built
// facing local +z): a column looks the same from every side, so a
// placement's `rotation` never matters for this one.

const SHAFT_RADIUS = 0.32;
const BASE_HEIGHT = 0.22;
const BASE_RADIUS = SHAFT_RADIUS + 0.1;
const CAPITAL_HEIGHT = 0.22;
const CAPITAL_RADIUS = SHAFT_RADIUS + 0.14;

export interface ColumnParams {
  /** Total floor-to-ceiling height, meters — see header comment. */
  height: number;
}

let stoneMat: THREE.MeshStandardMaterial | undefined;
function stoneMaterial(): THREE.MeshStandardMaterial {
  return (stoneMat ??= new THREE.MeshStandardMaterial({ color: 0x8a8880, roughness: 0.88, metalness: 0.04 }));
}

/** A round shaft between a slightly wider octagonal base and capital —
 * enough silhouette variation to read as a real architectural column rather
 * than a plain cylinder, without modeling actual fluting. */
function createColumnMesh(params?: ColumnParams): THREE.Group {
  const height = params?.height ?? 6;
  const shaftHeight = Math.max(0.2, height - BASE_HEIGHT - CAPITAL_HEIGHT);
  const mat = stoneMaterial();
  const group = new THREE.Group();

  const base = new THREE.Mesh(new THREE.CylinderGeometry(BASE_RADIUS, BASE_RADIUS, BASE_HEIGHT, 8), mat);
  base.position.y = BASE_HEIGHT / 2;
  group.add(base);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, shaftHeight, 16), mat);
  shaft.position.y = BASE_HEIGHT + shaftHeight / 2;
  group.add(shaft);

  const capital = new THREE.Mesh(new THREE.CylinderGeometry(CAPITAL_RADIUS, CAPITAL_RADIUS, CAPITAL_HEIGHT, 8), mat);
  capital.position.y = BASE_HEIGHT + shaftHeight + CAPITAL_HEIGHT / 2;
  group.add(capital);

  return group;
}

const column: FurnitureAssetDef<ColumnParams> = {
  id: "column",
  createMesh: (params) => createColumnMesh(params),
  footprint: (params) => ({ hx: BASE_RADIUS, hz: BASE_RADIUS, hy: (params?.height ?? 6) / 2 }),
};

export default column;
