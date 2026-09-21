import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';
import {addComponent,addEntity,createWorld} from 'bitecs';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {Dead,Health,NPC,NpcState,PlayerControlled,Position,Practice,Stamina}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {hudStore}=await server.ssrLoadModule('/src/hud/store.ts');
  const {hudSync}=await server.ssrLoadModule('/src/ecs/systems/hudSync.ts');

  // A real camera (for real projection math) looking down -Z from the
  // origin, matching this project's own forward convention -- and a
  // fake renderer, since only its canvas's bounding rect is ever read.
  const camera=new THREE.PerspectiveCamera(60,16/9,0.1,100);
  camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.updateMatrixWorld(true);
  const renderer={domElement:{getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720})}};

  const world=createWorld();
  const player=addEntity(world);
  addComponent(world,player,PlayerControlled);addComponent(world,player,Health);addComponent(world,player,Stamina);
  Health.current[player]=Health.max[player]=100;
  Stamina.current[player]=42;Stamina.max[player]=80;

  // Stamina syncs into the store the same way Health already does.
  hudSync(world,camera,renderer);
  assert.equal(hudStore.staminaCurrent,42);
  assert.equal(hudStore.staminaMax,80);
  assert.equal(hudStore.inCombat,false,'no NPCs at all means not in combat');
  assert.deepEqual(hudStore.enemyHealthBars,[]);
  assert.deepEqual(hudStore.enemyLabels,[]);

  const spawnNpc=(state,{dz=-5}={})=>{
    const eid=addEntity(world);
    addComponent(world,eid,NPC);addComponent(world,eid,Health);addComponent(world,eid,Position);
    Health.current[eid]=30;Health.max[eid]=50;
    NPC.state[eid]=state;
    NPC.archetypeId[eid]=undefined;NPC.provoked[eid]=0;
    Position.x[eid]=0;Position.y[eid]=0;Position.z[eid]=dz;
    return eid;
  };

  // LOITERING/FOLLOWING never count as "targeted the player", and a docile,
  // never-provoked NPC never gets a state label either -- it's not an "enemy".
  const loitering=spawnNpc(NpcState.LOITERING);
  const following=spawnNpc(NpcState.FOLLOWING);
  hudSync(world,camera,renderer);
  assert.equal(hudStore.inCombat,false,'LOITERING/FOLLOWING NPCs never count as in-combat targets');
  assert.deepEqual(hudStore.enemyHealthBars,[]);
  assert.deepEqual(hudStore.enemyLabels,[],'a docile, never-provoked NPC never gets a floating state label');

  // CHASING and ATTACKING both count, and carry the NPC's real current/max health.
  const chaser=spawnNpc(NpcState.CHASING);
  Health.current[chaser]=18;Health.max[chaser]=40;
  hudSync(world,camera,renderer);
  assert.equal(hudStore.inCombat,true,'a CHASING NPC alone is enough to be in combat');
  assert.deepEqual(hudStore.enemyHealthBars,[{eid:chaser,current:18,max:40}]);

  const attacker=spawnNpc(NpcState.ATTACKING);
  Health.current[attacker]=5;Health.max[attacker]=25;
  hudSync(world,camera,renderer);
  assert.equal(hudStore.enemyHealthBars.length,2,'both the chaser and the attacker show up');
  assert.ok(hudStore.enemyHealthBars.some((e)=>e.eid===attacker&&e.current===5&&e.max===25));

  // A dead NPC never shows a tile, even if its stale NPC.state still reads
  // CHASING/ATTACKING (death only ever adds Dead, see combat.ts).
  addComponent(world,attacker,Dead);
  hudSync(world,camera,renderer);
  assert.deepEqual(hudStore.enemyHealthBars,[{eid:chaser,current:18,max:40}],'a dead NPC is dropped from the combat tiles');

  // A sparring practice opponent has its own dedicated score UI
  // (PracticeBar.tsx) and is excluded here to avoid a redundant tile.
  addComponent(world,chaser,Practice);
  Practice.active[chaser]=1;
  hudSync(world,camera,renderer);
  assert.equal(hudStore.inCombat,false,'an active practice opponent is excluded, not shown as a combat enemy');
  assert.deepEqual(hudStore.enemyHealthBars,[]);
  Practice.active[chaser]=0;

  // Floating state label: a provoked (or aggressive-archetype) NPC gets one
  // at any state, LOITERING included -- broader than the health tiles above,
  // since the point is to see an enemy go idle -> alert -> attacking, not
  // only ever read "Attacking" once it's already too late to matter.
  NPC.provoked[loitering]=1;
  NPC.state[loitering]=NpcState.LOITERING;
  hudSync(world,camera,renderer);
  let label=hudStore.enemyLabels.find((l)=>l.eid===loitering);
  assert.ok(label,'a provoked NPC gets a floating label even while merely LOITERING');
  assert.equal(label.text,'Idle');
  assert.equal(label.state,NpcState.LOITERING);
  assert.ok(Number.isFinite(label.x)&&Number.isFinite(label.y),'the label carries real projected screen coordinates');

  NPC.state[loitering]=NpcState.CHASING;
  hudSync(world,camera,renderer);
  label=hudStore.enemyLabels.find((l)=>l.eid===loitering);
  assert.equal(label.text,'Chasing');

  NPC.state[loitering]=NpcState.ATTACKING;
  hudSync(world,camera,renderer);
  label=hudStore.enemyLabels.find((l)=>l.eid===loitering);
  assert.equal(label.text,'Attacking');

  // A dead or sparring provoked NPC never gets a label either.
  addComponent(world,loitering,Dead);
  hudSync(world,camera,renderer);
  assert.ok(!hudStore.enemyLabels.some((l)=>l.eid===loitering),'a dead provoked NPC loses its label too');

  console.log('hudSync stamina, in-combat detection, enemy health tiles and floating state labels passed');
} finally {await server.close();}
