import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";

// Wall fireplace, for room-a's great hall (issue: great-room decor) — a
// stone surround, a dark hearth recess, and a small stack of "burning" logs
// with emissive glow. Deliberately **no `THREE.PointLight`**, the same
// restraint candelabra.ts's own header comment documents for exactly this
// reason: this project already relies on `tileBuilder.ts`'s wall torches for
// real dynamic lighting, and a torch's whole point is casting real shadows
// off a wall it's flush against — a second, unrelated light source per
// fireplace would just be extra shadow-map cost for a prop that's meant to
// read as "lit" via its own emissive material, not by actually lighting the
// room. If a future pass wants a fireplace that visibly brightens its
// corner, add the light there deliberately (and keep its shadow map modest,
// 256x256 like a torch's) rather than defaulting to one here.
//
// Builds facing local +z (the hearth opens toward whoever's looking at it),
// meant to sit flush against a wall with `rotation` pointing that opening
// into the room, the same wall-mounted convention banner.ts/poster.ts use.

const SURROUND_WIDTH = 1.3;
const SURROUND_HEIGHT = 1.4;
const SURROUND_DEPTH = 0.4;
const HEARTH_WIDTH = 0.85;
const HEARTH_HEIGHT = 0.85;
const HEARTH_DEPTH = 0.28;
const MANTEL_HEIGHT = 0.12;
const MANTEL_OVERHANG = 0.08;
const LOG_RADIUS = 0.05;
const LOG_LENGTH = 0.6;
const LOG_COUNT = 3;
const FLAME_COUNT = 3;

let stoneMat: THREE.MeshStandardMaterial | undefined;
function stoneMaterial(): THREE.MeshStandardMaterial {
  return (stoneMat ??= new THREE.MeshStandardMaterial({ color: 0x6b6a63, roughness: 0.9, metalness: 0.05 }));
}

let hearthMat: THREE.MeshStandardMaterial | undefined;
function hearthMaterial(): THREE.MeshStandardMaterial {
  return (hearthMat ??= new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.95, metalness: 0 }));
}

let logMat: THREE.MeshStandardMaterial | undefined;
function logMaterial(): THREE.MeshStandardMaterial {
  return (logMat ??= new THREE.MeshStandardMaterial({ color: 0x3a2417, roughness: 0.9, metalness: 0 }));
}

// Same warm-glow emissive approach as candelabra.ts's candle flames --
// bright emissive color, no real light, reads as "lit" purely through the
// material itself.
let fireMat: THREE.MeshStandardMaterial | undefined;
function fireMaterial(): THREE.MeshStandardMaterial {
  return (fireMat ??= new THREE.MeshStandardMaterial({
    color: 0xffa030,
    emissive: 0xff5a10,
    emissiveIntensity: 2.4,
    roughness: 0.4,
  }));
}

/** A stone surround with a mantel shelf, a dark recessed hearth, a few
 * crossed logs, and small emissive "flame" cones nestled among them. */
function createFireplaceMesh(): THREE.Group {
  const group = new THREE.Group();

  const surround = new THREE.Mesh(new THREE.BoxGeometry(SURROUND_WIDTH, SURROUND_HEIGHT, SURROUND_DEPTH), stoneMaterial());
  surround.position.set(0, SURROUND_HEIGHT / 2, -SURROUND_DEPTH / 2);
  group.add(surround);

  const mantel = new THREE.Mesh(
    new THREE.BoxGeometry(SURROUND_WIDTH + MANTEL_OVERHANG * 2, MANTEL_HEIGHT, SURROUND_DEPTH + MANTEL_OVERHANG),
    stoneMaterial(),
  );
  mantel.position.set(0, SURROUND_HEIGHT - MANTEL_HEIGHT / 2, -SURROUND_DEPTH / 2 + MANTEL_OVERHANG / 2);
  group.add(mantel);

  // Recessed hearth: a dark box set slightly proud of the surround's front
  // face so it reads as a cavity rather than z-fighting with it.
  const hearth = new THREE.Mesh(new THREE.BoxGeometry(HEARTH_WIDTH, HEARTH_HEIGHT, HEARTH_DEPTH), hearthMaterial());
  hearth.position.set(0, HEARTH_HEIGHT / 2, -HEARTH_DEPTH / 2 + 0.01);
  group.add(hearth);

  const logGeo = new THREE.CylinderGeometry(LOG_RADIUS, LOG_RADIUS, LOG_LENGTH, 8);
  for (let i = 0; i < LOG_COUNT; i++) {
    const log = new THREE.Mesh(logGeo, logMaterial());
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i - (LOG_COUNT - 1) / 2) * 0.35;
    log.position.set(0, LOG_RADIUS + i * 0.02, -HEARTH_DEPTH / 2 + 0.06);
    group.add(log);
  }

  for (let i = 0; i < FLAME_COUNT; i++) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), fireMaterial());
    const angle = (i / FLAME_COUNT) * Math.PI * 2;
    flame.position.set(Math.cos(angle) * 0.12, LOG_RADIUS * 2 + 0.1, -HEARTH_DEPTH / 2 + 0.06 + Math.sin(angle) * 0.06);
    group.add(flame);
  }

  return group;
}

const fireplace: FurnitureAssetDef = {
  id: "fireplace",
  createMesh: () => createFireplaceMesh(),
  footprint: { hx: SURROUND_WIDTH / 2, hz: SURROUND_DEPTH / 2, hy: SURROUND_HEIGHT / 2 },
};

export default fireplace;
