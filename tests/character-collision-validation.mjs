import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {addComponent,addEntity,createWorld} from 'bitecs';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {CharacterBody,PhysicsBody,PhysicsCollider,Position,Velocity}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {initPhysics,createPhysics,addCharacter,addStaticBox,PHYSICS_DT}=await server.ssrLoadModule('/src/physics/world.ts');
  const {characterSystem,physicsSyncSystem}=await server.ssrLoadModule('/src/ecs/systems/character.ts');

  await initPhysics();
  const physics=createPhysics();
  const world=createWorld();
  // A floor to stand on -- every real level has one underfoot, and without
  // it these ungrounded kinematic characters free-fall under gravity with
  // nothing to stop them. That's not just cosmetic: it was this test's own
  // bug for a while (mistaken at first for a broken CHARACTER_GROUPS
  // filter) -- two characters falling from the same height drift apart in Y
  // by even a frame's worth of update-order slop, and Rapier's capsule
  // shapes are tested in full 3D, so their horizontal paths could cross
  // while they were no longer at overlapping heights, sailing past each
  // other with zero collisions reported despite everything being configured
  // correctly.
  addStaticBox(physics, 0, -0.5, 0, 20, 0.5, 20);

  function spawnCharacter(x,z,{radius=.35,halfHeight=.55}={}){
    const eid=addEntity(world);
    addComponent(world,eid,CharacterBody);addComponent(world,eid,PhysicsBody);addComponent(world,eid,PhysicsCollider);
    addComponent(world,eid,Position);addComponent(world,eid,Velocity);
    CharacterBody.radius[eid]=radius;CharacterBody.halfHeight[eid]=halfHeight;
    CharacterBody.verticalVelocity[eid]=0;CharacterBody.grounded[eid]=0;
    Position.x[eid]=x;Position.y[eid]=0;Position.z[eid]=z;
    Velocity.x[eid]=0;Velocity.z[eid]=0;
    const handles=addCharacter(physics,x,0,z,radius,halfHeight);
    PhysicsBody[eid]=handles.body;
    PhysicsCollider[eid]=handles.collider;
    return eid;
  }

  const tick=(dt)=>{
    characterSystem(world,physics,dt);
    physics.world.step();
    physicsSyncSystem(world);
  };

  // A stationary character (A) blocks a second one (B) walking straight at
  // it -- physics/world.ts's CHARACTER_GROUPS now makes character capsules
  // solid to each other (previously they interacted with level geometry and
  // props only, letting an NPC and the player -- or, now that the combat-test
  // sandbox can spawn several opponents at once, two NPCs -- overlap freely).
  const a=spawnCharacter(0,0);
  const b=spawnCharacter(0,-3);
  // Let both settle onto the floor (and stop falling) before the real test
  // starts -- see the addStaticBox comment above for why this matters.
  for (let t=0;t<0.5;t+=PHYSICS_DT) tick(PHYSICS_DT);
  Velocity.z[b]=3; // straight toward A, fast enough to reach/pass it in well under a second if unobstructed
  for (let t=0;t<2;t+=PHYSICS_DT) tick(PHYSICS_DT);

  const dist=Math.hypot(Position.x[a]-Position.x[b],Position.z[a]-Position.z[b]);
  const combinedRadius=CharacterBody.radius[a]+CharacterBody.radius[b];
  assert.ok(dist >= combinedRadius - 0.05,
    `two characters never end up overlapping (expected >= ${combinedRadius}, got ${dist})`);
  assert.ok(dist < 2.9, 'B was actually stopped by A, not just short of reaching it for some unrelated reason');

  console.log('character-vs-character physical collision passed');
} finally {await server.close();}
