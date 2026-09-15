import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Procedural hand-lantern mesh (issue #75), following swordModel.ts's exact
// pattern: a handful of primitives merged into one two-material-group
// `THREE.BufferGeometry` (frame, then glass), shared between the world
// pickup mesh (game.ts) and the first-person viewmodel
// (ecs/systems/items.ts) — no imported model/texture, matching every other
// prop/item in this repo.
//
// Unlike the sword (authored "grip at bottom, tip at +Y" then rotated so its
// long axis is Z), a lantern has no natural long axis to reorient around —
// it's carried upright, the same way it's built, so there's no equivalent
// bake-a-rotation step here.
//
// The mesh's origin (0,0,0) sits at the vertical center of the frame/glass
// column (roughly where a carrying hand would be, a bit below the actual
// handle) — the same "pivot near where a hand holds it" convention as
// swordModel.ts's grip-centered origin, so `VIEWMODEL_OFFSET` (items.ts)
// positions it sensibly without per-item-type tuning. It also happens to be
// exactly the glass core's center, i.e. the lantern's light source — see
// `LANTERN_LIGHT_LOCAL_POSITION` below.

const BASE_SIZE = 0.16; // footprint of the base plate / top cap, meters
const BASE_HEIGHT = 0.03;
const POST_HEIGHT = 0.18; // frame height between base and cap, and the glass core's height
const POST_RADIUS = 0.012;
const POST_INSET = 0.06; // corner posts sit this far from center on both X and Z
const GLASS_SIZE = 0.11; // glass core width/depth (a bit short of the posts' footprint)
const HANDLE_RADIUS = 0.06;
const HANDLE_TUBE = 0.012;

let frameMat: THREE.MeshStandardMaterial | undefined;
let glassMat: THREE.MeshStandardMaterial | undefined;

/** Dark wrought-iron-look frame material, cached like swordModel.ts's
 * `metalMaterial()`. */
function frameMaterial(): THREE.MeshStandardMaterial {
  return (frameMat ??= new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.6, roughness: 0.5 }));
}

/** Warm amber "glass" material for the lantern's glow chamber. Carries a
 * real `emissive` so the *world pickup* mesh reads as a lit lantern (a
 * subtle always-on glow) even though — per the issue — it has no live
 * `THREE.PointLight` until it's actually equipped; the viewmodel reuses the
 * same material, its actual illumination coming from the separate
 * `PointLight` `createViewmodelMesh` (items.ts) adds alongside it. */
function glassMaterial(): THREE.MeshStandardMaterial {
  return (glassMat ??= new THREE.MeshStandardMaterial({
    color: 0x3a2410,
    emissive: 0xffaa44,
    emissiveIntensity: 0.9,
    roughness: 0.3,
    metalness: 0,
  }));
}

/**
 * Builds one merged lantern mesh: a base plate, four corner posts, a glass
 * core (the material group a caller can pick out by index 1 if it ever needs
 * to, though nothing does today), a top cap, and a half-torus carry handle —
 * as two material groups (frame, then glass) on a single merged
 * `THREE.BufferGeometry`, same "several primitives -> one mesh" shape as
 * `createSwordMesh`. Call once per usage site; see that function's doc
 * comment for why sharing/caching instances isn't needed.
 */
export function createLanternMesh(): THREE.Mesh {
  const halfPost = POST_HEIGHT / 2;

  // Base plate, flush under the posts.
  const base = new THREE.BoxGeometry(BASE_SIZE, BASE_HEIGHT, BASE_SIZE);
  base.translate(0, -halfPost - BASE_HEIGHT / 2, 0);

  // Four corner posts spanning the full frame height, centered on the
  // mesh's origin (matching the glass core below).
  const postGeos: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, POST_HEIGHT, 6);
      post.translate(sx * POST_INSET, 0, sz * POST_INSET);
      postGeos.push(post);
    }
  }

  // Top cap, mirroring the base.
  const cap = new THREE.BoxGeometry(BASE_SIZE, BASE_HEIGHT, BASE_SIZE);
  cap.translate(0, halfPost + BASE_HEIGHT / 2, 0);

  // Carry handle: a half-torus. `THREE.TorusGeometry`'s ring lies in its
  // local XY plane (swept around Z) — with `arc: Math.PI` that's exactly a
  // semicircle from (+radius,0,0) up through (0,radius,0) down to
  // (-radius,0,0), i.e. already a standing handle arc with no rotation
  // needed; just lift it to sit on top of the cap.
  const handle = new THREE.TorusGeometry(HANDLE_RADIUS, HANDLE_TUBE, 6, 12, Math.PI);
  handle.translate(0, halfPost + BASE_HEIGHT, 0);

  const frameGeo = mergeGeometries([base, ...postGeos, cap, handle], false);
  if (!frameGeo) throw new Error("lanternModel: failed to merge frame geometries");

  // Glass core: the glow chamber the four posts frame. Its center is world
  // origin (0,0,0) — see this file's header comment.
  const glass = new THREE.BoxGeometry(GLASS_SIZE, POST_HEIGHT - 0.02, GLASS_SIZE);

  // useGroups=true assigns geometry group 0 -> frameGeo, group 1 -> glass,
  // lining materialIndex up with a [frameMaterial, glassMaterial] array.
  const merged = mergeGeometries([frameGeo, glass], true);
  if (!merged) throw new Error("lanternModel: failed to merge lantern geometry");
  merged.computeVertexNormals();

  const mesh = new THREE.Mesh(merged, [frameMaterial(), glassMaterial()]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Local-space position of the lantern's light source (the glass core's
 * center) — exactly the mesh's own origin today, but exported rather than
 * assumed `(0,0,0)` inline at each call site so a future reshaping of this
 * mesh (moving the glow chamber off-origin) only needs to update it here.
 * `createViewmodelMesh` (ecs/systems/items.ts) positions its `PointLight`
 * here. */
export const LANTERN_LIGHT_LOCAL_POSITION = new THREE.Vector3(0, 0, 0);
