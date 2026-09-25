import {createServer} from 'vite';
import * as THREE from 'three';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
await mkdir('public/two-handed',{recursive:true});
try {
 const {createTwoHandedRig}=await server.ssrLoadModule('/src/characters/twoHandedRig.ts');
 for(const kind of ['quarterstaff','greatsword']) {
  const records=[];
  for(const name of ['jab','swing','block']) {
   const rig=createTwoHandedRig(kind),mixer=new THREE.AnimationMixer(rig.mesh);
   const duration=name==='block'?2.4:rig.clips[name].duration;
   const body=rig.mesh.geometry,prop=rig.weapon.geometry;
   const colors=Array.from(body.attributes.color.array),indices=Array.from(body.index.array),n=body.attributes.position.count;
   const pc=Array(prop.attributes.position.count*3).fill(.5);
   for(const g of prop.groups)for(let j=g.start;j<g.start+g.count;j++) {
    const index=prop.index.getX(j),c=rig.weapon.material[g.materialIndex].color;
    pc.splice(index*3,3,c.r,c.g,c.b);
   }
   colors.push(...pc);indices.push(...Array.from(prop.index.array,x=>x+n));
   const frames=[];let maxGripError=0;const rightFootZ=[];
   for(let f=0;f<72;f++) {
    const t=f/24;
    const clip=name==='block'&&t<rig.clips.blockEnter.duration?rig.clips.blockEnter:rig.clips[name];
    const local=name==='block'?(clip===rig.clips.blockEnter?t:0):Math.min(Math.max(t-.25,0),duration);
    mixer.stopAllAction();const action=mixer.clipAction(clip);action.reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(local);
    rig.mesh.updateMatrixWorld(true);rig.skeleton.update();
    rightFootZ.push(rig.skeleton.bones.find(b=>b.name==='foot.R').getWorldPosition(new THREE.Vector3()).z);
    for(const [j,side] of ['R','L'].entries()) {
     const hand=rig.skeleton.bones.find(b=>b.name==='hand.'+side);
     const palm=hand.localToWorld(rig.palmOffset.clone());
     const grip=rig.weapon.localToWorld(new THREE.Vector3(0,0,rig.grip[j]));
     maxGripError=Math.max(maxGripError,palm.distanceTo(grip));
    }
    const vertices=[];
    for(let i=0;i<n;i++){const p=new THREE.Vector3();rig.mesh.getVertexPosition(i,p);vertices.push(p.toArray());}
    for(let i=0;i<prop.attributes.position.count;i++)vertices.push(rig.weapon.localToWorld(new THREE.Vector3().fromBufferAttribute(prop.attributes.position,i)).toArray());
    frames.push(vertices);
   }
   console.log(kind,name,'max grip error',maxGripError.toFixed(4));
   assert(maxGripError<.02,`${kind} ${name}: hands must remain within 2cm of the grip`);
   if(kind==='greatsword'&&name==='swing') {
    assert(Math.min(...rightFootZ)<-.35,'rear foot slides back during chamber');
    assert(Math.max(...rightFootZ)>.60,'right foot passes the left foot in a large forward step');
   }
   records.push({name,frames,indices,colors,duration});
  }
  await writeFile(`public/two-handed/${kind}.json`,JSON.stringify(records));
 }
}finally{await server.close();}
