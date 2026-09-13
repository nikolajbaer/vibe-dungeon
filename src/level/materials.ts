import * as THREE from "three";
import {
  wallMaterial as stoneWallMaterial,
  floorMaterial as stoneFloorMaterial,
  ceilingMaterial as stoneCeilingMaterial,
  woodMaterial as woodDoorMaterial,
} from "../materials/dungeonMaterials";

// Level materials — walls/floors/ceilings now use the procedural stone
// materials from src/materials/dungeonMaterials.ts (issue #11), wired in as
// described in README's Design Notes ("Procedural stone textures").
//
// This initial pass uses each material's default `repeat` rather than
// threading real per-face size in meters through from tileBuilder.ts — see
// issue #27. A fast-follow can pass a `repeat` scaled to each face's actual
// size once tileBuilder's wall-segment geometry settles.
//
// `doorMaterial()` now uses the procedural wood-grain material (issue #42).

let wall: THREE.Material | undefined;
let floor: THREE.Material | undefined;
let ceiling: THREE.Material | undefined;
let door: THREE.Material | undefined;

export function wallMaterial(): THREE.Material {
  return (wall ??= stoneWallMaterial());
}

export function floorMaterial(): THREE.Material {
  // repeat 1.5 (50% more repetition than the default) — smaller-looking
  // flagstones per the coordinator's request.
  return (floor ??= stoneFloorMaterial(1.5));
}

export function ceilingMaterial(): THREE.Material {
  return (ceiling ??= stoneCeilingMaterial());
}

export function doorMaterial(): THREE.Material {
  return (door ??= woodDoorMaterial());
}
