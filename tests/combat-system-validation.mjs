import assert from 'node:assert/strict';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {addComponent,addEntity,createWorld}=await import('bitecs');
  const {Combat,Health,Item,Carried,NPC,NpcState,PlayerControlled,Stamina}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {ATTACK_PROFILES,ATTACK_STAMINA_COST,BLOCK_MITIGATION,STAMINA_REGEN_PER_SECOND,applyMeleeDamage,combatSystem,setBlocking,tryMeleeAttack}=await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const {classifyCombatGesture}=await server.ssrLoadModule('/src/input/touchControls.ts');

  assert.deepEqual(ATTACK_PROFILES,{jab:{damageMultiplier:.7,recovery:.5},swing:{damageMultiplier:1.35,recovery:1}});
  assert.deepEqual(BLOCK_MITIGATION,{unarmed:.3,dagger:.5,oneHanded:.75});
  // jab vs. the charged swing is decided by hold duration now (combat.ts's
  // tryStartSwingCharge/releaseSwingCharge), not by swipe shape -- this only
  // ever needs to pull a deliberate downward swipe (block) out.
  assert.equal(classifyCombatGesture(8),'attack','a small vertical drift attacks');
  assert.equal(classifyCombatGesture(-11),'attack','an upward nudge attacks');
  assert.equal(classifyCombatGesture(21),'block','a deliberate downward swipe blocks');

  const setup=(weapon)=>{
    const world=createWorld(),defender=addEntity(world);
    addComponent(world,defender,Health);addComponent(world,defender,Combat);
    Health.current[defender]=100;Health.max[defender]=100;
    Combat.attackRecovery[defender]=0;Combat.blocking[defender]=0;Combat.agility[defender]=0;
    if(weapon){const item=addEntity(world);addComponent(world,item,Item);addComponent(world,item,Carried);Item.itemTypeId[item]=weapon;Carried.ownerEid[item]=defender;Carried.slot[item]='hand-right';}
    return {world,defender};
  };

  // Held block (Skyrim-style, replacing the old timed parry): mitigation is
  // looked up live from whatever's currently equipped, not snapshotted when
  // block started, and there's no window to miss -- every hit while it's
  // held is mitigated, and releasing it drops straight back to full damage.
  for(const [weapon,expected] of [[undefined,7],['dagger',5],['sword',3]]){
    const {world,defender}=setup(weapon);
    setBlocking(world,defender,true);
    assert.equal(Combat.blocking[defender],1,`${weapon??'unarmed'} block raises`);
    assert.equal(applyMeleeDamage(world,defender,10),expected,`${weapon??'unarmed'} mitigation`);
    setBlocking(world,defender,false);
    assert.equal(Combat.blocking[defender],0,'releasing block clears the flag');
    assert.equal(applyMeleeDamage(world,defender,10),10,'an unblocked hit lands full damage');
  }

  // Block can't be raised mid-attack-recovery -- the same "can't parry
  // mid-swing" gate the old timed parry had.
  {
    const {world,defender}=setup();
    Combat.attackRecovery[defender]=0.5;
    setBlocking(world,defender,true);
    assert.equal(Combat.blocking[defender],0,'block cannot be raised mid-attack-recovery');
  }

  // NPC reactive block: agility rolls once per landed hit (no held input of
  // its own), rather than reacting into a timed window.
  {
    const {world,defender}=setup();
    Combat.agility[defender]=1;
    assert.equal(applyMeleeDamage(world,defender,10),7,'a fully agile unarmed NPC always blocks (30% mitigation)');
  }
  {
    const {world,defender}=setup();
    Combat.agility[defender]=0;
    assert.equal(applyMeleeDamage(world,defender,10),10,'a zero-agility NPC never reactively blocks');
  }

  // Stamina: each attack type costs stamina and refuses outright -- the same
  // as being on cooldown -- once it's too low; it regenerates continuously.
  {
    const world=createWorld(),player=addEntity(world);
    addComponent(world,player,PlayerControlled);addComponent(world,player,Combat);addComponent(world,player,Stamina);
    Combat.attackRecovery[player]=0;Combat.blocking[player]=0;Combat.agility[player]=0;
    Stamina.max[player]=100;Stamina.current[player]=100;
    assert.equal(tryMeleeAttack(world,'swing'),true,'enough stamina lets the attack through');
    assert.equal(Stamina.current[player],100-ATTACK_STAMINA_COST.swing,'the attack deducted its stamina cost');
    Combat.attackRecovery[player]=0; // bypass recovery gate to isolate the stamina check
    Stamina.current[player]=ATTACK_STAMINA_COST.swing-1;
    assert.equal(tryMeleeAttack(world,'swing'),false,'too little stamina refuses the attack outright');
    assert.equal(Stamina.current[player],ATTACK_STAMINA_COST.swing-1,'a refused attack never deducts stamina');
    combatSystem(world,1);
    assert.ok(Math.abs(Stamina.current[player]-(ATTACK_STAMINA_COST.swing-1+STAMINA_REGEN_PER_SECOND))<1e-9,'stamina regenerates over time');
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
  console.log('attack balance, held block mitigation, and stamina gating passed');
} finally {await server.close();}
