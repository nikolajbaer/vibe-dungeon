import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Placeholder furniture prop (issue #40) — simple primitive-composed
// THREE.Group, flat wood-brown MeshStandardMaterial (no textures/images
// yet). Kept proportioned to real-world scale (meters) since the player is
// a real-scale first-person character in a 3m-unit world.
//
// The group's origin sits at floor level (y = 0) with every child mesh
// offset upward from there, so the generic placer (level/spawning.ts) can
// position the group directly at a floor (x, 0, z) point — the same
// convention tileBuilder.ts uses for wall/door meshes.

let woodMat: THREE.MeshStandardMaterial | undefined;

/** Shared flat wood-brown material, reused by every furniture asset that
 * wants a plain wood look (table, chair, barrel). */
export function woodMaterial(): THREE.MeshStandardMaterial {
  return (woodMat ??= new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85, metalness: 0 }));
}

const TABLE_HEIGHT = 0.75; // top surface height — "waist-height" per the issue
const TABLE_TOP_THICKNESS = 0.06;
const TABLE_WIDTH = 1.2;
const TABLE_DEPTH = 0.8;
const TABLE_LEG_SIZE = 0.07;
const TABLE_LEG_INSET = 0.09; // legs pulled in this far from each edge

/** A flat box top on four thin box legs, roughly waist-height (0.75m). */
function createTableMesh(): THREE.Group {
  const group = new THREE.Group();
  const mat = woodMaterial();

  const legHeight = TABLE_HEIGHT - TABLE_TOP_THICKNESS;
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE_WIDTH, TABLE_TOP_THICKNESS, TABLE_DEPTH), mat);
  top.position.y = legHeight + TABLE_TOP_THICKNESS / 2;
  group.add(top);

  const legX = TABLE_WIDTH / 2 - TABLE_LEG_INSET;
  const legZ = TABLE_DEPTH / 2 - TABLE_LEG_INSET;
  const legGeo = new THREE.BoxGeometry(TABLE_LEG_SIZE, legHeight, TABLE_LEG_SIZE);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(sx * legX, legHeight / 2, sz * legZ);
      group.add(leg);
    }
  }

  return group;
}

const table: FurnitureAssetDef = {
  id: "table",
  createMesh: () => createTableMesh(),
  footprint: { hx: TABLE_WIDTH / 2, hz: TABLE_DEPTH / 2 },
};

export default table;
