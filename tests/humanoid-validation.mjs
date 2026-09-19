import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.();}); }
  readAsDataURL(blob) { blob.arrayBuffer().then(data=>{this.result=`data:${blob.type};base64,${Buffer.from(data).toString('base64')}`;this.onloadend?.();}); }
};
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
const out=new URL('../public/characters/',import.meta.url);
await mkdir(out,{recursive:true});
try {
  const {createHumanoidBase}=await server.ssrLoadModule('/src/characters/humanoidBase.ts');
  for(const species of ['human','elf','goblin','dwarf']) {
    const rig=createHumanoidBase({species});
    const g=rig.mesh.geometry, weights=g.attributes.skinWeight, joints=g.attributes.skinIndex;
    assert.equal(rig.skeleton.bones.length,23);
    assert.equal(new Set(rig.skeleton.bones.map(b=>b.name)).size,23);
    assert.equal(rig.skeleton.bones.find(b=>b.name==='clavicle.L').parent.name,'chest');
    let blended=0;
    for(let i=0;i<weights.count;i++){
      let sum=0; for(let j=0;j<4;j++){const v=weights.array[i*4+j]; assert(v>=0&&v<=1);sum+=v;assert(joints.array[i*4+j]<23);}
      assert(Math.abs(sum-1)<1e-6);if(weights.getY(i)>0)blended++;
    }
    assert(blended>100);
    for(const clip of [rig.clips.walk,rig.clips.idle]) for(const t of clip.tracks){const n=t.getValueSize();for(let j=0;j<n;j++)assert(Math.abs(t.values[j]-t.values[t.values.length-n+j])<1e-5);}
    const duplicate=clone(rig.mesh);assert.notEqual(duplicate.skeleton.bones[0],rig.skeleton.bones[0]);
    const bytes=await new GLTFExporter().parseAsync(rig.mesh,{binary:true,animations:Object.values(rig.clips)});
    await writeFile(new URL(`humanoid-${species}.glb`,out),Buffer.from(bytes));
    const imported=await new GLTFLoader().parseAsync(bytes,'');
    assert.equal(imported.animations.length,14);
    let importedSkin;imported.scene.traverse(o=>{if(o.isSkinnedMesh)importedSkin=o;});assert.equal(importedSkin.skeleton.bones.length,23);
    const mixer=new THREE.AnimationMixer(rig.mesh);mixer.clipAction(rig.clips.walk).play();
    const frames=[];
    for(let f=0;f<32;f++){
      mixer.setTime(f/32*rig.clips.walk.duration);rig.mesh.updateMatrixWorld(true);rig.skeleton.update();
      const verts=[];for(let v=0;v<g.attributes.position.count;v++) {const p=new THREE.Vector3();rig.mesh.getVertexPosition(v,p);assert(Number.isFinite(p.x+p.y+p.z));verts.push(p.toArray());}
      assert(Math.min(...verts.map(v=>v[1]))>-.06,'walk must not significantly penetrate floor');
      frames.push(verts);
    }
    await writeFile(new URL(`${species}-render.json`,out),JSON.stringify({frames,indices:Array.from(g.index.array),colors:Array.from(g.attributes.color.array)}));
    for (const name of ['idle', 'hit', 'death']) {
      mixer.stopAllAction(); rig.skeleton.pose();
      const clip = rig.clips[name], action = mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
      const poses = [];
      for (let f = 0; f <= 90; f++) {
        const time = name === 'idle' ? f / 15 : name === 'hit' ? (f / 15) % 2 : f / 15;
        // Reset single-shot state when scrubbing across repeated hits.
        action.reset().play(); mixer.setTime(time);
        rig.mesh.updateMatrixWorld(true); rig.skeleton.update();
        const vertices = [];
        for (let v = 0; v < g.attributes.position.count; v++) {
          const p = new THREE.Vector3(); rig.mesh.getVertexPosition(v,p);
          assert(Number.isFinite(p.x+p.y+p.z)); vertices.push(p.toArray());
        }
        assert(Math.min(...vertices.map(p=>p[1])) > -.035, `${species} ${name}: floor penetration`);
        poses.push(vertices);
      }
      if(name==='death') assert.deepEqual(poses[60],poses[90], 'death holds its final pose');
      if(species==='human') await writeFile(new URL(`${name}-render.json`,out),JSON.stringify({frames:poses,indices:Array.from(g.index.array),colors:Array.from(g.attributes.color.array)}));
    }
    console.log(`${species}: ${g.index.count/3} triangles, ${blended} blended vertices, 23 bones; loop, clone, deformation and GLB round-trip passed`);
  }
} finally {await server.close();}
