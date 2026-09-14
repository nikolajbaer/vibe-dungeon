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

// --- Wall banner / tapestry (issue #70) -------------------------------------
// A hanging rod + cloth panel with one contrasting stripe, for a simple
// heraldic look. Purely decorative: thin, flush to a wall, and — per the
// issue — nothing a player could meaningfully collide with, so (unlike
// every prop above) it gets no `*_FOOTPRINT`/collider. Builds facing local
// +z by default; `decorations.ts` rotates the group to match whichever wall
// it ends up mounted on, the same way it rotates `createChair` to face a
// table instead of this module hardcoding a direction per wall.

const BANNER_WIDTH = 1.0;
const BANNER_HEIGHT = 1.8;
const BANNER_THICKNESS = 0.035;
const BANNER_BOTTOM_Y = 1.55; // bottom edge height above the floor
const BANNER_ROD_RADIUS = 0.03;
const BANNER_ROD_OVERHANG = 0.12; // how far the rod poke out past the cloth on each side
const BANNER_STRIPE_HEIGHT = 0.32;

let bannerRodMat: THREE.MeshStandardMaterial | undefined;
function bannerRodMaterial(): THREE.MeshStandardMaterial {
  return (bannerRodMat ??= new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.6, metalness: 0.35 }));
}

/**
 * A hanging wall banner: a horizontal mounting rod plus a cloth panel below
 * it, with one contrasting stripe near the top. `primaryColor`/
 * `accentColor` let callers vary the look between placements (e.g. giving
 * room-a and room-b their own palette) without a second factory function.
 */
export function createBanner(primaryColor: number = 0x7a1f1f, accentColor: number = 0xc9a227): THREE.Group {
  const group = new THREE.Group();

  const rodLength = BANNER_WIDTH + BANNER_ROD_OVERHANG * 2;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(BANNER_ROD_RADIUS, BANNER_ROD_RADIUS, rodLength, 8), bannerRodMaterial());
  rod.rotation.z = Math.PI / 2; // lay the cylinder on its side, spanning local X
  rod.position.y = BANNER_BOTTOM_Y + BANNER_HEIGHT + BANNER_ROD_RADIUS;
  group.add(rod);

  const clothMat = new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.9, metalness: 0 });
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(BANNER_WIDTH, BANNER_HEIGHT, BANNER_THICKNESS), clothMat);
  cloth.position.y = BANNER_BOTTOM_Y + BANNER_HEIGHT / 2;
  group.add(cloth);

  // A slightly-proud stripe (a hair thicker than the cloth) near the top so
  // it doesn't z-fight with the panel behind it.
  const stripeMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.85, metalness: 0 });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(BANNER_WIDTH, BANNER_STRIPE_HEIGHT, BANNER_THICKNESS + 0.006), stripeMat);
  stripe.position.y = BANNER_BOTTOM_Y + BANNER_HEIGHT - BANNER_STRIPE_HEIGHT * 1.4;
  group.add(stripe);

  return group;
}

// --- Standing candelabra (issue #70) ----------------------------------------
// A floor-standing candle stand: a weighted base, a slim pole, and a small
// tray of candles up top. Deliberately distinct from the wall-mounted
// torches in tileBuilder.ts's `addTorch` — no bracket arm, no `PointLight`
// (a torch's whole point is casting real shadows off a wall it's flush
// against; a candelabra just needs to read as "lit" via its emissive candle
// tips, with the room's own torches supplying the actual light — see
// tileBuilder.ts's `TORCHES_PER_ROOM`, which every room-sized tile already
// gets regardless of what decorations.ts places). A real floor obstacle, so
// it exports a `*_FOOTPRINT` sized to its widest point (the candle tray),
// the same "collider matches the widest silhouette" reasoning as the
// barrel's bulge above — not just the slim pole a naive footprint might use.

const CANDELABRA_POLE_HEIGHT = 1.0;
const CANDELABRA_POLE_RADIUS = 0.035;
const CANDELABRA_BASE_RADIUS = 0.22;
const CANDELABRA_BASE_HEIGHT = 0.05;
const CANDELABRA_TRAY_RADIUS = 0.26;
const CANDELABRA_TRAY_HEIGHT = 0.04;
const CANDELABRA_CANDLE_RADIUS = 0.02;
const CANDELABRA_CANDLE_HEIGHT = 0.16;
const CANDELABRA_FLAME_RADIUS = 0.03;
const CANDELABRA_FLAME_HEIGHT = 0.08;
const CANDELABRA_CANDLE_COUNT = 3;
const CANDELABRA_CANDLE_ORBIT = 0.15; // how far each candle sits from the pole's center

