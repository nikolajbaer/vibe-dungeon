import * as THREE from "three";
import type { World } from "bitecs";
import { addStaticBox, type Physics } from "../physics/world";
import { spawnItems, spawnProps } from "./spawning";
import type { Level } from "./level";
import sword from "../assets/items/sword";
import { ceilingMaterial, floorMaterial, wallMaterial } from "./materials";

const ROOM_HALF = 15;
const WALL_HEIGHT = 7;

function addWallTorch(scene: THREE.Scene, x: number, z: number, inwardX: number, inwardZ: number): void {
  const group = new THREE.Group();
  group.name = "combatTestTorch";
  group.userData.combatTestTorch = true;
  group.position.set(x, 3.2, z);

  const bracket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 0.42, 6),
    new THREE.MeshStandardMaterial({ color: 0x34271e, metalness: 0.35, roughness: 0.7 }),
  );
  bracket.rotation.z = Math.PI / 2;
  bracket.position.set(inwardX * 0.18, -0.12, inwardZ * 0.18);
  group.add(bracket);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.28, 7),
    new THREE.MeshStandardMaterial({ color: 0xffbd55, emissive: 0xff6a18, emissiveIntensity: 2.4 }),
  );
  flame.position.set(inwardX * 0.34, 0.08, inwardZ * 0.34);
  group.add(flame);
  const light = new THREE.PointLight(0xffa34d, 12, 11, 2);
  light.position.copy(flame.position);
  group.add(light);
  scene.add(group);
}

function addSwordAndShield(scene: THREE.Scene, x: number, z: number, rotationY: number): void {
  const display = new THREE.Group();
  display.name = "combatTestSwordAndShield";
  display.userData.combatTestWallDecoration = true;
  display.position.set(x, 3.5, z);
  display.rotation.y = rotationY;

  const shield = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58, 0.48, 0.12, 10),
    new THREE.MeshStandardMaterial({ color: 0x7d3130, metalness: 0.15, roughness: 0.72 }),
  );
  shield.rotation.x = Math.PI / 2;
  display.add(shield);
  const boss = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xa5a8ad, metalness: 0.65, roughness: 0.35 }),
  );
  boss.scale.z = 0.35;
  boss.position.z = 0.09;
  display.add(boss);

  const weapon = sword.createWorldMesh();
  weapon.scale.setScalar(1.15);
  weapon.rotation.x = -Math.PI / 2;
  weapon.rotation.z = -0.28;
  weapon.position.set(-0.5, -0.05, 0.12);
  display.add(weapon);
  scene.add(display);
}

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
  const stone = floorMaterial();
  const texturedWall = wallMaterial();
  const ceiling = ceilingMaterial();
  const sand = new THREE.MeshStandardMaterial({ color: 0xb99a62, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x76502d, roughness: 0.88 });

  addBox(physics, scene, new THREE.Vector3(30, 0.2, 30), new THREE.Vector3(0, -0.1, 0), stone);
  addBox(physics, scene, new THREE.Vector3(18, 0.2, 18), new THREE.Vector3(0, 0.1, 0), sand);
  addBox(physics, scene, new THREE.Vector3(30, 0.25, 30), new THREE.Vector3(0, WALL_HEIGHT, 0), ceiling);
  addBox(physics, scene, new THREE.Vector3(0.3, WALL_HEIGHT, 30), new THREE.Vector3(-ROOM_HALF, WALL_HEIGHT / 2, 0), texturedWall);
  addBox(physics, scene, new THREE.Vector3(0.3, WALL_HEIGHT, 30), new THREE.Vector3(ROOM_HALF, WALL_HEIGHT / 2, 0), texturedWall);
  addBox(physics, scene, new THREE.Vector3(30, WALL_HEIGHT, 0.3), new THREE.Vector3(0, WALL_HEIGHT / 2, -ROOM_HALF), texturedWall);
  addBox(physics, scene, new THREE.Vector3(30, WALL_HEIGHT, 0.3), new THREE.Vector3(0, WALL_HEIGHT / 2, ROOM_HALF), texturedWall);

  // Two torches per wall, 15m apart, plus one centered heraldic display.
  for (const offset of [-7.5, 7.5]) {
    addWallTorch(scene, offset, -14.75, 0, 1);
    addWallTorch(scene, offset, 14.75, 0, -1);
    addWallTorch(scene, -14.75, offset, 1, 0);
    addWallTorch(scene, 14.75, offset, -1, 0);
  }
  addSwordAndShield(scene, 0, -14.78, 0);
  addSwordAndShield(scene, 0, 14.78, Math.PI);
  addSwordAndShield(scene, -14.78, 0, Math.PI / 2);
  addSwordAndShield(scene, 14.78, 0, -Math.PI / 2);

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
