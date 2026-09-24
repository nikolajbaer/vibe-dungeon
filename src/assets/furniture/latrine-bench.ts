import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";
import { woodMaterial } from "./table";

// A simple two-seat privy bench (dormitory-expansion task) — the furnishing
// for the dormitory wing's two capping latrines. A plain wooden bench on
// four legs, its top pierced by two dark circular holes, the standard
// low-poly-primitives read this codebase's furniture already uses for
// "obviously what it is without needing a texture" (see chest.ts/table.ts).
// Static (no `dynamic`/`container` — nothing to loot or shove here, just a
// fixture), faces local +z like every other furniture asset here.

const BENCH_WIDTH = 1.5;
const BENCH_DEPTH = 0.55;
const BENCH_TOP_HEIGHT = 0.5;
const BENCH_TOP_THICKNESS = 0.06;
const LEG_THICKNESS = 0.07;
const HOLE_RADIUS = 0.16;
const HOLE_INSET_X = BENCH_WIDTH / 4; // two holes, spaced a quarter of the width in from center each

let holeMat: THREE.MeshStandardMaterial | undefined;
function holeMaterial(): THREE.MeshStandardMaterial {
  return (holeMat ??= new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.95 }));
}

/** A wood bench top and four legs, with two dark cylindrical "holes" set
 * flush into the top surface. */
function createLatrineBenchMesh(): THREE.Group {
  const group = new THREE.Group();
  group.userData.surfaceMaterial = "wood";
  const wood = woodMaterial();

  const top = new THREE.Mesh(new THREE.BoxGeometry(BENCH_WIDTH, BENCH_TOP_THICKNESS, BENCH_DEPTH), wood);
  top.position.y = BENCH_TOP_HEIGHT - BENCH_TOP_THICKNESS / 2;
  group.add(top);

  const legHeight = BENCH_TOP_HEIGHT - BENCH_TOP_THICKNESS;
  const legGeo = new THREE.BoxGeometry(LEG_THICKNESS, legHeight, LEG_THICKNESS);
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(sx * (BENCH_WIDTH / 2 - LEG_THICKNESS), legHeight / 2, sz * (BENCH_DEPTH / 2 - LEG_THICKNESS));
      group.add(leg);
    }
  }

  const holeGeo = new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, BENCH_TOP_THICKNESS * 0.6, 14);
  for (const sx of [-1, 1] as const) {
    const hole = new THREE.Mesh(holeGeo, holeMaterial());
    hole.position.set(sx * HOLE_INSET_X, BENCH_TOP_HEIGHT - BENCH_TOP_THICKNESS * 0.3, 0);
    group.add(hole);
  }

  return group;
}

const latrineBench: FurnitureAssetDef = {
  id: "latrine-bench",
  createMesh: () => createLatrineBenchMesh(),
  footprint: { hx: BENCH_WIDTH / 2, hz: BENCH_DEPTH / 2 },
};

export default latrineBench;
