import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';
import { addComponent, addEntity, createWorld, query } from 'bitecs';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { opponentArchetype } = await server.ssrLoadModule('/src/combatTest/bootstrap.ts');
  assert.equal(opponentArchetype('random', () => 0), 'javelin-fighter');
  assert.equal(opponentArchetype('random', () => .4), 'crossbow-fighter');
  assert.equal(opponentArchetype('random', () => .9), 'quarterstaff-fighter');
  assert.equal(opponentArchetype('quarterstaff'), 'quarterstaff-fighter');

  const { Carried, Health, Item, NPC, Object3DRef, PlayerControlled, Position, Rotation, Velocity } =
    await server.ssrLoadModule('/src/ecs/components.ts');
  const { createRangedNpcMesh, beginRangedNpcAttack, updateRangedNpcs, rangedNpcHasJavelin } =
    await server.ssrLoadModule('/src/ecs/systems/rangedNpcAnimation.ts');
  const { rangedCombatSystem, getRangedCombatDebugState, launchNpcProjectile } =
    await server.ssrLoadModule('/src/ecs/systems/rangedCombat.ts');
  const { initPhysics, createPhysics } = await server.ssrLoadModule('/src/physics/world.ts');
  await initPhysics();
  const physics = createPhysics();
  const world = createWorld(), scene = new THREE.Scene();
  const player = addEntity(world);
  for (const component of [PlayerControlled, Position, Health]) addComponent(world, player, component);
  Position.x[player] = 0; Position.y[player] = 0; Position.z[player] = 8;
  Health.current[player] = 100; Health.max[player] = 100;

  const shooter = addEntity(world);
  for (const component of [NPC, Position, Rotation, Velocity, Object3DRef]) addComponent(world, shooter, component);
  NPC.team[shooter] = 1; NPC.archetypeId[shooter] = 'crossbow-fighter';
  Position.x[shooter] = 0; Position.y[shooter] = 0; Position.z[shooter] = 0;
  Velocity.x[shooter] = 0; Velocity.z[shooter] = 0;
  Object3DRef[shooter] = createRangedNpcMesh('crossbow', shooter);
  scene.add(Object3DRef[shooter]);
  scene.updateMatrixWorld(true);
  assert.equal(beginRangedNpcAttack(shooter, player, world, scene), 5, 'crossbow fires on a five-second cadence');
  updateRangedNpcs(world, .43, false);
  assert.equal(getRangedCombatDebugState().flyingBolts, 1, 'bolt launches at the animation release frame');
  for (let i = 0; i < 20 && Health.current[player] === 100; i++) {
    scene.updateMatrixWorld(true);
    rangedCombatSystem(world, physics, scene, .025);
  }
  assert.ok(Health.current[player] < 100, 'a flying NPC bolt can actually hit the first-person player');
  const healthAfterHit = Health.current[player];
  const coveredScene = new THREE.Scene();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 3, .2), new THREE.MeshBasicMaterial());
  wall.position.set(0, 1.4, 4);
  coveredScene.add(wall);
  coveredScene.updateMatrixWorld(true);
  launchNpcProjectile(coveredScene, shooter, player, 'crossbow', new THREE.Vector3(0, 1.3, .7), () => .5);
  for (let i = 0; i < 20; i++) rangedCombatSystem(world, physics, coveredScene, .025);
  assert.equal(Health.current[player], healthAfterHit, 'a wall intercepts the NPC shot before the player');
  assert.ok(query(world, [Item, Object3DRef]).some(eid => Object3DRef[eid]?.parent === wall),
    'the intercepted bolt embeds in the wall as a recoverable item');

  const thrower = addEntity(world);
  for (const component of [NPC, Position, Rotation, Velocity, Object3DRef]) addComponent(world, thrower, component);
  NPC.team[thrower] = 1; NPC.archetypeId[thrower] = 'javelin-fighter';
  Position.x[thrower] = 1; Position.y[thrower] = 0; Position.z[thrower] = 0;
  Velocity.x[thrower] = 0; Velocity.z[thrower] = 0;
  Object3DRef[thrower] = createRangedNpcMesh('javelin', thrower);
  Object3DRef[thrower].position.x = 1;
  scene.add(Object3DRef[thrower]);
  const carried = addEntity(world);
  addComponent(world, carried, Item); addComponent(world, carried, Carried);
  Item.itemTypeId[carried] = 'javelin'; Carried.ownerEid[carried] = thrower;
  assert.ok(rangedNpcHasJavelin(thrower));
  beginRangedNpcAttack(thrower, player, world, scene);
  updateRangedNpcs(world, .63, false);
  assert.equal(rangedNpcHasJavelin(thrower), false, 'one javelin throw then dagger melee');
  assert.equal(query(world, [Item, Carried]).some(eid => Carried.ownerEid[eid] === thrower && Item.itemTypeId[eid] === 'javelin'), false,
    'thrown javelin is no longer duplicated in NPC inventory');
  assert.ok(Object3DRef[thrower].getObjectByName('backupDagger').visible, 'dagger appears after the throw');
  console.log('arena opponent selection, crossbow release/hit/cadence, and javelin-to-dagger transition passed');
} finally {
  await server.close();
}
