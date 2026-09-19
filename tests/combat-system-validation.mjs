import assert from 'node:assert/strict';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {addComponent,addEntity,createWorld}=await import('bitecs');
  const {Combat,Health,Item,Carried,NPC,NpcState,PlayerControlled}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {ATTACK_PROFILES,PARRY_MITIGATION,PARRY_STARTUP,PARRY_WINDOW,applyMeleeDamage,combatSystem,tryParry}=await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const {classifyCombatGesture}=await server.ssrLoadModule('/src/input/touchControls.ts');

  assert.deepEqual(ATTACK_PROFILES,{jab:{damageMultiplier:.7,recovery:.5},cross:{damageMultiplier:1,recovery:.75},chop:{damageMultiplier:1.35,recovery:1}});
  assert.deepEqual(PARRY_MITIGATION,{unarmed:.3,dagger:.5,oneHanded:.75});
  assert.equal(classifyCombatGesture(6,8),'jab','10px remains a tap');
  assert.equal(classifyCombatGesture(-11,2),'cross','left swipe swings');
  assert.equal(classifyCombatGesture(11,2),'jab','right swipe jabs');
  assert.equal(classifyCombatGesture(2,-11),'chop','up swipe chops');
  assert.equal(classifyCombatGesture(2,11),'parry','down swipe parries');

  const setup=(weapon)=>{
    const world=createWorld(),defender=addEntity(world);
    addComponent(world,defender,Health);addComponent(world,defender,Combat);
    Health.current[defender]=100;Health.max[defender]=100;
    Combat.attackRecovery[defender]=0;Combat.parryStartup[defender]=0;Combat.parryWindow[defender]=0;Combat.parryRecovery[defender]=0;
    Combat.parryMitigation[defender]=0;Combat.agility[defender]=0;
    if(weapon){const item=addEntity(world);addComponent(world,item,Item);addComponent(world,item,Carried);Item.itemTypeId[item]=weapon;Carried.ownerEid[item]=defender;Carried.slot[item]='hand-right';}
    return {world,defender};
  };

  for(const [weapon,expected] of [[undefined,7],['dagger',5],['sword',3]]){
    const {world,defender}=setup(weapon);
    assert(tryParry(world,defender),`${weapon??'unarmed'} parry starts`);
    applyMeleeDamage(world,defender,10);
    assert.equal(Health.current[defender],90,'startup does not mitigate');
    combatSystem(world,PARRY_STARTUP);
    assert.equal(Combat.parryWindow[defender],PARRY_WINDOW,'active window opens after startup');
    assert.equal(applyMeleeDamage(world,defender,10),expected,`${weapon??'unarmed'} mitigation`);
    assert(!tryParry(world,defender),'parry cannot be spammed during recovery');
  }
  {
    const {world,defender}=setup();
    Combat.agility[defender]=1;
    Combat.parryMitigation[defender]=PARRY_MITIGATION.dagger;
    assert.equal(applyMeleeDamage(world,defender,10),5,'agile NPC detects the strike and dagger-parries');
    assert(Combat.parryWindow[defender]>0,'reactive NPC parry opens the active window');
  }
  {
    const {world,defender}=setup(),player=addEntity(world);
    addComponent(world,defender,NPC);addComponent(world,player,PlayerControlled);
    NPC.state[defender]=NpcState.LOITERING;NPC.provoked[defender]=0;NPC.provocationHits[defender]=0;NPC.drawRemaining[defender]=0;
    applyMeleeDamage(world,defender,2,player);
    assert.equal(NPC.state[defender],NpcState.LOITERING,'friendly NPC forgives one hit');
    applyMeleeDamage(world,defender,2,player);
    assert.equal(NPC.provoked[defender],1,'friendly NPC retaliates after a second hit');
    assert.equal(NPC.state[defender],NpcState.CHASING);
    assert.equal(NPC.drawRemaining[defender],.5,'retaliation waits for weapon draw');
  }
  console.log('attack balance, recovery and timed parry mitigation passed');
} finally {await server.close();}
