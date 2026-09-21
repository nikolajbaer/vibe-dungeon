import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {addComponent,addEntity,createWorld,query}=await import('bitecs');
  const {Carried,Item,Object3DRef,PhysicsBody,PlayerControlled,Stackable}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {default:crossbow}=await server.ssrLoadModule('/src/assets/items/crossbow.ts');
  const {pickUpItem}=await server.ssrLoadModule('/src/ecs/systems/items.ts');
  const ranged=await server.ssrLoadModule('/src/ecs/systems/rangedCombat.ts');

  assert.equal(crossbow.rangedWeapon.reloadSeconds,1.5);
  assert.equal(crossbow.rangedWeapon.maxRange,12);
  assert.equal(ranged.shouldEmbedProjectile(.25,true),true);
  assert.equal(ranged.shouldEmbedProjectile(.249,true),false);
  assert.equal(ranged.shouldEmbedProjectile(20,false),false);
  assert.ok(Math.abs(ranged.embeddedBoltOriginOffset() - -.1825) < 1e-9,'75% of bolt remains outside impact surface');

  // reflectBounceVelocity: a straight-on hit on a flat floor (normal +Y)
  // should fully invert the vertical component and damp the whole thing by
  // BOLT_BOUNCE_RESTITUTION, leaving the horizontal component untouched in
  // direction (just damped).
  const straightDown=new THREE.Vector3(0,-10,0),floorNormal=new THREE.Vector3(0,1,0);
  const bounced=ranged.reflectBounceVelocity(straightDown,floorNormal);
  assert.ok(Math.abs(bounced.x)<1e-9 && Math.abs(bounced.z)<1e-9,'straight-down bounce stays on the vertical axis');
  assert.ok(bounced.y>0,'straight-down bounce off a floor points back up');
  assert.ok(Math.abs(bounced.y-3.5)<1e-9,'bounce speed is damped by the restitution factor (10 * .35)');

  // A grazing hit (incoming mostly parallel to the surface) should reflect
  // to mostly the same direction it came from, just damped, not zeroed out.
  const grazing=new THREE.Vector3(5,-0.01,0),wallNormal=new THREE.Vector3(0,0,1);
  const grazingBounced=ranged.reflectBounceVelocity(grazing,wallNormal);
  assert.ok(grazingBounced.x>0,'a grazing bounce keeps traveling mostly the same direction');

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
  wood.position.set(0,1.5,-.2);wood.userData.surfaceMaterial='wood';scene.add(wood);scene.updateMatrixWorld(true);

  assert.equal(ranged.tryFireRanged(world,camera,scene),'fired');
  assert.equal(Stackable.count[ammo],2,'one bolt consumed');
  assert.equal(ranged.tryFireRanged(world,camera,scene),'reloading','reload gates immediate second shot');
  ranged.rangedCombatSystem(world,{},scene,.1);scene.updateMatrixWorld(true);
  const recovered=query(world,[Item,Object3DRef,Stackable]).find(eid=>eid!==ammo);
  assert.notEqual(recovered,undefined,'close wall impact becomes a recoverable world bolt');
  assert.equal(Object3DRef[recovered].parent,wood,'bolt stays embedded in the wood it hit');
  const embeddedWorldPosition=new THREE.Vector3();Object3DRef[recovered].getWorldPosition(embeddedWorldPosition);
  assert.ok(embeddedWorldPosition.z > wood.position.z,'embedded bolt origin stays outside the close wall');
  // Regression check for the "bolt ends up in a completely different place"
  // bug: bolt.mesh was parented directly to the scene during flight with its
  // position/quaternion tracking *world* coordinates every frame, and
  // withPickupHitbox wrapped that same mesh into a new group without
  // resetting it -- so the final position was the *sum* of the group's
  // intended embed transform and the bolt's stale in-flight world position,
  // not just the intended embed transform alone (previously off by ~15m in
  // a comparable scenario). The wood's near face sits at z=-.15 (box centered
  // at z=-.2, half-depth .05); the bolt travels almost dead level along -Z
  // from the camera at (0,1.5,0), so the embed origin -- backed off from that
  // face by embeddedBoltOriginOffset() towards the shooter -- should land
  // within centimeters of (0, 1.5, .0325), nowhere near the ~15m a
  // reparenting bug would produce.
  const expectedEmbedPosition=new THREE.Vector3(0,1.5,-.15).addScaledVector(new THREE.Vector3(0,0,-1),ranged.embeddedBoltOriginOffset());
  assert.ok(embeddedWorldPosition.distanceTo(expectedEmbedPosition)<0.05,
    `embedded bolt lands at the impact point, not somewhere else (expected ~${expectedEmbedPosition.toArray()}, got ${embeddedWorldPosition.toArray()})`);
  assert.equal(pickUpItem(world,recovered,player),'picked-up');
  assert.equal(Stackable.count[ammo],3,'recovered bolt merges back into ammo stack');

  for(let t=0;t<1.35;t+=.05) ranged.rangedCombatSystem(world,{},scene,.05);
  assert.equal(ranged.tryFireRanged(world,camera,scene),'reloading','still gated before 1.5 seconds');
  ranged.rangedCombatSystem(world,{},scene,.1);
  assert.equal(ranged.tryFireRanged(world,camera,scene),'fired','ready after the 1.5 second reload');
  // Drain that last shot (it embeds in the wood, same as before) and let its
  // reload finish so `world`'s weapon entity id is no longer "reloading" in
  // the module-level `reloads` map -- bitecs numbers entities per-world
  // starting from the same id in every world, so `world2` below reuses this
  // exact same weapon entity id and would otherwise inherit this stale state.
  for(let t=0;t<1.6;t+=.1) ranged.rangedCombatSystem(world,{},scene,.1);

  // Clatter path: a bolt that never hits anything runs out of range and
  // falls to the "else" branch in makeRecoverableBolt, which needs a real
  // Rapier body (buildItemWorldBody calls physics.world.createRigidBody) --
  // unlike the embed path above, `{}` won't do here.
  const {initPhysics,createPhysics}=await server.ssrLoadModule('/src/physics/world.ts');
  await initPhysics();
  const physics=createPhysics();
  const scene2=new THREE.Scene(),camera2=new THREE.PerspectiveCamera();
  camera2.position.set(0,1.5,0);camera2.lookAt(0,1.5,-1);camera2.updateMatrixWorld(true);
  const world2=createWorld(),player2=addEntity(world2),weapon2=addEntity(world2),ammo2=addEntity(world2);
  addComponent(world2,player2,PlayerControlled);
  addComponent(world2,weapon2,Item);addComponent(world2,weapon2,Carried);
  Item.itemTypeId[weapon2]='crossbow';Carried.ownerEid[weapon2]=player2;Carried.slot[weapon2]='hand-right';
  addComponent(world2,ammo2,Item);addComponent(world2,ammo2,Carried);addComponent(world2,ammo2,Stackable);
  Item.itemTypeId[ammo2]='bolt';Carried.ownerEid[ammo2]=player2;Carried.slot[ammo2]='inventory';Stackable.count[ammo2]=1;
  assert.equal(ranged.tryFireRanged(world2,camera2,scene2),'fired');
  // 12m at 18m/s is under a second of flight even with gravity pulling it down.
  let clatteredEid;
  for(let t=0;t<1.5 && clatteredEid===undefined;t+=.02){
    ranged.rangedCombatSystem(world2,physics,scene2,.02);
    clatteredEid=query(world2,[Item,PhysicsBody]).find(eid=>eid!==ammo2);
  }
  assert.notEqual(clatteredEid,undefined,'a bolt that never hits anything still resolves once it runs out of range');
  const body=PhysicsBody[clatteredEid];
  const linvel=body.linvel(),angvel=body.angvel();
  // The old behavior: buildItemWorldBody left the body at rest, so a bolt
  // that failed to embed just materialized motionless at the impact point.
  assert.ok(linvel.z<-1,'a non-embedded bolt keeps traveling forward instead of stopping dead (clatter, not a motionless drop)');
  assert.ok(linvel.y>0,'reflecting off the default up-normal sends it bouncing upward, not straight through the floor');
  assert.ok(angvel.x!==0||angvel.y!==0||angvel.z!==0,'a clattering bolt tumbles instead of sliding without any spin');
  console.log('crossbow ammo label, reload, surface sticking, bolt recovery and clatter physics passed');
} finally {await server.close();}
