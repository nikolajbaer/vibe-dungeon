import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ItemAssetDef } from "../types";

// Shared low-poly sword mesh (issue #65; migrated into the asset-authoring
// system) — a handful of `THREE.CylinderGeometry`/`THREE.BoxGeometry`/
// `THREE.SphereGeometry` primitives positioned relative to each other and
// merged with `mergeGeometries`, same pattern as
// src/characters/humanoidRig.ts's `buildMeshGeometry` and every furniture
// factory under src/assets/furniture/ — no textures, no imported/external
// model, no skinning/bones needed here (unlike the humanoid rig, this is
// static geometry).
//
// Authored standing upright (grip at the bottom, blade tip at +Y) since
// that's the natural way to reason about "grip -> crossguard -> blade ->
// tip" front-to-back, then the whole merged geometry is rotated 90° about X
// so the finished mesh's long axis is Z, tip at +Z — putting the tip on the
// axis `THREE.Object3D.prototype.lookAt` points at its target for a
// non-camera/light object (a three.js quirk: unlike a camera, whose -Z looks
// at its target, a plain Object3D's lookAt aims its local +Z) — so a caller
// can orient the held viewmodel with `sword.lookAt(aPointOutInFrontOfTheCamera)`
// instead of hand-picking Euler angles.
//
// The mesh's origin (0,0,0) sits at the center of the grip — i.e. roughly
// where a hand would wrap around it — so a caller positioning/rotating the
// mesh (ecs/systems/items.ts's `VIEWMODEL_OFFSET`) pivots around the hand,
// with the blade extending out from there, rather than around the weapon's
// visual midpoint.

const GRIP_LENGTH = 0.14; // matches humanoidRig's HAND_LEN — "hand-width" grip
const GRIP_RADIUS = 0.018;
const POMMEL_RADIUS = 0.032;
const CROSSGUARD_LENGTH = 0.22; // full width, perpendicular to the blade
const CROSSGUARD_HEIGHT = 0.035; // thickness along the blade axis
const CROSSGUARD_DEPTH = 0.045; // front-to-back thickness
const BLADE_BODY_LENGTH = 0.68;
const BLADE_TIP_LENGTH = 0.16;
const BLADE_WIDTH_BASE = 0.05; // apothem-ish radius at the guard end (diamond cross-section)
const BLADE_WIDTH_TIP = 0.004; // near-point radius at the tip
const BLADE_FLATTEN = 0.35; // scales the blade's Z (front-back) thickness down relative to its X width

// Same "shrink a touch for the closer camera" scale-down every viewmodel in
// this repo uses — an unscaled sword held at the hand offset reads as
// oversized.
const VIEWMODEL_SCALE = 0.85;

let metalMat: THREE.MeshStandardMaterial | undefined;
let gripMat: THREE.MeshStandardMaterial | undefined;

/** Shared flat metal-look material for blade/crossguard/pommel — cached the
 * same way every material factory in src/assets/furniture/ is. */
function metalMaterial(): THREE.MeshStandardMaterial {
  return (metalMat ??= new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.3, roughness: 0.4 }));
}

/** Shared flat leather-look grip material, distinct from the metal parts. */
function gripMaterial(): THREE.MeshStandardMaterial {
  return (gripMat ??= new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.9, metalness: 0 }));
}

/**
 * Builds one merged low-poly sword mesh: tapered blade, crossguard, grip,
 * and pommel, as two material groups (metal parts, then the grip) on a
 * single `THREE.BufferGeometry` — `mergeGeometries(..., true)` adds a
 * geometry group per input so a `[metal, grip]` materials array renders
 * correctly.
 */
export interface SwordMeshOptions {
  crossguardLength?: number;
  bluntTip?: boolean;
}

export function createSwordMesh(options: SwordMeshOptions = {}): THREE.Mesh {
  // Pommel: a small sphere cap at the very end of the grip.
  const pommel = new THREE.SphereGeometry(POMMEL_RADIUS, 8, 6);
  pommel.translate(0, -GRIP_LENGTH / 2 - POMMEL_RADIUS * 0.5, 0);

  // Crossguard: a short, wide, flattened box perpendicular to the blade,
  // sitting right above the grip.
  const crossguard = new THREE.BoxGeometry(options.crossguardLength ?? CROSSGUARD_LENGTH, CROSSGUARD_HEIGHT, CROSSGUARD_DEPTH);
  const crossguardY = GRIP_LENGTH / 2 + CROSSGUARD_HEIGHT / 2;
  crossguard.translate(0, crossguardY, 0);

  // Keep the blade parallel-sided through most of its length, then taper
  // only near the end. This reads as a sword rather than an oversized
  // triangular dagger, particularly at inventory-icon scale.
  const bladeBaseY = crossguardY + CROSSGUARD_HEIGHT / 2;
  const bladeBody = new THREE.BoxGeometry(BLADE_WIDTH_BASE * 2, BLADE_BODY_LENGTH, BLADE_WIDTH_BASE * 2 * BLADE_FLATTEN);
  bladeBody.translate(0, bladeBaseY + BLADE_BODY_LENGTH / 2, 0);

  // Wooden practice swords terminate in a broad flat end. Steel blades use
  // the same low-poly four-sided transition but close to a proper point.
  const endWidth = options.bluntTip ? BLADE_WIDTH_BASE * .62 : BLADE_WIDTH_TIP;
  const bladeTip = new THREE.CylinderGeometry(endWidth, BLADE_WIDTH_BASE, BLADE_TIP_LENGTH, 4);
  bladeTip.scale(1, 1, BLADE_FLATTEN);
  bladeTip.translate(0, bladeBaseY + BLADE_BODY_LENGTH + BLADE_TIP_LENGTH / 2, 0);

  const metalGeo = mergeGeometries([pommel, crossguard, bladeBody, bladeTip], false);
  if (!metalGeo) throw new Error("sword: failed to merge metal-part geometries");

  // Grip: a plain cylinder, hand-width, spanning [-GRIP_LENGTH/2, GRIP_LENGTH/2]
  // — i.e. centered exactly on the mesh's origin.
  const grip = new THREE.CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, GRIP_LENGTH, 8);

  // useGroups=true assigns geometry group 0 -> metalGeo, group 1 -> grip, so
  // materialIndex lines up with a [metalMaterial, gripMaterial] array below.
  const merged = mergeGeometries([metalGeo, grip], true);
  if (!merged) throw new Error("sword: failed to merge sword geometry");

  // Reorient from the authored "grip at bottom, tip at +Y" pose into the
  // finished mesh's "long axis Z, tip at +Z" convention (see header
  // comment) — a single bake here means neither call site has to think
  // about it.
  merged.rotateX(Math.PI / 2);
  merged.computeVertexNormals();

  const mesh = new THREE.Mesh(merged, [metalMaterial(), gripMaterial()]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const sword: ItemAssetDef = {
  id: "sword",
  name: "Sword",
  icon: "🗡️",
  slot: "hand",
  meleeDamage: 15,
  mass: 3, // a real blade has heft — it thuds down rather than skittering
  createWorldMesh: () => createSwordMesh(),
  createViewmodelMesh: () => {
    const mesh = createSwordMesh();
    mesh.scale.setScalar(VIEWMODEL_SCALE);
    return mesh;
  },
};

export default sword;
