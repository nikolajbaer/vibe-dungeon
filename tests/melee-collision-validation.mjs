import assert from 'node:assert/strict';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {addComponent,addEntity,createWorld,removeComponent}=await import('bitecs');
  const {Carried,CharacterBody,Combat,Dead,Health,Item,NPC,NpcState,PhysicsBody,PlayerControlled,Position,Rotation,Stamina,Velocity}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {initPhysics,createPhysics,addCharacter,addCombatHitboxes,queryCombatHitboxes}=await server.ssrLoadModule('/src/physics/world.ts');
  const {registerMeleeSwing,meleeCollisionSystem,getCombatHitboxColliders}=await server.ssrLoadModule('/src/ecs/systems/meleeCollision.ts');
  const {ATTACK_STAMINA_COST,applyMeleeDamage,tryMeleeAttack}=await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const {npcSystem}=await server.ssrLoadModule('/src/ecs/systems/npc.ts');
  const {default:bandit}=await server.ssrLoadModule('/src/assets/npcs/bandit.ts');

  await initPhysics();
  const physics=createPhysics();
  // One shared bitecs world (and one shared Rapier world) for every block
  // below, each placed 100m apart along X -- meleeCollision.ts's own
  // bookkeeping (registeredEids/colliderOwners/pendingSwings) is
  // module-level state keyed by eid, exactly like rangedCombat.ts's
  // `reloads`/`flyingBolts` or npcAnimation.ts's `npcAnimations` map, so a
  // fresh createWorld() per block would silently collide eids (bitecs
  // numbers entities from 1 in every world) against that state -- and a
  // fresh Rapier world per block wouldn't help anyway, since real gameplay
  // never spins up more than one of either. Spacing blocks out in world
  // space keeps them from ever seeing each other's colliders instead.
  const world=createWorld();
  let blockX=0;
  const nextBlock=()=>{ blockX+=100; return blockX; };

  function spawnCombatant(bx,{dx=0,dz,yaw=0,radius=.35,halfHeight=.55}){
    const eid=addEntity(world);
    addComponent(world,eid,Health);addComponent(world,eid,CharacterBody);addComponent(world,eid,PhysicsBody);
    addComponent(world,eid,Position);addComponent(world,eid,Rotation);
    Health.current[eid]=Health.max[eid]=100;
    CharacterBody.radius[eid]=radius;CharacterBody.halfHeight[eid]=halfHeight;
    Position.x[eid]=bx+dx;Position.y[eid]=0;Position.z[eid]=dz;
    Rotation.yaw[eid]=yaw;
    const handles=addCharacter(physics,bx+dx,0,dz,radius,halfHeight);
    PhysicsBody[eid]=handles.body;
    return eid;
  }

  // Matches game.ts's real ordering: physics.world.step() always runs
  // before any query against the world (Rapier's query pipeline -- what
  // intersectionsWithShape reads -- is only brought up to date as part of a
  // step, not incrementally as colliders are created). A brand-new
  // combatant's combat hitboxes are themselves created lazily on first
  // sight (`ensureCombatHitboxes`, called from inside meleeCollisionSystem)
  // -- meaning colliders created *this* call aren't queryable until *next*
  // call's step, one tick later. Harmless in real continuous play (a swing
  // stays active for many real frames, so it simply finds a freshly-created
  // hitbox one tick later than an already-registered one), so each block
  // "warms up" with one no-op tick right after spawning, before registering
  // and resolving a real swing, rather than assuming the very first tick
  // sees everything.
  const tick=(dt)=>{
    physics.world.step();
    const hits=meleeCollisionSystem(world,physics,dt);
    for(const hit of hits) applyMeleeDamage(world,hit.targetEid,hit.damage,hit.attackerEid);
    return hits;
  };
  const warmUp=()=>{ tick(0); };

  // A target directly in front (yaw 0 faces -Z, per the codebase's own
  // convention -- see combat.ts/npc.ts) and within reach gets hit.
  {
    const bx=nextBlock();
    const attacker=spawnCombatant(bx,{dz:0});
    const target=spawnCombatant(bx,{dz:-1});
    warmUp();
    registerMeleeSwing(attacker,0,-1,1.4,.8,1.1,15,.2);
    const hits=tick(1/60);
    assert.equal(hits.length,1,'a target directly in front of a swing is hit');
    assert.equal(hits[0].targetEid,target);
    assert.equal(hits[0].attackerEid,attacker);
    assert.ok(['head','torso','legs'].includes(hits[0].part));
    assert.equal(hits[0].damage,15,'melee damage is flat -- no per-part multiplier (that\'s ranged-only now)');
    assert.equal(Health.current[target],100-Math.round(hits[0].damage),'applyMeleeDamage actually lands the resolved damage');
  }

  // Well outside reach: never hit, and the swing quietly expires (not stuck
  // resolving forever) once its active window runs out.
  {
    const bx=nextBlock();
    const attacker=spawnCombatant(bx,{dz:0});
    spawnCombatant(bx,{dz:-5});
    warmUp();
    registerMeleeSwing(attacker,0,-1,1.4,.8,1.1,15,.1);
    let hits=[];
    for(let t=0;t<.3;t+=1/60) hits=hits.concat(tick(1/60));
    assert.equal(hits.length,0,'a target well outside reach is never hit, however long the window stays open');
  }

  // Never hits the attacker's own body.
  {
    const bx=nextBlock();
    const attacker=spawnCombatant(bx,{dz:0});
    warmUp();
    registerMeleeSwing(attacker,0,-1,1.4,.8,1.1,15,.2);
    const hits=tick(1/60);
    assert.equal(hits.length,0,'a swing with nothing else around never counts the attacker\'s own hitbox');
  }

  // Never hits an already-dead target.
  {
    const bx=nextBlock();
    const attacker=spawnCombatant(bx,{dz:0});
    const target=spawnCombatant(bx,{dz:-1});
    addComponent(world,target,Dead);
    warmUp();
    registerMeleeSwing(attacker,0,-1,1.4,.8,1.1,15,.2);
    const hits=tick(1/60);
    assert.equal(hits.length,0,'a dead target is never counted as a hit');
  }

  // A dead combatant's hitbox cylinders are actually removed from the
  // physics world (and this module's own bookkeeping), not just excluded
  // from hit resolution -- otherwise a corpse's cylinders sit around
  // forever and the debug overlay (which just draws whatever's still
  // registered) keeps showing them long after the NPC died.
  {
    const bx=nextBlock();
    const attacker=spawnCombatant(bx,{dz:0});
    const target=spawnCombatant(bx,{dz:-1});
    warmUp(); // registers both combatants' hitbox cylinders
    assert.equal(getCombatHitboxColliders().filter((c)=>c.eid===target).length,3,'the target starts with three registered cylinders');
    addComponent(world,target,Dead);
    tick(1/60); // meleeCollisionSystem's pruneDeadHitboxes should now remove them
    assert.equal(getCombatHitboxColliders().filter((c)=>c.eid===target).length,0,'a dead target\'s cylinders are pruned from the debug/query registry');
    assert.equal(getCombatHitboxColliders().filter((c)=>c.eid===attacker).length,3,'pruning a dead target leaves a still-living combatant\'s own cylinders alone');
  }

  // "Count one collision for the swing": a box tall enough to overlap
  // several of the target's cylinders at once still resolves to exactly
  // one hit, and always at the swing's flat, unmultiplied damage -- melee
  // no longer favors whichever body part it happened to land on.
  {
    const bx=nextBlock();
    const attacker=spawnCombatant(bx,{dz:0});
    spawnCombatant(bx,{dz:-1});
    warmUp();
    registerMeleeSwing(attacker,0,-1,1.4,.8,3,15,.2); // 3m tall -- spans the whole target's height
    const hits=tick(1/60);
    assert.equal(hits.length,1,'a swing overlapping multiple cylinders on one target still counts as a single hit');
    assert.ok(['head','torso','legs'].includes(hits[0].part));
    assert.equal(hits[0].damage,15,'damage stays flat no matter which of the overlapping parts resolved');
  }

  // Physics-layer check, independent of registerMeleeSwing's own fixed swing
  // height: three real cylinders exist, stacked bottom to top, and a query
  // box confined to one band only ever finds that band's cylinder.
  {
    const bx=nextBlock();
    const handles=addCharacter(physics,bx,0,0,.35,.55);
    const parts=addCombatHitboxes(physics,handles.body,.35,.55);
    physics.world.step(); // bring the query pipeline up to date, same as tick() does
    assert.equal(parts.length,3,'three body-part cylinders are attached');
    assert.deepEqual(new Set(parts.map(p=>p.part)),new Set(['legs','torso','head']));
    const ownersByHandle=new Map(parts.map(p=>[p.collider.handle,p.part]));

    const legsBox={cx:bx,cy:.3,cz:0,rotation:{x:0,y:0,z:0,w:1},hx:1,hy:.2,hz:1};
    const legsHits=queryCombatHitboxes(physics,legsBox);
    assert.ok(legsHits.length>0,'a box at ground level finds the legs cylinder');
    for(const c of legsHits) assert.equal(ownersByHandle.get(c.handle),'legs','a ground-level box never reaches into the torso');

    const headBox={cx:bx,cy:1.75,cz:0,rotation:{x:0,y:0,z:0,w:1},hx:1,hy:.05,hz:1};
    const headHits=queryCombatHitboxes(physics,headBox);
    assert.ok(headHits.length>0,'a box at the crown finds the head cylinder');
    for(const c of headHits) assert.equal(ownersByHandle.get(c.handle),'head');
  }

  // tryMeleeAttack end to end: an equipped sword's reach is scaled by the
  // requested attack type -- a jab's extended reach connects at a distance
  // a chop's shorter one can't.
  {
    const setupPlayer=(attackType,distance)=>{
      const bx=nextBlock();
      const player=spawnCombatant(bx,{dz:0});
      addComponent(world,player,PlayerControlled);addComponent(world,player,Combat);addComponent(world,player,Stamina);
      Combat.attackRecovery[player]=0;Combat.blocking[player]=0;Combat.agility[player]=0;
      Stamina.max[player]=100;Stamina.current[player]=100;
      const sword=addEntity(world);
      addComponent(world,sword,Item);addComponent(world,sword,Carried);
      Item.itemTypeId[sword]='sword';Carried.ownerEid[sword]=player;Carried.slot[sword]='hand-right';
      spawnCombatant(bx,{dz:-distance});
      warmUp();
      const fired=tryMeleeAttack(world,attackType);
      assert.equal(fired,true,`${attackType} throws a swing`);
      assert.ok(Combat.attackRecovery[player]>0,'attack recovery starts');
      assert.equal(tryMeleeAttack(world,attackType),false,'cannot attack again during recovery');
      let hits=[];
      for(let t=0;t<.05;t+=1/60) hits=hits.concat(tick(1/60));
      // Both tryMeleeAttack and npcSystem later on grab the *first* matching
      // PlayerControlled entity in the whole shared world -- clean this
      // block's up so it can't shadow a later block's own player.
      removeComponent(world,player,PlayerControlled);
      return hits;
    };
    // sword reach 1.4m; jab multiplier 1.15 -> 1.61m box reach, chop 0.85 ->
    // 1.19m. The target's own .35m capsule radius brings its near surface
    // that much closer than its center distance, so 1.7m center-to-center
    // (surface at 1.35m) sits inside jab's reach but outside chop's.
    assert.equal(setupPlayer('jab',1.7).length,1,'a jab\'s extended reach connects at 1.7m');
    assert.equal(setupPlayer('chop',1.7).length,0,'a chop\'s shorter reach misses the same 1.7m target');
  }

  // tryMeleeAttack refuses outright -- same as being on cooldown -- without
  // enough stamina for the requested attack type, and deducts it on success.
  {
    const bx=nextBlock();
    const player=spawnCombatant(bx,{dz:0});
    addComponent(world,player,PlayerControlled);addComponent(world,player,Combat);addComponent(world,player,Stamina);
    Combat.attackRecovery[player]=0;Combat.blocking[player]=0;Combat.agility[player]=0;
    Stamina.max[player]=100;Stamina.current[player]=ATTACK_STAMINA_COST.chop-1;
    assert.equal(tryMeleeAttack(world,'chop'),false,'too little stamina refuses the chop outright');
    Stamina.current[player]=ATTACK_STAMINA_COST.chop;
    assert.equal(tryMeleeAttack(world,'chop'),true,'exactly enough stamina lets the chop through');
    assert.equal(Stamina.current[player],0,'the chop\'s full stamina cost was deducted');
    removeComponent(world,player,PlayerControlled);
  }

  // NPC attack path (npc.ts's updateAggressive): an aggressive-testStyle
  // bandit right next to the player eventually lands a real, resolved hit
  // -- not the old guaranteed-on-cooldown distance check.
  {
    const bx=nextBlock();
    const player=spawnCombatant(bx,{dz:0});
    addComponent(world,player,PlayerControlled);addComponent(world,player,Velocity);
    Velocity.x[player]=0;Velocity.z[player]=0;

    const npcEid=spawnCombatant(bx,{dz:-1});
    addComponent(world,npcEid,NPC);addComponent(world,npcEid,Velocity);
    Health.current[npcEid]=Health.max[npcEid]=bandit.health;
    Velocity.x[npcEid]=0;Velocity.z[npcEid]=0;
    NPC.archetypeId[npcEid]='bandit';
    NPC.testStyle[npcEid]='aggressive';
    NPC.state[npcEid]=NpcState.LOITERING;
    NPC.attackCooldownRemaining[npcEid]=0;NPC.drawRemaining[npcEid]=0;NPC.provoked[npcEid]=0;NPC.provocationHits[npcEid]=0;
    warmUp();

    let landed=false;
    for(let t=0;t<1.5 && !landed;t+=1/60){
      npcSystem(world,1/60);
      if(tick(1/60).length>0) landed=true;
    }
    assert.ok(landed,'an aggressive NPC within range eventually lands a resolved swing on the player');
    assert.ok(Health.current[player]<100,'the resolved swing actually damaged the player');
  }

  console.log('melee swing collision, flat damage, cylinder placement, weapon reach, stamina gating and NPC attack passed');
} finally {await server.close();}
