// Bake the actual Three.js skin + sword for a repeatable offline preview.
import { createServer } from 'vite';
import * as THREE from 'three';
import { mkdir, writeFile } from 'node:fs/promises';
const destination=process.argv[2] ?? '/mnt/data/skeleton-warrior';
await mkdir(destination,{recursive:true});
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {createSkeletonWarriorRig,getSkeletonRibTexture}=await server.ssrLoadModule('/src/characters/skeletonWarrior.ts');
  const rig=createSkeletonWarriorRig(), mixer=new THREE.AnimationMixer(rig.mesh);
  const objects=[];rig.mesh.traverse(o=>{if(o.isMesh)objects.push(o);});
  const colors=[],uv=[],indices=[],faceMaterial=[],doubleSided=[];
  let offset=0;
  for(const object of objects) {
    const g=object.geometry,p=g.attributes.position,idx=g.index?Array.from(g.index.array):Array.from({length:p.count},(_,i)=>i);
    const materials=Array.isArray(object.material)?object.material:[object.material];
    const color=Array(p.count).fill(null);
    const groups=g.groups.length?g.groups:[{start:0,count:idx.length,materialIndex:0}];
    for(const group of groups) {
      const material=materials[group.materialIndex];
      for(let j=group.start;j<group.start+group.count;j++) color[idx[j]]=material;
    }
    for(let i=0;i<p.count;i++) {
      const material=color[i]??materials[0],c=material.color.clone();
      if(material.vertexColors&&g.attributes.color)c.multiply(new THREE.Color().fromBufferAttribute(g.attributes.color,i));
      colors.push(...c.toArray());uv.push(g.attributes.uv?.getX(i)??0,g.attributes.uv?.getY(i)??0);
    }
    for(let f=0;f<idx.length;f+=3) {
      const material=color[idx[f]]??materials[0];
      indices.push(idx[f]+offset,idx[f+1]+offset,idx[f+2]+offset);
      faceMaterial.push(material.map===getSkeletonRibTexture()?1:0);
      doubleSided.push(material.side===THREE.DoubleSide);
    }
    offset+=p.count;
  }
  const bake=(name,time)=>{
    mixer.stopAllAction();rig.skeleton.pose();
    const action=mixer.clipAction(rig.clips[name]);action.reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    mixer.setTime(time);rig.mesh.updateMatrixWorld(true);rig.skeleton.update();
    const result=[],point=new THREE.Vector3();
    for(const object of objects) for(let i=0;i<object.geometry.attributes.position.count;i++) {
      if(object.isSkinnedMesh)object.getVertexPosition(i,point);else point.fromBufferAttribute(object.geometry.attributes.position,i);
      point.applyMatrix4(object.matrixWorld);result.push(...point.toArray().map(n=>Math.round(n*1e5)/1e5));
    }
    return result;
  };
  const texture=getSkeletonRibTexture().image;
  const data={indices,colors,uv,faceMaterial,doubleSided,triangles:rig.mesh.userData.bodyTriangles,
    texture:{width:texture.width,height:texture.height,data:Array.from(texture.data)},
    still:bake('idle',0),
    walk:Array.from({length:32},(_,i)=>bake('walk',i/32*rig.clips.walk.duration)),
    swing:Array.from({length:48},(_,i)=>bake('weaponCross',Math.min(Math.max(i/24-.3,0),rig.clips.weaponCross.duration))),
    jab:Array.from({length:48},(_,i)=>bake('weaponJab',Math.min(Math.max(i/24-.3,0),rig.clips.weaponJab.duration))),
    block:Array.from({length:48},(_,i)=>bake('parry',Math.min(Math.max(i/24-.3,0),.30))),
  };
  await writeFile(`${destination}/model.json`,JSON.stringify(data));
  console.log(destination,`${data.triangles} body triangles`);
} finally {await server.close();}
