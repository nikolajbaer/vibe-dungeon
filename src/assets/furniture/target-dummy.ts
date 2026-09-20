import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";
import { woodMaterial } from "./table";

// Melee-training target dummy (issue: training wing) — a wood post driven
// into a round base, a straw-wrapped torso, a crossbar for arms, and a
// round head, roughly humanoid in silhouette without needing a real rig.
// Purely decorative: no health, no hit reactions, no combat mechanic of its
// own (this project's only actual combat target is a real `NPC` entity —
// see `ecs/systems/combat.ts`) -- a player can still swing at it like any
// other prop, it just never registers a hit or reacts, exactly like every
// other static furniture piece here. Static (no `dynamic`), since a wooden
// post driven into the ground shouldn't budge when brushed past, unlike a
// barrel or crate.
//
// Builds centered on its post at local (0,0), roughly 1.8m tall (player eye
// height) so it reads at human scale from across a small room.

const BASE_RADIUS = 0.35;
const BASE_HEIGHT = 0.08;
const POST_RADIUS = 0.06;
const POST_HEIGHT = 1.5;
const TORSO_RADIUS = 0.16;
const TORSO_HEIGHT = 0.75;
const TORSO_BASE_Y = 0.55;
const ARM_LENGTH = 0.7;
const ARM_RADIUS = 0.045;
const ARM_Y = TORSO_BASE_Y + TORSO_HEIGHT - 0.15;
const HEAD_RADIUS = 0.14;

let strawMat: THREE.MeshStandardMaterial | undefined;
function strawMaterial(): THREE.MeshStandardMaterial {
  return (strawMat ??= new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.95, metalness: 0 }));
}

let sackMat: THREE.MeshStandardMaterial | undefined;
function sackMaterial(): THREE.MeshStandardMaterial {
  return (sackMat ??= new THREE.MeshStandardMaterial({ color: 0xb8a578, roughness: 0.9, metalness: 0 }));
}

/** A round base, a driven post, a straw torso, a crossbar for arms, and a
 * sack-cloth head -- a rough humanoid silhouette built entirely from
 * cylinders/spheres. */
function createTargetDummyMesh(): THREE.Group {
  const group = new THREE.Group();
  group.userData.surfaceMaterial = "wood";
  const wood = woodMaterial();

  const base = new THREE.Mesh(new THREE.CylinderGeometry(BASE_RADIUS, BASE_RADIUS * 1.05, BASE_HEIGHT, 16), wood);
  base.position.y = BASE_HEIGHT / 2;
  group.add(base);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS * 1.2, POST_HEIGHT, 10), wood);
  post.position.y = BASE_HEIGHT + POST_HEIGHT / 2;
  group.add(post);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_RADIUS * 0.85, TORSO_RADIUS, TORSO_HEIGHT, 12), strawMaterial());
  torso.position.y = TORSO_BASE_Y + TORSO_HEIGHT / 2;
  group.add(torso);

  const arms = new THREE.Mesh(new THREE.CylinderGeometry(ARM_RADIUS, ARM_RADIUS, ARM_LENGTH, 8), wood);
  arms.rotation.z = Math.PI / 2;
  arms.position.y = ARM_Y;
  group.add(arms);

  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 12, 10), sackMaterial());
  head.position.y = TORSO_BASE_Y + TORSO_HEIGHT + HEAD_RADIUS * 0.8;
  group.add(head);

  return group;
}

const targetDummy: FurnitureAssetDef = {
  id: "target-dummy",
  createMesh: () => createTargetDummyMesh(),
  footprint: { hx: TORSO_RADIUS, hz: TORSO_RADIUS, hy: (BASE_HEIGHT + POST_HEIGHT) / 2 },
};

export default targetDummy;
