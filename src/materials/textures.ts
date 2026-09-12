import * as THREE from "three";

// ---------------------------------------------------------------------------
// Procedural, seamlessly-tileable stone-look textures, drawn at runtime onto
// a <canvas> and wrapped as THREE.CanvasTexture. Deliberately dependency-free
// (issue #11): no image assets, no noise library — just small hashed
// pseudo-random noise functions implemented directly below.
//
// This module is standalone and not yet imported by anything else. See the
// README "Design Notes" for how a future task should wire the materials in
// `dungeonMaterials.ts` into `src/level/materials.ts`'s
// wallMaterial()/floorMaterial()/ceilingMaterial().
// ---------------------------------------------------------------------------

/** Deterministic pseudo-random float in [0, 1) from two integers + a seed.
 * A cheap bit-mixing hash (no external RNG lib) — good enough for
 * blockout-grade noise. */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrapIndex(v: number, period: number): number {
  return ((v % period) + period) % period;
}

/** Toroidal (seam-free when tiled) value noise. `x`/`y` are in "cell" units;
 * `period` is how many lattice cells the noise repeats over. Sampling with
 * x,y sweeping exactly [0, period) across the canvas guarantees the left/top
 * edge and right/bottom edge line up, since both ends hash to the same
 * wrapped lattice points. */
function tiledValueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const v00 = hash2(wrapIndex(x0, period), wrapIndex(y0, period), seed);
  const v10 = hash2(wrapIndex(x0 + 1, period), wrapIndex(y0, period), seed);
  const v01 = hash2(wrapIndex(x0, period), wrapIndex(y0 + 1, period), seed);
  const v11 = hash2(wrapIndex(x0 + 1, period), wrapIndex(y0 + 1, period), seed);
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}

/** Sum of a few octaves of tiledValueNoise. Still perfectly seam-free since
 * every octave's period stays an integer multiple of the base period. */
