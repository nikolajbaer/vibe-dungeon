import * as THREE from "three";
import { createStoneTexture, createWoodTexture } from "./textures";

// ---------------------------------------------------------------------------
// Drop-in stone MeshStandardMaterials for walls/floors/ceilings (issue #11).
// Not wired into the level yet — see README "Design Notes" for the intended
// one-line-per-material hookup into src/level/materials.ts.
//
// Each source texture is authored to represent one 3m project grid unit,
// with individual stone blocks sized ~0.3-0.6m within that unit (gridCount
// below controls how many blocks span the texture). `repeat` is then an
// extra multiplier for surfaces bigger than one grid unit — e.g. an 8m-long
// wall built from a single stretched face should pass repeat ~= 8/3 so
// blocks keep reading at a consistent real-world size instead of being
// stretched. Default repeat of 1 assumes a roughly-one-grid-unit face.
// ---------------------------------------------------------------------------

export type Repeat = number | [number, number];

function applyRepeat(tex: THREE.Texture, repeat: Repeat): void {
  const [rx, ry] = Array.isArray(repeat) ? repeat : [repeat, repeat];
  tex.repeat.set(rx, ry);
}

// Canvas generation is a bit of per-pixel work (a few hundred µs at 256px),
// so the base textures are generated once and cloned (cheap — shares the
// underlying canvas image) per material instance, letting each caller set
// its own repeat independently.

let wallTextureBase: THREE.CanvasTexture | null = null;
function wallTexture(): THREE.CanvasTexture {
  if (!wallTextureBase) {
    wallTextureBase = createStoneTexture({
      pattern: "coursed",
      baseColor: [140, 134, 124],
      mortarColor: [56, 52, 48],
      gridCount: 6,
      noiseStrength: 0.22,
      mortarStrength: 0.9,
      seed: 11,
    });
  }
  return wallTextureBase;
}

let floorTextureBase: THREE.CanvasTexture | null = null;
function floorTexture(): THREE.CanvasTexture {
  if (!floorTextureBase) {
    floorTextureBase = createStoneTexture({
      pattern: "flagstone",
      baseColor: [96, 87, 76],
      mortarColor: [38, 34, 30],
      gridCount: 5,
      noiseStrength: 0.28,
      mortarStrength: 0.95,
      brightness: 0.9,
      seed: 22,
    });
  }
  return floorTextureBase;
}

let ceilingTextureBase: THREE.CanvasTexture | null = null;
function ceilingTexture(): THREE.CanvasTexture {
  if (!ceilingTextureBase) {
    ceilingTextureBase = createStoneTexture({
      pattern: "flat",
      baseColor: [70, 70, 76],
      mortarColor: [46, 46, 50],
      gridCount: 6,
      noiseStrength: 0.12,
      mortarStrength: 0.5,
      brightness: 0.65,
      seed: 33,
    });
  }
  return ceilingTextureBase;
}

let woodTextureBase: THREE.CanvasTexture | null = null;
function woodTexture(): THREE.CanvasTexture {
  if (!woodTextureBase) {
    woodTextureBase = createWoodTexture({
      baseColor: [120, 78, 45],
      grainColor: [72, 44, 22],
      grainDirection: "vertical",
      plankCount: 4,
      seed: 44,
    });
  }
  return woodTextureBase;
}

function cloneWithRepeat(base: THREE.CanvasTexture, repeat: Repeat): THREE.CanvasTexture {
  const tex = base.clone();
  tex.needsUpdate = true;
  applyRepeat(tex, repeat);
  return tex;
}

/** Coursed-stone wall material (vertical block coursing, running bond). */
export function wallMaterial(repeat: Repeat = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: cloneWithRepeat(wallTexture(), repeat),
    roughness: 0.95,
    metalness: 0.02,
  });
}

/** Flagstone floor material — slightly darker/worn than the wall stone. */
export function floorMaterial(repeat: Repeat = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: cloneWithRepeat(floorTexture(), repeat),
    roughness: 0.98,
    metalness: 0.0,
  });
}

/** Flat, low-contrast, darker ceiling material (less lit in a dungeon). */
export function ceilingMaterial(repeat: Repeat = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: cloneWithRepeat(ceilingTexture(), repeat),
    roughness: 0.95,
    metalness: 0.0,
  });
}

/** Vertical-plank wood-grain material, used for doors (issue #42). */
export function woodMaterial(repeat: Repeat = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: cloneWithRepeat(woodTexture(), repeat),
    roughness: 0.75,
    metalness: 0.02,
  });
}
