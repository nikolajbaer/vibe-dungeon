import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// The castle great hall's throne (great-hall wing task) — a raised dais, a
// high-backed seat with armrests, and a simple carved crest along the top of
// the backrest. Static (no `dynamic`, unlike table.ts): a throne should read
// as fixed architecture, not furniture a player could shove around. Builds
// facing local +z (the seat faces whoever's looking at it, same as
// fireplace.ts's hearth); a placement's `rotation` points it into the room
// from whichever wall it backs onto — see rooms/castle-hall.ts for its own
// far-wall placement.
//
// Carries a real `THREE.PointLight`, the same deliberate exception (and for
// the same confirmed-by-screenshot reason) grand-doors.ts's own header
// comment explains: a one-of-a-kind set piece, at the far end of a room
// with only `TORCHES_PER_ROOM` automatic torches to cover several times
// `great_hall`'s floor area, otherwise rendering as a solid black
// silhouette rather than the "far side" focal point the room is built
// around.

const DAIS_WIDTH = 2.0;
const DAIS_DEPTH = 1.6;
const DAIS_HEIGHT = 0.22;
const SEAT_WIDTH = 0.75;
const SEAT_DEPTH = 0.65;
const SEAT_HEIGHT = 0.5; // above the dais
const BACK_HEIGHT = 1.6; // above the seat
const BACK_THICKNESS = 0.1;
const ARM_HEIGHT = 0.28; // above the seat
const ARM_THICKNESS = 0.09;
const CREST_WIDTH = 0.5;
const CREST_HEIGHT = 0.35;

let stoneMat: THREE.MeshStandardMaterial | undefined;
function daisMaterial(): THREE.MeshStandardMaterial {
  return (stoneMat ??= new THREE.MeshStandardMaterial({ color: 0x827c6e, roughness: 0.85, metalness: 0.05 }));
}

let woodMat: THREE.MeshStandardMaterial | undefined;
function throneWoodMaterial(): THREE.MeshStandardMaterial {
  return (woodMat ??= new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.7, metalness: 0.1 }));
}

let goldMat: THREE.MeshStandardMaterial | undefined;
function goldTrimMaterial(): THREE.MeshStandardMaterial {
  return (goldMat ??= new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.4, metalness: 0.75 }));
}

// Matches tileBuilder.ts's own TORCH_LIGHT_COLOR/_RANGE — see header
// comment for why this asset gets a real light at all.
const THRONE_LIGHT_COLOR = 0xffaa55;
const THRONE_LIGHT_INTENSITY = 1.6;
const THRONE_LIGHT_RANGE = 8;

/** A low stone dais, a high-backed wooden seat with armrests standing on
 * it, and a gold crest ornament along the top of the backrest. */
function createThroneMesh(): THREE.Group {
  const group = new THREE.Group();
  const wood = throneWoodMaterial();

  const dais = new THREE.Mesh(new THREE.BoxGeometry(DAIS_WIDTH, DAIS_HEIGHT, DAIS_DEPTH), daisMaterial());
  dais.position.set(0, DAIS_HEIGHT / 2, 0);
  group.add(dais);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(SEAT_WIDTH, SEAT_HEIGHT, SEAT_DEPTH), wood);
  seat.position.set(0, DAIS_HEIGHT + SEAT_HEIGHT / 2, 0);
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(SEAT_WIDTH, BACK_HEIGHT, BACK_THICKNESS), wood);
  back.position.set(0, DAIS_HEIGHT + SEAT_HEIGHT + BACK_HEIGHT / 2, -SEAT_DEPTH / 2 + BACK_THICKNESS / 2);
  group.add(back);

  const armGeo = new THREE.BoxGeometry(ARM_THICKNESS, ARM_HEIGHT, SEAT_DEPTH * 0.8);
  for (const sign of [-1, 1] as const) {
    const arm = new THREE.Mesh(armGeo, wood);
    arm.position.set(sign * (SEAT_WIDTH / 2 - ARM_THICKNESS / 2), DAIS_HEIGHT + SEAT_HEIGHT + ARM_HEIGHT / 2, -SEAT_DEPTH * 0.1);
    group.add(arm);

    const leg = new THREE.Mesh(new THREE.BoxGeometry(ARM_THICKNESS, DAIS_HEIGHT + SEAT_HEIGHT, ARM_THICKNESS), wood);
    leg.position.set(sign * (SEAT_WIDTH / 2 - ARM_THICKNESS / 2), (DAIS_HEIGHT + SEAT_HEIGHT) / 2, SEAT_DEPTH / 2 - ARM_THICKNESS / 2);
    group.add(leg);
  }

  const crest = new THREE.Mesh(new THREE.ConeGeometry(CREST_WIDTH / 2, CREST_HEIGHT, 3), goldTrimMaterial());
  crest.rotation.z = Math.PI;
  crest.position.set(0, DAIS_HEIGHT + SEAT_HEIGHT + BACK_HEIGHT + CREST_HEIGHT / 2 - 0.05, -SEAT_DEPTH / 2 + BACK_THICKNESS / 2);
  group.add(crest);

  // See header comment for why this asset gets a real light -- positioned
  // out in front of the seat, roughly crest height, so it lights the whole
  // throne rather than sitting inside the backrest.
  const light = new THREE.PointLight(THRONE_LIGHT_COLOR, THRONE_LIGHT_INTENSITY, THRONE_LIGHT_RANGE, 2);
  light.position.set(0, DAIS_HEIGHT + SEAT_HEIGHT + BACK_HEIGHT * 0.7, 1.2);
  light.castShadow = true;
  light.shadow.mapSize.set(256, 256);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = THRONE_LIGHT_RANGE;
  light.shadow.bias = -0.002;
  group.add(light);

  return group;
}

const throne: FurnitureAssetDef = {
  id: "throne",
  createMesh: () => createThroneMesh(),
  footprint: { hx: DAIS_WIDTH / 2, hz: DAIS_DEPTH / 2, hy: (DAIS_HEIGHT + SEAT_HEIGHT + BACK_HEIGHT) / 2 },
};

export default throne;
