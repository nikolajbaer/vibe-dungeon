import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

// The javelin: the first weapon that both dual-wields (alongside the
// dagger, weight-gated) and fires through the shared jab-or-charge-and-
// release input as a self-thrown weapon rather than a melee swing or an
// ammo-based rangedWeapon (see ItemAssetDef.throwable's own doc comment).
// This covers the asset's own stats, the dual-wield weight gate
// (items.ts's wouldExceedDualWieldWeight), and the throw charge/release/
// flight/impact mechanics (throwingCombat.ts) end to end -- the thrown
// weapon is a real Rapier rigid body for its whole flight (see that file's
// own header comment for why), so this needs a real physics world, the same
// `initPhysics`/`createPhysics`/`addCharacter`/`addCombatHitboxes` setup
// melee-collision-validation.mjs already uses for its own hit-detection
// tests.

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { addComponent, addEntity, createWorld, hasComponent } = await import('bitecs');
  const {
    Carried, Combat, CharacterBody, DynamicBody, Embedded, Health, Item, Object3DRef, PhysicsBody, PhysicsRotation, PlayerControlled, Position, Rotation, Stamina,
  } = await server.ssrLoadModule('/src/ecs/components.ts');
  const { default: javelin } = await server.ssrLoadModule('/src/assets/items/javelin.ts');
  const { default: sword } = await server.ssrLoadModule('/src/assets/items/sword.ts');
  const { default: dagger } = await server.ssrLoadModule('/src/assets/items/dagger.ts');
  const {
    DUAL_WIELD_MAX_COMBINED_WEIGHT, wouldExceedDualWieldWeight,
  } = await server.ssrLoadModule('/src/ecs/systems/items.ts');
  const { ATTACK_PROFILES, ATTACK_STAMINA_COST } = await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const { initPhysics, createPhysics, addDynamicBox, addCharacter } = await server.ssrLoadModule('/src/physics/world.ts');
  const { meleeCollisionSystem } = await server.ssrLoadModule('/src/ecs/systems/meleeCollision.ts');
  const throwing = await server.ssrLoadModule('/src/ecs/systems/throwingCombat.ts');

  // --- Asset stats -----------------------------------------------------
  assert.ok(javelin.meleeReach > sword.meleeReach, 'reach weapon like the quarterstaff/greatsword -- longer than a sword\'s jab');
  assert.ok(javelin.meleeDamage < sword.meleeDamage, 'traded some flat damage for that reach, same tradeoff the quarterstaff makes');
  assert.ok(javelin.throwable, 'declares throwable tuning');
  assert.ok(javelin.throwable.damage >= 45, 'packs enough punch to drop a full-health "guard" NPC (45 HP) in one thrown hit');
  assert.ok(!javelin.rangedWeapon, 'not an ammo-based rangedWeapon -- no zoom, no reload, no ammo count');
  assert.ok(!javelin.twoHanded, 'one-handed -- otherwise it could never dual-wield with the dagger');

  // --- Dual-wield weight gate -------------------------------------------
  function withHands(leftId, rightId) {
    const world = createWorld();
    const player = addEntity(world);
    const left = addEntity(world), right = addEntity(world);
    if (leftId) {
      addComponent(world, left, Item); addComponent(world, left, Carried);
      Item.itemTypeId[left] = leftId; Carried.ownerEid[left] = player; Carried.slot[left] = 'hand-left';
    }
    if (rightId) {
      addComponent(world, right, Item); addComponent(world, right, Carried);
      Item.itemTypeId[right] = rightId; Carried.ownerEid[right] = player; Carried.slot[right] = 'hand-right';
    }
    return { world, player, candidate: addEntity(world) };
  }

  {
    const { world, player, candidate } = withHands('dagger', undefined);
    addComponent(world, candidate, Item); Item.itemTypeId[candidate] = 'sword';
    assert.equal(sword.mass + dagger.mass, 3.6);
    assert.ok(sword.mass + dagger.mass <= DUAL_WIELD_MAX_COMBINED_WEIGHT, 'sword+dagger is the named example combo -- must fit under the cap');
    assert.equal(wouldExceedDualWieldWeight(world, player, candidate, 'hand-right'), false, 'sword alongside an already-equipped dagger is allowed');
  }
  {
    const { world, player, candidate } = withHands('dagger', undefined);
    addComponent(world, candidate, Item); Item.itemTypeId[candidate] = 'javelin';
    assert.ok(javelin.mass + dagger.mass <= DUAL_WIELD_MAX_COMBINED_WEIGHT, 'javelin+dagger is the other named example combo -- must also fit');
    assert.equal(wouldExceedDualWieldWeight(world, player, candidate, 'hand-right'), false, 'javelin alongside an already-equipped dagger is allowed');
  }
  {
    const { world, player, candidate } = withHands('sword', undefined);
    addComponent(world, candidate, Item); Item.itemTypeId[candidate] = 'sword';
    assert.ok(sword.mass * 2 > DUAL_WIELD_MAX_COMBINED_WEIGHT, 'two swords together exceed the cap');
    assert.equal(wouldExceedDualWieldWeight(world, player, candidate, 'hand-right'), true, 'a second sword is refused -- too heavy to dual-wield');
  }
  {
    // A single weapon (nothing in the other hand) is never gated by this --
    // only carrying *two at once* is.
    const { world, player, candidate } = withHands(undefined, undefined);
    addComponent(world, candidate, Item); Item.itemTypeId[candidate] = 'sword';
    assert.equal(wouldExceedDualWieldWeight(world, player, candidate, 'hand-right'), false, 'equipping into an empty off-hand is never weight-gated');
  }
  console.log('dual-wield weight gate (sword+dagger and javelin+dagger allowed, sword+sword refused) passed');

  // --- Charge gating (no physics needed -- tryStartThrowCharge never
  // touches a PhysicsBody at all) ----------------------------------------
  function spawnPlayerWithCarriedJavelin() {
    const world = createWorld();
    const player = addEntity(world);
    addComponent(world, player, PlayerControlled);
    addComponent(world, player, Combat);
    addComponent(world, player, Stamina);
    addComponent(world, player, Health);
    Health.current[player] = Health.max[player] = 100;
    Combat.attackRecovery[player] = 0; Combat.attackRecoveryOffhand[player] = 0;
    Combat.blocking[player] = 0;
    Combat.charging[player] = 0; Combat.chargingOffhand[player] = 0;
    Combat.agility[player] = 0;
    Stamina.max[player] = Stamina.current[player] = 100;

    const weapon = addEntity(world);
    addComponent(world, weapon, Item);
    addComponent(world, weapon, Carried);
    Item.itemTypeId[weapon] = 'javelin';
    Carried.ownerEid[weapon] = player;
    Carried.slot[weapon] = 'hand-right';
    return { world, player, weapon };
  }

  {
    const { world, player } = spawnPlayerWithCarriedJavelin();
    assert.equal(throwing.isEquippedWeaponThrowable(world, player), true, 'a carried javelin is recognized as throwable');
    assert.equal(throwing.tryStartThrowCharge(world), true, 'charge starts');
    assert.equal(Combat.charging[player], 1, 'Combat.charging set, same flag a melee swing charge uses');
    assert.equal(throwing.tryStartThrowCharge(world), false, 'already charging -- refuses a second charge start');
  }
  {
    const { world, player } = spawnPlayerWithCarriedJavelin();
    Stamina.current[player] = ATTACK_STAMINA_COST.swing - 1;
    assert.equal(throwing.tryStartThrowCharge(world), false, 'refuses without enough stamina for the shared swing cost');
  }
  console.log('throw charge gating (stamina, no double-charge) passed');

  // --- Real-physics throw: launch, flight, and a block-bypassing hit on a
  // real kinematic character's combat hitboxes, ending with the javelin
  // actually stuck to the target's own three.js mesh -------------------
  await initPhysics();
  const physics = createPhysics();

  function spawnPlayer(world) {
    const player = addEntity(world);
    addComponent(world, player, PlayerControlled);
    addComponent(world, player, Combat);
    addComponent(world, player, Stamina);
    addComponent(world, player, Health);
    Health.current[player] = Health.max[player] = 100;
    Combat.attackRecovery[player] = 0; Combat.attackRecoveryOffhand[player] = 0;
    Combat.blocking[player] = 0;
    Combat.charging[player] = 0; Combat.chargingOffhand[player] = 0;
    Combat.agility[player] = 0;
    Stamina.max[player] = Stamina.current[player] = 100;
    return player;
  }

  // A javelin, equipped into `slot`, as a real dynamic Rapier body
  // (mirroring buildItemWorldBody's own shape/mass, not a mock) sitting
  // disabled at the origin, exactly as pickUpItem leaves a carried item's
  // body until it's thrown. Shaped like the javelin's *real*
  // boxShapeOf-computed collider (long and off-center from the grip
  // origin -- see javelin.ts's own SHAFT_FORWARD_LENGTH/HEAD_LENGTH/
  // TAIL_LENGTH), not a tiny centered cube: this is what actually
  // exercises throwingCombat.ts's multi-point `findStruckCharacter`
  // sampling along the shaft, rather than a bare origin check a ~1.3m
  // weapon can pass right past without ever registering as "close enough."
  function equipJavelin(world, player, slot) {
    const weapon = addEntity(world);
    addComponent(world, weapon, Item);
    addComponent(world, weapon, Carried);
    addComponent(world, weapon, Object3DRef);
    addComponent(world, weapon, PhysicsBody);
    Item.itemTypeId[weapon] = 'javelin';
    Carried.ownerEid[weapon] = player;
    Carried.slot[weapon] = slot;
    const mesh = new THREE.Group();
    mesh.visible = false;
    Object3DRef[weapon] = mesh;
    const body = addDynamicBox(physics, 0, 1.5, 0, 0, { hx: 0.03, hy: 0.03, hz: 0.64, cx: 0, cy: 0, cz: 0.46 }, javelin.mass);
    body.setEnabled(false);
    PhysicsBody[weapon] = body;
    return { weapon, body };
  }

  function spawnCharacterTarget(world, x, z) {
    const targetEid = addEntity(world);
    addComponent(world, targetEid, Health);
    addComponent(world, targetEid, CharacterBody);
    addComponent(world, targetEid, PhysicsBody);
    addComponent(world, targetEid, Position);
    addComponent(world, targetEid, Rotation);
    addComponent(world, targetEid, Object3DRef);
    Health.current[targetEid] = Health.max[targetEid] = 45; // the "guard" archetype's own health
    CharacterBody.radius[targetEid] = 0.35;
    CharacterBody.halfHeight[targetEid] = 0.55;
    Position.x[targetEid] = x; Position.y[targetEid] = 0; Position.z[targetEid] = z;
    Rotation.yaw[targetEid] = 0;
    const targetHandles = addCharacter(physics, x, 0, z, 0.35, 0.55);
    PhysicsBody[targetEid] = targetHandles.body;
    // A real three.js mesh standing in for the NPC's own rig root -- the
    // one thing this test needs beyond melee-collision-validation.mjs's own
    // setup, since `stickInCharacter` (throwingCombat.ts) reparents the
    // struck javelin onto exactly this.
    const mesh = new THREE.Group();
    mesh.position.set(x, 0, z);
    Object3DRef[targetEid] = mesh;
    return targetEid;
  }

  {
    const world = createWorld();
    const player = spawnPlayer(world);
    const { weapon, body } = equipJavelin(world, player, 'hand-right');
    const targetEid = spawnCharacterTarget(world, 0, -6);
    // Combat hitboxes are attached lazily, the same way the real game does
    // it for the player and every NPC (`meleeCollision.ts`'s own
    // `ensureCombatHitboxes`, run at the top of every `meleeCollisionSystem`
    // call) -- calling `addCombatHitboxes` directly would create real Rapier
    // colliders but skip registering them in `meleeCollision.ts`'s own
    // eid-lookup table, which `findStruckCharacter` (throwingCombat.ts)
    // relies on via `getCombatHitboxColliders`.
    meleeCollisionSystem(world, physics, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.5, 0);
    camera.lookAt(0, 1.5, -6);
    camera.updateMatrixWorld(true);

    assert.equal(throwing.tryStartThrowCharge(world, 'hand-right'), true);
    assert.equal(body.isEnabled(), false, 'still disabled while merely charging -- nothing launches until release');
    assert.equal(throwing.tryThrowWeapon(world, physics, camera, scene, 'hand-right'), true, 'release throws it');
    assert.equal(Combat.charging[player], 0, 'charging flag cleared on release');
    assert.ok(Combat.attackRecovery[player] > 0, 'a throw still gates the next attack, same as any other attack');
    assert.equal(Stamina.current[player], 100 - ATTACK_STAMINA_COST.swing, 'stamina spent on release, not on charge-start');
    assert.equal(hasComponent(world, weapon, Carried), false, 'the javelin leaves the player\'s hand the instant it\'s thrown');
    assert.equal(Object3DRef[weapon].visible, true, 'its world mesh becomes visible again -- it\'s a real flying object now');
    assert.equal(body.isEnabled(), true, 'its physics body is re-enabled -- a real Rapier rigid body for the whole flight');
    assert.equal(throwing.getThrowingCombatDebugState().flying, 1, 'tracked as one live throw');
    assert.equal(javelin.throwable.projectileSpeed, 12, 'flies at half its original (pre-feedback) speed');

    // Step real physics forward until it reaches (and physically collides
    // with) the target 6m out -- real Rapier CCD (inherited from
    // addDynamicBox) prevents tunneling through the target's capsule in one
    // big step.
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      physics.world.step();
      throwing.throwingCombatSystem(world, 1 / 60);
      if (throwing.getThrowingCombatDebugState().flying === 0) hit = true;
    }
    assert.ok(hit, 'the thrown javelin actually resolves within two seconds of real physics simulation');
    assert.ok(Health.current[targetEid] <= 0, 'one thrown hit drops a full-health "guard" (45 HP) -- ranged damage bypasses blocking entirely');

    // The one behavior this whole feature is about: a hit on an NPC sticks,
    // reparented onto the target's own three.js mesh so it visually rides
    // along with whatever that mesh does next (a death collapse, a walk).
    assert.equal(hasComponent(world, weapon, Embedded), true, 'a hit on a character sticks the javelin in place');
    assert.equal(Object3DRef[weapon].parent, Object3DRef[targetEid], 'reparented onto the target\'s own mesh, not left a child of the scene');
    assert.equal(body.isEnabled(), false, 'the physics body is frozen once stuck -- it no longer drives the (now parent-relative) visual position');
    assert.equal(hasComponent(world, weapon, PhysicsRotation), false, 'PhysicsRotation is dropped so syncSystem\'s quaternion loop (no Embedded skip) leaves the attach()-given local rotation alone');
  }
  console.log('javelin throw: charge, release, real rigid-body flight, and a block-bypassing lethal hit that sticks to the target\'s own mesh passed');

  // --- Hitting a dynamic prop (a barrel, a dropped item) is NOT a
  // character hit -- Rapier's own collision response knocks it around for
  // free, and the javelin itself stays a live, un-stuck rigid body. -------
  {
    const world = createWorld();
    const player = spawnPlayer(world);
    const { weapon, body } = equipJavelin(world, player, 'hand-right');

    const propEid = addEntity(world);
    addComponent(world, propEid, DynamicBody);
    addComponent(world, propEid, PhysicsBody);
    const propBody = addDynamicBox(physics, 0, 1.5, -4, 0, { hx: 0.3, hy: 0.3, hz: 0.3, cx: 0, cy: 0, cz: 0 }, 5);
    PhysicsBody[propEid] = propBody;
    const propStartZ = propBody.translation().z;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.5, 0);
    camera.lookAt(0, 1.5, -4);
    camera.updateMatrixWorld(true);

    assert.equal(throwing.tryStartThrowCharge(world, 'hand-right'), true);
    assert.equal(throwing.tryThrowWeapon(world, physics, camera, scene, 'hand-right'), true);

    for (let i = 0; i < 90; i++) {
      physics.world.step();
      throwing.throwingCombatSystem(world, 1 / 60);
    }
    assert.ok(propBody.translation().z < propStartZ - 0.05, 'the prop is physically shoved further away -- Rapier\'s own solver, nothing this file does explicitly');
    assert.equal(hasComponent(world, weapon, Embedded), false, 'a struck prop never sticks the javelin -- only a character hit does');
    assert.equal(body.isEnabled(), true, 'the javelin\'s own body stays live -- it bounces/settles like any other thrown rigid object, not frozen in place');
  }
  console.log('javelin throw: hitting a dynamic prop shoves it via real physics, never sticks the javelin passed');

  console.log('\n=== Javelin: dual-wield weight gate and throw mechanics passed ===\n');
} finally {
  await server.close();
}
