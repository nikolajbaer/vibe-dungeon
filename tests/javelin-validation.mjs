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
    Carried, Combat, DynamicBody, Embedded, Health, Item, Object3DRef, PhysicsBody, PlayerControlled, Stamina,
  } = await server.ssrLoadModule('/src/ecs/components.ts');
  const { default: javelin } = await server.ssrLoadModule('/src/assets/items/javelin.ts');
  const { default: sword } = await server.ssrLoadModule('/src/assets/items/sword.ts');
  const { default: dagger } = await server.ssrLoadModule('/src/assets/items/dagger.ts');
  const {
    DUAL_WIELD_MAX_COMBINED_WEIGHT, wouldExceedDualWieldWeight,
  } = await server.ssrLoadModule('/src/ecs/systems/items.ts');
  const { ATTACK_PROFILES, ATTACK_STAMINA_COST } = await server.ssrLoadModule('/src/ecs/systems/combat.ts');
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

  // --- Throw: hand-simulated flight (mirroring rangedCombat.ts's own bolt
  // approach -- see throwingCombat.ts's header comment for why a real Rapier
  // body doesn't work for a weapon that also needs to embed), a physics/
  // scene mock in the same shape ranged-combat-validation.mjs already uses
  // for the crossbow's bolts ----------------------------------------------
  function mockPhysicsBody() {
    const calls = { setTranslation: [], setLinvel: [], setEnabled: [], applyImpulseAtPoint: [] };
    return {
      calls,
      setTranslation: (p) => calls.setTranslation.push(p),
      setLinvel: (v) => calls.setLinvel.push(v),
      setAngvel: () => {},
      setRotation: () => {},
      setEnabled: (v) => calls.setEnabled.push(v),
      isEnabled: () => calls.setEnabled.at(-1) ?? false,
      applyImpulseAtPoint: (impulse, point, wakeUp) => calls.applyImpulseAtPoint.push({ impulse, point, wakeUp }),
    };
  }

  function spawnPlayerWithThrownJavelin() {
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
    addComponent(world, weapon, Object3DRef);
    addComponent(world, weapon, PhysicsBody);
    Item.itemTypeId[weapon] = 'javelin';
    Carried.ownerEid[weapon] = player;
    Carried.slot[weapon] = 'hand-right';

    // A real world-placed javelin's Object3DRef is the pickup-hitbox-wrapped
    // group `withPickupHitbox` builds (visual mesh first, invisible pickup
    // sphere second) -- shaped here like the javelin's own real proportions
    // (grip near the rear third, not centered) so `tryThrowWeapon`'s
    // `tipOffset` measurement exercises the same off-center case the real
    // mesh has, not a trivially-centered box.
    const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.28));
    visualMesh.geometry.translate(0, 0, 0.46); // local Z now spans [-0.18, 1.1], matching javelin.ts's own grip-to-tip/-butt span
    const group = new THREE.Group();
    group.add(visualMesh, new THREE.Mesh(new THREE.SphereGeometry(0.35)));
    group.visible = false;
    Object3DRef[weapon] = group;

    const body = mockPhysicsBody();
    PhysicsBody[weapon] = body;
    return { world, player, weapon, group, body };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.5, 0);
  camera.lookAt(0, 1.5, -6);
  camera.updateMatrixWorld(true);

  {
    // A living target with a real Health component directly in the throw's
    // path, matched the same way rangedCombat's flying bolts find one --
    // owningEid walks up from the hit object looking for userData.eid.
    const { world, player, weapon, group, body } = spawnPlayerWithThrownJavelin();
    const targetEid = addEntity(world);
    addComponent(world, targetEid, Health);
    Health.current[targetEid] = Health.max[targetEid] = 45; // the "guard" archetype's own health
    const targetMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), new THREE.MeshBasicMaterial());
    targetMesh.position.set(0, 1.5, -6);
    targetMesh.userData.eid = targetEid;
    scene.add(targetMesh);
    scene.updateMatrixWorld(true);

    assert.equal(throwing.tryStartThrowCharge(world), true);
    assert.equal(throwing.tryThrowWeapon(world, {}, camera, scene), true, 'release throws it');
    assert.equal(Combat.charging[player], 0, 'charging flag cleared on release');
    assert.ok(Combat.attackRecovery[player] > 0, 'a throw still gates the next attack, same as any other attack');
    assert.equal(Stamina.current[player], 100 - ATTACK_STAMINA_COST.swing, 'stamina spent on release, not on charge-start');
    assert.equal(hasComponent(world, weapon, Carried), false, 'the javelin leaves the player\'s hand the instant it\'s thrown');
    assert.equal(group.visible, true, 'its world mesh becomes visible again -- it\'s a real flying object now');
    assert.deepEqual(body.calls.setEnabled, [false], 'physics body stays disabled through hand-simulated flight, same as while carried');
    assert.equal(throwing.getThrowingCombatDebugState().flying, 1, 'tracked as one flying projectile');

    // Half of the old (pre-feedback) speed of 24 m/s -- 6m away takes exactly
    // 0.5s to reach at 12 m/s.
    assert.equal(javelin.throwable.projectileSpeed, 12, 'flies at half its original speed');

    let hit = false;
    for (let i = 0; i < 90 && !hit; i++) {
      throwing.throwingCombatSystem(world, {}, scene, 1 / 30);
      if (throwing.getThrowingCombatDebugState().flying === 0) hit = true;
    }
    assert.ok(hit, 'the thrown javelin actually resolves within a few seconds of flight');
    assert.ok(Health.current[targetEid] <= 0, 'one thrown hit drops a full-health "guard" (45 HP) -- ranged damage bypasses blocking entirely');
    assert.equal(hasComponent(world, weapon, Embedded), true, 'a solid, dead-on hit sticks the javelin into what it struck, like a fired bolt');
    scene.remove(targetMesh);
  }
  console.log('javelin throw: charge, release, hand-simulated flight, a block-bypassing lethal hit, and embedding in the target passed');

  {
    // A dynamic prop (a barrel, a dropped item) sitting in the throw's path --
    // no Health component, just DynamicBody + a real-looking PhysicsBody --
    // should get a real impulse imparted to *its own* body rather than the
    // javelin embedding in it.
    const { world, weapon, group, body } = spawnPlayerWithThrownJavelin();
    const propEid = addEntity(world);
    addComponent(world, propEid, DynamicBody);
    addComponent(world, propEid, PhysicsBody);
    const propBody = mockPhysicsBody();
    PhysicsBody[propEid] = propBody;
    const propMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial());
    propMesh.position.set(0, 1.5, -4);
    propMesh.userData.eid = propEid;
    scene.add(propMesh);
    scene.updateMatrixWorld(true);

    assert.equal(throwing.tryStartThrowCharge(world), true);
    assert.equal(throwing.tryThrowWeapon(world, {}, camera, scene), true);

    let hit = false;
    for (let i = 0; i < 90 && !hit; i++) {
      throwing.throwingCombatSystem(world, {}, scene, 1 / 30);
      if (throwing.getThrowingCombatDebugState().flying === 0) hit = true;
    }
    assert.ok(hit, 'resolves against the prop within a few seconds of flight');
    assert.equal(propBody.calls.applyImpulseAtPoint.length, 1, 'a real impulse is imparted to the struck prop\'s own physics body -- this is the actual "knock it over"');
    const { impulse } = propBody.calls.applyImpulseAtPoint[0];
    assert.ok(impulse.z < 0, 'the impulse pushes the prop further away from the thrower, in the javelin\'s own direction of travel (toward -Z)');
    assert.equal(hasComponent(world, weapon, Embedded), false, 'a struck prop never gets the javelin stuck in it -- it clatters nearby instead');
    scene.remove(propMesh);
  }
  console.log('javelin throw: hitting a dynamic prop imparts a real impulse to it instead of embedding passed');

  console.log('\n=== Javelin: dual-wield weight gate and throw mechanics passed ===\n');
} finally {
  await server.close();
}
