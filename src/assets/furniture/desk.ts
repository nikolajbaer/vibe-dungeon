import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";
import { woodMaterial } from "./table";

// A writing desk (great-hall wing task) — table.ts's own box-top-on-legs
// shape, but narrower/deeper with a drawer bank on one side, so it reads as
// a proper desk rather than another dining table. Shares table.ts's wood
// material for visual consistency across the level's furniture. Builds
// facing local +z (someone sitting at it faces +z, the same convention
// chair.ts uses so a placement's `rotation` can seat it toward whichever
// direction makes sense in the room); the drawer bank sits on the local +x
// side.

const DESK_HEIGHT = 0.76;
const DESK_TOP_THICKNESS = 0.05;
const DESK_WIDTH = 1.3;
const DESK_DEPTH = 0.65;
const LEG_SIZE = 0.06;
const LEG_INSET = 0.08;
const DRAWER_WIDTH = 0.4;
const DRAWER_HEIGHT = 0.18;
const DRAWER_GAP = 0.02;
const DRAWER_COUNT = 2;
const KNOB_RADIUS = 0.015;

let ironMat: THREE.MeshStandardMaterial | undefined;
function knobMaterial(): THREE.MeshStandardMaterial {
  return (ironMat ??= new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.5, metalness: 0.6 }));
}

/** A flat top on four legs, plus a stack of drawer fronts (with a small
 * knob each) filling the local +x side down to the floor, standing in for
 * table.ts's leg on that corner. */
function createDeskMesh(): THREE.Group {
  const group = new THREE.Group();
  group.userData.surfaceMaterial = "wood";
  const mat = woodMaterial();

  const legHeight = DESK_HEIGHT - DESK_TOP_THICKNESS;
  const top = new THREE.Mesh(new THREE.BoxGeometry(DESK_WIDTH, DESK_TOP_THICKNESS, DESK_DEPTH), mat);
  top.position.y = legHeight + DESK_TOP_THICKNESS / 2;
  group.add(top);

  const legX = DESK_WIDTH / 2 - LEG_INSET;
  const legZ = DESK_DEPTH / 2 - LEG_INSET;
  const legGeo = new THREE.BoxGeometry(LEG_SIZE, legHeight, LEG_SIZE);
  // Legs on the -x side only -- the +x side is the drawer bank below.
  for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(-legX, legHeight / 2, sz * legZ);
    group.add(leg);
  }

  const drawerFrontWidth = DESK_DEPTH - LEG_INSET * 0.6;
  const drawerBank = new THREE.Mesh(new THREE.BoxGeometry(DRAWER_WIDTH, legHeight, drawerFrontWidth), mat);
  drawerBank.position.set(legX - DRAWER_WIDTH / 2 + LEG_INSET / 2, legHeight / 2, 0);
  group.add(drawerBank);

  const drawerFrontGeo = new THREE.BoxGeometry(DRAWER_WIDTH * 0.9, DRAWER_HEIGHT, 0.015);
  const knobGeo = new THREE.SphereGeometry(KNOB_RADIUS, 6, 6);
  const knobMat = knobMaterial();
  const bankFrontX = legX - DRAWER_WIDTH + LEG_INSET / 2;
  const totalDrawerHeight = DRAWER_COUNT * DRAWER_HEIGHT + (DRAWER_COUNT - 1) * DRAWER_GAP;
  let cursorY = legHeight - (legHeight - totalDrawerHeight) / 2 - DRAWER_HEIGHT / 2;
  for (let i = 0; i < DRAWER_COUNT; i++) {
    const front = new THREE.Mesh(drawerFrontGeo, mat);
    front.position.set(bankFrontX, cursorY, 0);
    group.add(front);
    const knob = new THREE.Mesh(knobGeo, knobMat);
    knob.position.set(bankFrontX - 0.01, cursorY, 0);
    group.add(knob);
    cursorY -= DRAWER_HEIGHT + DRAWER_GAP;
  }

  return group;
}

const desk: FurnitureAssetDef = {
  id: "desk",
  createMesh: () => createDeskMesh(),
  footprint: { hx: DESK_WIDTH / 2, hz: DESK_DEPTH / 2 },
  dynamic: { mass: 40 },
};

export default desk;
