import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Supply crate (issue #71's side-chamber clutter) — a simple slatted-look
// box, stackable by its exact `CRATE_HEIGHT` (a placement two crates high
// sets the second one's `PropPlacement.y` to this constant; only the
// bottom-most crate of a stack gets a collider — see level/spawning.ts's
// "a collider is only attached at y=0" rule, which exists for exactly this
// case).

let crateMat: THREE.MeshStandardMaterial | undefined;
function crateMaterial(): THREE.MeshStandardMaterial {
  return (crateMat ??= new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9, metalness: 0 }));
}

const CRATE_SIZE = 0.6;
/** Exported so a placement stacking a second crate on top of a first knows
 * how far to raise it (`PropPlacement.y`) — see this file's header comment. */
export const CRATE_HEIGHT = CRATE_SIZE;

/** A simple slatted-look crate: one box plus thin raised edge strips on its
 * top face (so it doesn't read as a bare cube next to stone walls). */
function createCrateMesh(): THREE.Group {
  const group = new THREE.Group();
  group.userData.surfaceMaterial = "wood";
  const mat = crateMaterial();

  const body = new THREE.Mesh(new THREE.BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE), mat);
  body.position.y = CRATE_SIZE / 2;
  group.add(body);

  const stripThickness = 0.035;
  const stripY = CRATE_SIZE - stripThickness / 2;
  for (const axis of ["x", "z"] as const) {
    for (const sign of [-1, 1]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(
          axis === "x" ? CRATE_SIZE : stripThickness,
          stripThickness,
          axis === "z" ? CRATE_SIZE : stripThickness,
        ),
        mat,
      );
      strip.position.set(axis === "x" ? 0 : sign * (CRATE_SIZE / 2 - stripThickness / 2), stripY, axis === "z" ? 0 : sign * (CRATE_SIZE / 2 - stripThickness / 2));
      group.add(strip);
    }
  }

  return group;
}

const crate: FurnitureAssetDef = {
  id: "crate",
  createMesh: () => createCrateMesh(),
  footprint: { hx: CRATE_SIZE / 2, hz: CRATE_SIZE / 2 },
  // Light enough to shove around, and the reason the side-chamber's stacked
  // pair now really is a stack: knock the bottom crate out and the top one
  // drops.
  dynamic: { mass: 14 },
};

export default crate;
