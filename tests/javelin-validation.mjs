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
    Carried, Combat, Health, Item, Object3DRef, PhysicsBody, PlayerControlled, Stamina,
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

  // --- Charge / throw mechanics ------------------------------------------
  function spawnPlayerWithJavelin() {
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

    // A real world-placed javelin (spawnItems -> buildItemWorldBody) already
    // has an Object3DRef + PhysicsBody by the time it's picked up (pickUpItem
    // hides rather than destroys them) -- mimic that here with a plain mesh
    // and a minimal RigidBody-shaped mock covering only what
    // dropCarriedItem's "reuse the existing body" fast path actually calls,
    // so this test doesn't need a real Rapier world.
    const mesh = new THREE.Group();
    mesh.visible = false;
    addComponent(world, weapon, Object3DRef);
    addComponent(world, weapon, PhysicsBody);
    Object3DRef[weapon] = mesh;
    const bodyCalls = { setEnabled: [], setTranslation: [] };
    PhysicsBody[weapon] = {
      setEnabled: (v) => bodyCalls.setEnabled.push(v),
      setTranslation: (p) => bodyCalls.setTranslation.push(p),
      setLinvel: () => {},
      setAngvel: () => {},
      setRotation: () => {},
    };
    return { world, player, weapon, mesh, bodyCalls };
  }

  {
    const { world, player } = spawnPlayerWithJavelin();
    assert.equal(throwing.isEquippedWeaponThrowable(world, player), true, 'a carried javelin is recognized as throwable');
    assert.equal(throwing.tryStartThrowCharge(world), true, 'charge starts');
    assert.equal(Combat.charging[player], 1, 'Combat.charging set, same flag a melee swing charge uses');
    assert.equal(throwing.tryStartThrowCharge(world), false, 'already charging -- refuses a second charge start');
  }
  {
    const { world, player } = spawnPlayerWithJavelin();
    Stamina.current[player] = ATTACK_STAMINA_COST.swing - 1;
    assert.equal(throwing.tryStartThrowCharge(world), false, 'refuses without enough stamina for the shared swing cost');
  }
  console.log('throw charge gating (stamina, no double-charge) passed');

  {
    const { world, player, weapon, mesh, bodyCalls } = spawnPlayerWithJavelin();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.5, 0);
    camera.lookAt(0, 1.5, -1);
    camera.updateMatrixWorld(true);

    // A target with a real Health component sitting directly in the throw's
    // path, matched the same way rangedCombat's flying bolts find one --
    // owningEid walks up from the hit object looking for userData.eid.
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
    assert.equal(mesh.visible, true, 'its world mesh becomes visible again -- it\'s a real flying object now');
    assert.equal(throwing.getThrowingCombatDebugState().flying, 1, 'tracked as one flying projectile');

    // Advance flight until it reaches (and passes through) the target ~6m
    // out -- projectileSpeed 24 m/s covers that in well under a second.
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      throwing.throwingCombatSystem(world, {}, scene, 1 / 30);
      if (throwing.getThrowingCombatDebugState().flying === 0) hit = true;
    }
    assert.ok(hit, 'the thrown javelin actually resolves (hits or lands) within a second of flight');
    assert.ok(Health.current[targetEid] <= 0, 'one thrown hit drops a full-health "guard" (45 HP) -- ranged damage bypasses blocking entirely');
    assert.deepEqual(bodyCalls.setEnabled, [false, true], 'physics body disabled through flight, re-enabled once it lands (dropCarriedItem\'s reuse path)');
  }
  console.log('javelin throw: charge, release, flight, block-bypassing lethal impact, and landing as a recoverable world item passed');

  console.log('\n=== Javelin: dual-wield weight gate and throw mechanics passed ===\n');
} finally {
  await server.close();
}
