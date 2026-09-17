import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Wall poster / notice board (narration devices) — a wooden frame around a
// parchment panel, for a "pinned announcement" look distinct from
// banner.ts's cloth-and-rod heraldry. Purely decorative like a banner:
// thin, flush to a wall, no footprint. Builds facing local +z; a
// placement's `rotation` points it at whichever wall it's mounted on.
//
// The actual notice text lives on the `ReadablePlacement` that co-locates
// with this asset (see level/placementTypes.ts), not here — this module
// only builds what a poster *looks like*, the same "type vs. per-instance
// data" split every other asset/placement pair in this repo uses.

const POSTER_WIDTH = 0.7;
const POSTER_HEIGHT = 0.9;
const POSTER_THICKNESS = 0.02;
const POSTER_FRAME_THICKNESS = 0.05;
const POSTER_BOTTOM_Y = 1.3; // bottom edge height above the floor

let frameMat: THREE.MeshStandardMaterial | undefined;
function frameMaterial(): THREE.MeshStandardMaterial {
  return (frameMat ??= new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.8, metalness: 0.05 }));
}

let parchmentMat: THREE.MeshStandardMaterial | undefined;
function parchmentMaterial(): THREE.MeshStandardMaterial {
  return (parchmentMat ??= new THREE.MeshStandardMaterial({ color: 0xe8d9ad, roughness: 0.95, metalness: 0 }));
}

function createPosterMesh(): THREE.Group {
  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(POSTER_WIDTH + POSTER_FRAME_THICKNESS * 2, POSTER_HEIGHT + POSTER_FRAME_THICKNESS * 2, POSTER_THICKNESS),
    frameMaterial(),
  );
  frame.position.y = POSTER_BOTTOM_Y + POSTER_HEIGHT / 2;
  group.add(frame);

  // Slightly proud of the frame's face so it doesn't z-fight with it.
  const parchment = new THREE.Mesh(new THREE.BoxGeometry(POSTER_WIDTH, POSTER_HEIGHT, POSTER_THICKNESS + 0.01), parchmentMaterial());
  parchment.position.set(0, POSTER_BOTTOM_Y + POSTER_HEIGHT / 2, 0.006);
  group.add(parchment);

  return group;
}

const poster: FurnitureAssetDef = {
  id: "poster",
  createMesh: () => createPosterMesh(),
  // No footprint — see header comment.
};

export default poster;
