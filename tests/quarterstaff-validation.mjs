import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The quarterstaff (first two-handed *melee* weapon, the crossbow being
// two-handed but ranged-only): less damage than the sword, traded for more
// reach, a uniformly slower recovery, and a higher stamina cost via
// ItemAssetDef.attackMultipliers -- the same jab/swing recovery/stamina
// values under both, unlike the greatsword's deliberately different ones
// (greatsword-validation.mjs). Real hit detection (does a longer reach
// actually land where a sword's wouldn't) is covered generically by
// melee-collision-validation.mjs, alongside the greatsword's own equivalent
// reach test; this file covers the weapon-specific data actually flowing
// through combat.ts's shared attack path, plus the asset's own stat
// declarations and mesh sanity.

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { addComponent, addEntity, createWorld } = await import('bitecs');
  const { Combat, Carried, Health, Item, PlayerControlled, Stamina } = await server.ssrLoadModule('/src/ecs/components.ts');
  const {
    ATTACK_PROFILES, ATTACK_STAMINA_COST, BLOCK_MITIGATION,
    applyMeleeDamage, releaseSwingCharge, setBlocking, tryMeleeAttack, tryStartSwingCharge,
  } = await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const { default: quarterstaff } = await server.ssrLoadModule('/src/assets/items/quarterstaff.ts');
  const { default: sword } = await server.ssrLoadModule('/src/assets/items/sword.ts');
  const { createQuarterstaffMesh } = await server.ssrLoadModule('/src/assets/items/quarterstaff.ts');

  // Asset stats: less damage, more reach than the sword, two-handed, and a
  // real (if worse than the sword's) block mitigation class -- not
  // "unarmed"-tier just because it also declares reach/recovery/stamina
  // knobs the sword doesn't need.
  assert.ok(quarterstaff.meleeDamage < sword.meleeDamage, 'less damage than the sword');
  assert.ok(quarterstaff.meleeReach > sword.meleeReach, 'more reach than the sword');
  assert.equal(quarterstaff.twoHanded, true, 'occupies both hands, like the crossbow');
  for (const attackType of ['jab', 'swing']) {
    assert.ok(quarterstaff.attackMultipliers[attackType].recovery > 1, `${attackType}: slower recovery than the sword's implicit 1x`);
    assert.ok(quarterstaff.attackMultipliers[attackType].stamina > 1, `${attackType}: costs more stamina than the sword's implicit 1x`);
  }
  assert.ok(!sword.attackMultipliers, 'the sword itself is unaffected -- still an implicit 1x');

  // Mesh sanity: a real, renderable merged geometry with the three material
  // groups (wood shaft, metal caps, grip wrap) createQuarterstaffMesh builds.
  {
    const mesh = createQuarterstaffMesh();
    assert.ok(mesh.geometry.attributes.position.count > 0, 'quarterstaff mesh has real geometry');
    assert.equal(mesh.material.length, 3, 'wood/metal/grip material groups');
    assert.equal(mesh.geometry.groups.length, 3, 'geometry has a group per material');
  }

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

  // Recovery and stamina cost both scale by the quarterstaff's own
  // multipliers, for both attack types -- a sword-wielder (or unarmed)
  // pays exactly the shared table's base numbers.
  for (const attackType of ['jab', 'swing']) {
    const base = ATTACK_PROFILES[attackType];
    const baseCost = ATTACK_STAMINA_COST[attackType];

    const { world: swordWorld, player: swordPlayer } = spawnPlayerWith('sword');
    assert.equal(tryMeleeAttack(swordWorld, attackType), true);
    assert.equal(Combat.attackRecovery[swordPlayer], base.recovery, `${attackType}: sword recovery is the unmultiplied base`);
    assert.equal(Stamina.current[swordPlayer], 1000 - baseCost, `${attackType}: sword stamina cost is the unmultiplied base`);

    const { world: staffWorld, player: staffPlayer } = spawnPlayerWith('quarterstaff');
    assert.equal(tryMeleeAttack(staffWorld, attackType), true);
    assert.equal(Combat.attackRecovery[staffPlayer], base.recovery * quarterstaff.attackMultipliers[attackType].recovery, `${attackType}: quarterstaff recovery is multiplied`);
    assert.equal(Stamina.current[staffPlayer], 1000 - baseCost * quarterstaff.attackMultipliers[attackType].stamina, `${attackType}: quarterstaff stamina cost is multiplied`);
  }

  // The held-charge path (tryStartSwingCharge/releaseSwingCharge) gates and
  // spends stamina the same multiplied way as a plain tryMeleeAttack('swing').
  {
    const { world, player } = spawnPlayerWith('quarterstaff');
    assert.equal(tryStartSwingCharge(world), true);
    assert.equal(Stamina.current[player], 1000, 'charging itself never spends stamina -- only release does');
    assert.equal(releaseSwingCharge(world), true);
    assert.equal(Stamina.current[player], 1000 - ATTACK_STAMINA_COST.swing * quarterstaff.attackMultipliers.swing.stamina, 'release spends the multiplied swing cost');
    assert.equal(Combat.attackRecovery[player], ATTACK_PROFILES.swing.recovery * quarterstaff.attackMultipliers.swing.recovery, 'release sets the multiplied swing recovery');
  }

  // A too-small stamina pool for the quarterstaff's multiplied cost is
  // refused outright -- even when it would have been enough for the
  // sword's unmultiplied one, proving the gate itself (not just the spend)
  // accounts for the multiplier.
  {
    const { world, player } = spawnPlayerWith('quarterstaff');
    Stamina.current[player] = ATTACK_STAMINA_COST.jab; // exactly the sword's cost, not the quarterstaff's higher one
    assert.equal(tryMeleeAttack(world, 'jab'), false, 'refused -- not enough for the quarterstaff\'s multiplied jab cost');
    assert.equal(Stamina.current[player], ATTACK_STAMINA_COST.jab, 'a refused attack never deducts stamina');
  }

  // Block mitigation: a "twoHanded" class of its own, below the sword's
  // oneHanded but above dagger/unarmed.
  {
    const { world, player } = spawnPlayerWith('quarterstaff');
    setBlocking(world, player, true);
    assert.equal(applyMeleeDamage(world, player, 10), Math.round(10 * (1 - BLOCK_MITIGATION.twoHanded)), 'quarterstaff block uses the twoHanded mitigation rate');
    assert.ok(BLOCK_MITIGATION.twoHanded < BLOCK_MITIGATION.oneHanded, 'weaker guard than the sword');
    assert.ok(BLOCK_MITIGATION.twoHanded > BLOCK_MITIGATION.dagger, 'still a real two-handed weapon\'s guard, not a dagger\'s');
  }

  console.log('quarterstaff stats (less damage/more reach), recovery/stamina multipliers, twoHanded block class, and mesh geometry passed');
} finally {
  await server.close();
}
