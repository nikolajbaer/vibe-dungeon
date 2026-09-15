import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Wall banner / tapestry (issue #70) — a hanging rod + cloth panel with one
// contrasting stripe, for a simple heraldic look. Purely decorative: thin,
// flush to a wall, and nothing a player could meaningfully collide with, so
// (unlike every other furniture asset) it declares no `footprint`. Builds
// facing local +z by default; a placement's `rotation` (applied generically
// by level/spawning.ts) points it at whichever wall it ends up mounted on,
// the same way chair.ts's mesh always faces local +z and relies on the
// placer to rotate it toward a table.

const BANNER_WIDTH = 1.0;
const BANNER_HEIGHT = 1.8;
const BANNER_THICKNESS = 0.035;
const BANNER_BOTTOM_Y = 1.55; // bottom edge height above the floor
const BANNER_ROD_RADIUS = 0.03;
const BANNER_ROD_OVERHANG = 0.12; // how far the rod pokes out past the cloth on each side
const BANNER_STRIPE_HEIGHT = 0.32;

let bannerRodMat: THREE.MeshStandardMaterial | undefined;
function bannerRodMaterial(): THREE.MeshStandardMaterial {
  return (bannerRodMat ??= new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.6, metalness: 0.35 }));
}

/** Asset-specific placement params: lets different placements of the same
 * banner give it different heraldry (e.g. room-a's red/gold vs. room-b's
 * green/gold) without a second asset module. Both default to a red/gold
 * look if omitted. */
export interface BannerParams {
  primaryColor?: number;
  accentColor?: number;
}

/**
 * A hanging wall banner: a horizontal mounting rod plus a cloth panel below
 * it, with one contrasting stripe near the top.
 */
function createBannerMesh(params?: BannerParams): THREE.Group {
  const primaryColor = params?.primaryColor ?? 0x7a1f1f;
  const accentColor = params?.accentColor ?? 0xc9a227;

  const group = new THREE.Group();

  const rodLength = BANNER_WIDTH + BANNER_ROD_OVERHANG * 2;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(BANNER_ROD_RADIUS, BANNER_ROD_RADIUS, rodLength, 8), bannerRodMaterial());
  rod.rotation.z = Math.PI / 2; // lay the cylinder on its side, spanning local X
  rod.position.y = BANNER_BOTTOM_Y + BANNER_HEIGHT + BANNER_ROD_RADIUS;
  group.add(rod);

  const clothMat = new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.9, metalness: 0 });
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(BANNER_WIDTH, BANNER_HEIGHT, BANNER_THICKNESS), clothMat);
  cloth.position.y = BANNER_BOTTOM_Y + BANNER_HEIGHT / 2;
  group.add(cloth);

  // A slightly-proud stripe (a hair thicker than the cloth) near the top so
  // it doesn't z-fight with the panel behind it.
  const stripeMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.85, metalness: 0 });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(BANNER_WIDTH, BANNER_STRIPE_HEIGHT, BANNER_THICKNESS + 0.006), stripeMat);
  stripe.position.y = BANNER_BOTTOM_Y + BANNER_HEIGHT - BANNER_STRIPE_HEIGHT * 1.4;
  group.add(stripe);

  return group;
}

const banner: FurnitureAssetDef<BannerParams> = {
  id: "banner",
  createMesh: (params) => createBannerMesh(params),
  // No footprint — see header comment.
};

export default banner;
