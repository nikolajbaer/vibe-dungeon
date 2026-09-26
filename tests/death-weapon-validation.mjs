import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';
import { addComponent, addEntity, createWorld, hasComponent, query } from 'bitecs';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { CharacterBody, Carried, Dead, Health, Item, NPC, Object3DRef, PhysicsBody, PhysicsCollider, PlayerControlled, Position, Velocity } =
    await server.ssrLoadModule('/src/ecs/components.ts');
  const { initPhysics, createPhysics, addCharacter, addStaticBox, PHYSICS_DT } =
    await server.ssrLoadModule('/src/physics/world.ts');
  const { spawnNpcs } = await server.ssrLoadModule('/src/level/spawning.ts');
  const { applyRangedDamage } = await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const { deathWeaponSystem } = await server.ssrLoadModule('/src/ecs/systems/deathWeapon.ts');
  const { characterSystem, physicsSyncSystem } = await server.ssrLoadModule('/src/ecs/systems/character.ts');
  const { getNpcWeaponMesh, triggerHitReaction, npcAnimationSystem } = await server.ssrLoadModule('/src/ecs/systems/npcAnimation.ts');
  await initPhysics();
  const physics = createPhysics(), world = createWorld(), scene = new THREE.Scene();
  addStaticBox(physics, 0, -.5, 0, 20, .5, 20);

  const player = addEntity(world);
  for (const c of [PlayerControlled, Health, Position, Velocity, CharacterBody, PhysicsBody, PhysicsCollider]) addComponent(world, player, c);
  Health.current[player] = 100; Health.max[player] = 100;
  Position.x[player] = 0; Position.y[player] = 0; Position.z[player] = -2;
  Velocity.x[player] = 0; Velocity.z[player] = 0;
  CharacterBody.radius[player] = .35; CharacterBody.halfHeight[player] = .55;
  CharacterBody.verticalVelocity[player] = 0; CharacterBody.grounded[player] = 0;
  const handles = addCharacter(physics, 0, 0, -2, .35, .55);
  PhysicsBody[player] = handles.body; PhysicsCollider[player] = handles.collider;

  const [bandit, fighter, crossbow] = spawnNpcs(world, physics, scene, [
    { id: 'bandit', x: 0, z: 0, contents: ['dagger'] },
    { id: 'quarterstaff-fighter', x: 4, z: 0 },
    { id: 'crossbow-fighter', x: 8, z: 0, contents: ['crossbow'] },
  ]);
  // The two-handed weapon must follow the hand while flinching rather than
  // remaining suspended where the previous guard animation left it.
  const staff = getNpcWeaponMesh(fighter);
  triggerHitReaction(fighter);
  npcAnimationSystem(world, .2, false);
  scene.updateMatrixWorld(true);
  const hand = Object3DRef[fighter].getObjectByName('hand.R');
  const relative = hand.worldToLocal(staff.getWorldPosition(new THREE.Vector3()));
  npcAnimationSystem(world, .2, false);
  scene.updateMatrixWorld(true);
  const later = hand.worldToLocal(staff.getWorldPosition(new THREE.Vector3()));
  assert.ok(relative.distanceTo(later) < .02, 'hit animation keeps weapon attached to the moving hand');

  // A hidden/drawn one-handed prop must vanish with its inventory copy on
  // the no-drop half of the roll. The same rule applies to ranged props.
  for (const eid of [bandit, crossbow]) {
    applyRangedDamage(world, eid, 100, player);
    assert(hasComponent(world, eid, Dead));
    assert.equal(PhysicsCollider[eid].collisionGroups(), 0, 'corpse capsule is non-solid immediately');
    assert.equal(getNpcWeaponMesh(eid).visible, false, 'rig weapon disappears at the death frame');
  }
  deathWeaponSystem(world, physics, scene, () => .75);
  assert.equal(query(world, [Item, Carried]).some(id => [bandit, crossbow].includes(Carried.ownerEid[id])), false,
    'weapons that disappear are not left in corpse inventory');

  // Dropping an unseeded two-handed weapon creates a recoverable physics
  // item exactly at the frozen prop transform, with a toss and spin.
  scene.updateMatrixWorld(true);
  const dropPosition = staff.getWorldPosition(new THREE.Vector3());
  applyRangedDamage(world, fighter, 100, player);
  assert.equal(staff.visible, false);
  deathWeaponSystem(world, physics, scene, () => .25);
  const dropped = query(world, [Item, Object3DRef]).find(id => Item.itemTypeId[id] === 'quarterstaff');
  assert.notEqual(dropped, undefined);
  assert.ok(Object3DRef[dropped].position.distanceTo(dropPosition) < .001);
  assert.ok(PhysicsBody[dropped].linvel().y > 0, 'dropped staff is tossed into dynamic physics');
  deathWeaponSystem(world, physics, scene, () => .25);
  assert.equal(query(world, [Item]).filter(id => Item.itemTypeId[id] === 'quarterstaff').length, 1,
    'death resolution never duplicates the drop');

  const [seededBandit] = spawnNpcs(world, physics, scene, [{ id: 'bandit', x: 12, z: 0, contents: ['dagger'] }]);
  const seededDagger = query(world, [Item, Carried]).find(id => Carried.ownerEid[id] === seededBandit);
  applyRangedDamage(world, seededBandit, 100, player);
  deathWeaponSystem(world, physics, scene, () => .25);
  assert.equal(hasComponent(world, seededDagger, Carried), false, 'dropping removes the seeded weapon from the corpse');
  assert.ok(PhysicsBody[seededDagger].linvel().y > 0, 'seeded dagger uses its own recoverable world item');

  // Both the player and a living NPC walk through separate corpse capsules.
  const [walker] = spawnNpcs(world, physics, scene, [{ id: 'villager', x: 8, z: -2 }]);
  Velocity.z[walker] = 3;
  Velocity.z[player] = 3;
  for (let t = 0; t < 1.4; t += PHYSICS_DT) {
    characterSystem(world, physics, PHYSICS_DT);
    physics.world.step();
    physicsSyncSystem(world);
  }
  assert.ok(Position.z[player] > .7, `player passes through corpse, reached z=${Position.z[player]}`);
  assert.ok(Position.z[walker] > .7, `NPC passes through corpse, reached z=${Position.z[walker]}`);
  assert.equal(PhysicsCollider[fighter].collisionGroups(), 0);
  console.log('death drops, disappearance, hit grip, and corpse collision passed');
} finally { await server.close(); }
