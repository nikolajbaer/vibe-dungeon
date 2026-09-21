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
  npcSystem(world,1/60,()=>'test-sector');
  assert(Math.abs(Rotation.yaw[bandit]-Math.atan2(3,4))<1e-6,'chasing bandit faces target');

  Position.x[player]=0;Position.z[player]=-1;NPC.state[bandit]=NpcState.ATTACKING;
  npcSystem(world,1/60,()=>'test-sector');
  assert(Math.abs(Math.abs(Rotation.yaw[bandit])-Math.PI)<1e-6,'attacking bandit turns with target');

  const testOpponent=addEntity(world);
  for(const component of [NPC,Position,Rotation,Velocity,Health]) addComponent(world,testOpponent,component);
  NPC.archetypeId[testOpponent]='villager';NPC.state[testOpponent]=NpcState.LOITERING;
  NPC.homeX[testOpponent]=4;NPC.homeZ[testOpponent]=0;NPC.moveSpeed[testOpponent]=4;
  NPC.testStyle[testOpponent]='aggressive';
  Position.x[testOpponent]=4;Position.z[testOpponent]=0;
  Position.x[player]=0;Position.z[player]=0;
  npcSystem(world,1/60,()=>'test-sector');
  npcSystem(world,1/60,()=>'test-sector');
  assert(Math.abs(Math.hypot(Velocity.x[testOpponent],Velocity.z[testOpponent])-4)<1e-6,'configured aggressive opponent uses slider speed');

  NPC.testStyle[testOpponent]='passive';Velocity.x[testOpponent]=2;Velocity.z[testOpponent]=2;
  npcSystem(world,1/60,()=>'test-sector');
  assert.equal(Velocity.x[testOpponent],0,'passive test opponent stops moving');
  assert.equal(Velocity.z[testOpponent],0,'passive test opponent stops moving on both axes');
  console.log('bandit facing and configurable opponent styles passed');
} finally {await server.close();}
