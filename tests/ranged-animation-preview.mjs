import {createServer} from 'vite';
import * as THREE from 'three';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
await mkdir('public/two-handed',{recursive:true});
try{
 const {createRangedRig}=await server.ssrLoadModule('/src/characters/rangedRig.ts');
 for(const kind of ['crossbow','javelin']){
  const records=[];
  for(const name of kind==='crossbow'?['hold','fire']:['hold','jab','throw']){
   const rig=createRangedRig(kind),mixer=new THREE.AnimationMixer(rig.mesh),clip=rig.clips[name];
   const objects=[];rig.mesh.traverse(o=>{if(o.isMesh)objects.push(o);});
   const indices=[],colors=[];let offset=0;
   for(const o of objects){
    const g=o.geometry,n=g.attributes.position.count,c=Array(n*3).fill(.5);
    if(g.attributes.color)c.splice(0,c.length,...g.attributes.color.array);
    else for(const group of g.groups.length?g.groups:[{start:0,count:g.index?.count??n,materialIndex:0}]){
     const mat=Array.isArray(o.material)?o.material[group.materialIndex]:o.material;
     for(let j=group.start;j<group.start+group.count;j++){const i=g.index?g.index.getX(j):j;c.splice(i*3,3,mat.color.r,mat.color.g,mat.color.b);}
    }
    colors.push(...c);indices.push(...(g.index?Array.from(g.index.array,x=>x+offset):Array.from({length:n},(_,i)=>i+offset)));offset+=n;
   }
   const frames=[];let maxError=0;
   for(let f=0;f<72;f++){
    const t=Math.min(Math.max(0,f/24-.25),clip.duration);
    mixer.stopAllAction();const action=mixer.clipAction(clip);action.reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(t);rig.mesh.updateMatrixWorld(true);rig.skeleton.update();
    if(!(name==='throw'&&t>=rig.releaseTime))for(const side of kind==='crossbow'?['R','L']:['R']){
     const hand=rig.skeleton.bones.find(b=>b.name==='hand.'+side),palm=hand.localToWorld(new THREE.Vector3(0,-.065,.014));
     const grip=rig.weapon.localToWorld(kind==='crossbow'?new THREE.Vector3(side==='R'?0:.025,-.07,side==='R'?-.15:.20):new THREE.Vector3());
     maxError=Math.max(maxError,palm.distanceTo(grip));
    }
    const vertices=[];
    for(const o of objects)for(let i=0;i<o.geometry.attributes.position.count;i++){
     const p=new THREE.Vector3();if(o.isSkinnedMesh)o.getVertexPosition(i,p);else p.fromBufferAttribute(o.geometry.attributes.position,i);
     vertices.push(o.localToWorld(p).toArray());
    }
    frames.push(vertices);
   }
   assert(maxError<.025,kind+' '+name+' grip error '+maxError);
   if(name==='throw')assert(rig.weapon.position.z>5,'javelin leaves hand after release');
   if(name==='fire')assert(rig.projectile.position.z>10,'bolt fires forward');
   console.log(kind,name,'grip error',maxError.toFixed(4));
   records.push({name,frames,indices,colors,duration:clip.duration});
  }
  await writeFile(`public/two-handed/${kind}.json`,JSON.stringify(records));
 }
}finally{await server.close();}
