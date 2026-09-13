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

// ---------------------------------------------------------------------------
// Procedural, seamlessly-tileable wood-grain texture (issue #42). Reuses the
// hashed-noise primitives above (hash2/smoothstep/lerp/wrapIndex,
// tiledValueNoise/tiledFbm, toroidalWorley) rather than introducing a new
// noise family. The only new building blocks are `tiledValueNoise2` /
// `tiledFbm2`, which are the same toroidal value-noise/fbm but sampled with
// independent x/y periods so the grain can be stretched long along one axis
// (elongated streaks) while staying higher-frequency across it — still
// exactly seam-free for the same reason tiledValueNoise is: every axis wraps
// its lattice indices via wrapIndex against an integer period.
// ---------------------------------------------------------------------------

/** Like `tiledValueNoise`, but the x and y axes wrap against independent
 * periods, letting the caller stretch noise long in one direction (e.g. wood
 * grain running the length of a plank) while keeping it fine-grained in the
 * other. */
function tiledValueNoise2(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  seed: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const v00 = hash2(wrapIndex(x0, periodX), wrapIndex(y0, periodY), seed);
  const v10 = hash2(wrapIndex(x0 + 1, periodX), wrapIndex(y0, periodY), seed);
  const v01 = hash2(wrapIndex(x0, periodX), wrapIndex(y0 + 1, periodY), seed);
  const v11 = hash2(wrapIndex(x0 + 1, periodX), wrapIndex(y0 + 1, periodY), seed);
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}

/** Anisotropic sibling of `tiledFbm`: sums octaves of `tiledValueNoise2`,
 * scaling both periods by the same per-octave frequency so every octave
 * still wraps against an integer period (seam-free). */
function tiledFbm2(
  x: number,
  y: number,
  basePeriodX: number,
  basePeriodY: number,
  seed: number,
  octaves = 3,
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let max = 0;
  for (let o = 0; o < octaves; o++) {
    sum +=
      tiledValueNoise2(x * freq, y * freq, basePeriodX * freq, basePeriodY * freq, seed + o * 101) *
      amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / max;
}

export interface WoodTextureOptions {
  /** Canvas size in px (square). Kept modest — this is blockout art. */
  size?: number;
  /** Base wood RGB, 0-255. */
  baseColor: [number, number, number];
  /** Darker grain-streak RGB, 0-255, blended in along the grain. */
  grainColor: [number, number, number];
  /** Plank-seam line RGB, 0-255. Defaults to a darkened `baseColor`. */
  seamColor?: [number, number, number];
  /** Which way the grain (and plank seams) run. "vertical" = grain runs
   * top-to-bottom with seams as vertical lines splitting boards side by
   * side — the natural look for a door made of upright planks. */
  grainDirection?: "vertical" | "horizontal";
  /** How many planks/boards span the texture across the grain direction. */
  plankCount?: number;
  /** 0-1, strength of the broad elongated grain streaks. */
  grainStrength?: number;
  /** 0-1, strength of the fine high-frequency fiber lines. */
  fiberStrength?: number;
  /** 0-1, how strongly the seam colour blends in at plank edges. */
  seamStrength?: number;
  /** Draw occasional subtle knots (concentric rings) in the grain. */
  knots?: boolean;
  /** Roughly how many knot "cells" span the texture — higher = more, smaller
   * knots. */
  knotDensity?: number;
  /** Uniform brightness multiplier applied at the end. */
  brightness?: number;
  seed?: number;
}

/** Draws a procedural, seamlessly-tileable wood-grain texture and returns it
 * as a THREE.CanvasTexture (RepeatWrapping already set on both axes), using
 * the same toroidal-wrapping approach as `createStoneTexture`. */
export function createWoodTexture(opts: WoodTextureOptions): THREE.CanvasTexture {
  const size = opts.size ?? 256;
  const grainDirection = opts.grainDirection ?? "vertical";
  const plankCount = Math.max(1, Math.round(opts.plankCount ?? 4));
  const grainStrength = opts.grainStrength ?? 0.4;
  const fiberStrength = opts.fiberStrength ?? 0.16;
  const seamStrength = opts.seamStrength ?? 0.6;
  const knots = opts.knots ?? true;
  const knotDensity = Math.max(1, Math.round(opts.knotDensity ?? 3));
  const brightness = opts.brightness ?? 1;
  const seed = opts.seed ?? 1;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const [br, bg, bb] = opts.baseColor;
  const [gr, gg, gb] = opts.grainColor;
  const [sr, sg, sb] = opts.seamColor ?? [
    Math.round(br * 0.45),
    Math.round(bg * 0.45),
    Math.round(bb * 0.45),
  ];

  // The whole texture represents one project grid unit, same convention as
  // the stone textures — see dungeonMaterials.ts.
  const gridCount = 6;
  const crossFreqFine = 14; // fine wood-fiber lines across the grain
  const crossFreqBroad = 5; // broader streak banding across the grain
  const alongFreqBroad = 1.2; // slow variation along the grain -> long streaks

  const plankWidth = size / plankCount;
  const seamHalf = Math.max(1, size * 0.006);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px / size) * gridCount;
      const v = (py / size) * gridCount;
      const cross = grainDirection === "vertical" ? u : v;
      const along = grainDirection === "vertical" ? v : u;

      // Elongated grain streaks: low frequency along the grain, higher
      // across it, via the anisotropic fbm above.
      const streak = tiledFbm2(
        cross * crossFreqBroad,
        along * alongFreqBroad,
        gridCount * crossFreqBroad,
        gridCount * alongFreqBroad,
        seed,
        3,
      );
      // Fine fiber lines: very high frequency across, very low along.
      const fiber = tiledValueNoise2(
        cross * crossFreqFine,
        along * 0.6,
        gridCount * crossFreqFine,
        gridCount * 0.6,
        seed + 400,
      );
      // Broad isotropic mottling for overall colour variance.
      const mottle = tiledFbm(u, v, gridCount, seed + 900, 2);

      let shade =
        (streak - 0.5) * 2 * grainStrength +
        (fiber - 0.5) * 2 * fiberStrength +
        (mottle - 0.5) * 2 * 0.12;

      // Occasional knots: toroidal Worley cells, only some of which get a
      // visible knot, darkened toward the cell's feature point with a faint
      // concentric ring pattern.
      if (knots) {
        const wx = (px / size) * knotDensity;
        const wy = (py / size) * knotDensity;
        const w = toroidalWorley(wx, wy, knotDensity, knotDensity, seed + 1300);
        const hasKnot = hash2(Math.floor(wx), Math.floor(wy), seed + 1400) < 0.3;
        if (hasKnot && w.d1 < 0.4) {
          const core = 1 - w.d1 / 0.4;
          const ring = 0.5 + 0.5 * Math.sin(w.d1 * 30);
          shade -= core * 0.6 + core * ring * 0.25;
        }
      }

      const t = Math.max(0, Math.min(1, 0.5 + shade));
      let r = lerp(br, gr, t);
      let g = lerp(bg, gg, t);
      let b = lerp(bb, gb, t);

      const crossPx = grainDirection === "vertical" ? px : py;
      const dCross = crossPx % plankWidth;
      const distSeam = Math.min(dCross, plankWidth - dCross);
      if (distSeam < seamHalf) {
        r = lerp(r, sr, seamStrength);
        g = lerp(g, sg, seamStrength);
        b = lerp(b, sb, seamStrength);
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
