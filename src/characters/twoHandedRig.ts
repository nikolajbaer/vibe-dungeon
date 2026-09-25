import * as THREE from 'three';
import { createHumanoidBase, type HumanoidSpecies } from './humanoidBase';
import quarterstaff from '../assets/items/quarterstaff';
import greatsword from '../assets/items/greatsword';

export type TwoHandedWeapon = 'quarterstaff' | 'greatsword';
type Key = { t:number; p:number[]; aim:number[]; yaw:number; crouch:number; step:number };
const v = (a:number[]) => new THREE.Vector3(...a);
const point = (o:THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/** Preview-first animation set: baked ordinary Three.js clips, not render-only
 * poses. Both palms follow a rigid weapon, with analytic elbow/knee IK.
 * +Z faces the opponent. Meyer-inspired guards, stylized for game readability.
 * This does not change live NPC AI or combat timing until art approval. */
export function createTwoHandedRig(kind:TwoHandedWeapon, species:HumanoidSpecies='human') {
  const rig=createHumanoidBase({species,tunic:kind==='quarterstaff'?0x587c69:0x495b85});
  const mesh=rig.mesh, bones=rig.skeleton.bones;
  const bone=(name:string)=>bones.find(b=>b.name===name)!;
  const weapon=(kind==='quarterstaff'?quarterstaff:greatsword).createWorldMesh();
  weapon.name='twoHandedProp';mesh.add(weapon);
  const sy=species==='dwarf'?.77:1;
  const grip=kind==='quarterstaff' ? [-.27,.27] : [.055,-.07];
  const palmOffset=new THREE.Vector3(0,-.065*sy,.014);
  const rest=bones.map(b=>b.position.clone());
  const guard:Key=kind==='quarterstaff'
    ? {t:0,p:[-.04,1.12,.27],aim:[.65,.18,1],yaw:-.16,crouch:.06,step:0}
    : {t:0,p:[-.12,1.13,.27],aim:[.18,.48,1],yaw:-.12,crouch:.06,step:0};
  const key=(t:number,p:number[],aim:number[],yaw:number,crouch:number,step:number):Key=>({t,p,aim,yaw,crouch,step});
  const end=(t:number)=>({...guard,t});
  const jab=kind==='quarterstaff' ? [guard,
    key(.16,[-.08,1.12,.20],[.32,.10,1],-.30,.10,-.025),
    key(.36,[-.02,1.24,.30],[.12,.06,1],.20,.11,.17),
    key(.46,[-.02,1.24,.30],[.12,.06,1],.20,.11,.17),end(.95)] : [guard,
    key(.26,[-.10,1.17,.19],[0,.08,1],-.25,.12,-.025),
    key(.52,[-.02,1.30,.50],[0,0,1],.18,.12,.20),
    key(.66,[-.02,1.30,.50],[0,0,1],.18,.12,.20),end(1.3)];
  const swing=kind==='quarterstaff' ? [guard,
    key(.28,[-.22,1.33,.15],[.1,.72,-1],-.48,.10,0),
    key(.47,[-.04,1.32,.32],[.9,.28,.65],-.1,.12,.1),
    key(.62,[.15,1.22,.37],[.95,-.08,.35],.48,.14,.18),
    key(.82,[.20,1.15,.27],[.7,-.16,-.7],.60,.12,.18),end(1.35)] : [guard,
    key(.42,[-.21,1.225,.06],[-.60,.23,-1],-1.25,.15,-.22),
    key(.64,[-.23,1.225,.02],[-.40,.135,-1],-1.45,.18,-.22),
    // Hips begin unwinding while the blade still trails behind the shoulder.
    key(.73,[-.16,1.24,.18],[-.925,.19,-.25],-.65,.20,-.04),
    key(.84,[0,1.21,.455],[.175,.06,1],.18,.20,.32),
    key(1.02,[.23,1.00,.30],[.825,-.255,.26],1.12,.21,.80),
    key(1.20,[.23,1.00,.30],[.825,-.255,.26],1.12,.21,.80),end(2.15)];
  const raised=kind==='quarterstaff'
    ? key(.3,[0,1.43,.28],[1,.30,.05],-.12,.10,-.04)
    : key(.4,[-.08,1.40,.23],[.82,-.12,.58],-.18,.10,-.03);

  function worldRotation(b:THREE.Bone,q:THREE.Quaternion) {
    b.quaternion.copy(b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    mesh.updateMatrixWorld(true);
  }
  function limb(upper:THREE.Bone,lower:THREE.Bone,tip:THREE.Bone,target:THREE.Vector3,pole:THREE.Vector3) {
    const a=point(upper), delta=target.clone().sub(a), d=delta.length();
    const l1=lower.position.length(),l2=tip.position.length();
    const reach=THREE.MathUtils.clamp(d,.001,l1+l2-.00001),axis=delta.normalize();
    const along=(l1*l1-l2*l2+reach*reach)/(2*reach);
    const bend=pole.clone().sub(a);bend.addScaledVector(axis,-bend.dot(axis)).normalize();
    const elbow=a.clone().addScaledVector(axis,along).addScaledVector(bend,Math.sqrt(Math.max(0,l1*l1-along*along)));
    worldRotation(upper,new THREE.Quaternion().setFromUnitVectors(lower.position.clone().normalize(),elbow.clone().sub(a).normalize()));
    worldRotation(lower,new THREE.Quaternion().setFromUnitVectors(tip.position.clone().normalize(),target.clone().sub(point(lower)).normalize()));
  }
  function bake(name:string,keys:Key[]) {
    const duration=keys.at(-1)!.t,count=Math.ceil(duration*60),times:number[]=[],positions:number[]=[],wp:number[]=[],wq:number[]=[],rot=bones.map(()=>[] as number[]);
    for(let i=0;i<=count;i++) {
      const t=i*duration/count; times.push(t);
      let k=0;while(k<keys.length-2&&t>keys[k+1].t)k++;
      const a=keys[k],b=keys[k+1],u=THREE.MathUtils.smoothstep((t-a.t)/(b.t-a.t),0,1);
      const mix=(x:number,y:number)=>THREE.MathUtils.lerp(x,y,u);
      const p=v(a.p).lerp(v(b.p),u);p.y*=sy;
      const qa=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),v(a.aim).normalize());
      const qb=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),v(b.aim).normalize());
      const q=qa.slerp(qb,u),step=mix(a.step,b.step),yaw=mix(a.yaw,b.yaw),c=mix(a.crouch,b.crouch);
      const powerStep=kind==='greatsword'&&name==='swing';
      // The weapon travels with the advancing torso; the right foot passes
      // the planted left foot, lifting during delivery and the return step.
      if(powerStep)p.z+=step*.25;
      const lift=powerStep ? (t>.64&&t<1.02 ? .14*Math.sin(Math.PI*(t-.64)/.38)
        : t>1.20 ? .10*Math.sin(Math.PI*(t-1.20)/.95) : 0) : 0;
      bones.forEach((bone,j)=>{bone.position.copy(rest[j]);bone.quaternion.identity();});
      bone('hips').position.set(0,(.89-c)*sy,step*.4);
      bone('hips').rotation.y=yaw*.35;bone('spine').rotation.set(.04,yaw*.25,0);bone('chest').rotation.y=yaw*.4;bone('head').rotation.y=-yaw;
      weapon.position.copy(p);weapon.quaternion.copy(q);mesh.updateMatrixWorld(true);
      for(const [side,sgn] of [['R',-1],['L',1]] as const) {
        const hand=bone('hand.'+side),palm=new THREE.Vector3(0,0,grip[side==='R'?0:1]).applyQuaternion(q).add(p);
        const handQ=q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
        const wrist=palm.clone().sub(palmOffset.clone().applyQuaternion(handQ));
        limb(bone('upperArm.'+side),bone('forearm.'+side),hand,wrist,new THREE.Vector3(sgn*.7,.9*sy,.12));
        worldRotation(hand,handQ);
        const foot=bone('foot.'+side),target=new THREE.Vector3(sgn*.16,(.08+(side==='R'?lift:0))*sy,side==='R'?-.15+step:.18);
        limb(bone('upperLeg.'+side),bone('lowerLeg.'+side),foot,target,new THREE.Vector3(sgn*.16,.5*sy,1));
        worldRotation(foot,new THREE.Quaternion());
      }
      positions.push(...bone('hips').position.toArray());wp.push(...p.toArray());wq.push(...q.toArray());
      bones.forEach((b,j)=>rot[j].push(...b.quaternion.toArray()));
    }
    const tracks:THREE.KeyframeTrack[]=bones.map((b,j)=>new THREE.QuaternionKeyframeTrack(b.name+'.quaternion',times,rot[j]));
    tracks.push(new THREE.VectorKeyframeTrack('hips.position',times,positions),new THREE.VectorKeyframeTrack('twoHandedProp.position',times,wp),new THREE.QuaternionKeyframeTrack('twoHandedProp.quaternion',times,wq));
    return new THREE.AnimationClip(kind+'_'+name,duration,tracks);
  }
  const clips={jab:bake('jab',jab),swing:bake('swing',swing),blockEnter:bake('blockEnter',[guard,raised]),block:bake('block',[{...raised,t:0},{...raised,t:1}]),guard:bake('guard',[guard,end(1)])};
  rig.skeleton.pose();mesh.animations=Object.values(clips);
  return {...rig,baseClips:rig.clips,clips,weapon,grip,palmOffset};
}
