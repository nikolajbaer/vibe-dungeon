import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createWorld, addEntity, addComponent } from 'bitecs';

// A ranged hit has a flat chance (RANGED_STAGGER_CHANCE) to stagger its NPC
// target for RANGED_STAGGER_SECONDS -- melee never staggers (bolt-only, see
// applyRangedDamage's own comment), and while staggered npcSystem freezes
// the NPC's AI entirely rather than letting it keep chasing/attacking.

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {Combat,Health,NPC,NpcState,PlayerControlled,Position,Velocity}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {applyRangedDamage,RANGED_STAGGER_CHANCE,RANGED_STAGGER_SECONDS}=await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const {npcSystem}=await server.ssrLoadModule('/src/ecs/systems/npc.ts');

  assert.ok(RANGED_STAGGER_CHANCE > 0 && RANGED_STAGGER_CHANCE < 1);
  assert.ok(RANGED_STAGGER_SECONDS > 0);

  function spawnNpcTarget(world) {
    const eid=addEntity(world);
    addComponent(world,eid,Health);addComponent(world,eid,NPC);addComponent(world,eid,Combat);
    Health.current[eid]=Health.max[eid]=100;
    NPC.state[eid]=NpcState.LOITERING;
    return eid;
  }

  const originalRandom=Math.random;
  try {
    const world=createWorld();
    const attacker=addEntity(world);
    addComponent(world,attacker,PlayerControlled);
    const target=spawnNpcTarget(world);

    Math.random=()=>RANGED_STAGGER_CHANCE-.01; // just under the threshold -- staggers
    applyRangedDamage(world,target,5,attacker);
    assert.equal(NPC.staggerRemaining[target],RANGED_STAGGER_SECONDS,'a roll under the stagger chance staggers the NPC');

    Health.current[target]=100;
    NPC.staggerRemaining[target]=0;
    Math.random=()=>RANGED_STAGGER_CHANCE+.01; // just over -- never staggers
    applyRangedDamage(world,target,5,attacker);
    assert.equal(NPC.staggerRemaining[target],0,'a roll over the stagger chance never staggers');
  } finally {
    Math.random=originalRandom;
  }

  // A staggered NPC's AI is frozen outright -- npcSystem zeroes its velocity
  // and just counts the timer down, no wander/chase/attack decision at all.
  {
    const world=createWorld();
    const target=spawnNpcTarget(world);
    addComponent(world,target,Position);addComponent(world,target,Velocity);
    NPC.archetypeId[target]='bandit';
    NPC.staggerRemaining[target]=1;
    Velocity.x[target]=5;Velocity.z[target]=5; // pretend it was already moving
    npcSystem(world,.4,()=>'sector');
    assert.ok(NPC.staggerRemaining[target]>0 && NPC.staggerRemaining[target]<1,'staggerRemaining counts down toward 0');
    assert.equal(Velocity.x[target],0,'a staggered NPC is frozen, not moving under its own AI');
    assert.equal(Velocity.z[target],0);

    npcSystem(world,1,()=>'sector'); // well past what's left
    assert.equal(NPC.staggerRemaining[target],0,'stagger never goes negative -- clamped at 0 once it wears off');
  }

  console.log('ranged stagger (flat chance, timed AI freeze) passed');
} finally {await server.close();}
