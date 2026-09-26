import * as THREE from 'three';
import { hasComponent, type World } from 'bitecs';
import { Combat, NPC, Velocity } from '../components';
import { createTwoHandedRig, type TwoHandedWeapon } from '../../characters/twoHandedRig';

type Mode='guard'|'walk'|'jab'|'swing'|'blockEnter'|'block'|'hit'|'death';
const states=new Map<number,{
  rig:ReturnType<typeof createTwoHandedRig>; mixer:THREE.AnimationMixer;
  actions:Record<Mode,THREE.AnimationAction>; mode:Mode; elapsed:number;
  nextSwing:boolean; contact?:()=>void; contactAt:number; reactiveBlock:number;
}>();
export function createTwoHandedNpcMesh(kind:TwoHandedWeapon,eid:number):THREE.Object3D {
  const rig=createTwoHandedRig(kind),mixer=new THREE.AnimationMixer(rig.mesh);
  rig.mesh.userData.eid=eid;rig.weapon.userData.weaponKind=kind;
  // Keep the braced upper-body grip while using the standard walking legs.
  const upper=rig.clips.guard.tracks.filter(t=>!/^hips\.|^(upperLeg|lowerLeg|foot|toe)\./.test(t.name));
  const lower=rig.baseClips.walk.tracks.filter(t=>/^hips\.|^(upperLeg|lowerLeg|foot|toe)\./.test(t.name));
  const walk=new THREE.AnimationClip('twoHandedWalk',rig.baseClips.walk.duration,[...lower,...upper]);
  const clips={...rig.clips,walk,hit:rig.baseClips.hit,death:rig.baseClips.death};
  const actions={} as Record<Mode,THREE.AnimationAction>;
  for(const name of Object.keys(clips) as Mode[]) {
    actions[name]=mixer.clipAction(clips[name]);
    if(!['guard','walk','block'].includes(name)) {actions[name].setLoop(THREE.LoopOnce,1);actions[name].clampWhenFinished=true;}
  }
  states.set(eid,{rig,mixer,actions,mode:'guard',elapsed:0,nextSwing:false,contactAt:0,reactiveBlock:0});
  actions.guard.play();mixer.update(0);
  return rig.mesh;
}
function play(eid:number,mode:Mode) {
  const s=states.get(eid)!;s.mixer.stopAllAction();s.mode=mode;s.elapsed=0;s.actions[mode].reset().play();
}
export function twoHandedWeapon(eid:number){return states.get(eid)?.rig.weapon;}
export function twoHandedLocked(eid:number){const s=states.get(eid);return !!s&&!['guard','walk'].includes(s.mode);}
export function beginTwoHandedAttack(eid:number,onContact:(type:'jab'|'swing')=>void):number|undefined {
  const s=states.get(eid);if(!s)return undefined;
  if(twoHandedLocked(eid))return 0;
  const type=s.nextSwing?'swing':'jab';s.nextSwing=!s.nextSwing;play(eid,type);
  s.contactAt=type==='jab'?(s.rig.weapon.userData.weaponKind==='greatsword'?.52:.36)
    :(s.rig.weapon.userData.weaponKind==='greatsword'?.84:.47);
  s.contact=()=>onContact(type);
  return s.rig.clips[type].duration+.15;
}
export function reactTwoHanded(eid:number,event:'hit'|'death'|'block'):boolean {
  const s=states.get(eid);if(!s)return false;if(s.mode==='death')return true;
  s.contact=undefined;
  if(event==='death') {play(eid,'death');}
  else if(event==='hit') {
    // Non-combat clips have no prop tracks: follow the hand through the fall
    // or flinch rather than leaving a rigid weapon suspended in world space.
    s.rig.mesh.updateMatrixWorld(true);
    const p=s.rig.weapon.getWorldPosition(new THREE.Vector3()),q=s.rig.weapon.getWorldQuaternion(new THREE.Quaternion());
    play(eid,event);
    s.rig.mesh.attach(s.rig.weapon);
    s.rig.weapon.position.copy(s.rig.mesh.worldToLocal(p));
    s.rig.weapon.quaternion.copy(s.rig.mesh.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    s.rig.mesh.updateMatrixWorld(true);
    s.rig.skeleton.bones.find(b=>b.name==='hand.R')!.attach(s.rig.weapon);
  }else {s.reactiveBlock=.65;play(eid,'blockEnter');}
  return true;
}
export function updateTwoHandedNpcs(world:World,dt:number,paused:boolean) {
  for(const [eid,s] of states) {
    if(!hasComponent(world,eid,NPC)){states.delete(eid);continue;}
    if(paused&&!['hit','death'].includes(s.mode))continue;
    s.elapsed+=dt;s.reactiveBlock=Math.max(0,s.reactiveBlock-dt);s.mixer.update(dt);
    if(s.contact&&s.elapsed>=s.contactAt){const hit=s.contact;s.contact=undefined;hit();}
    if(s.mode==='death')continue;
    const held=Combat.blocking[eid]>0||s.reactiveBlock>0;
    if(['jab','swing','hit','blockEnter'].includes(s.mode)) {
      if(s.elapsed<s.actions[s.mode].getClip().duration)continue;
      if(s.rig.weapon.parent!==s.rig.mesh)s.rig.mesh.attach(s.rig.weapon);
      play(eid,held?'block':'guard');
    }
    const target:Mode=held?'block':Math.hypot(Velocity.x[eid]||0,Velocity.z[eid]||0)>.05?'walk':'guard';
    if(s.mode!==target)play(eid,held?'blockEnter':target);
  }
}
