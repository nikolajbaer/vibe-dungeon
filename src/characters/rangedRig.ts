import * as THREE from 'three';
import {createHumanoidBase} from './humanoidBase';
import crossbow from '../assets/items/crossbow';
import javelin from '../assets/items/javelin';
import bolt from '../assets/items/bolt';

type Key={t:number;p:number[];aim:number[];yaw:number;step:number};
const vec=(a:number[])=>new THREE.Vector3(...a);
export function createRangedRig(kind:'crossbow'|'javelin') {
 const rig=createHumanoidBase({tunic:kind==='crossbow'?0x705735:0x61714c});
 const mesh=rig.mesh,bones=rig.skeleton.bones,bone=(n:string)=>bones.find(b=>b.name===n)!;
 const weapon=new THREE.Group();weapon.name='rangedProp';mesh.add(weapon);
 const model=(kind==='crossbow'?crossbow:javelin).createWorldMesh();
 if(kind==='crossbow')model.rotation.y=Math.PI;weapon.add(model);
 const projectile=bolt.createWorldMesh();projectile.name='previewBolt';mesh.add(projectile);
 const rest=bones.map(b=>b.position.clone()),palmOffset=new THREE.Vector3(0,-.065,.014);
 const guard:Key={t:0,p:kind==='crossbow'?[-.06,1.20,.28]:[-.30,1.27,.23],aim:[0,0,1],yaw:-.12,step:0};
 const k=(t:number,p:number[],aim:number[],yaw:number,step:number):Key=>({t,p,aim,yaw,step});
 const lowAim=[0,Math.sin(Math.PI/9),Math.cos(Math.PI/9)];
 const lowGuard:Key={t:0,p:[-.29,.91,.17],aim:lowAim,yaw:-.12,step:0};
 const sequences:Record<string,Key[]>=kind==='crossbow'?{
  hold:[guard,{...guard,t:2}],
  fire:[guard,k(.35,[-.06,1.28,.31],[0,.02,1],-.12,0),k(.42,[-.06,1.28,.31],[0,.02,1],-.12,0),k(.49,[-.06,1.30,.27],[0,.10,1],-.16,0),k(.70,[-.06,1.28,.31],[0,.02,1],-.12,0),{...guard,t:1.35}],
 }:{
  hold:[lowGuard,{...lowGuard,t:2}],
  jab:[lowGuard,k(.18,[-.31,.91,.08],lowAim,-.32,-.03),k(.40,[-.18,1.01,.43],lowAim,.22,.18),k(.5,[-.18,1.01,.43],lowAim,.22,.18),{...lowGuard,t:.95}],
  throw:[guard,
   k(.38,[-.32,1.43,-.28],[.12,.18,1],-1.20,-.20),
   k(.48,[-.34,1.45,-.30],[.10,.12,1],-1.40,-.20),
   // Lead with the hips; the throwing hand stays back briefly before
   // accelerating over the shoulder into the existing release frame.
   k(.54,[-.28,1.46,-.13],[.06,.10,1],-.65,.02),
   k(.62,[-.10,1.45,.51],[0,.04,1],.48,.40),
   k(.88,[.12,1.05,.32],[0,0,1],.90,.40),{...guard,t:1.65}],
 };
 function worldQ(b:THREE.Bone,q:THREE.Quaternion){b.quaternion.copy(b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));mesh.updateMatrixWorld(true);}
 function ik(upper:THREE.Bone,lower:THREE.Bone,tip:THREE.Bone,target:THREE.Vector3,pole:THREE.Vector3){
  const origin=upper.getWorldPosition(new THREE.Vector3()),axis=target.clone().sub(origin),l1=lower.position.length(),l2=tip.position.length(),d=Math.min(axis.length(),l1+l2-.00001);axis.normalize();
  const along=(l1*l1-l2*l2+d*d)/(2*d),bend=pole.clone().sub(origin);bend.addScaledVector(axis,-bend.dot(axis)).normalize();
  const elbow=origin.clone().addScaledVector(axis,along).addScaledVector(bend,Math.sqrt(Math.max(0,l1*l1-along*along)));
  worldQ(upper,new THREE.Quaternion().setFromUnitVectors(lower.position.clone().normalize(),elbow.clone().sub(origin).normalize()));
  worldQ(lower,new THREE.Quaternion().setFromUnitVectors(tip.position.clone().normalize(),target.clone().sub(lower.getWorldPosition(new THREE.Vector3())).normalize()));
 }
 const clips:Record<string,THREE.AnimationClip>={};
 for(const [name,keys]of Object.entries(sequences)) {
  const duration=keys[keys.length-1].t,count=Math.ceil(duration*60),times:number[]=[],root:number[]=[],wp:number[]=[],wq:number[]=[],ps:number[]=[],pp:number[]=[],rot=bones.map(()=>[]as number[]);
  for(let i=0;i<=count;i++){
   const t=i*duration/count;times.push(t);let index=0;while(index<keys.length-2&&t>keys[index+1].t)index++;
   const a=keys[index],b=keys[index+1],u=THREE.MathUtils.smoothstep((t-a.t)/(b.t-a.t),0,1),mix=(x:number,y:number)=>THREE.MathUtils.lerp(x,y,u);
   const p=vec(a.p).lerp(vec(b.p),u),aim=vec(a.aim).lerp(vec(b.aim),u).normalize(),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),aim),yaw=mix(a.yaw,b.yaw),step=mix(a.step,b.step);
   bones.forEach((b,j)=>{b.position.copy(rest[j]);b.quaternion.identity();});
   bone('hips').position.set(0,.79,step*.4);bone('hips').rotation.y=yaw*.3;bone('spine').rotation.y=yaw*.3;bone('chest').rotation.y=yaw*.4;bone('head').rotation.y=-yaw;
   mesh.updateMatrixWorld(true);
   for(const [side,sgn]of [['R',-1],['L',1]]as const){
    const handQ=q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
    const palm=kind==='crossbow'?p.clone().add(new THREE.Vector3(side==='R'?0:.025,-.07,side==='R'?-.15:.20).applyQuaternion(q))
      :side==='R'?p.clone():new THREE.Vector3(.26,1.17,.22);
    const wrist=palm.clone().sub(palmOffset.clone().applyQuaternion(handQ));
    ik(bone('upperArm.'+side),bone('forearm.'+side),bone('hand.'+side),wrist,new THREE.Vector3(sgn*.65,.95,.06));worldQ(bone('hand.'+side),handQ);
    const lift=name==='throw'&&side==='R'&&t>.38&&t<.62?.10*Math.sin(Math.PI*(t-.38)/.24):0;
    ik(bone('upperLeg.'+side),bone('lowerLeg.'+side),bone('foot.'+side),new THREE.Vector3(sgn*.16,.08+lift,side==='R'?-.15+step:.18),new THREE.Vector3(sgn*.16,.5,1));worldQ(bone('foot.'+side),new THREE.Quaternion());
   }
   // Preview release: the prop leaves the throwing hand on the exact release
   // sample. Gameplay can consume the same releaseTime to spawn physics.
   const released=name==='throw'&&t>=.62;
   // Model spans Z=-.18..1.10: center is .46m forward of its authored grip.
   // Hold/jab keys describe the palm, so offset the prop to put that center
   // in the hand. The overarm throw retains its separate rear grip.
   const centered=kind==='javelin'&&name!=='throw';
   const weaponP=released?new THREE.Vector3(-.10,1.45,.51).add(new THREE.Vector3(0,.4,8).multiplyScalar(t-.62)):p.clone().addScaledVector(aim,centered?-.46:0);
   wp.push(...weaponP.toArray());wq.push(...(released?new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(0,.04,1).normalize()):q).toArray());
   const fired=kind==='crossbow'&&name==='fire'&&t>=.42;
   const boltP=fired?new THREE.Vector3(-.06,1.39,.31+18*(t-.42)):p.clone().add(new THREE.Vector3(0,.10,.10));
   pp.push(...boltP.toArray());ps.push(...(kind==='crossbow'?[1,1,1]:[0,0,0]));
   root.push(...bone('hips').position.toArray());bones.forEach((b,j)=>rot[j].push(...b.quaternion.toArray()));
  }
  const tracks:THREE.KeyframeTrack[]=bones.map((b,j)=>new THREE.QuaternionKeyframeTrack(b.name+'.quaternion',times,rot[j]));
  tracks.push(new THREE.VectorKeyframeTrack('hips.position',times,root),new THREE.VectorKeyframeTrack('rangedProp.position',times,wp),new THREE.QuaternionKeyframeTrack('rangedProp.quaternion',times,wq),new THREE.VectorKeyframeTrack('previewBolt.position',times,pp),new THREE.VectorKeyframeTrack('previewBolt.scale',times,ps));
  clips[name]=new THREE.AnimationClip(kind+'_'+name,duration,tracks);
 }
 rig.skeleton.pose();return {...rig,baseClips:rig.clips,clips,weapon,projectile,releaseTime:kind==='crossbow'?.42:.62};
}
