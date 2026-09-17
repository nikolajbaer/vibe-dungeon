import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// A rolled scroll resting on a surface (a table, a pedestal, the floor) —
// a paper cylinder with lighter end-caps and a tie ribbon, for a "read
// this" prop distinct from poster.ts's wall-mounted look. See that
// module's header comment for why the actual notice text isn't here.
// Purely decorative, no footprint — small enough that nothing could
// meaningfully collide with it.

const SCROLL_LENGTH = 0.28;
const SCROLL_RADIUS = 0.045;
const SCROLL_CAP_RADIUS = 0.05;
const SCROLL_CAP_THICKNESS = 0.012;
const SCROLL_TIE_RADIUS = 0.015;

let paperMat: THREE.MeshStandardMaterial | undefined;
function paperMaterial(): THREE.MeshStandardMaterial {
  return (paperMat ??= new THREE.MeshStandardMaterial({ color: 0xe8d9ad, roughness: 0.85, metalness: 0 }));
}

let capMat: THREE.MeshStandardMaterial | undefined;
function capMaterial(): THREE.MeshStandardMaterial {
  return (capMat ??= new THREE.MeshStandardMaterial({ color: 0xf3ead0, roughness: 0.8, metalness: 0 }));
}

let tieMat: THREE.MeshStandardMaterial | undefined;
function tieMaterial(): THREE.MeshStandardMaterial {
  return (tieMat ??= new THREE.MeshStandardMaterial({ color: 0x7a1f1f, roughness: 0.7, metalness: 0 }));
}

function createScrollMesh(): THREE.Group {
  const group = new THREE.Group();

  // Lying on its side, spanning local X, resting on the floor/surface below
  // (mesh origin sits on that surface — see Footprint's doc comment).
  const body = new THREE.Mesh(new THREE.CylinderGeometry(SCROLL_RADIUS, SCROLL_RADIUS, SCROLL_LENGTH, 12), paperMaterial());
  body.rotation.z = Math.PI / 2;
  body.position.y = SCROLL_RADIUS;
  group.add(body);

  for (const sign of [-1, 1] as const) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(SCROLL_CAP_RADIUS, SCROLL_CAP_RADIUS, SCROLL_CAP_THICKNESS, 12), capMaterial());
    cap.rotation.z = Math.PI / 2;
    cap.position.set(sign * SCROLL_LENGTH * 0.42, SCROLL_RADIUS, 0);
    group.add(cap);
  }

  const tie = new THREE.Mesh(new THREE.TorusGeometry(SCROLL_RADIUS + 0.006, SCROLL_TIE_RADIUS, 6, 12), tieMaterial());
  tie.rotation.y = Math.PI / 2;
  tie.position.y = SCROLL_RADIUS;
  group.add(tie);

  return group;
}

const scroll: FurnitureAssetDef = {
  id: "scroll",
  createMesh: () => createScrollMesh(),
  // No footprint — see header comment.
};

export default scroll;
