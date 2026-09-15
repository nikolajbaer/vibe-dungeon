import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";
import { woodMaterial } from "./table";

const CHAIR_SEAT_HEIGHT = 0.45;
const CHAIR_SEAT_SIZE = 0.42;
const CHAIR_SEAT_THICKNESS = 0.05;
const CHAIR_BACK_HEIGHT = 0.45;
const CHAIR_LEG_SIZE = 0.05;

/** A small box seat + back + thin legs. Faces local +z (i.e. the back is on
 * the -z side) — the generic placer rotates the group around Y (via
 * `PropPlacement.rotation`) to face it toward a table. */
function createChairMesh(): THREE.Group {
  const group = new THREE.Group();
  const mat = woodMaterial();

  const legHeight = CHAIR_SEAT_HEIGHT - CHAIR_SEAT_THICKNESS;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(CHAIR_SEAT_SIZE, CHAIR_SEAT_THICKNESS, CHAIR_SEAT_SIZE), mat);
  seat.position.y = legHeight + CHAIR_SEAT_THICKNESS / 2;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(CHAIR_SEAT_SIZE, CHAIR_BACK_HEIGHT, CHAIR_SEAT_THICKNESS), mat);
  back.position.set(0, legHeight + CHAIR_SEAT_THICKNESS + CHAIR_BACK_HEIGHT / 2, -CHAIR_SEAT_SIZE / 2 + CHAIR_SEAT_THICKNESS / 2);
  group.add(back);

  const legInset = CHAIR_SEAT_SIZE / 2 - 0.04;
  const legGeo = new THREE.BoxGeometry(CHAIR_LEG_SIZE, legHeight, CHAIR_LEG_SIZE);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(sx * legInset, legHeight / 2, sz * legInset);
      group.add(leg);
    }
  }

  return group;
}

const chair: FurnitureAssetDef = {
  id: "chair",
  createMesh: () => createChairMesh(),
  footprint: { hx: CHAIR_SEAT_SIZE / 2, hz: CHAIR_SEAT_SIZE / 2 },
};

export default chair;
