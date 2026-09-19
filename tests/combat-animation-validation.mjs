import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import * as THREE from 'three';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {createHumanoidBase}=await server.ssrLoadModule('/src/characters/humanoidBase.ts');
  for(const species of ['human','elf','goblin','dwarf']) {
    const rig=createHumanoidBase({species,weapon:'shortSword'});
    const mixer=new THREE.AnimationMixer(rig.mesh);
    const pose=(name,t)=>{mixer.stopAllAction();rig.skeleton.pose();const action=mixer.clipAction(rig.clips[name]);action.reset().setLoop(THREE.LoopOnce,1).play();mixer.setTime(t);rig.mesh.updateMatrixWorld(true);rig.skeleton.update();};
    const bone=name=>rig.skeleton.bones.find(candidate=>candidate.name===name);
    const point=name=>bone(name).getWorldPosition(new THREE.Vector3());
    const sword=rig.mesh.getObjectByName('shortSword');
    const tip=()=>sword.localToWorld(new THREE.Vector3(0,0,.765));
    const minY=()=>{const values=[];for(let i=0;i<rig.mesh.geometry.attributes.position.count;i++){const p=new THREE.Vector3();rig.mesh.getVertexPosition(i,p);values.push(p.y);}return Math.min(...values);};

    pose('unarmedStrike',0);const guardRight=point('hand.R'),guardLeft=point('hand.L');
    pose('unarmedStrike',.48);const punch=point('hand.R');
    assert(punch.z>guardRight.z+.25,`${species}: punch extends forward`);
    const sy=species==='dwarf'?.77:1;
    assert(guardRight.y>1.35*sy&&guardLeft.y>1.35*sy,`${species}: both hands guard the face`);
    assert(punch.y>1.5*sy&&punch.y<1.8*sy,`${species}: right cross targets an equal-height face`);
    const elbowAngle=bone('forearm.R').quaternion.angleTo(new THREE.Quaternion());
    assert(elbowAngle<.05,`${species}: right elbow fully extends at impact`);
    assert(minY()>-.025,`${species}: punch keeps feet above floor`);

    pose('parry',0);const parryStart=tip();pose('parry',.16);const parryBase=sword.getWorldPosition(new THREE.Vector3()),parryFlat=tip(),flatDirection=parryFlat.clone().sub(parryBase).normalize();pose('parry',.30);const parryContact=tip();
    assert(Math.abs(flatDirection.y)<.06&&Math.abs(flatDirection.x)>.9,`${species}: parry establishes a horizontal blade first`);
    assert(parryContact.y>parryStart.y+.45*sy,`${species}: parry lifts the weapon across the face`);
    assert(parryContact.x>0,`${species}: parry crosses the center line`);
    assert(minY()>-.025,`${species}: parry keeps feet above floor`);

    pose('chop',.24);const windup=tip();pose('chop',.42);const chamberBase=sword.getWorldPosition(new THREE.Vector3()),chamberTip=tip(),chamberDirection=chamberTip.clone().sub(chamberBase).normalize();pose('chop',.64);const contact=tip();pose('chop',.82);const finish=tip();
    assert(chamberDirection.z<-.85,`${species}: chop hinges the weapon backward in the chamber`);
    assert(windup.y>finish.y+.9*sy,`${species}: chop has a strong downward arc`);
    assert(contact.z>.55&&finish.y>.4*sy,`${species}: chop lands forward without striking the floor`);
    assert(minY()>-.025,`${species}: chop keeps feet above floor`);
    console.log(`${species}: face guard/right cross, crossing parry and overhead chop passed`);
  }

  for(const [clipName,weapon] of [['parry',true],['unarmedStrike',false],['chop',true]]) {
    const rig=createHumanoidBase({weapon:weapon?'shortSword':undefined}),mixer=new THREE.AnimationMixer(rig.mesh);
    const action=mixer.clipAction(rig.clips[clipName]);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const body=rig.mesh.geometry,bodyCount=body.attributes.position.count;
    const indices=Array.from(body.index.array),colors=Array.from(body.attributes.color.array);
    const held=weapon?rig.mesh.getObjectByName('shortSword'):undefined;
    if(held){const g=held.geometry,c=Array(g.attributes.position.count*3).fill(0);for(const group of g.groups){const material=held.material[group.materialIndex];for(let j=group.start;j<group.start+group.count;j++){const vi=g.index?g.index.getX(j):j;c[vi*3]=material.color.r;c[vi*3+1]=material.color.g;c[vi*3+2]=material.color.b;}}colors.push(...c);indices.push(...Array.from(g.index.array,v=>v+bodyCount));}
    const frames=[];
    for(let frame=0;frame<90;frame++){
      const normalized=Math.max(0,Math.min(1,((frame/30)-.25)/2.25));
      const local=normalized*rig.clips[clipName].duration;
      mixer.setTime(local);rig.mesh.updateMatrixWorld(true);rig.skeleton.update();
      const vertices=[];for(let i=0;i<bodyCount;i++){const p=new THREE.Vector3();rig.mesh.getVertexPosition(i,p);vertices.push(p.toArray());}
      if(held)for(let i=0;i<held.geometry.attributes.position.count;i++)vertices.push(held.localToWorld(new THREE.Vector3().fromBufferAttribute(held.geometry.attributes.position,i)).toArray());
      frames.push(vertices);
    }
    await writeFile(new URL(`../public/characters/${clipName}-render.json`,import.meta.url),JSON.stringify({frames,indices,colors}));
  }
} finally {await server.close();}
