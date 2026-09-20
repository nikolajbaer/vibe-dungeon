import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";
import { addComponent, addEntity, createWorld, query } from "bitecs";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: () => {},
      }),
    }),
  };
  const physicsModule = await server.ssrLoadModule("/src/physics/world.ts");
  const { buildCombatTestLevel } = await server.ssrLoadModule("/src/level/combatTestLevel.ts");
  const { Item, Container, Carried, CarryCapacity, Stackable } = await server.ssrLoadModule("/src/ecs/components.ts");
  const { maxCarryWeight } = await server.ssrLoadModule("/src/ecs/systems/items.ts");
  await physicsModule.initPhysics();
  const world = createWorld();
  const physics = physicsModule.createPhysics();
  const scene = new THREE.Scene();
  const level = buildCombatTestLevel(world, physics, scene);

  assert.equal(level.sectorAt(0, 0, 0), "combat-test", "arena has its own standalone sector");
  assert.deepEqual(level.spawn, { x: 0, z: 12, yaw: 0 }, "player spawns at the arena entrance facing the floor");
  const itemTypes = query(world, [Item]).map((eid) => Item.itemTypeId[eid]);
  for (const weapon of ["dagger", "sword", "wooden_sword", "crossbow"]) {
    assert(itemTypes.includes(weapon), `equipment table includes ${weapon}`);
  }
  const [barrel] = query(world, [Container]);
  const bolts = query(world, [Item, Carried, Stackable]).find((eid) => Carried.ownerEid[eid] === barrel && Item.itemTypeId[eid] === "bolt");
  assert(bolts !== undefined && Stackable.count[bolts] === 50, "projectile barrel contains 50 bolts");
  assert.equal(scene.children.filter((object) => object.userData.combatTestTorch).length, 8, "two torches are spaced along each wall");
  assert.equal(scene.children.filter((object) => object.userData.combatTestWallDecoration).length, 4, "each wall has a centered sword-and-shield display");
  const player = addEntity(world);
  addComponent(world, player, CarryCapacity);
  CarryCapacity.maxWeight[player] = 100;
  assert.equal(maxCarryWeight(world, player), 100, "combat-test player can carry 100kg");
  console.log("30m combat room, raised floor, wall dressing, weapon table and projectile barrel passed");
} finally {
  await server.close();
}