let candelabraMetalMat: THREE.MeshStandardMaterial | undefined;
function candelabraMetalMaterial(): THREE.MeshStandardMaterial {
  return (candelabraMetalMat ??= new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.45, metalness: 0.75 }));
}

let candleWaxMat: THREE.MeshStandardMaterial | undefined;
function candleWaxMaterial(): THREE.MeshStandardMaterial {
  return (candleWaxMat ??= new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7, metalness: 0 }));
}

let candleFlameMat: THREE.MeshStandardMaterial | undefined;
function candleFlameMaterial(): THREE.MeshStandardMaterial {
  return (candleFlameMat ??= new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xff8a1a,
    emissiveIntensity: 2,
    roughness: 0.4,
  }));
}

/** A wrought-iron floor candelabra: a weighted base, a slim pole, and a
 * tray of a few candles (with small emissive flame tips) up top. */
export function createCandelabra(): THREE.Group {
  const group = new THREE.Group();
  const metal = candelabraMetalMaterial();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(CANDELABRA_BASE_RADIUS, CANDELABRA_BASE_RADIUS * 1.15, CANDELABRA_BASE_HEIGHT, 16),
    metal,
  );
  base.position.y = CANDELABRA_BASE_HEIGHT / 2;
  group.add(base);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(CANDELABRA_POLE_RADIUS, CANDELABRA_POLE_RADIUS * 1.4, CANDELABRA_POLE_HEIGHT, 10),
    metal,
  );
  pole.position.y = CANDELABRA_BASE_HEIGHT + CANDELABRA_POLE_HEIGHT / 2;
  group.add(pole);

  const trayY = CANDELABRA_BASE_HEIGHT + CANDELABRA_POLE_HEIGHT;
  const tray = new THREE.Mesh(
    new THREE.CylinderGeometry(CANDELABRA_TRAY_RADIUS, CANDELABRA_TRAY_RADIUS * 0.85, CANDELABRA_TRAY_HEIGHT, 16),
    metal,
  );
  tray.position.y = trayY + CANDELABRA_TRAY_HEIGHT / 2;
  group.add(tray);

  const candleBaseY = trayY + CANDELABRA_TRAY_HEIGHT;
  for (let i = 0; i < CANDELABRA_CANDLE_COUNT; i++) {
    const angle = (i / CANDELABRA_CANDLE_COUNT) * Math.PI * 2;
    const cx = Math.cos(angle) * CANDELABRA_CANDLE_ORBIT;
    const cz = Math.sin(angle) * CANDELABRA_CANDLE_ORBIT;

    const candle = new THREE.Mesh(
      new THREE.CylinderGeometry(CANDELABRA_CANDLE_RADIUS, CANDELABRA_CANDLE_RADIUS, CANDELABRA_CANDLE_HEIGHT, 8),
      candleWaxMaterial(),
    );
    candle.position.set(cx, candleBaseY + CANDELABRA_CANDLE_HEIGHT / 2, cz);
    group.add(candle);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(CANDELABRA_FLAME_RADIUS, CANDELABRA_FLAME_HEIGHT, 6), candleFlameMaterial());
    flame.position.set(cx, candleBaseY + CANDELABRA_CANDLE_HEIGHT + CANDELABRA_FLAME_HEIGHT / 2, cz);
    group.add(flame);
  }

  return group;
}

/** Rough footprint half-extents (meters), for callers building the matching
 * `Collider` — kept alongside the factories so the collision box and the
 * visual geometry can't drift apart. */
export const TABLE_FOOTPRINT = { hx: TABLE_WIDTH / 2, hz: TABLE_DEPTH / 2 };
export const CHAIR_FOOTPRINT = { hx: CHAIR_SEAT_SIZE / 2, hz: CHAIR_SEAT_SIZE / 2 };
export const BARREL_FOOTPRINT = { hx: BARREL_RADIUS_BULGE, hz: BARREL_RADIUS_BULGE };
export const CANDELABRA_FOOTPRINT = { hx: CANDELABRA_TRAY_RADIUS, hz: CANDELABRA_TRAY_RADIUS };
// No `BANNER_FOOTPRINT` — see the createBanner doc comment above.
