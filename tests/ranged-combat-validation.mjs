import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {addComponent,addEntity,createWorld,hasComponent,query}=await import('bitecs');
  const {Carried,CharacterBody,Embedded,Health,Item,Object3DRef,PhysicsBody,PlayerControlled,Stackable}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {default:crossbow}=await server.ssrLoadModule('/src/assets/items/crossbow.ts');
  const {pickUpItem}=await server.ssrLoadModule('/src/ecs/systems/items.ts');
  const {syncSystem}=await server.ssrLoadModule('/src/ecs/systems/sync.ts');
  const {BODY_PART_DAMAGE_MULTIPLIER,meleeCollisionSystem,getCombatHitboxColliders,stickTarget}=await server.ssrLoadModule('/src/ecs/systems/meleeCollision.ts');
  const ranged=await server.ssrLoadModule('/src/ecs/systems/rangedCombat.ts');

  assert.equal(crossbow.rangedWeapon.reloadSeconds,1.5);
  assert.equal(crossbow.rangedWeapon.maxRange,40);
  assert.equal(ranged.shouldEmbedProjectile(.25,true),true);
  assert.equal(ranged.shouldEmbedProjectile(.249,true),false);
  assert.equal(ranged.shouldEmbedProjectile(20,false),false);
  assert.ok(Math.abs(ranged.embeddedBoltDepth() - .1375) < 1e-9,'75% of bolt remains outside impact surface');

  // A dead-on hit (incidence 1, the default when the caller doesn't pass
  // one) still embeds; a perfectly grazing one (incidence 0 -- direction
  // exactly parallel to the surface) never does, regardless of speed.
  // Below `embeddedBoltDepth()/BOLT_TIP_OFFSET` incidence, embedding would
  // leave the whole bolt buried under the surface instead of visibly stuck
  // in it (see `embeddedBoltOrigin`'s doc comment) -- too shallow a hit
  // clatters off instead, same as a real arrow skipping off a glancing hit.
  assert.equal(ranged.shouldEmbedProjectile(20,true,1),true,'a dead-on hit embeds');
  assert.equal(ranged.shouldEmbedProjectile(20,true,0),false,'a perfectly grazing hit never embeds, however fast');

  // embeddedBoltOrigin: regression check for a shallow/grazing hit (a bolt
  // traveling parallel to the struck surface, direction perpendicular to its
  // normal) undercounting the embed depth. The dot product of (origin -
  // hitPoint) with the surface normal isolates just the along-normal
  // component of the offset; when direction contributes nothing along the
  // normal (dot == 0), that component must equal exactly -embeddedBoltDepth()
  // regardless of which way `direction` points -- the earlier version
  // measured embed depth along `direction` instead of the surface normal, so
  // this same perpendicular case gave *zero* embed depth (a bolt that just
  // rests at the surface instead of actually sinking into it).
  const grazeHitPoint=new THREE.Vector3(4,0.2,-3),floorNormalUp=new THREE.Vector3(0,1,0),grazeDirection=new THREE.Vector3(1,0,0);
  const grazeOrigin=ranged.embeddedBoltOrigin(grazeHitPoint,floorNormalUp,grazeDirection);
  const alongNormal=grazeOrigin.clone().sub(grazeHitPoint).dot(floorNormalUp);
  assert.ok(Math.abs(alongNormal - -ranged.embeddedBoltDepth()) < 1e-9,
    `a grazing hit still embeds the full depth along the surface normal (expected ${-ranged.embeddedBoltDepth()}, got ${alongNormal})`);

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
  // from the camera at (0,1.5,0) (its surface normal is (0,0,1), a head-on
  // hit), so the embed origin should land within centimeters of
  // (0, 1.5, .0325), nowhere near the ~15m a reparenting bug would produce.
  const expectedEmbedPosition=ranged.embeddedBoltOrigin(new THREE.Vector3(0,1.5,-.15),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1));
  assert.ok(embeddedWorldPosition.distanceTo(expectedEmbedPosition)<0.05,
    `embedded bolt lands at the impact point, not somewhere else (expected ~${expectedEmbedPosition.toArray()}, got ${embeddedWorldPosition.toArray()})`);

  // Regression check for a second, separate bug with the same symptom: the
  // embedded bolt's entity carries a real ECS `Position` (world coordinates,
  // used by doors.ts's proximity-pickup fallback) alongside an `Object3DRef`
  // now parented to the wood it struck rather than the scene. `syncSystem`
  // runs every frame and, for anything with both components, blindly writes
  // `Position` into the object's *local* `.position` -- correct only when
  // the parent is the scene (identity transform). Parented to the wood
  // instead, that doubled the wood's own world offset into the bolt's
  // position the very next frame, without any further ranged-combat code
  // ever running again (confirmed against the actual game: a bolt fired at
  // a wall would render correctly for one frame, then vanish). The `Embedded`
  // tag added alongside `Position`/`Object3DRef` at embed time exists
  // specifically so `syncSystem` skips this entity; assert both that the tag
  // is present and that a real `syncSystem` call leaves its rendered
  // position untouched.
  assert.ok(hasComponent(world,recovered,Embedded),'embedded bolt is tagged so syncSystem knows to leave its transform alone');
  syncSystem(world);
  const afterSyncPosition=new THREE.Vector3();Object3DRef[recovered].getWorldPosition(afterSyncPosition);
  assert.ok(afterSyncPosition.distanceTo(embeddedWorldPosition)<1e-6,
    `syncSystem must not move an embedded bolt (before ${embeddedWorldPosition.toArray()}, after ${afterSyncPosition.toArray()})`);

  assert.equal(pickUpItem(world,recovered,player,scene),'picked-up');
  assert.ok(!hasComponent(world,recovered,Embedded),'pickup clears the Embedded tag so a later drop gets ordinary generic sync back');
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
  const {initPhysics,createPhysics,addCharacter}=await server.ssrLoadModule('/src/physics/world.ts');
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
  // 40m at 34m/s is a bit over a second of flight even with gravity pulling it down.
  let clatteredEid;
  for(let t=0;t<2.5 && clatteredEid===undefined;t+=.02){
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
  // Drain world2's reload too, for the same reason as world/world2 above --
  // world3 below is a third bitecs world, so its weapon entity id collides
  // with world2's still-reloading one unless that reload is allowed to finish.
  for(let t=0;t<1.6;t+=.1) ranged.rangedCombatSystem(world2,physics,scene2,.1);

  // End-to-end regression check for the "sticks to the mat instead of
  // sinking in" bug: a shallow, near-horizontal shot skimming into a floor
  // (direction mostly parallel to the floor's normal, low incidence) must
  // clatter off (real physics body, angular velocity) rather than embed --
  // embedding it would have left the whole bolt buried under the floor
  // (this exact scenario, before the incidence gate, produced a bolt whose
  // origin sat *below* the floor's surface instead of visibly sticking out
  // of it).
  const world3=createWorld(),player3=addEntity(world3),weapon3=addEntity(world3),ammo3=addEntity(world3);
  addComponent(world3,player3,PlayerControlled);
  addComponent(world3,weapon3,Item);addComponent(world3,weapon3,Carried);
  Item.itemTypeId[weapon3]='crossbow';Carried.ownerEid[weapon3]=player3;Carried.slot[weapon3]='hand-right';
  addComponent(world3,ammo3,Item);addComponent(world3,ammo3,Carried);addComponent(world3,ammo3,Stackable);
  Item.itemTypeId[ammo3]='bolt';Carried.ownerEid[ammo3]=player3;Carried.slot[ammo3]='inventory';Stackable.count[ammo3]=1;
  const scene3=new THREE.Scene(),camera3=new THREE.PerspectiveCamera();
  camera3.position.set(0,0.3,0);
  camera3.lookAt(20,0.05,0); // nearly level, a hair downward -- a grazing hit on the floor ahead
  camera3.updateMatrixWorld(true);
  const floor=new THREE.Mesh(new THREE.BoxGeometry(40,0.2,40),new THREE.MeshBasicMaterial());
  floor.position.set(0,-0.1,0);scene3.add(floor);scene3.updateMatrixWorld(true);
  assert.equal(ranged.tryFireRanged(world3,camera3,scene3),'fired');
  let shallowEid;
  for(let t=0;t<1.5 && shallowEid===undefined;t+=.02){
    ranged.rangedCombatSystem(world3,physics,scene3,.02);
    shallowEid=query(world3,[Item,PhysicsBody]).find(eid=>eid!==ammo3);
  }
  assert.notEqual(shallowEid,undefined,'a shallow hit on the floor resolves to a clatter (PhysicsBody), never an Embedded bolt');
  assert.ok(!hasComponent(world3,shallowEid,Embedded),'too shallow an incidence to embed convincingly clatters off instead');
  // Drain world3's reload too -- world4 below is a fourth bitecs world, so
  // its weapon entity id collides with world3's still-reloading one
  // otherwise, same reasoning as the world/world2 drains above.
  for(let t=0;t<1.6;t+=.1) ranged.rangedCombatSystem(world3,physics,scene3,.1);

  // Body-part damage multiplier: melee moved to flat, uniform damage (see
  // meleeCollision.ts's BODY_PART_DAMAGE_MULTIPLIER doc comment), but a
  // bolt still has one real impact point, so ranged keeps the precision
  // reward -- whichever combat hitbox cylinder the hit point falls inside
  // scales the damage.
  const world4=createWorld(),player4=addEntity(world4),weapon4=addEntity(world4),ammo4=addEntity(world4),target4=addEntity(world4);
  addComponent(world4,player4,PlayerControlled);
  addComponent(world4,weapon4,Item);addComponent(world4,weapon4,Carried);
  Item.itemTypeId[weapon4]='crossbow';Carried.ownerEid[weapon4]=player4;Carried.slot[weapon4]='hand-right';
  addComponent(world4,ammo4,Item);addComponent(world4,ammo4,Carried);addComponent(world4,ammo4,Stackable);
  Item.itemTypeId[ammo4]='bolt';Carried.ownerEid[ammo4]=player4;Carried.slot[ammo4]='inventory';Stackable.count[ammo4]=1;
  addComponent(world4,target4,Health);addComponent(world4,target4,CharacterBody);addComponent(world4,target4,PhysicsBody);
  Health.current[target4]=Health.max[target4]=100;
  CharacterBody.radius[target4]=.35;CharacterBody.halfHeight[target4]=.55;
  const targetHandles=addCharacter(physics,0,0,-1,.35,.55);
  PhysicsBody[target4]=targetHandles.body;
  meleeCollisionSystem(world4,physics,0); // registers target4's three combat hitbox cylinders
  const headCollider=getCombatHitboxColliders().find((c)=>c.eid===target4&&c.part==='head');
  const headY=headCollider.collider.translation().y;

  const scene4=new THREE.Scene(),camera4=new THREE.PerspectiveCamera();
  camera4.position.set(0,headY,0);camera4.lookAt(0,headY,-1);camera4.updateMatrixWorld(true); // level shot aimed exactly at head height
  const targetMesh=new THREE.Mesh(new THREE.BoxGeometry(.7,2,.7),new THREE.MeshBasicMaterial());
  targetMesh.position.set(0,1,-1);targetMesh.userData.eid=target4;scene4.add(targetMesh);scene4.updateMatrixWorld(true);
  assert.equal(ranged.tryFireRanged(world4,camera4,scene4),'fired');
  for(let t=0;t<1&&Health.current[target4]===100;t+=.02) ranged.rangedCombatSystem(world4,physics,scene4,.02);
  const expectedHeadDamage=Math.max(1,Math.round(crossbow.rangedWeapon.damage*BODY_PART_DAMAGE_MULTIPLIER.head));
  assert.equal(Health.current[target4],100-expectedHeadDamage,'a bolt landing at head height applies the head damage multiplier');

  // Regression check for "an arrow stuck in an NPC stays floating exactly
  // where it hit instead of following the corpse's death collapse": both
  // this module's own embed path and throwingCombat.ts's used to reparent
  // straight onto whatever raw mesh the hit landed on -- a character's own
  // root object, whose transform stays fixed at its ECS Position/Rotation
  // the whole time, since a death/hit animation moves individual bones (an
  // AnimationMixer) rather than the root. `stickTarget` is the shared fix:
  // it walks to the specific bone nearest the struck part instead, falling
  // back to the root for anything that doesn't have one.
  const rig=new THREE.Object3D();
  const hips=new THREE.Object3D();hips.name='hips';rig.add(hips);
  const chest=new THREE.Object3D();chest.name='chest';rig.add(chest);
  const head=new THREE.Object3D();head.name='head';rig.add(head);
  assert.equal(stickTarget(rig,'head'),head,'a head hit reparents onto the head bone, not the rig root');
  assert.equal(stickTarget(rig,'torso'),chest,'a torso hit reparents onto the chest bone');
  assert.equal(stickTarget(rig,'legs'),hips,'a legs hit reparents onto the hips bone');
  assert.equal(stickTarget(rig,undefined),rig,'no resolved body part falls back to the rig root');
  const bareBox=new THREE.Object3D(); // no named bones at all -- a non-humanoid target
  assert.equal(stickTarget(bareBox,'head'),bareBox,'a target with no matching bone falls back to its own root');
  assert.equal(stickTarget(undefined,'head'),undefined,'no target root at all resolves to nothing to attach to');

  console.log('crossbow ammo label, reload, surface sticking, bolt recovery, clatter physics and body-part multiplier passed');
  console.log('stickTarget: embedded projectiles resolve to the struck bone, not the character root, so they follow death/hit animations');
} finally {await server.close();}
