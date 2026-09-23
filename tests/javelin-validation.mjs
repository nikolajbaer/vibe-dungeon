import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

// The javelin: the first weapon that both dual-wields (alongside the
// dagger, weight-gated) and fires through the shared jab-or-charge-and-
// release input as a self-thrown weapon rather than a melee swing or an
// ammo-based rangedWeapon (see ItemAssetDef.throwable's own doc comment).
// This covers the asset's own stats, the dual-wield weight gate
// (items.ts's wouldExceedDualWieldWeight), and the throw charge/release/
// flight/impact mechanics (throwingCombat.ts) end to end without a real
// browser or Rapier world -- the same "mock just enough physics" shape
// ranged-combat-validation.mjs already uses for the crossbow's bolts.

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { addComponent, addEntity, createWorld, hasComponent } = await import('bitecs');
  const {
    Carried, CharacterBody, Combat, Health, Item, Object3DRef, PhysicsBody, PlayerControlled, Position, Rotation, Stamina,
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
    Combat.attackRecovery[player] = 0;
    Combat.blocking[player] = 0;
    Combat.charging[player] = 0;
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
  // real kinematic character's combat hitboxes ----------------------------
  // Unlike the old raycast-based flight, the thrown javelin is now a real
  // Rapier dynamic body (see throwingCombat.ts's own header comment), so
  // this needs a real physics world -- the same `initPhysics`/`createPhysics`/
  // `addCharacter`/`addCombatHitboxes` setup melee-collision-validation.mjs
  // already uses for its own hit-detection tests.
  await initPhysics();
  const physics = createPhysics();
  {
    const world = createWorld();
    const player = addEntity(world);
    addComponent(world, player, PlayerControlled);
    addComponent(world, player, Combat);
    addComponent(world, player, Stamina);
    addComponent(world, player, Health);
    Health.current[player] = Health.max[player] = 100;
    Combat.attackRecovery[player] = 0;
    Combat.blocking[player] = 0;
    Combat.charging[player] = 0;
    Combat.agility[player] = 0;
    Stamina.max[player] = Stamina.current[player] = 100;

    // The javelin: a real dynamic Rapier body (mirroring buildItemWorldBody's
    // own shape/mass, not a mock) sitting disabled at the origin, exactly as
    // pickUpItem leaves a carried item's body until it's thrown.
    const weapon = addEntity(world);
    addComponent(world, weapon, Item);
    addComponent(world, weapon, Carried);
    addComponent(world, weapon, Object3DRef);
    addComponent(world, weapon, PhysicsBody);
    Item.itemTypeId[weapon] = 'javelin';
    Carried.ownerEid[weapon] = player;
    Carried.slot[weapon] = 'hand-right';
    const mesh = new THREE.Group();
    mesh.visible = false;
    Object3DRef[weapon] = mesh;
    // Shaped like the javelin's *real* boxShapeOf-computed collider (long
    // and off-center from the grip origin -- see javelin.ts's own
    // SHAFT_FORWARD_LENGTH/HEAD_LENGTH/TAIL_LENGTH), not a tiny centered
    // cube: this is what actually exercises throwingCombat.ts's multi-point
    // `findStruckCharacter` sampling along the shaft, rather than a bare
    // origin check that a ~1.3m weapon can pass right past without ever
    // registering as "close enough."
    const body = addDynamicBox(physics, 0, 1.5, 0, 0, { hx: 0.03, hy: 0.03, hz: 0.64, cx: 0, cy: 0, cz: 0.46 }, javelin.mass);
    body.setEnabled(false);
    PhysicsBody[weapon] = body;

    // A target character 6m down -Z, with real combat hitboxes registered
    // the same way every NPC/the player gets them in the real game.
    const targetEid = addEntity(world);
    addComponent(world, targetEid, Health);
    addComponent(world, targetEid, CharacterBody);
    addComponent(world, targetEid, PhysicsBody);
    addComponent(world, targetEid, Position);
    addComponent(world, targetEid, Rotation);
    Health.current[targetEid] = Health.max[targetEid] = 45; // the "guard" archetype's own health
    CharacterBody.radius[targetEid] = 0.35;
    CharacterBody.halfHeight[targetEid] = 0.55;
    Position.x[targetEid] = 0; Position.y[targetEid] = 0; Position.z[targetEid] = -6;
    Rotation.yaw[targetEid] = 0;
    const targetHandles = addCharacter(physics, 0, 0, -6, 0.35, 0.55);
    PhysicsBody[targetEid] = targetHandles.body;
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

    assert.equal(throwing.tryStartThrowCharge(world), true);
    assert.equal(body.isEnabled(), false, 'still disabled while merely charging -- nothing launches until release');
    assert.equal(throwing.tryThrowWeapon(world, physics, camera, scene), true, 'release throws it');
    assert.equal(Combat.charging[player], 0, 'charging flag cleared on release');
    assert.ok(Combat.attackRecovery[player] > 0, 'a throw still gates the next attack, same as any other attack');
    assert.equal(Stamina.current[player], 100 - ATTACK_STAMINA_COST.swing, 'stamina spent on release, not on charge-start');
    assert.equal(hasComponent(world, weapon, Carried), false, 'the javelin leaves the player\'s hand the instant it\'s thrown');
    assert.equal(mesh.visible, true, 'its world mesh becomes visible again -- it\'s a real flying object now');
    assert.equal(body.isEnabled(), true, 'its physics body is re-enabled -- a real Rapier rigid body for the whole flight');
    assert.equal(throwing.getThrowingCombatDebugState().flying, 1, 'tracked as one live throw');

    // Step real physics forward until it reaches (and physically collides
    // with) the target 6m out -- projectileSpeed 24 m/s covers that in
    // well under a second, real Rapier CCD (inherited from addDynamicBox)
    // preventing tunneling through the target's capsule in one big step.
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      physics.world.step();
      throwing.throwingCombatSystem(world, 1 / 60);
      if (throwing.getThrowingCombatDebugState().flying === 0) hit = true;
    }
    assert.ok(hit, 'the thrown javelin actually resolves within two seconds of real physics simulation');
    assert.ok(Health.current[targetEid] <= 0, 'one thrown hit drops a full-health "guard" (45 HP) -- ranged damage bypasses blocking entirely');
  }
  console.log('javelin throw: charge, release, real-physics flight, and a block-bypassing lethal hit on a kinematic character passed');

  console.log('\n=== Javelin: dual-wield weight gate and throw mechanics passed ===\n');
} finally {
  await server.close();
}
