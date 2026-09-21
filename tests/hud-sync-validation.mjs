import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {addComponent,addEntity,createWorld} from 'bitecs';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {Dead,Health,NPC,NpcState,PlayerControlled,Practice,Stamina}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {hudStore}=await server.ssrLoadModule('/src/hud/store.ts');
  const {hudSync}=await server.ssrLoadModule('/src/ecs/systems/hudSync.ts');

  const world=createWorld();
  const player=addEntity(world);
  addComponent(world,player,PlayerControlled);addComponent(world,player,Health);addComponent(world,player,Stamina);
  Health.current[player]=Health.max[player]=100;
  Stamina.current[player]=42;Stamina.max[player]=80;

  // Stamina syncs into the store the same way Health already does.
  hudSync(world);
  assert.equal(hudStore.staminaCurrent,42);
  assert.equal(hudStore.staminaMax,80);
  assert.equal(hudStore.inCombat,false,'no NPCs at all means not in combat');
  assert.deepEqual(hudStore.enemyHealthBars,[]);

  // LOITERING/FOLLOWING never count as "targeted the player".
  const loitering=addEntity(world);
  addComponent(world,loitering,NPC);addComponent(world,loitering,Health);
  Health.current[loitering]=30;Health.max[loitering]=50;
  NPC.state[loitering]=NpcState.LOITERING;
  const following=addEntity(world);
  addComponent(world,following,NPC);addComponent(world,following,Health);
  Health.current[following]=30;Health.max[following]=50;
  NPC.state[following]=NpcState.FOLLOWING;
  hudSync(world);
  assert.equal(hudStore.inCombat,false,'LOITERING/FOLLOWING NPCs never count as in-combat targets');
  assert.deepEqual(hudStore.enemyHealthBars,[]);

  // CHASING and ATTACKING both count, and carry the NPC's real current/max health.
  const chaser=addEntity(world);
  addComponent(world,chaser,NPC);addComponent(world,chaser,Health);
  Health.current[chaser]=18;Health.max[chaser]=40;
  NPC.state[chaser]=NpcState.CHASING;
  hudSync(world);
  assert.equal(hudStore.inCombat,true,'a CHASING NPC alone is enough to be in combat');
  assert.deepEqual(hudStore.enemyHealthBars,[{eid:chaser,current:18,max:40}]);

  const attacker=addEntity(world);
  addComponent(world,attacker,NPC);addComponent(world,attacker,Health);
  Health.current[attacker]=5;Health.max[attacker]=25;
  NPC.state[attacker]=NpcState.ATTACKING;
  hudSync(world);
  assert.equal(hudStore.enemyHealthBars.length,2,'both the chaser and the attacker show up');
  assert.ok(hudStore.enemyHealthBars.some((e)=>e.eid===attacker&&e.current===5&&e.max===25));

  // A dead NPC never shows a tile, even if its stale NPC.state still reads
  // CHASING/ATTACKING (death only ever adds Dead, see combat.ts).
  addComponent(world,attacker,Dead);
  hudSync(world);
  assert.deepEqual(hudStore.enemyHealthBars,[{eid:chaser,current:18,max:40}],'a dead NPC is dropped from the combat tiles');

  // A sparring practice opponent has its own dedicated score UI
  // (PracticeBar.tsx) and is excluded here to avoid a redundant tile.
  addComponent(world,chaser,Practice);
  Practice.active[chaser]=1;
  hudSync(world);
  assert.equal(hudStore.inCombat,false,'an active practice opponent is excluded, not shown as a combat enemy');
  assert.deepEqual(hudStore.enemyHealthBars,[]);

  console.log('hudSync stamina, in-combat detection and enemy health tile filtering passed');
} finally {await server.close();}
