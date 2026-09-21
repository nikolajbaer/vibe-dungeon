import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {addComponent,addEntity,createWorld,query}=await import('bitecs');
  const {Carried,Item,Object3DRef,PlayerControlled,Stackable}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {default:crossbow}=await server.ssrLoadModule('/src/assets/items/crossbow.ts');
  const {pickUpItem}=await server.ssrLoadModule('/src/ecs/systems/items.ts');
  const ranged=await server.ssrLoadModule('/src/ecs/systems/rangedCombat.ts');

  assert.equal(crossbow.rangedWeapon.reloadSeconds,1.5);
  assert.equal(crossbow.rangedWeapon.maxRange,12);
  assert.equal(ranged.shouldEmbedProjectile(1,true),true);
  assert.equal(ranged.shouldEmbedProjectile(.99,true),false);
  assert.equal(ranged.shouldEmbedProjectile(20,false),false);

  const world=createWorld(),player=addEntity(world),weapon=addEntity(world),ammo=addEntity(world);
  addComponent(world,player,PlayerControlled);
  addComponent(world,weapon,Item);addComponent(world,weapon,Carried);
  Item.itemTypeId[weapon]='crossbow';Carried.ownerEid[weapon]=player;Carried.slot[weapon]='hand-right';
  addComponent(world,ammo,Item);addComponent(world,ammo,Carried);addComponent(world,ammo,Stackable);
  Item.itemTypeId[ammo]='bolt';Carried.ownerEid[ammo]=player;Carried.slot[ammo]='inventory';Stackable.count[ammo]=3;
  assert.equal(ranged.getRangedAmmoLabel(world,player),'3 crossbow bolts');

  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  camera.position.set(0,1.5,0);camera.lookAt(0,1.5,-1);camera.updateMatrixWorld(true);
  const wood=new THREE.Mesh(new THREE.BoxGeometry(1,1,0.1),new THREE.MeshBasicMaterial());
  wood.position.set(0,1.5,-1.3);wood.userData.surfaceMaterial='wood';scene.add(wood);scene.updateMatrixWorld(true);

  assert.equal(ranged.tryFireRanged(world,camera,scene),'fired');
  assert.equal(Stackable.count[ammo],2,'one bolt consumed');
  assert.equal(ranged.tryFireRanged(world,camera,scene),'reloading','reload gates immediate second shot');
  ranged.rangedCombatSystem(world,{},scene,.1);scene.updateMatrixWorld(true);
  const recovered=query(world,[Item,Object3DRef,Stackable]).find(eid=>eid!==ammo);
  assert.notEqual(recovered,undefined,'wood impact becomes a recoverable world bolt');
  assert.equal(Object3DRef[recovered].parent,wood,'bolt stays embedded in the wood it hit');
  assert.equal(pickUpItem(world,recovered,player),'picked-up');
  assert.equal(Stackable.count[ammo],3,'recovered bolt merges back into ammo stack');

  for(let t=0;t<1.35;t+=.05) ranged.rangedCombatSystem(world,{},scene,.05);
  assert.equal(ranged.tryFireRanged(world,camera,scene),'reloading','still gated before 1.5 seconds');
  ranged.rangedCombatSystem(world,{},scene,.1);
  assert.equal(ranged.tryFireRanged(world,camera,scene),'fired','ready after the 1.5 second reload');
  console.log('crossbow ammo label, reload, surface sticking and bolt recovery passed');
} finally {await server.close();}
