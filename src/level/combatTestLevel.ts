import * as THREE from "three";
import type { World } from "bitecs";
import { addStaticBox, type Physics } from "../physics/world";
import { spawnItems, spawnProps } from "./spawning";
import type { Level } from "./level";
import sword from "../assets/items/sword";
import { ceilingMaterial, floorMaterial, wallMaterial } from "./materials";

const ROOM_HALF = 15;
const WALL_HEIGHT = 7;

function createSandMaterial(): THREE.MeshStandardMaterial {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hash = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const coarse = Math.abs(Math.sin(Math.floor(x / 5) * 4.13 + Math.floor(y / 5) * 9.71) * 113.7) % 1;
      const shade = (hash - 0.5) * 24 + (coarse - 0.5) * 14;
      const index = (y * size + x) * 4;
      image.data[index] = 190 + shade;
      image.data[index + 1] = 158 + shade;
      image.data[index + 2] = 99 + shade * 0.65;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(9, 9);
  const material = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 1 });
  material.name = "combatTestSand";
  return material;
}

function addArcheryTarget(scene: THREE.Scene, z: number): void {
  const target = new THREE.Group();
  target.name = "combatTestArcheryTarget";
  target.userData.combatTestArcheryTarget = true;
  target.userData.surfaceMaterial = "wood";
  target.position.set(-14.76, 2.15, z);
  const rings = [
    { radius: 0.78, color: 0xe4ddc4 },
    { radius: 0.58, color: 0x2f3540 },
    { radius: 0.38, color: 0xd9d1b7 },
    { radius: 0.2, color: 0xb63d32 },
  ];
  rings.forEach(({ radius, color }, index) => {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.07, 24),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
    );
    ring.rotation.z = Math.PI / 2;
    ring.position.x = index * 0.012;
    target.add(ring);
  });
  scene.add(target);
}

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
  const sand = createSandMaterial();
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
  addArcheryTarget(scene, -4.5);
  addArcheryTarget(scene, 4.5);

  // Long equipment table along the north wall, leaving the west wall clear
  // for archery targets opposite the east-side projectile barrel.
  addBox(physics, scene, new THREE.Vector3(4.8, 0.12, 0.9), new THREE.Vector3(0, 0.78, -12.5), wood);
  for (const x of [-2.1, 2.1]) {
    addBox(physics, scene, new THREE.Vector3(0.12, 0.72, 0.12), new THREE.Vector3(x, 0.36, -12.75), wood);
    addBox(physics, scene, new THREE.Vector3(0.12, 0.72, 0.12), new THREE.Vector3(x, 0.36, -12.25), wood);
  }
  spawnItems(world, physics, scene, [
    { id: "dagger", x: -1.7, y: 1.05, z: -12.5 },
    { id: "sword", x: -0.6, y: 1.05, z: -12.5 },
    { id: "wooden_sword", x: 0.6, y: 1.05, z: -12.5 },
    { id: "crossbow", x: 1.7, y: 1.05, z: -12.5 },
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
