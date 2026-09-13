import * as THREE from "three";

// Placeholder furniture prop factories (issue #40) — simple primitive-composed
// THREE.Groups, flat wood-brown MeshStandardMaterial (no textures/images yet;
// a separate task is building a real wood texture — wiring it in here is a
// natural fast-follow once that lands, see src/level/materials.ts's
// `doorMaterial()` for the equivalent flat-color-for-now pattern used
// elsewhere in the level). Kept proportioned to real-world scale (meters)
// since the player is a real-scale first-person character in a 3m-unit world.
//
// Each factory returns a group whose origin sits at floor level (y = 0) with
// every child mesh offset upward from there, so callers can position the
// group directly at a floor (x, 0, z) point — the same convention
// tileBuilder.ts uses for wall/door meshes. Placement + collision entities
// live in src/level/decorations.ts, not here; this module only builds visual
// geometry.

let woodMat: THREE.MeshStandardMaterial | undefined;

/** Shared flat wood-brown material for every prop, cached like the
 * materials in src/level/materials.ts (one instance reused across meshes
 * rather than allocated per-call). */
function woodMaterial(): THREE.MeshStandardMaterial {
  return (woodMat ??= new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85, metalness: 0 }));
}

const TABLE_HEIGHT = 0.75; // top surface height — "waist-height" per the issue
const TABLE_TOP_THICKNESS = 0.06;
const TABLE_WIDTH = 1.2;
const TABLE_DEPTH = 0.8;
const TABLE_LEG_SIZE = 0.07;
const TABLE_LEG_INSET = 0.09; // legs pulled in this far from each edge

/** A flat box top on four thin box legs, roughly waist-height (0.75m). */
export function createTable(): THREE.Group {
  const group = new THREE.Group();
  const mat = woodMaterial();

  const legHeight = TABLE_HEIGHT - TABLE_TOP_THICKNESS;
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE_WIDTH, TABLE_TOP_THICKNESS, TABLE_DEPTH), mat);
  top.position.y = legHeight + TABLE_TOP_THICKNESS / 2;
  group.add(top);

  const legX = TABLE_WIDTH / 2 - TABLE_LEG_INSET;
  const legZ = TABLE_DEPTH / 2 - TABLE_LEG_INSET;
  const legGeo = new THREE.BoxGeometry(TABLE_LEG_SIZE, legHeight, TABLE_LEG_SIZE);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(sx * legX, legHeight / 2, sz * legZ);
      group.add(leg);
    }
  }

  return group;
}

const CHAIR_SEAT_HEIGHT = 0.45;
const CHAIR_SEAT_SIZE = 0.42;
const CHAIR_SEAT_THICKNESS = 0.05;
const CHAIR_BACK_HEIGHT = 0.45;
const CHAIR_LEG_SIZE = 0.05;

/** A small box seat + back + thin legs. Faces local +z (i.e. the back is on
 * the -z side) so callers can rotate the group around Y to face it toward a
 * table. */
export function createChair(): THREE.Group {
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

const BARREL_HEIGHT = 0.85;
const BARREL_RADIUS_CAP = 0.28; // top/bottom radius
const BARREL_RADIUS_BULGE = 0.34; // middle bulge radius
const BARREL_CAP_HEIGHT = 0.15;

/**
 * A cylinder with a slight barrel-bulge — three stacked cylinders (narrower
 * top/bottom caps, a wider middle section) rather than a single plain
 * cylinder, per the issue's nice-to-have.
 */
export function createBarrel(): THREE.Group {
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

/** Rough footprint half-extents (meters), for callers building the matching
 * `Collider` — kept alongside the factories so the collision box and the
 * visual geometry can't drift apart. */
export const TABLE_FOOTPRINT = { hx: TABLE_WIDTH / 2, hz: TABLE_DEPTH / 2 };
export const CHAIR_FOOTPRINT = { hx: CHAIR_SEAT_SIZE / 2, hz: CHAIR_SEAT_SIZE / 2 };
export const BARREL_FOOTPRINT = { hx: BARREL_RADIUS_BULGE, hz: BARREL_RADIUS_BULGE };
