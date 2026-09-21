import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {addComponent,addEntity,createWorld} from 'bitecs';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const c=await server.ssrLoadModule('/src/ecs/components.ts');
  const {applyMeleeDamage}=await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const {PRACTICE_POINTS,practiceSystem,startPractice}=await server.ssrLoadModule('/src/ecs/systems/practice.ts');
  const {ITEM_REGISTRY}=await server.ssrLoadModule('/src/assets/itemRegistry.ts');
  const {DIALOGUE_REGISTRY}=await server.ssrLoadModule('/src/dialogue/dialogueRegistry.ts');
  const {default:training}=await server.ssrLoadModule('/src/level/rooms/training-wing.ts');
  const world=createWorld(),player=addEntity(world),master=addEntity(world);
  for(const component of [c.PlayerControlled,c.Health,c.Combat,c.Position,c.Velocity])addComponent(world,player,component);
  for(const component of [c.NPC,c.Health,c.Combat,c.Position,c.Velocity])addComponent(world,master,component);
  c.Health.current[player]=c.Health.max[player]=100;c.Health.current[master]=c.Health.max[master]=100;
  for(const eid of [player,master]){c.Combat.attackRecovery[eid]=0;c.Combat.blocking[eid]=0;c.Combat.agility[eid]=0;}
  c.NPC.wanderTargetX[master]=c.NPC.homeX[master]=c.Position.x[master]=30;
  c.NPC.wanderTargetZ[master]=c.NPC.homeZ[master]=c.Position.z[master]=6;
  c.Velocity.x[master]=c.Velocity.z[master]=0;

  assert(startPractice(world,master,0),'practice starts');
  assert.equal(c.Practice.points[player],PRACTICE_POINTS);assert.equal(c.Practice.points[master],PRACTICE_POINTS);
  applyMeleeDamage(world,master,PRACTICE_POINTS);
  assert.equal(c.Health.current[master],100,'practice damage never touches real health');
  const result=practiceSystem(world);
  assert(result?.playerWon,'player wins when master runs out of practice points');
  assert.equal(c.Practice.active[player],0);assert.equal(c.NPC.state[master],c.NpcState.LOITERING);

  assert(ITEM_REGISTRY.wooden_sword,'wooden sword is registered');
  assert(training.items.some(item=>item.id==='wooden_sword'),'wooden sword is placed in training room');
  assert(training.npcs.some(npc=>npc.id==='weapons-master'),'weapons master is placed in training room');
  assert.equal(DIALOGUE_REGISTRY['weapons-master'].nodes.greeting.choices.filter(choice=>choice.effect==='startPractice').length,3);
  console.log('non-lethal practice bout, wooden sword, master placement and difficulty dialogue passed');
} finally {await server.close();}
