import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {addComponent,addEntity,createWorld}=await import('bitecs');
  const {CharacterBody,Health,PhysicsBody,Position,Rotation}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {initPhysics,createPhysics,addCharacter}=await server.ssrLoadModule('/src/physics/world.ts');
  const {registerMeleeSwing,meleeCollisionSystem,getCombatHitboxColliders}=await server.ssrLoadModule('/src/ecs/systems/meleeCollision.ts');
  const {applyMeleeDamage}=await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const hitboxDebug=await server.ssrLoadModule('/src/ecs/systems/hitboxDebug.ts');

  await initPhysics();
  const physics=createPhysics();
  const world=createWorld();
  const scene=new THREE.Scene();

  function spawnCombatant(dz){
    const eid=addEntity(world);
    addComponent(world,eid,Health);addComponent(world,eid,CharacterBody);addComponent(world,eid,PhysicsBody);
    addComponent(world,eid,Position);addComponent(world,eid,Rotation);
    Health.current[eid]=Health.max[eid]=100;
    CharacterBody.radius[eid]=.35;CharacterBody.halfHeight[eid]=.55;
    Position.x[eid]=0;Position.y[eid]=0;Position.z[eid]=dz;
    Rotation.yaw[eid]=0;
    const handles=addCharacter(physics,0,0,dz,.35,.55);
    PhysicsBody[eid]=handles.body;
    return eid;
  }

  const attacker=spawnCombatant(0);
  const target=spawnCombatant(-1);

  const tick=(dt)=>{
    physics.world.step();
    const hits=meleeCollisionSystem(world,physics,dt);
    for(const hit of hits) applyMeleeDamage(world,hit.targetEid,hit.damage,hit.attackerEid,hit.part);
    return hits;
  };
  tick(0); // warm-up: attaches each combatant's 3 hitbox cylinders (query-pipeline staleness, see meleeCollisionSystem)

  assert.equal(hitboxDebug.isHitboxDebugEnabled(),false,'starts disabled');
  hitboxDebug.setHitboxDebugEnabled(true);
  assert.equal(hitboxDebug.isHitboxDebugEnabled(),true);

  const lineSegments=()=>scene.children.filter(c=>c.type==='LineSegments');
  hitboxDebug.hitboxDebugSystem(scene,0.016);
  assert.equal(lineSegments().length,6,'three body-part cylinders per combatant, no swing box yet');

  // A registered-but-not-yet-resolved swing gets its own wireframe box.
  registerMeleeSwing(attacker,0,-1,1.4,.8,1.1,15,.2);
  hitboxDebug.hitboxDebugSystem(scene,0.016);
  assert.equal(lineSegments().length,7,'an active swing adds one wireframe box alongside the six cylinders');

  function cylinderHelperFor(eid,part){
    const entry=getCombatHitboxColliders().find((c)=>c.eid===eid&&c.part===part);
    const t=entry.collider.translation();
    return lineSegments().find((c)=>Math.abs(c.position.x-t.x)<1e-6&&Math.abs(c.position.y-t.y)<1e-6&&Math.abs(c.position.z-t.z)<1e-6);
  }
  const isRed=(helper)=>helper.material.color.getHex()===0xff0000;
  const isWhite=(helper)=>helper.material.color.getHex()===0xffffff;

  // Resolving the swing (target is directly in front, within reach) lands a
  // real hit -- only the struck part's own cylinder, and the attacker's
  // weapon box, should flash red; every other cylinder stays white.
  const hits=tick(1/60);
  assert.equal(hits.length,1,'the swing connects with the target directly in front');
  const struckPart=hits[0].part;
  hitboxDebug.hitboxDebugSystem(scene,0.01); // small dt, well within the flash window

  assert.ok(isRed(cylinderHelperFor(target,struckPart)),'the struck part\'s own cylinder flashes red');
  for(const part of ['head','torso','legs']){
    if(part===struckPart) continue;
    assert.ok(isWhite(cylinderHelperFor(target,part)),'an unstruck part of the target stays white');
  }
  for(const part of ['head','torso','legs']){
    assert.ok(isWhite(cylinderHelperFor(attacker,part)),'the attacker\'s own cylinders never flash from its own swing');
  }
  const cylinderHelpers=new Set([target,attacker].flatMap((eid)=>['head','torso','legs'].map((part)=>cylinderHelperFor(eid,part))));
  const weaponBox=lineSegments().find((c)=>!cylinderHelpers.has(c));
  assert.ok(weaponBox&&isRed(weaponBox),'the attacker\'s swing box keeps rendering, red, for the flash window even after the swing resolved');

  hitboxDebug.hitboxDebugSystem(scene,10); // far past the flash window -- fades the box to white this frame
  assert.ok(isWhite(cylinderHelperFor(target,struckPart)),'the struck cylinder fades back to white');
  hitboxDebug.hitboxDebugSystem(scene,10); // next frame sees the flash already expired and drops the box
  assert.equal(lineSegments().length,6,'the resolved swing\'s box disappears once its flash finishes');

  // A direct applyMeleeDamage call with no known body part (the handful of
  // test/legacy call sites with no real swing behind them) flashes all
  // three of the target's cylinders, not just one.
  applyMeleeDamage(world,target,10,attacker);
  hitboxDebug.hitboxDebugSystem(scene,0.01);
  for(const part of ['head','torso','legs']) assert.ok(isRed(cylinderHelperFor(target,part)),'an unknown-part hit flashes every cylinder on the target');

  hitboxDebug.setHitboxDebugEnabled(false);
  assert.equal(lineSegments().length,0,'disabling the toggle removes every hitbox and swing-box helper from the scene');

  console.log('hitbox debug toggle, real cylinder/swing-box geometry, and per-part scored-hit flash/fade passed');
} finally {await server.close();}
