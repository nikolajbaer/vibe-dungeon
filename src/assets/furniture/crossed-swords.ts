import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Wall-mounted "crossed swords and shield" trophy decoration (issue:
// great-room / training-wing decor) — two crude sword shapes crossed behind
// a round shield, all flattened low-poly boxes/cones rather than reusing
// items/sword.ts's real pickup mesh (that one's built standing upright with
// a hand-grip origin for viewmodel/world-pickup use; this is a fixed
// silhouette meant to hang flat, closer in spirit to banner.ts's "thin,
// flush to a wall" decor). Purely decorative, no footprint, same as
// banner.ts/poster.ts — nothing to walk into on a wall-mounted piece.
//
// Builds facing local +z (the shield/blades face out into the room); a
// placement's `rotation` points it at whichever wall it's mounted on, same
// convention as every other wall fixture here.

const BLADE_LENGTH = 0.75;
const BLADE_WIDTH = 0.09;
const BLADE_THICKNESS = 0.02;
const HILT_LENGTH = 0.16;
const HILT_RADIUS = 0.025;
const CROSSGUARD_LENGTH = 0.2;
const SHIELD_RADIUS = 0.32;
const SHIELD_THICKNESS = 0.05;
const MOUNT_Y = 1.9; // center height above the floor

let bladeMat: THREE.MeshStandardMaterial | undefined;
function bladeMaterial(): THREE.MeshStandardMaterial {
  return (bladeMat ??= new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.5, roughness: 0.35 }));
}

let hiltMat: THREE.MeshStandardMaterial | undefined;
function hiltMaterial(): THREE.MeshStandardMaterial {
  return (hiltMat ??= new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.85, metalness: 0 }));
}

let shieldMat: THREE.MeshStandardMaterial | undefined;
function shieldMaterial(): THREE.MeshStandardMaterial {
  return (shieldMat ??= new THREE.MeshStandardMaterial({ color: 0x6b1f1f, roughness: 0.7, metalness: 0.2 }));
}

let shieldBossMat: THREE.MeshStandardMaterial | undefined;
function shieldBossMaterial(): THREE.MeshStandardMaterial {
  return (shieldBossMat ??= new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.4, metalness: 0.7 }));
}

/** One flat blade + crossguard + hilt, lying in the XY plane (mount is
 * along local Z's thin axis), tilted by `tiltRadians` so a pair crosses in
 * an X shape once mirrored. */
function buildSword(tiltRadians: number): THREE.Group {
  const group = new THREE.Group();

  const blade = new THREE.Mesh(new THREE.BoxGeometry(BLADE_WIDTH, BLADE_LENGTH, BLADE_THICKNESS), bladeMaterial());
  blade.position.y = BLADE_LENGTH / 2;
  group.add(blade);

  const crossguard = new THREE.Mesh(new THREE.BoxGeometry(CROSSGUARD_LENGTH, BLADE_WIDTH * 0.6, BLADE_THICKNESS * 1.5), hiltMaterial());
  group.add(crossguard);

  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(HILT_RADIUS, HILT_RADIUS, HILT_LENGTH, 8), hiltMaterial());
  hilt.rotation.z = Math.PI / 2;
  hilt.position.y = -HILT_LENGTH / 2;
  group.add(hilt);

  group.rotation.z = tiltRadians;
  return group;
}

/** Two swords crossed in an X behind a round shield with a raised boss,
 * meant to hang flat on a wall like a trophy display. */
function createCrossedSwordsMesh(): THREE.Group {
  const group = new THREE.Group();

  // Every child gets `MOUNT_Y` baked into its own position rather than
  // setting it once on the returned group's own position -- the generic
  // placer (`spawnProps`, level/spawning.ts) calls `mesh.position.set(x,y,z)`
  // on whatever `createMesh` returns, which would overwrite (not add to) a
  // Y set here on the top-level group. Every other furniture asset that
  // mounts above floor level (banner.ts, poster.ts, candelabra's tray) does
  // it the same way, for the same reason.
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(SHIELD_RADIUS, SHIELD_RADIUS, SHIELD_THICKNESS, 20), shieldMaterial());
  shield.rotation.x = Math.PI / 2;
  shield.position.y = MOUNT_Y;
  group.add(shield);

  const boss = new THREE.Mesh(new THREE.SphereGeometry(SHIELD_RADIUS * 0.22, 12, 8), shieldBossMaterial());
  boss.position.set(0, MOUNT_Y, SHIELD_THICKNESS / 2 + SHIELD_RADIUS * 0.1);
  group.add(boss);

  const swordA = buildSword(Math.PI / 4);
  swordA.position.set(0, MOUNT_Y, SHIELD_THICKNESS / 2 + BLADE_THICKNESS);
  group.add(swordA);

  const swordB = buildSword(-Math.PI / 4);
  swordB.position.set(0, MOUNT_Y, SHIELD_THICKNESS / 2 + BLADE_THICKNESS * 2);
  group.add(swordB);

  return group;
}

const crossedSwords: FurnitureAssetDef = {
  id: "crossed-swords",
  createMesh: () => createCrossedSwordsMesh(),
  // No footprint -- wall-mounted trophy piece, same as banner.ts/poster.ts.
};

export default crossedSwords;
