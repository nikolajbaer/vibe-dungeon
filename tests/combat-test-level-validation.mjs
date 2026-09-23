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
  const { Item, Container, Carried, CarryCapacity, Position, PhysicsRotation, Stackable } = await server.ssrLoadModule("/src/ecs/components.ts");
  const { maxCarryWeight } = await server.ssrLoadModule("/src/ecs/systems/items.ts");
  const { dynamicSyncSystem } = await server.ssrLoadModule("/src/ecs/systems/dynamics.ts");
  await physicsModule.initPhysics();
  const world = createWorld();
  const physics = physicsModule.createPhysics();
  const scene = new THREE.Scene();
  const level = buildCombatTestLevel(world, physics, scene);

  assert.equal(level.sectorAt(0, 0, 0), "combat-test", "arena has its own standalone sector");
  assert.deepEqual(level.spawn, { x: 0, z: -10.5, yaw: 0 }, "player spawns in front of the equipment table, facing it");
  const itemTypes = query(world, [Item]).map((eid) => Item.itemTypeId[eid]);
  for (const weapon of ["dagger", "sword", "wooden_sword", "crossbow", "quarterstaff", "greatsword"]) {
    assert(itemTypes.includes(weapon), `equipment table includes ${weapon}`);
  }
  const [barrel] = query(world, [Container]);
  const bolts = query(world, [Item, Carried, Stackable]).find((eid) => Carried.ownerEid[eid] === barrel && Item.itemTypeId[eid] === "bolt");
  assert(bolts !== undefined && Stackable.count[bolts] === 50, "projectile barrel contains 50 bolts");
  assert.ok(Math.abs(Position.z[barrel] - (-12.5)) < 1, "the projectile barrel is parked next to the equipment table, not across the room");
  assert.equal(scene.children.filter((object) => object.userData.combatTestTorch).length, 8, "two torches are spaced along each wall");
  assert.equal(scene.children.filter((object) => object.userData.combatTestWallDecoration).length, 4, "each wall has a centered sword-and-shield display");
  assert.equal(scene.children.filter((object) => object.userData.combatTestArcheryTarget).length, 2, "the west wall has two archery targets");
  const sandMaterial = scene.children
    .filter((object) => object instanceof THREE.Mesh)
    .map((object) => object.material)
    .find((material) => material?.name === "combatTestSand");
  assert(sandMaterial?.map, "raised sparring mat uses a repeated procedural sand texture");
  const player = addEntity(world);
  addComponent(world, player, CarryCapacity);
  CarryCapacity.maxWeight[player] = 100;
  assert.equal(maxCarryWeight(world, player), 100, "combat-test player can carry 100kg");

  // Regression check: a long, thin dynamic body (every world item falls
  // under gravity -- see spawning.ts's buildItemWorldBody) resting on too
  // shallow a surface can tip and settle standing on end rather than lying
  // flat, exactly what happened to the greatsword before it and the
  // quarterstaff got their own deeper second table. After physics has had
  // a few seconds to settle, each one's own long axis (local +Z, "tip" by
  // every sword-derived mesh's own authored convention -- see sword.ts's
  // header comment) should still read as mostly horizontal, not vertical.
  for (let i = 0; i < 180; i++) physics.world.step();
  dynamicSyncSystem(world);
  for (const weaponId of ["quarterstaff", "greatsword"]) {
    const eid = query(world, [Item]).find((e) => Item.itemTypeId[e] === weaponId);
    assert.ok(eid !== undefined, `${weaponId} exists in the world`);
    const q = new THREE.Quaternion(PhysicsRotation.x[eid], PhysicsRotation.y[eid], PhysicsRotation.z[eid], PhysicsRotation.w[eid]);
    const tipDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    assert.ok(Math.abs(tipDirection.y) < 0.5, `${weaponId} settles lying roughly flat on the second table, not standing on end (tip direction y: ${tipDirection.y})`);
  }

  console.log("30m combat room, raised floor, wall dressing, weapon tables (including a deeper one for the quarterstaff/greatsword) and projectile barrel passed");
} finally {
  await server.close();
}
