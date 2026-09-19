import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createWorld, addEntity, addComponent } from 'bitecs';
const server = await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {NPC,Velocity}=await server.ssrLoadModule('/src/ecs/components.ts');
  const animation=await server.ssrLoadModule('/src/ecs/systems/npcAnimation.ts');
  const {getSharedHumanoidRig}=await server.ssrLoadModule('/src/characters/humanoidRig.ts');
  const {MIN_LINGER_SECONDS}=await server.ssrLoadModule('/src/ecs/systems/corpseCleanup.ts');
  assert(MIN_LINGER_SECONDS>getSharedHumanoidRig().clips.death.duration);
  const world=createWorld();
  const meshes=[];
  for(const role of ['villager','bandit','quartermaster','weapons-master','guard']) {
    const {default:archetype}=await server.ssrLoadModule(`/src/assets/npcs/${role}.ts`);
    const eid=addEntity(world);addComponent(world,eid,NPC);addComponent(world,eid,Velocity);
    Velocity.x[eid]=0;Velocity.z[eid]=0;
    const mesh=archetype.createMesh(eid);meshes.push(mesh);
    assert(mesh.isSkinnedMesh);assert.equal(mesh.skeleton.bones.length,23);
    assert.equal(mesh.geometry.index.count/3,1628);assert.equal(mesh.userData.eid,eid);
    if(role==='bandit') {assert(mesh.getObjectByName('dagger'),'bandit carries a dagger');assert.equal(mesh.getObjectByName('dagger').visible,false);}
    else if(role==='weapons-master') {assert(mesh.getObjectByName('woodenSword'),'weapons master carries a wooden sword');assert.equal(mesh.getObjectByName('woodenSword').visible,false);}
    else if(role==='guard') {assert(mesh.getObjectByName('nasalHelmet'));assert(mesh.getObjectByName('noseGuard'));assert(mesh.getObjectByName('chainmail'));}
    else assert(!mesh.getObjectByName('dagger'),`${role} remains unarmed`);
    const tick=(seconds,paused=false)=>{for(let t=0;t<seconds;t+=1/60)animation.npcAnimationSystem(world,1/60,paused);};
    const state=()=>animation.getNpcAnimationDebugState(eid);
    tick(.1);assert.equal(state().activeClip,'idle');
    const before=state().mixerTime;tick(.2,true);assert.equal(state().mixerTime,before);
    Velocity.z[eid]=1;tick(.1);animation.triggerHitReaction(eid);tick(.9);
    assert.equal(state().activeClip,'walk');assert.equal(state().walkWeight,1);
    assert.equal(state().idleWeight,0);
    Velocity.z[eid]=0;tick(.3);assert.equal(state().activeClip,'idle');
    if(role==='bandit') {
      assert(animation.triggerWeaponDraw(eid));tick(.1);assert.equal(state().activeClip,'draw');assert.equal(state().weaponVisible,false);
      tick(.2);assert.equal(state().weaponVisible,true);tick(.3);
      NPC.state[eid]=3;tick(.3);assert.equal(state().activeClip,'combatIdle');
      animation.triggerAttack(eid);tick(.2);assert.equal(state().activeClip,'attack');
      tick(1.7);assert.equal(state().activeClip,'combatIdle');
      animation.triggerParry(eid);tick(.2);assert.equal(state().activeClip,'parry');
      tick(.9);assert.equal(state().activeClip,'combatIdle');
      NPC.state[eid]=0;tick(.3);assert.equal(state().activeClip,'idle');
    }
    animation.triggerHitReaction(eid);tick(.1);animation.triggerDeathCollapse(eid);tick(3,true);
    assert.equal(state().activeClip,'death');assert.equal(state().deathWeight,1);
    assert.equal(state().idleWeight,0);assert.equal(state().walkWeight,0);
    assert.equal(state().deathClipTime,getSharedHumanoidRig().clips.death.duration);
    animation.triggerHitReaction(eid);animation.triggerDeathCollapse(eid);tick(.1);
    assert.equal(state().deathClipTime,getSharedHumanoidRig().clips.death.duration);
    console.log(`${role}: new mesh, idle/walk, modal pause, hit recovery, death interruption and final hold passed`);
  }
  assert.notEqual(meshes[0].skeleton.bones[0],meshes[1].skeleton.bones[0]);
  assert.notEqual(meshes[0].material,meshes[1].material,'bandit tint is independent');
  const {default:cellar}=await server.ssrLoadModule('/src/level/rooms/cellar.ts');
  const banditSpawn=cellar.npcs.find(npc=>npc.id==='bandit');
  assert(banditSpawn.contents.includes('dagger'),'bandit dagger is seeded as corpse loot');
} finally {await server.close();}
