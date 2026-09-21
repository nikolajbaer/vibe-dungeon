import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createWorld, addEntity, addComponent } from 'bitecs';

// npc.ts's sector-based leash: an aggressive NPC's chase is relentless --
// retreating never shakes it on its own -- but gives up the instant the
// target leaves whatever sector the NPC shares with it, *once they've
// actually shared one* (NPC.reachedTargetSector). That gate matters because
// aggroRange has no line-of-sight check, so a chase can begin with the
// target already in a different sector (behind a wall/door) -- leashing on
// that immediately, before the chase ever had a chance to close the gap,
// was a real regression this test guards against.

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {NPC,NpcState,Position,Rotation,Velocity,Health,PlayerControlled}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {npcSystem}=await server.ssrLoadModule('/src/ecs/systems/npc.ts');

  // A trivial two-sector world: everything left of x=3 is "A", everything
  // at or past it is "B" -- enough to test crossing a boundary without a
  // real level.
  const sectorAt=(x)=>x<3?'A':'B';

  function spawnBandit(world,x,z){
    const eid=addEntity(world);
    for(const component of [NPC,Position,Rotation,Velocity,Health]) addComponent(world,eid,component);
    NPC.archetypeId[eid]='bandit';NPC.state[eid]=NpcState.LOITERING;
    NPC.homeX[eid]=x;NPC.homeZ[eid]=z;NPC.attackCooldownRemaining[eid]=1;
    Position.x[eid]=x;Position.z[eid]=z;
    return eid;
  }

  // Aggro fires across a sector boundary (bandit in "A", target already in
  // "B", well within aggroRange) -- the chase must NOT immediately leash on
  // the very next tick just because the two started in different sectors;
  // it hasn't had a chance to close the distance yet.
  {
    const world=createWorld();
    const player=addEntity(world);
    for(const component of [Position,Health,PlayerControlled]) addComponent(world,player,component);
    Position.x[player]=5;Position.z[player]=0;Health.current[player]=100; // sector B

    const bandit=spawnBandit(world,0,0); // sector A, distance 5 <= aggroRange 6
    npcSystem(world,1/60,sectorAt);
    assert.equal(NPC.state[bandit],NpcState.CHASING,'aggro fires across a sector boundary');

    npcSystem(world,1/60,sectorAt); // the tick where the old bug immediately re-leashed
    assert.equal(NPC.state[bandit],NpcState.CHASING,'never having shared a sector yet, the chase is not leashed on its first real tick');
  }

  // Once the NPC and target have actually shared a sector, retreating
  // *within* it never leashes -- pursuit is relentless up to that point.
  {
    const world=createWorld();
    const player=addEntity(world);
    for(const component of [Position,Health,PlayerControlled]) addComponent(world,player,component);
    Position.x[player]=1;Position.z[player]=0; // sector A, same as the bandit

    const bandit=spawnBandit(world,0,0);
    npcSystem(world,1/60,sectorAt); // LOITERING -> CHASING
    npcSystem(world,1/60,sectorAt); // now in the CHASING/ATTACKING branch: sectors match -> reachedTargetSector set
    assert.notEqual(NPC.state[bandit],NpcState.LOITERING,'still engaged after sharing a sector');

    Position.x[player]=2.9; // retreats, but still inside sector A
    npcSystem(world,1/60,sectorAt);
    assert.notEqual(NPC.state[bandit],NpcState.LOITERING,'retreating within the same sector never shakes pursuit');
  }

  // Having shared a sector, the target actually leaving it does leash.
  {
    const world=createWorld();
    const player=addEntity(world);
    for(const component of [Position,Health,PlayerControlled]) addComponent(world,player,component);
    Position.x[player]=1;Position.z[player]=0; // sector A

    const bandit=spawnBandit(world,0,0);
    npcSystem(world,1/60,sectorAt); // LOITERING -> CHASING
    npcSystem(world,1/60,sectorAt); // sectors match -> reachedTargetSector set
    assert.notEqual(NPC.state[bandit],NpcState.LOITERING,'engaged before the target retreats out of sector');

    Position.x[player]=5; // sector B -- the bandit (still at x=0, sector A) never followed
    npcSystem(world,1/60,sectorAt);
    assert.equal(NPC.state[bandit],NpcState.LOITERING,'the target actually leaving the shared sector gives up the chase');
  }

  console.log('sector-based pursuit leash (relentless within a sector, gives up on leaving one already shared) passed');
} finally {await server.close();}
