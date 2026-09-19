import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createHumanoidBase, type HumanoidOptions, type HumanoidSpecies } from './humanoidBase';
const scene=new THREE.Scene();scene.background=new THREE.Color(0x171d27);
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.01,100);camera.position.set(2.5,1.7,4);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;document.body.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.9,0);controls.update();
scene.add(new THREE.HemisphereLight(0xc6dcff,0x535064,2.2));
const key=new THREE.DirectionalLight(0xffedd7,3);key.position.set(3,5,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);scene.add(key);
const rim=new THREE.DirectionalLight(0x8faeff,2);rim.position.set(-3,2,-2);scene.add(rim);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x222c3b,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.005;ground.receiveShadow=true;scene.add(ground);
const grid=new THREE.GridHelper(8,32,0x40516b,0x29364a);scene.add(grid);
let rig=createHumanoidBase({weapon:'shortSword'}),mixer=new THREE.AnimationMixer(rig.mesh),helper=new THREE.SkeletonHelper(rig.mesh),paused=false,showBones=false;
scene.add(rig.mesh,helper);helper.visible=false;
const select=document.querySelector<HTMLSelectElement>('#species')!;
const weapon=document.querySelector<HTMLSelectElement>('#weapon')!;
const clip=document.querySelector<HTMLSelectElement>('#clip')!;
clip.add(new Option('Crouched guard','combatIdle'));
clip.add(new Option('One-handed jab','weaponJab'));
clip.add(new Option('One-handed cross','weaponCross'));
clip.add(new Option('One-handed chop','weaponChop'));
clip.add(new Option('Weapon parry','parry'));
clip.add(new Option('Unarmed jab','unarmedJab'));
clip.add(new Option('Unarmed cross','unarmedCross'));
clip.add(new Option('Unarmed chop','unarmedChop'));
clip.add(new Option('Unarmed parry','unarmedParry'));
clip.querySelector<HTMLOptionElement>('option[value="idle"]')?.setAttribute('label','Loiter');
// The original options derive their values from text, so keep explicit values.
for(const option of clip.options) {
  if(option.value==='idle') {option.value='idle';option.textContent='Loiter';}
  if(option.value==='hit') {option.value='hit';option.textContent='Take damage';}
}
function play(){mixer.stopAllAction();const action=mixer.clipAction(rig.clips[clip.value as keyof typeof rig.clips]);if(clip.value==='death'||clip.value==='hit'){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}action.play();}
play();
function rebuild(){mixer.stopAllAction();mixer.uncacheRoot(rig.mesh);scene.remove(rig.mesh,helper);rig.mesh.geometry.dispose();(rig.mesh.material as THREE.Material).dispose();rig.skeleton.dispose();helper.dispose();rig=createHumanoidBase({species:select.value as HumanoidSpecies,weapon:(weapon.value||undefined) as HumanoidOptions['weapon']});mixer=new THREE.AnimationMixer(rig.mesh);helper=new THREE.SkeletonHelper(rig.mesh);helper.visible=showBones;scene.add(rig.mesh,helper);play();}
select.onchange=rebuild;
weapon.onchange=rebuild;
clip.onchange=()=>{if(clip.value.startsWith('unarmed')&&weapon.value!==''){weapon.value='';rebuild();}else if((clip.value.startsWith('weapon')||clip.value==='parry')&&weapon.value===''){weapon.value='shortSword';rebuild();}else play();};
document.querySelector<HTMLButtonElement>('#pause')!.onclick=(e)=>{paused=!paused;(e.target as HTMLButtonElement).textContent=paused?'Play':'Pause';};
document.querySelector<HTMLButtonElement>('#bones')!.onclick=()=>{showBones=!showBones;helper.visible=showBones;};
async function exportCharacter(species:HumanoidSpecies){const asset=createHumanoidBase({species,weapon:'shortSword'});const data=await new GLTFExporter().parseAsync(asset.mesh,{binary:true,animations:Object.values(asset.clips)});return Array.from(new Uint8Array(data as ArrayBuffer));}
document.querySelector<HTMLButtonElement>('#export')!.onclick=async()=>{const bytes=await exportCharacter(select.value as HumanoidSpecies);const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'model/gltf-binary'}));const a=document.createElement('a');a.href=url;a.download=`humanoid-${select.value}.glb`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
Object.assign(window,{exportCharacter,workshop:{rig,renderer,scene,camera}});
const clock=new THREE.Clock();renderer.setAnimationLoop(()=>{const dt=Math.min(clock.getDelta(),.05);if(!paused)mixer.update(dt);renderer.render(scene,camera);});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