function tiledFbm(x: number, y: number, basePeriod: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let max = 0;
  for (let o = 0; o < octaves; o++) {
    sum += tiledValueNoise(x * freq, y * freq, basePeriod * freq, seed + o * 101) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / max;
}

/** Toroidal Worley/cellular noise: one random feature point per grid cell
 * (cells wrap), returning the distance to the nearest (`d1`) and
 * second-nearest (`d2`) feature point plus the winning cell's id — the
 * classic building block for a flagstone/crazy-paving look. Wraps seamlessly
 * because the 3x3 neighborhood of cells is searched using wrapped indices,
 * so a point near one edge of the canvas correctly "sees" feature points
 * from the opposite edge. */
function toroidalWorley(
  x: number,
  y: number,
  cellsX: number,
  cellsY: number,
  seed: number,
): { d1: number; d2: number; id: number } {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let d1 = Infinity;
  let d2 = Infinity;
  let id1 = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = wrapIndex(cx + ox, cellsX);
      const gy = wrapIndex(cy + oy, cellsY);
      // Feature point jittered within its cell, hashed from the *wrapped*
      // cell coords so the same physical cell always resolves to the same
      // point regardless of which neighboring copy we're searching from.
      const fx = cx + ox + hash2(gx, gy, seed);
      const fy = cy + oy + hash2(gx, gy, seed + 1);
      const dx = x - fx;
      const dy = y - fy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id1 = gx * 7919 + gy * 104729;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return { d1, d2, id: id1 };
}

export interface StoneTextureOptions {
  /** Canvas size in px (square). Kept modest — this is blockout art. */
  size?: number;
  /** Base stone RGB, 0-255. */
  baseColor: [number, number, number];
  /** Grout/mortar RGB, 0-255. */
  mortarColor: [number, number, number];
  /** "coursed" = brick-like wall blocks (running bond), "flagstone" =
   * irregular floor paving (toroidal Worley cells), "flat" = mostly-flat
   * mottled noise with a faint grid (ceiling). */
  pattern: "coursed" | "flagstone" | "flat";
  /** How many blocks/cells span the texture. The full texture is meant to
   * represent one 3m project grid unit, so e.g. gridCount=6 gives ~0.5m
   * blocks — see dungeonMaterials.ts. */
  gridCount?: number;
  /** 0-1, how strong the per-block/per-pixel colour jitter is. */
  noiseStrength?: number;
  /** 0-1-ish, how strongly the mortar colour blends in at block edges. */
  mortarStrength?: number;
  /** Uniform brightness multiplier applied at the end (e.g. <1 to darken a
   * ceiling that gets less light in a dungeon). */
  brightness?: number;
  seed?: number;
}

/** Draws a procedural, seamlessly-tileable stone texture and returns it as a
 * THREE.CanvasTexture (RepeatWrapping already set on both axes). See
 * `pattern` for the three looks used by walls, floors and ceilings. */
export function createStoneTexture(opts: StoneTextureOptions): THREE.CanvasTexture {
  const size = opts.size ?? 256;
  const gridCount = opts.gridCount ?? 6;
  const noiseStrength = opts.noiseStrength ?? 0.18;
  const mortarStrength = opts.mortarStrength ?? 0.85;
  const brightness = opts.brightness ?? 1;
  const seed = opts.seed ?? 1;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const [br, bg, bb] = opts.baseColor;
  const [mr, mg, mb] = opts.mortarColor;

  // Even row count for "coursed" so the half-block running-bond offset lines
  // up again when the texture wraps top-to-bottom.
  const coursedRows = Math.max(2, Math.round(gridCount * 0.6) + (Math.round(gridCount * 0.6) % 2));

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Broad mottling + fine grain, both sampled toroidally so the whole
      // field wraps without a seam.
      const nx = (px / size) * gridCount;
      const ny = (py / size) * gridCount;
      const mottle = tiledFbm(nx, ny, gridCount, seed, 3);
      const grain = tiledValueNoise(nx * 8, ny * 8, gridCount * 8, seed + 500);

      let isMortar = false;
      let cellShade = 0.5;

      if (opts.pattern === "coursed") {
        const blockW = size / gridCount;
        const blockH = size / coursedRows;
        const rowIndex = Math.floor(py / blockH);
        const offsetX = (rowIndex % 2) * (blockW / 2);
        const localX = (px + offsetX) % size;
        const dx = localX % blockW;
        const dy = py % blockH;
        const distX = Math.min(dx, blockW - dx);
        const distY = Math.min(dy, blockH - dy);
        const mortarHalf = Math.max(1, size * 0.007);
        isMortar = distX < mortarHalf || distY < mortarHalf;
        const cellX = Math.floor(localX / blockW);
        cellShade = hash2(cellX, rowIndex, seed + 900);
      } else if (opts.pattern === "flagstone") {
        const w = toroidalWorley(nx, ny, gridCount, gridCount, seed + 200);
        const edgeWidth = 0.09;
        isMortar = w.d2 - w.d1 < edgeWidth;
        cellShade = hash2(w.id & 0xffff, (w.id >>> 16) & 0xffff, seed + 900);
      } else {
        // "flat": faint large grid, mostly noise, low contrast.
        const blockW = size / gridCount;
        const dx = px % blockW;
        const dy = py % blockW;
        const distX = Math.min(dx, blockW - dx);
        const distY = Math.min(dy, blockW - dy);
        const mortarHalf = Math.max(1, size * 0.004);
        isMortar = distX < mortarHalf || distY < mortarHalf;
      }

      const shade =
        (mottle - 0.5) * 2 * noiseStrength +
        (grain - 0.5) * 2 * (noiseStrength * 0.4) +
        (cellShade - 0.5) * 2 * (noiseStrength * 0.6);

      let r: number;
      let g: number;
      let b: number;
      if (isMortar) {
        r = lerp(br, mr, mortarStrength) * (1 + shade * 0.3);
        g = lerp(bg, mg, mortarStrength) * (1 + shade * 0.3);
        b = lerp(bb, mb, mortarStrength) * (1 + shade * 0.3);
      } else {
        r = br * (1 + shade);
        g = bg * (1 + shade);
        b = bb * (1 + shade);
      }

      const i = (py * size + px) * 4;
      data[i] = Math.max(0, Math.min(255, r * brightness));
      data[i + 1] = Math.max(0, Math.min(255, g * brightness));
      data[i + 2] = Math.max(0, Math.min(255, b * brightness));
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
