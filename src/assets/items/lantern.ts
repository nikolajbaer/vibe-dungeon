import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ItemAssetDef } from "../types";

// Procedural hand-lantern mesh (issue #75) — a hand-item that casts real
// light while equipped instead of dealing melee damage (`meleeDamage` is
// left undefined, so combat.ts's unarmed-damage fallback applies). Frame +
// glass-core + handle, merged into one two-material-group
// `THREE.BufferGeometry`, same pattern as sword.ts.
//
// The mesh's origin (0,0,0) sits at the vertical center of the frame/glass
// column (roughly where a carrying hand would be, a bit below the actual
// handle) — the same "pivot near where a hand holds it" convention as
// sword.ts's grip-centered origin. It also happens to be exactly the glass
// core's center, i.e. the lantern's light source — see
// `LANTERN_LIGHT_LOCAL_POSITION` below.

const BASE_SIZE = 0.16; // footprint of the base plate / top cap, meters
const BASE_HEIGHT = 0.03;
const POST_HEIGHT = 0.18; // frame height between base and cap, and the glass core's height
const POST_RADIUS = 0.012;
const POST_INSET = 0.06; // corner posts sit this far from center on both X and Z
const GLASS_SIZE = 0.11; // glass core width/depth (a bit short of the posts' footprint)
const HANDLE_RADIUS = 0.06;
const HANDLE_TUBE = 0.012;

// Local-space position of the lantern's light source (the glass core's
// center) — exactly the mesh's own origin today, but kept as its own
// constant rather than assumed `(0,0,0)` inline below so a future
// reshaping of this mesh (moving the glow chamber off-origin) only needs to
// update it here.
const LANTERN_LIGHT_LOCAL_POSITION = new THREE.Vector3(0, 0, 0);

// Viewmodel light params — sanity-checked against tileBuilder.ts's
// `TORCH_LIGHT_*` (a wall-mounted torch: color 0xffaa55, intensity 1.4,
// range 6, decay 2) and against a genuinely dark stretch of corridor
// in-game (see issue #75's PR description for the before/after
// pixel-brightness sample: 128.65/255 equipped vs. 22.53/255 unequipped, at
// the same spot). A shade warmer/whiter than the torch (0xffd9a0 vs
// 0xffaa55) so the two read as distinct light sources side by side,
// slightly brighter/longer-reaching than one torch since, unlike a torch,
// this is meant to be the player's *only* light source deep in corridors
// that don't get one — but still low enough, at the range the mesh actually
// sits from the camera, to avoid blowing out nearby geometry under this
// scene's ACESFilmicToneMapping (game.ts).
const LANTERN_LIGHT_COLOR = 0xffd9a0;
const LANTERN_LIGHT_INTENSITY = 1.6;
const LANTERN_LIGHT_RANGE = 7; // meters
const LANTERN_VIEWMODEL_SCALE = 0.8; // matches the sword's own "shrink a touch for the closer camera" scale-down
// In-hand-only framing tilt, applied to the viewmodel mesh only (the world
// pickup mesh stays upright) — found by rendering candidate angles at the
// real hand offset/scale: unrotated, the lantern reads as a mostly edge-on
// sliver at that close, off-to-the-side hand position.
const LANTERN_VIEWMODEL_TILT = Math.PI / 4;

let frameMat: THREE.MeshStandardMaterial | undefined;
let glassMat: THREE.MeshStandardMaterial | undefined;

/** Dark wrought-iron-look frame material. */
function frameMaterial(): THREE.MeshStandardMaterial {
  return (frameMat ??= new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.6, roughness: 0.5 }));
}

/** Warm amber "glass" material for the lantern's glow chamber. Carries a
 * real `emissive` so the *world pickup* mesh reads as a lit lantern (a
 * subtle always-on glow) even though it has no live `THREE.PointLight`
 * until it's actually equipped; the viewmodel reuses the same material, its
 * actual illumination coming from the separate `PointLight`
 * `createViewmodelMesh` below adds alongside it. */
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
 * core, a top cap, and a half-torus carry handle — two material groups
 * (frame, then glass) on a single merged `THREE.BufferGeometry`.
 */
function createLanternMesh(): THREE.Mesh {
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
  if (!frameGeo) throw new Error("lantern: failed to merge frame geometries");

  // Glass core: the glow chamber the four posts frame. Its center is world
  // origin (0,0,0) — see this file's header comment.
  const glass = new THREE.BoxGeometry(GLASS_SIZE, POST_HEIGHT - 0.02, GLASS_SIZE);

  // useGroups=true assigns geometry group 0 -> frameGeo, group 1 -> glass,
  // lining materialIndex up with a [frameMaterial, glassMaterial] array.
  const merged = mergeGeometries([frameGeo, glass], true);
  if (!merged) throw new Error("lantern: failed to merge lantern geometry");
  merged.computeVertexNormals();

  const mesh = new THREE.Mesh(merged, [frameMaterial(), glassMaterial()]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const lantern: ItemAssetDef = {
  id: "lantern",
  name: "Lantern",
  icon: "🏮",
  slot: "hand",
  createWorldMesh: () => createLanternMesh(),
  createViewmodelMesh: () => {
    // A `THREE.Group` holding the lantern mesh *and* a real
    // `THREE.PointLight`, so `equipItem`'s `camera.add(mesh)` /
    // `unequipItem`'s `mesh.removeFromParent()` (ecs/systems/items.ts) turn
    // the light on and off for free — nothing else needs to know the
    // lantern is lit. The *world pickup* mesh (built by `createWorldMesh`
    // above) never goes through this function, so it never gets a live
    // light — only an equipped lantern actually shines.
    const mesh = createLanternMesh();
    mesh.scale.setScalar(LANTERN_VIEWMODEL_SCALE);
    mesh.rotation.x = LANTERN_VIEWMODEL_TILT;

    const light = new THREE.PointLight(LANTERN_LIGHT_COLOR, LANTERN_LIGHT_INTENSITY, LANTERN_LIGHT_RANGE, 2);
    // `mesh` is scaled but sits at the group's own origin, so the light's
    // local position needs no rescaling.
    light.position.copy(LANTERN_LIGHT_LOCAL_POSITION);

    const group = new THREE.Group();
    group.add(mesh, light);
    return group;
  },
};

export default lantern;
