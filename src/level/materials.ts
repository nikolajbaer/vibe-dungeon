import * as THREE from "three";

// Flat/colored placeholder materials for level geometry — same look as the
// original hand-placed level, just moved behind small named functions.
//
// This is a deliberate seam for a separate, later task that's adding real
// stone textures: swapping these bodies for `THREE.TextureLoader` output
// (or a shared `MeshStandardMaterial` with `map`/`normalMap` set) is then a
// small, isolated change to this one file. Do not add textures here.

let wall: THREE.Material | undefined;
let floor: THREE.Material | undefined;
let ceiling: THREE.Material | undefined;
let door: THREE.Material | undefined;

export function wallMaterial(): THREE.Material {
  return (wall ??= new THREE.MeshStandardMaterial({ color: 0x888d96 }));
}

export function floorMaterial(): THREE.Material {
  return (floor ??= new THREE.MeshStandardMaterial({ color: 0x5a4a3a }));
}

export function ceilingMaterial(): THREE.Material {
  return (ceiling ??= new THREE.MeshStandardMaterial({ color: 0x24262c }));
}

export function doorMaterial(): THREE.Material {
  return (door ??= new THREE.MeshStandardMaterial({ color: 0xa5622f }));
}
