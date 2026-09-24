import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Wall-mounted stained-glass window (great-hall wing task) — a stone frame
// around a grid of colored "glass" panes, each lit from within (emissive,
// like fireplace.ts's flames/candelabra.ts's candles) rather than actually
// lit by a real light, the same "reads as lit through the material alone"
// restraint those two use and for the same reason: this project already
// relies on tileBuilder.ts's own wall torches for real dynamic lighting.
// Purely decorative — no footprint, the same convention banner.ts uses,
// since nothing should ever physically collide with a window mounted flush
// on a wall. Builds facing local +z (the glass faces whoever's looking at
// it from inside the room); a placement's `rotation` points that face at
// whichever wall it's actually mounted on, same as banner.ts/poster.ts.
//
// `WindowParams.width` lets a narrower variant (the Maester's study's
// "smaller windows", per that room's own decor) reuse this asset rather than
// needing a second one — height/pane count scale down together with it so a
// narrow window still reads as one coherent window, not a stretched wide one
// with fewer panes cut off.

export interface WindowParams {
  /** Overall width, meters — height and pane grid scale with it. Defaults to
   * a large hall-sized window; pass a smaller value for a study/bedroom. */
  width?: number;
}

const DEFAULT_WIDTH = 1.6;
const ASPECT = 1.6; // height = width * ASPECT
const FRAME_THICKNESS = 0.1;
const FRAME_DEPTH = 0.12;
const GLASS_DEPTH = 0.03;
const SILL_BOTTOM_Y = 2.4; // bottom edge height above the floor
const COLS = 3;
const ROWS = 4;
const MULLION_WIDTH = 0.05; // stone divider between panes

let frameMat: THREE.MeshStandardMaterial | undefined;
function frameMaterial(): THREE.MeshStandardMaterial {
  return (frameMat ??= new THREE.MeshStandardMaterial({ color: 0x736f66, roughness: 0.85, metalness: 0.05 }));
}

// A jewel-toned palette, cycled across the pane grid so no two adjacent
// panes share a color -- enough variation to read as a real mosaic rather
// than a flat tinted pane.
const PANE_COLORS = [0x7a1f2e, 0x1f4a7a, 0x1f6b3a, 0xb8860b, 0x5a2b7a, 0xc9a227];
const paneMats = new Map<number, THREE.MeshStandardMaterial>();
function paneMaterial(color: number): THREE.MeshStandardMaterial {
  let mat = paneMats.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85 });
    paneMats.set(color, mat);
  }
  return mat;
}

/** A stone frame around a grid of emissive colored glass panes, separated by
 * thin stone mullions. */
function createWindowMesh(params?: WindowParams): THREE.Group {
  const width = params?.width ?? DEFAULT_WIDTH;
  const height = width * ASPECT;
  const group = new THREE.Group();
  const frame = frameMaterial();

  const outer = new THREE.Mesh(new THREE.BoxGeometry(width + FRAME_THICKNESS * 2, height + FRAME_THICKNESS * 2, FRAME_DEPTH), frame);
  outer.position.set(0, SILL_BOTTOM_Y + height / 2, -FRAME_DEPTH / 2);
  group.add(outer);

  const paneAreaW = width - MULLION_WIDTH * (COLS - 1);
  const paneAreaH = height - MULLION_WIDTH * (ROWS - 1);
  const paneW = paneAreaW / COLS;
  const paneH = paneAreaH / ROWS;
  let colorIndex = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(paneW, paneH, GLASS_DEPTH), paneMaterial(PANE_COLORS[colorIndex % PANE_COLORS.length]));
      const px = -width / 2 + paneW / 2 + col * (paneW + MULLION_WIDTH);
      const py = SILL_BOTTOM_Y + paneH / 2 + row * (paneH + MULLION_WIDTH);
      pane.position.set(px, py, -FRAME_DEPTH / 2 + 0.01);
      group.add(pane);
      colorIndex++;
    }
  }

  return group;
}

const stainedGlassWindow: FurnitureAssetDef<WindowParams> = {
  id: "stained-glass-window",
  createMesh: (params) => createWindowMesh(params),
  // No footprint — see header comment.
};

export default stainedGlassWindow;
