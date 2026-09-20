import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";
import { woodMaterial } from "./table";

// Simple bed frame for the upstairs dormitory (issue: dormitory furnishing)
// — a low wood frame, a raised mattress block, and a folded blanket/pillow
// accent, same "stack of primitives" approach as table.ts/chair.ts. Purely
// decorative like the table (a static obstacle, not a container or
// interactable) — nothing about sleeping/resting exists as a mechanic yet,
// so this is furniture to walk around, not to use.
//
// Builds facing local +z (the headboard sits on -z, foot of the bed on +z),
// matching every other furniture asset's "caller rotates" convention.

const BED_LENGTH = 2.0;
const BED_WIDTH = 1.0;
const FRAME_HEIGHT = 0.32;
const FRAME_THICKNESS = 0.08;
const MATTRESS_HEIGHT = 0.22;
const HEADBOARD_HEIGHT = 0.55;
const HEADBOARD_THICKNESS = 0.06;
const PILLOW_WIDTH = 0.55;
const PILLOW_DEPTH = 0.35;
const PILLOW_HEIGHT = 0.12;
const BLANKET_LENGTH = 0.9; // covers the foot end of the mattress

let mattressMat: THREE.MeshStandardMaterial | undefined;
function mattressMaterial(): THREE.MeshStandardMaterial {
  return (mattressMat ??= new THREE.MeshStandardMaterial({ color: 0xdededd, roughness: 0.95, metalness: 0 }));
}

let pillowMat: THREE.MeshStandardMaterial | undefined;
function pillowMaterial(): THREE.MeshStandardMaterial {
  return (pillowMat ??= new THREE.MeshStandardMaterial({ color: 0xf2ede0, roughness: 0.9, metalness: 0 }));
}

let blanketMat: THREE.MeshStandardMaterial | undefined;
function blanketMaterial(): THREE.MeshStandardMaterial {
  return (blanketMat ??= new THREE.MeshStandardMaterial({ color: 0x5a3a3a, roughness: 0.9, metalness: 0 }));
}

/** A low wood frame, mattress, pillow (headboard end, -z), and a folded
 * blanket accent (foot end, +z). */
function createBedMesh(): THREE.Group {
  const group = new THREE.Group();
  group.userData.surfaceMaterial = "wood";
  const wood = woodMaterial();

  const frame = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH, FRAME_THICKNESS, BED_LENGTH), wood);
  frame.position.y = FRAME_HEIGHT - FRAME_THICKNESS / 2;
  group.add(frame);

  const legHeight = FRAME_HEIGHT - FRAME_THICKNESS;
  const legGeo = new THREE.BoxGeometry(0.07, legHeight, 0.07);
  const legX = BED_WIDTH / 2 - 0.05;
  const legZ = BED_LENGTH / 2 - 0.05;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(sx * legX, legHeight / 2, sz * legZ);
      group.add(leg);
    }
  }

  const headboard = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH, HEADBOARD_HEIGHT, HEADBOARD_THICKNESS), wood);
  headboard.position.set(0, HEADBOARD_HEIGHT / 2, -BED_LENGTH / 2 - HEADBOARD_THICKNESS / 2);
  group.add(headboard);

  const mattress = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH - 0.06, MATTRESS_HEIGHT, BED_LENGTH - 0.06), mattressMaterial());
  mattress.position.y = FRAME_HEIGHT + MATTRESS_HEIGHT / 2;
  group.add(mattress);

  const pillow = new THREE.Mesh(new THREE.BoxGeometry(PILLOW_WIDTH, PILLOW_HEIGHT, PILLOW_DEPTH), pillowMaterial());
  pillow.position.set(0, FRAME_HEIGHT + MATTRESS_HEIGHT + PILLOW_HEIGHT / 2, -BED_LENGTH / 2 + PILLOW_DEPTH / 2 + 0.08);
  group.add(pillow);

  const blanket = new THREE.Mesh(new THREE.BoxGeometry(BED_WIDTH - 0.1, PILLOW_HEIGHT * 0.8, BLANKET_LENGTH), blanketMaterial());
  blanket.position.set(0, FRAME_HEIGHT + MATTRESS_HEIGHT + (PILLOW_HEIGHT * 0.8) / 2, BED_LENGTH / 2 - BLANKET_LENGTH / 2 - 0.05);
  group.add(blanket);

  return group;
}

const bed: FurnitureAssetDef = {
  id: "bed",
  createMesh: () => createBedMesh(),
  footprint: { hx: BED_WIDTH / 2, hz: BED_LENGTH / 2 },
  // Heavy, immovable-feeling furniture -- a bed shouldn't shove aside like a
  // chair. Static (no `dynamic`), same as table.ts's original design intent
  // would be if it weren't shovable; here there's no reason a bed ever needs
  // to move at all.
};

export default bed;
