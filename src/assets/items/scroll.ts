import * as THREE from "three";
import type { ItemAssetDef } from "../types";

// A rolled scroll (narration devices, follow-up) — unlike a poster, a
// scroll is naturally something you'd carry off and read later rather
// than only in place, so this is a real pickupable `Item` (`slot: null`,
// a curio like gem.ts — never equipped) rather than a fixture. Its actual
// notice text lives on the `ItemSpawn` that places it (`title`/`pages` —
// see `placementTypes.ts`), which is what makes `spawnItems` also attach
// a `Readable` component; picking it up and tapping it in the inventory
// list opens the paged reader (`InventoryList.tsx`, `notice/store.ts`),
// same reading UI a poster's in-place interact opens.

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
  // (mesh origin sits on that surface, same convention as every other
  // world item — it drops and settles like the sword/gem/lantern do).
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

const scroll: ItemAssetDef = {
  id: "scroll",
  name: "Scroll",
  icon: "📜",
  slot: null,
  mass: 0.15,
  createWorldMesh: () => createScrollMesh(),
};

export default scroll;
