import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Decorative "grand entrance doors" (great-hall wing task) — a pair of
// oversized, iron-studded double doors mounted flush against a solid wall,
// for the castle great hall's presumed main entrance. Deliberately *not* a
// real interactive `Door` (see `ecs/components.ts`) built through the tile
// system's own door faces (`tiles.ts`'s `FaceKind`/`tileBuilder.ts`'s
// `addDoorPair`): nothing is built beyond that wall today (there's no
// "outside the castle" yet), and `validateOccupancy` rejects any real
// `"door"`/`"opening"` face with nothing on the other side of it — so this
// is architecturally the only way to depict "a huge entrance, always shut"
// without actually making it openable. See `tileTypes/castle_hall.ts`'s own
// doc comment for the fuller reasoning.
//
// Purely decorative — no footprint (the wall behind it already blocks
// movement; a second collider here would be redundant, same reasoning
// banner.ts/poster.ts give for their own lack of one). Builds facing local
// +z (the doors face whoever's looking at them from inside the room); a
// placement's `rotation` points that face into whichever room it's mounted
// in, same convention as every other wall-mounted asset here.
//
// Unlike fireplace.ts/candelabra.ts, this one *does* carry a real
// `THREE.PointLight` (the same warm color/falloff shape as tileBuilder.ts's
// own wall torches) — a deliberate, narrow exception to "rely on the room's
// automatic torches for real light": this asset is a one-of-a-kind set
// piece (there's exactly one castle entrance), used at the far end of a
// room several times `great_hall`'s size with only `TORCHES_PER_ROOM` (2)
// automatic torches to light all of it — confirmed, by an actual Playwright
// screenshot, to leave this end of the hall essentially unlit otherwise (a
// solid black silhouette). A second light source per ordinary decor asset
// would add up across every room it's placed in; one light on an asset
// that's only ever placed once costs nothing by comparison, and without it
// the hall's own showpiece entrance would be invisible.

const LEAF_WIDTH = 1.3;
const LEAF_HEIGHT = 3.2;
const LEAF_THICKNESS = 0.14;
const LEAF_GAP = 0.03; // hairline seam between the two leaves
const FRAME_THICKNESS = 0.22;
const STUD_RADIUS = 0.04;
const STUD_ROWS = 5;
const STUD_COLS = 2;
const HANDLE_RADIUS = 0.05;

let woodMat: THREE.MeshStandardMaterial | undefined;
function doorWoodMaterial(): THREE.MeshStandardMaterial {
  return (woodMat ??= new THREE.MeshStandardMaterial({ color: 0x3a2b1e, roughness: 0.85, metalness: 0.05 }));
}

let ironMat: THREE.MeshStandardMaterial | undefined;
function ironMaterial(): THREE.MeshStandardMaterial {
  return (ironMat ??= new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.55, metalness: 0.6 }));
}

let stoneMat: THREE.MeshStandardMaterial | undefined;
function frameStoneMaterial(): THREE.MeshStandardMaterial {
  return (stoneMat ??= new THREE.MeshStandardMaterial({ color: 0x726e64, roughness: 0.88, metalness: 0.05 }));
}

// Matches tileBuilder.ts's own TORCH_LIGHT_COLOR/_RANGE exactly, for the
// same warm pool of light — a slightly lower intensity (this is one
// supplemental light on an already-lit set piece, not a room's primary
// light source) and a bit of extra range, since it has a whole grand
// entrance's width to actually cover rather than one wall bracket's
// immediate surroundings.
const DOOR_LIGHT_COLOR = 0xffaa55;
const DOOR_LIGHT_INTENSITY = 1.5;
const DOOR_LIGHT_RANGE = 9;

function buildLeaf(sign: -1 | 1): THREE.Group {
  const leaf = new THREE.Group();
  const wood = doorWoodMaterial();
  const iron = ironMaterial();

  const panel = new THREE.Mesh(new THREE.BoxGeometry(LEAF_WIDTH, LEAF_HEIGHT, LEAF_THICKNESS), wood);
  panel.position.set(sign * (LEAF_GAP / 2 + LEAF_WIDTH / 2), LEAF_HEIGHT / 2, 0);
  leaf.add(panel);

  // Studs/handle/straps all sit on the local +z side of the panel -- the
  // room-facing side once a placement's default rotation (0) leaves this
  // asset's "faces local +z" convention untouched (see header comment).
  const studGeo = new THREE.SphereGeometry(STUD_RADIUS, 8, 6);
  const leafX = sign * (LEAF_GAP / 2 + LEAF_WIDTH / 2);
  for (let r = 0; r < STUD_ROWS; r++) {
    for (let c = 0; c < STUD_COLS; c++) {
      const stud = new THREE.Mesh(studGeo, iron);
      const px = leafX + (c - (STUD_COLS - 1) / 2) * (LEAF_WIDTH * 0.55);
      const py = (r + 0.5) * (LEAF_HEIGHT / STUD_ROWS);
      stud.position.set(px, py, LEAF_THICKNESS / 2 + STUD_RADIUS * 0.5);
      leaf.add(stud);
    }
  }

  // Ring handle on the seam side of each leaf, roughly hand height.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(HANDLE_RADIUS, HANDLE_RADIUS * 0.25, 6, 12), iron);
  handle.position.set(sign * LEAF_GAP, 1.1, LEAF_THICKNESS / 2 + HANDLE_RADIUS * 0.5);
  leaf.add(handle);

  const strapGeo = new THREE.BoxGeometry(LEAF_WIDTH * 0.85, 0.08, LEAF_THICKNESS + 0.02);
  for (const y of [LEAF_HEIGHT * 0.25, LEAF_HEIGHT * 0.75]) {
    const strap = new THREE.Mesh(strapGeo, iron);
    strap.position.set(leafX, y, 0.005);
    leaf.add(strap);
  }

  return leaf;
}

/** A pair of oversized iron-bound wooden door leaves set into a stone
 * frame, meeting at a hairline seam down the middle — see header comment
 * for why this is a decoration, not a real openable door. */
function createGrandDoorsMesh(): THREE.Group {
  const group = new THREE.Group();
  const totalWidth = LEAF_WIDTH * 2 + LEAF_GAP;

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(totalWidth + FRAME_THICKNESS * 2, LEAF_HEIGHT + FRAME_THICKNESS, FRAME_THICKNESS),
    frameStoneMaterial(),
  );
  frame.position.set(0, (LEAF_HEIGHT + FRAME_THICKNESS) / 2, -FRAME_THICKNESS / 2 - 0.02);
  group.add(frame);

  group.add(buildLeaf(-1));
  group.add(buildLeaf(1));

  // See header comment for why this asset gets a real light where most
  // decor here doesn't -- positioned out in front of the doors, roughly
  // torch height, so it actually lights the doors themselves rather than
  // sitting inside them.
  const light = new THREE.PointLight(DOOR_LIGHT_COLOR, DOOR_LIGHT_INTENSITY, DOOR_LIGHT_RANGE, 2);
  light.position.set(0, LEAF_HEIGHT * 0.6, 1.4);
  light.castShadow = true;
  light.shadow.mapSize.set(256, 256);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = DOOR_LIGHT_RANGE;
  light.shadow.bias = -0.002;
  group.add(light);

  return group;
}

const grandDoors: FurnitureAssetDef = {
  id: "grand-doors",
  createMesh: () => createGrandDoorsMesh(),
  // No footprint — see header comment.
};

export default grandDoors;
