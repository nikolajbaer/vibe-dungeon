import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Standing candelabra (issue #70) — a weighted base, a slim pole, and a
// small tray of candles up top. Deliberately distinct from the wall-mounted
// torches in tileBuilder.ts's `addTorch` — no bracket arm, no
// `THREE.PointLight` (a torch's whole point is casting real shadows off a
// wall it's flush against; a candelabra just needs to read as "lit" via its
// emissive candle tips, with the room's own torches supplying the actual
// light). A real floor obstacle, so it declares a `footprint` sized to its
// widest point (the candle tray), the same "collider matches the widest
// silhouette" reasoning as the barrel's bulge.

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
function createCandelabraMesh(): THREE.Group {
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

const candelabra: FurnitureAssetDef = {
  id: "candelabra",
  createMesh: () => createCandelabraMesh(),
  footprint: { hx: CANDELABRA_TRAY_RADIUS, hz: CANDELABRA_TRAY_RADIUS },
};

export default candelabra;
