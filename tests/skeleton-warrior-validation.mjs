import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createHumanoidBase } = await server.ssrLoadModule('/src/characters/humanoidBase.ts');
  const { createSkeletonWarriorRig, getSkeletonRibTexture } = await server.ssrLoadModule('/src/characters/skeletonWarrior.ts');
  const human = createHumanoidBase(), rig = createSkeletonWarriorRig();
  assert.deepEqual(rig.skeleton.bones.map(b=>b.name), human.skeleton.bones.map(b=>b.name));
  rig.skeleton.bones.forEach((bone,i)=>assert.deepEqual(bone.position.toArray(),human.skeleton.bones[i].position.toArray()));
  assert.deepEqual(Object.keys(rig.clips),Object.keys(human.clips));
  assert.equal(rig.mesh.geometry.groups.length,2,'the body must stay at two material passes');
  assert(rig.mesh.userData.bodyTriangles<2500,'keep skeleton body under 2500 triangles');
  const alpha=Array.from(getSkeletonRibTexture().image.data).filter((_,i)=>i%4===3);
  assert(alpha.some(a=>a===0)&&alpha.some(a=>a===255),'rib cage must have real cutout gaps');
  const geometry=rig.mesh.geometry, weights=geometry.attributes.skinWeight;
  for(let i=0;i<weights.count;i++) assert(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<1e-6);
  const duplicate=clone(rig.mesh);
  assert.notEqual(duplicate.skeleton.bones[0],rig.skeleton.bones[0]);
  assert.equal(duplicate.getObjectByName('shortSword').parent.name,'hand.R');
  const mixer=new THREE.AnimationMixer(rig.mesh), point=new THREE.Vector3();
  for(const name of ['walk','weaponJab','weaponCross','parry','hit','death']) {
    mixer.stopAllAction(); rig.skeleton.pose();
    const action=mixer.clipAction(rig.clips[name]);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    for(let frame=0;frame<=8;frame++) {
      mixer.setTime(rig.clips[name].duration*frame/8);
      rig.mesh.updateMatrixWorld(true);rig.skeleton.update();
      let minY=Infinity;
      for(let i=0;i<geometry.attributes.position.count;i++) {
        rig.mesh.getVertexPosition(i,point); assert(Number.isFinite(point.x+point.y+point.z)); minY=Math.min(minY,point.y);
      }
      assert(minY>-.07,`${name} must keep bones above the floor`);
    }
  }
  const { NPC_REGISTRY }=await server.ssrLoadModule('/src/assets/npcRegistry.ts');
  assert(NPC_REGISTRY['skeleton-warrior']);
  console.log(`Skeleton warrior: ${rig.mesh.userData.bodyTriangles} triangles, 23 matching bones, two body material passes; clone, cutout texture and combat deformation passed.`);
} finally { await server.close(); }
