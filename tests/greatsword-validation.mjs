import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The greatsword: a two-handed sword whose two attacks are meant to feel
// different from each other, not a uniform scale like the quarterstaff's
// (quarterstaff-validation.mjs) -- a stab barely different from a
// one-handed sword's own (same flat meleeDamage/meleeReach, no per-type
// damage/reach bump), just slower and more tiring to commit to two-handed,
// versus a swing that hits 1.5x harder and reaches 1.25x further, at an
// even steeper recovery/stamina cost. Real reach/damage actually landing
// through physics (does the swing's extra reach connect where a sword's
// wouldn't, does the extra damage multiplier actually land) is covered in
// melee-collision-validation.mjs, alongside the sword's own equivalent
// reach test; this file covers the asset's own stat declarations and the
// stamina/recovery bookkeeping combat.ts's shared attack path applies for
// both attack types, plus mesh sanity.

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { addComponent, addEntity, createWorld } = await import('bitecs');
  const { Combat, Carried, Health, Item, PlayerControlled, Stamina } = await server.ssrLoadModule('/src/ecs/components.ts');
  const {
    ATTACK_PROFILES, ATTACK_STAMINA_COST, BLOCK_MITIGATION,
    releaseSwingCharge, tryMeleeAttack, tryStartSwingCharge,
  } = await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const { default: greatsword } = await server.ssrLoadModule('/src/assets/items/greatsword.ts');
  const { default: sword } = await server.ssrLoadModule('/src/assets/items/sword.ts');

  // Asset stats: same flat damage/reach baseline as the sword -- the whole
  // jab-barely-different/swing-much-stronger split lives in
  // attackMultipliers, not in a bumped meleeDamage/meleeReach.
  assert.equal(greatsword.meleeDamage, sword.meleeDamage, 'same flat damage baseline as the sword');
  assert.equal(greatsword.meleeReach, sword.meleeReach, 'same flat reach baseline as the sword');
  assert.equal(greatsword.twoHanded, true, 'occupies both hands, like the crossbow and quarterstaff');

  const jab = greatsword.attackMultipliers.jab;
  assert.ok(!jab.damage && !jab.reach, 'the stab is not meaningfully more damaging or longer-reaching than a one-handed sword\'s');
  assert.ok(jab.recovery > 1 && jab.stamina > 1, 'but a two-handed stab still recovers slower and costs more stamina');

  const swing = greatsword.attackMultipliers.swing;
  assert.equal(swing.damage, 1.5, 'swing deals 1.5x damage');
  assert.equal(swing.reach, 1.25, 'swing reaches 1.25x as far');
  assert.ok(swing.recovery > jab.recovery, 'the much stronger swing recovers slower than the already-slower stab');
  assert.ok(swing.stamina > jab.stamina, 'and costs more stamina than the stab too');

  function spawnPlayerWith(itemTypeId) {
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
    Stamina.max[player] = Stamina.current[player] = 1000; // plenty for every case below
    if (itemTypeId) {
      const item = addEntity(world);
      addComponent(world, item, Item);
      addComponent(world, item, Carried);
      Item.itemTypeId[item] = itemTypeId;
      Carried.ownerEid[item] = player;
      Carried.slot[item] = 'hand-left'; // two-handed weapons land here first (findOpenHandSlot)
    }
    return { world, player };
  }

  // Recovery and stamina cost both scale by the greatsword's own
  // per-attack-type multipliers -- and, for the stab, differ from the
  // swing's own (unlike the quarterstaff's uniform ones).
  for (const attackType of ['jab', 'swing']) {
    const base = ATTACK_PROFILES[attackType];
    const baseCost = ATTACK_STAMINA_COST[attackType];
    const mult = greatsword.attackMultipliers[attackType];

    const { world: swordWorld, player: swordPlayer } = spawnPlayerWith('sword');
    assert.equal(tryMeleeAttack(swordWorld, attackType), true);
    assert.equal(Combat.attackRecovery[swordPlayer], base.recovery, `${attackType}: sword recovery is the unmultiplied base`);
    assert.equal(Stamina.current[swordPlayer], 1000 - baseCost, `${attackType}: sword stamina cost is the unmultiplied base`);

    const { world: gsWorld, player: gsPlayer } = spawnPlayerWith('greatsword');
    assert.equal(tryMeleeAttack(gsWorld, attackType), true);
    assert.equal(Combat.attackRecovery[gsPlayer], base.recovery * mult.recovery, `${attackType}: greatsword recovery is multiplied`);
    assert.equal(Stamina.current[gsPlayer], 1000 - baseCost * mult.stamina, `${attackType}: greatsword stamina cost is multiplied`);
  }

  // The held-charge path (tryStartSwingCharge/releaseSwingCharge) gates and
  // spends stamina the same multiplied way as a plain tryMeleeAttack('swing').
  {
    const { world, player } = spawnPlayerWith('greatsword');
    assert.equal(tryStartSwingCharge(world), true);
    assert.equal(Stamina.current[player], 1000, 'charging itself never spends stamina -- only release does');
    assert.equal(releaseSwingCharge(world), true);
    assert.equal(Stamina.current[player], 1000 - ATTACK_STAMINA_COST.swing * greatsword.attackMultipliers.swing.stamina, 'release spends the multiplied swing cost');
    assert.equal(Combat.attackRecovery[player], ATTACK_PROFILES.swing.recovery * greatsword.attackMultipliers.swing.recovery, 'release sets the multiplied swing recovery');
  }

  // A too-small stamina pool for the greatsword's multiplied jab cost is
  // refused outright -- even when it would have been enough for the
  // sword's unmultiplied one.
  {
    const { world, player } = spawnPlayerWith('greatsword');
    Stamina.current[player] = ATTACK_STAMINA_COST.jab; // exactly the sword's cost, not the greatsword's higher one
    assert.equal(tryMeleeAttack(world, 'jab'), false, 'refused -- not enough for the greatsword\'s multiplied jab cost');
    assert.equal(Stamina.current[player], ATTACK_STAMINA_COST.jab, 'a refused attack never deducts stamina');
  }

  // Block mitigation: shares the quarterstaff's "twoHanded" class -- no
  // block-specific ask was made for this weapon, so it gets the same
  // real-but-weaker-than-a-one-handed-sword's guard rather than a novel
  // number invented just for it.
  assert.equal(BLOCK_MITIGATION.twoHanded, 0.65);

  // Mesh sanity: a real, renderable geometry, reused/rescaled from the
  // sword's own two-material (metal, grip) shape per greatsword.ts's own
  // doc comment -- still two groups after the clone/scale, not a novel
  // material split like the quarterstaff's three.
  {
    const mesh = greatsword.createWorldMesh();
    assert.ok(mesh.geometry.attributes.position.count > 0, 'greatsword mesh has real geometry');
    assert.equal(mesh.material.length, 2, 'metal/grip material groups, inherited from the sword mesh');
    assert.equal(mesh.geometry.groups.length, 2, 'geometry has a group per material');
  }

  console.log('greatsword stats (jab parity/swing 1.5x damage & 1.25x reach), per-attack-type recovery/stamina multipliers, and shared twoHanded block class passed');
} finally {
  await server.close();
}
