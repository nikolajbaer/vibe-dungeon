import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";
import { woodMaterial } from "./table";

const BARREL_HEIGHT = 0.85;
const BARREL_RADIUS_CAP = 0.28; // top/bottom radius
const BARREL_RADIUS_BULGE = 0.34; // middle bulge radius
const BARREL_CAP_HEIGHT = 0.15;

/**
 * A cylinder with a slight barrel-bulge — three stacked cylinders (narrower
 * top/bottom caps, a wider middle section) rather than a single plain
 * cylinder.
 */
function createBarrelMesh(): THREE.Group {
  const group = new THREE.Group();
  const mat = woodMaterial();

  const bulgeHeight = BARREL_HEIGHT - 2 * BARREL_CAP_HEIGHT;

  const bottom = new THREE.Mesh(
    new THREE.CylinderGeometry(BARREL_RADIUS_BULGE * 0.92, BARREL_RADIUS_CAP, BARREL_CAP_HEIGHT, 16),
    mat,
  );
  bottom.position.y = BARREL_CAP_HEIGHT / 2;
  group.add(bottom);

  const middle = new THREE.Mesh(
    new THREE.CylinderGeometry(BARREL_RADIUS_BULGE, BARREL_RADIUS_BULGE * 0.92, bulgeHeight, 16),
    mat,
  );
  middle.position.y = BARREL_CAP_HEIGHT + bulgeHeight / 2;
  group.add(middle);

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(BARREL_RADIUS_CAP, BARREL_RADIUS_BULGE * 0.92, BARREL_CAP_HEIGHT, 16),
    mat,
  );
  top.position.y = BARREL_CAP_HEIGHT + bulgeHeight + BARREL_CAP_HEIGHT / 2;
  group.add(top);

  return group;
}

const BARREL_CAPACITY = 6;

const barrel: FurnitureAssetDef = {
  id: "barrel",
  createMesh: () => createBarrelMesh(),
  footprint: { hx: BARREL_RADIUS_BULGE, hz: BARREL_RADIUS_BULGE },
  // A full barrel — shovable, but it takes a deliberate push.
  dynamic: { mass: 28 },
  // Doubles as storage: interact to open it and move items in/out.
  container: { capacity: BARREL_CAPACITY },
};

export default barrel;
