import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import * as THREE from 'three';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {createHumanoidBase}=await server.ssrLoadModule('/src/characters/humanoidBase.ts');
  for(const species of ['human','elf','goblin','dwarf']) {
    const rig=createHumanoidBase({species,weapon:'shortSword'});
    const sword=rig.mesh.getObjectByName('shortSword');
    assert.equal(sword.parent.name,'hand.R');
    const mixer=new THREE.AnimationMixer(rig.mesh);
    const pose=(name,t)=>{mixer.stopAllAction();rig.skeleton.pose();const a=mixer.clipAction(rig.clips[name]);a.reset().setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();mixer.setTime(t);rig.mesh.updateMatrixWorld(true);rig.skeleton.update();};
    const tip=()=>sword.localToWorld(new THREE.Vector3(0,0,.765));
    pose('combatIdle',0);const start=tip();const guardHeight=rig.skeleton.bones[0].position.y;
    pose('attack',.62);const end=tip();
    assert(end.z-start.z>.42,'stab must extend strongly forward');
    const direction=sword.localToWorld(new THREE.Vector3(0,0,1)).sub(sword.getWorldPosition(new THREE.Vector3())).normalize();
    assert(direction.z>.9,'blade points forward at impact');
    assert(Math.abs(direction.x)<.1,'blade stays centered on the opponent');
    assert(direction.y>.25&&direction.y<.5,'blade rises toward a similar-sized opponent chest');
    assert(guardHeight<.89*(species==='dwarf'?.77:1)-.025,'guard stays crouched');
    const frames=[],indices=Array.from(rig.mesh.geometry.index.array),colors=Array.from(rig.mesh.geometry.attributes.color.array);
    const bodyCount=rig.mesh.geometry.attributes.position.count;
    const wg=sword.geometry, wc=Array(wg.attributes.position.count*3).fill(0);
    for(const group of wg.groups) {
      const mat=sword.material[group.materialIndex];
      for(let j=group.start;j<group.start+group.count;j++) {
        const vi=wg.index?wg.index.getX(j):j;
        wc[vi*3]=mat.color.r;wc[vi*3+1]=mat.color.g;wc[vi*3+2]=mat.color.b;
      }
    }
    colors.push(...wc);indices.push(...Array.from(wg.index.array,v=>v+bodyCount));
    for(let f=0;f<100;f++){
      const t=f/30;pose(t<.45?'combatIdle':'attack',t<.45?t:Math.min(1.7,t-.45));
      const vertices=[];
      for(let v=0;v<bodyCount;v++) {const p=new THREE.Vector3();rig.mesh.getVertexPosition(v,p);vertices.push(p.toArray());}
      assert(Math.min(...vertices.map(v=>v[1]))>-.025,'feet remain above floor');
      for(let v=0;v<wg.attributes.position.count;v++)vertices.push(sword.localToWorld(new THREE.Vector3().fromBufferAttribute(wg.attributes.position,v)).toArray());
      frames.push(vertices);
    }
    if(species==='human')await writeFile(new URL('../public/characters/attack-render.json',import.meta.url),JSON.stringify({frames,indices,colors}));
    console.log(`${species}: attached sword, crouched guard, forward extension, blade aim and floor contact passed`);
  }
} finally {await server.close();}
