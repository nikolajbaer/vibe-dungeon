import * as THREE from "three";
import type { ItemAssetDef } from "../types";

// Coins (commodity inventory) -- the first `stackable` item: every pickup
// piles into one inventory slot per owner instead of a separate one each
// time (`Stackable` in ecs/components.ts, `giveItem` in
// ecs/systems/items.ts). `mass` is *per coin*, not per pile -- a stack of
// 50 weighs 50x what a single one does. A curio like gem.ts (`slot: null`,
// no viewmodel); the mesh itself is a static small heap regardless of the
// pile's actual count, same simplification a sword's mesh doesn't change
// with its damage stat.

const COIN_RADIUS = 0.045;
const COIN_THICKNESS = 0.012;

let coinMat: THREE.MeshStandardMaterial | undefined;
function coinMaterial(): THREE.MeshStandardMaterial {
  return (coinMat ??= new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.75, roughness: 0.3 }));
}

function createCoinPileMesh(): THREE.Group {
  const group = new THREE.Group();
  // A loose but stable stack: every coin lies flat, with small lateral
  // offsets that keep the individual layers readable at icon scale.
  const offsets: Array<[number, number, number]> = [
    [0, 0, 0],
    [0.014, COIN_THICKNESS, 0.006],
    [-0.008, COIN_THICKNESS * 2, -0.009],
    [0.009, COIN_THICKNESS * 3, -0.004],
  ];
  for (const [x, y, z] of offsets) {
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 12), coinMaterial());
    coin.position.set(x, y + COIN_THICKNESS / 2, z);
    group.add(coin);
  }
  return group;
}

const coin: ItemAssetDef = {
  id: "coin",
  name: "Coins",
  icon: "🪙",
  slot: null,
  mass: 0.01, // 10g per coin
  stackable: true,
  createWorldMesh: () => createCoinPileMesh(),
};

export default coin;
