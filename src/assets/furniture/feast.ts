import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// A tabletop spread of feast food (great-hall wing task) — a roast on a
// platter, a couple of round loaves, and a jug, for the great hall's long
// tables. Meant to be placed with `PropPlacement.y` set to table.ts's own
// `TABLE_HEIGHT` (0.75) so it sits on a tabletop rather than the floor — its
// own local origin is the surface it rests on, the same "y=0 is the surface
// it sits on" convention every other floor-level prop uses, just relative to
// a table instead of the floor. Purely decorative: no footprint (nothing
// should collide with a garnish sitting on top of a table that already has
// its own collider), and not `dynamic` for the same reason banner.ts/
// candelabra.ts aren't -- it would just slide off a jostled table with
// nothing underneath it to land on.

const PLATTER_RADIUS = 0.22;
const PLATTER_HEIGHT = 0.02;
const ROAST_RADIUS = 0.11;
const LOAF_RADIUS = 0.07;
const JUG_RADIUS = 0.05;
const JUG_HEIGHT = 0.16;

let platterMat: THREE.MeshStandardMaterial | undefined;
function platterMaterial(): THREE.MeshStandardMaterial {
  return (platterMat ??= new THREE.MeshStandardMaterial({ color: 0x8a8880, roughness: 0.6, metalness: 0.4 }));
}

let roastMat: THREE.MeshStandardMaterial | undefined;
function roastMaterial(): THREE.MeshStandardMaterial {
  return (roastMat ??= new THREE.MeshStandardMaterial({ color: 0x7a3a1e, roughness: 0.75, metalness: 0 }));
}

let loafMat: THREE.MeshStandardMaterial | undefined;
function loafMaterial(): THREE.MeshStandardMaterial {
  return (loafMat ??= new THREE.MeshStandardMaterial({ color: 0xc99a52, roughness: 0.85, metalness: 0 }));
}

let jugMat: THREE.MeshStandardMaterial | undefined;
function jugMaterial(): THREE.MeshStandardMaterial {
  return (jugMat ??= new THREE.MeshStandardMaterial({ color: 0x4a5a6b, roughness: 0.5, metalness: 0.15 }));
}

/** A metal platter holding a roast, two loaves beside it, and a jug off to
 * one side -- enough visual variety to read as "a feast" at a glance. */
function createFeastMesh(): THREE.Group {
  const group = new THREE.Group();

  const platter = new THREE.Mesh(new THREE.CylinderGeometry(PLATTER_RADIUS, PLATTER_RADIUS, PLATTER_HEIGHT, 16), platterMaterial());
  platter.position.y = PLATTER_HEIGHT / 2;
  group.add(platter);

  const roast = new THREE.Mesh(new THREE.SphereGeometry(ROAST_RADIUS, 12, 8), roastMaterial());
  roast.scale.set(1.3, 0.75, 0.9);
  roast.position.set(-0.03, PLATTER_HEIGHT + ROAST_RADIUS * 0.75, 0);
  group.add(roast);

  const loafGeo = new THREE.SphereGeometry(LOAF_RADIUS, 10, 7);
  for (const [lx, lz] of [[0.16, 0.1], [0.19, -0.08]] as const) {
    const loaf = new THREE.Mesh(loafGeo, loafMaterial());
    loaf.scale.set(1, 0.7, 1);
    loaf.position.set(lx, LOAF_RADIUS * 0.7, lz);
    group.add(loaf);
  }

  const jug = new THREE.Mesh(new THREE.CylinderGeometry(JUG_RADIUS * 0.7, JUG_RADIUS, JUG_HEIGHT, 10), jugMaterial());
  jug.position.set(-0.28, JUG_HEIGHT / 2, -0.05);
  group.add(jug);

  return group;
}

const feast: FurnitureAssetDef = {
  id: "feast",
  createMesh: () => createFeastMesh(),
  // No footprint — see header comment.
};

export default feast;
