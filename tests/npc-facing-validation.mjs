import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createWorld, addEntity, addComponent } from 'bitecs';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {NPC,NpcState,Position,Rotation,Velocity,Health,PlayerControlled}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {npcSystem}=await server.ssrLoadModule('/src/ecs/systems/npc.ts');
  const world=createWorld();
  const player=addEntity(world);
  for(const component of [Position,Health,PlayerControlled]) addComponent(world,player,component);
  Position.x[player]=3;Position.z[player]=4;Health.current[player]=100;

  const bandit=addEntity(world);
  for(const component of [NPC,Position,Rotation,Velocity,Health]) addComponent(world,bandit,component);
  NPC.archetypeId[bandit]='bandit';NPC.state[bandit]=NpcState.CHASING;
  NPC.homeX[bandit]=0;NPC.homeZ[bandit]=0;NPC.attackCooldownRemaining[bandit]=1;
  Position.x[bandit]=0;Position.z[bandit]=0;
  npcSystem(world,1/60);
  assert(Math.abs(Rotation.yaw[bandit]-Math.atan2(3,4))<1e-6,'chasing bandit faces target');

  Position.x[player]=0;Position.z[player]=-1;NPC.state[bandit]=NpcState.ATTACKING;
  npcSystem(world,1/60);
  assert(Math.abs(Math.abs(Rotation.yaw[bandit])-Math.PI)<1e-6,'attacking bandit turns with target');
  console.log('bandit chase/attack target facing passed');
} finally {await server.close();}
