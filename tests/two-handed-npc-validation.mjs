import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createWorld,addEntity,addComponent} from 'bitecs';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {NPC,Combat,Velocity}=await server.ssrLoadModule('/src/ecs/components.ts');
 const a=await server.ssrLoadModule('/src/ecs/systems/twoHandedNpcAnimation.ts');
 const world=createWorld();
 for(const kind of ['quarterstaff','greatsword']) {
  const eid=addEntity(world);for(const c of [NPC,Combat,Velocity])addComponent(world,eid,c);
  Velocity.x[eid]=Velocity.z[eid]=0;Combat.blocking[eid]=0;
  const mesh=a.createTwoHandedNpcMesh(kind,eid);let hits=[];
  const run=(seconds,paused=false)=>{for(let t=0;t<seconds;t+=.01)a.updateTwoHandedNpcs(world,.01,paused);};
  a.beginTwoHandedAttack(eid,t=>hits.push(t));run(.2);assert.equal(hits.length,0,'wind-up has no damage');
  run(1,true);assert.equal(hits.length,0,'pause does not progress attack');
  run(1.3);assert.deepEqual(hits,['jab']);assert(!a.twoHandedLocked(eid));
  a.beginTwoHandedAttack(eid,t=>hits.push(t));run(.2);a.reactTwoHanded(eid,'hit');run(2);
  assert.deepEqual(hits,['jab'],'hit cancels pending swing');
  Combat.blocking[eid]=1;run(3);assert(a.twoHandedLocked(eid),'block remains held');
  Combat.blocking[eid]=0;run(.1);assert(!a.twoHandedLocked(eid),'release lowers block');
  a.beginTwoHandedAttack(eid,t=>hits.push(t));a.reactTwoHanded(eid,'death');run(3);
  assert.deepEqual(hits,['jab'],'death cancels pending strike');
  assert.equal(a.twoHandedWeapon(eid).parent.name,'hand.R','weapon follows corpse hand');
  assert(mesh.getObjectByName('twoHandedProp'));
  console.log(kind+': delayed contact, pause, interrupt, indefinite block and death passed');
 }
}finally{await server.close();}
