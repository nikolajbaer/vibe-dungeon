import * as THREE from "three";
import type { World } from "bitecs";
import { addStaticBox, type Physics } from "../physics/world";
import { spawnItems, spawnProps } from "./spawning";
import type { Level } from "./level";

const ROOM_HALF = 15;
const WALL_HEIGHT = 7;

function addBox(
  physics: Physics,
  scene: THREE.Scene,
  size: THREE.Vector3,
  position: THREE.Vector3,
  material: THREE.Material,
): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.copy(position);
  mesh.receiveShadow = true;
  scene.add(mesh);
  addStaticBox(physics, position.x, position.y, position.z, size.x / 2, size.y / 2, size.z / 2);
}

/** A deliberately isolated 30m square room for repeatable combat tuning. */
export function buildCombatTestLevel(world: World, physics: Physics, scene: THREE.Scene): Level {
  const stone = new THREE.MeshStandardMaterial({ color: 0x69655f, roughness: 0.9 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x403e3b, roughness: 0.95 });
  const sand = new THREE.MeshStandardMaterial({ color: 0xb99a62, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x76502d, roughness: 0.88 });

  addBox(physics, scene, new THREE.Vector3(30, 0.2, 30), new THREE.Vector3(0, -0.1, 0), stone);
  addBox(physics, scene, new THREE.Vector3(18, 0.2, 18), new THREE.Vector3(0, 0.1, 0), sand);
  addBox(physics, scene, new THREE.Vector3(30, 0.25, 30), new THREE.Vector3(0, WALL_HEIGHT, 0), darkStone);
  addBox(physics, scene, new THREE.Vector3(0.3, WALL_HEIGHT, 30), new THREE.Vector3(-ROOM_HALF, WALL_HEIGHT / 2, 0), darkStone);
  addBox(physics, scene, new THREE.Vector3(0.3, WALL_HEIGHT, 30), new THREE.Vector3(ROOM_HALF, WALL_HEIGHT / 2, 0), darkStone);
  addBox(physics, scene, new THREE.Vector3(30, WALL_HEIGHT, 0.3), new THREE.Vector3(0, WALL_HEIGHT / 2, -ROOM_HALF), darkStone);
  addBox(physics, scene, new THREE.Vector3(30, WALL_HEIGHT, 0.3), new THREE.Vector3(0, WALL_HEIGHT / 2, ROOM_HALF), darkStone);

  // Long equipment table along the west wall.
  addBox(physics, scene, new THREE.Vector3(0.9, 0.12, 4.8), new THREE.Vector3(-12.5, 0.78, 0), wood);
  for (const z of [-2.1, 2.1]) {
    addBox(physics, scene, new THREE.Vector3(0.12, 0.72, 0.12), new THREE.Vector3(-12.75, 0.36, z), wood);
    addBox(physics, scene, new THREE.Vector3(0.12, 0.72, 0.12), new THREE.Vector3(-12.25, 0.36, z), wood);
  }
  spawnItems(world, physics, scene, [
    { id: "dagger", x: -12.5, y: 1.05, z: -1.7 },
    { id: "sword", x: -12.5, y: 1.05, z: -0.6 },
    { id: "wooden_sword", x: -12.5, y: 1.05, z: 0.6 },
    { id: "crossbow", x: -12.5, y: 1.05, z: 1.7 },
  ]);

  // The projectile barrel currently contains every projectile commodity in
  // the game (bolts); future ammunition types can be added to this list.
  spawnProps(world, physics, scene, [
    { id: "barrel", x: 12.5, z: 0, contents: [{ id: "bolt", count: 50 }] },
  ]);

  for (const x of [-9, 0, 9]) {
    const light = new THREE.PointLight(0xffdfae, 18, 18, 2);
    light.position.set(x, 5.5, 0);
    scene.add(light);
  }

  return {
    spawn: { x: 0, z: 12, yaw: 0 },
    sectorAt: () => "combat-test",
  };
}
