import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Dual-wielding's own independent left/right attack (issue: "when dual
// wielding... a second attack button... left/right weapons independently").
// Before this, a dual-wielding player's off-hand weapon was purely
// decorative for combat: `getEquippedWeapon` always picked whichever of the
// two hands hit harder, so the weaker weapon never actually got swung.
// Covers combat.ts's hand-aware `tryMeleeAttack`/`tryStartSwingCharge`/
// `releaseSwingCharge`/`cancelSwingCharge`, `getEquippedWeaponInHand`,
// `isDualWielding`, and `mainHand` -- plus the exploit `mainHand`/
// `handCombatFields` close: a single weapon (however it landed in whichever
// literal hand slot) must never be attackable through both "hands" at once
// off two independent recovery timers. No physics/Rapier needed -- like
// quarterstaff-validation.mjs, this only exercises the ECS bookkeeping
// (recovery/charging/stamina), never real hit detection.

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { addComponent, addEntity, createWorld } = await import('bitecs');
  const { Carried, Combat, Item, PlayerControlled, Stamina } = await server.ssrLoadModule('/src/ecs/components.ts');
  const {
    ATTACK_STAMINA_COST, getEquippedWeaponInHand, isDualWielding, mainHand,
    setBlocking, tryMeleeAttack, tryStartSwingCharge, releaseSwingCharge, cancelSwingCharge,
  } = await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const { isEquippedWeaponThrowable } = await server.ssrLoadModule('/src/ecs/systems/throwingCombat.ts');

  function spawnPlayer() {
    const world = createWorld();
    const player = addEntity(world);
    addComponent(world, player, PlayerControlled);
    addComponent(world, player, Combat);
    addComponent(world, player, Stamina);
    Combat.attackRecovery[player] = 0; Combat.attackRecoveryOffhand[player] = 0;
    Combat.charging[player] = 0; Combat.chargingOffhand[player] = 0;
    Combat.blocking[player] = 0; Combat.agility[player] = 0;
    Stamina.max[player] = Stamina.current[player] = 1000;
    return { world, player };
  }

  function equip(world, owner, itemTypeId, slot) {
    const eid = addEntity(world);
    addComponent(world, eid, Item); addComponent(world, eid, Carried);
    Item.itemTypeId[eid] = itemTypeId; Carried.ownerEid[eid] = owner; Carried.slot[eid] = slot;
    return eid;
  }

  // --- Genuine dual-wielding: dagger left, sword right --------------------
  {
    const { world, player } = spawnPlayer();
    equip(world, player, 'dagger', 'hand-left');
    equip(world, player, 'sword', 'hand-right');

    assert.equal(isDualWielding(world, player), true, 'both hands hold a real weapon');
    assert.equal(mainHand(world, player), 'hand-left', 'main input resolves to hand-left when dual-wielding');

    assert.equal(tryMeleeAttack(world, 'jab'), true, 'main-hand jab (dagger) succeeds');
    assert.ok(Combat.attackRecovery[player] > 0, 'main-hand recovery started');
    assert.equal(Combat.attackRecoveryOffhand[player], 0, 'off-hand recovery untouched by the main-hand attack');
    assert.equal(tryMeleeAttack(world, 'jab'), false, 'main hand refuses again mid-recovery');

    // The whole point: the off hand (sword) can still swing while the main
    // hand (dagger) is on cooldown -- two genuinely independent attacks.
    assert.equal(tryMeleeAttack(world, 'jab', 'hand-right'), true, 'off-hand jab (sword) succeeds while the main hand recovers');
    assert.ok(Combat.attackRecoveryOffhand[player] > 0, 'off-hand recovery started');
    assert.equal(tryMeleeAttack(world, 'jab', 'hand-right'), false, 'off hand refuses again mid-recovery');

    // Both draw from the one shared stamina pool.
    assert.equal(Stamina.current[player], 1000 - 2 * ATTACK_STAMINA_COST.jab, 'both attacks spent from the same shared stamina pool');
  }

  // --- Held charge/release/cancel, independently per hand ------------------
  {
    const { world, player } = spawnPlayer();
    equip(world, player, 'dagger', 'hand-left');
    equip(world, player, 'sword', 'hand-right');

    assert.equal(tryStartSwingCharge(world, 'hand-right'), true, 'off-hand charge starts');
    assert.ok(Combat.chargingOffhand[player] > 0, 'off-hand charging flag set');
    assert.equal(Combat.charging[player], 0, 'main-hand charging flag untouched');
    // Charging with your off hand doesn't stop the main hand jabbing away.
    assert.equal(tryMeleeAttack(world, 'jab'), true, 'main hand can still jab while the off hand charges');

    assert.equal(releaseSwingCharge(world, 'hand-right'), true, 'off-hand charge releases into a swing');
    assert.equal(Combat.chargingOffhand[player], 0, 'off-hand charging flag cleared by release');
    assert.ok(Combat.attackRecoveryOffhand[player] > 0, 'off-hand recovery started by the released swing');

    // Cancelling refunds nothing (nothing was ever spent) and just drops it.
    // (Recovery only ticks down via combatSystem's own per-frame dt, never
    // called here -- cleared by hand, same as quarterstaff-validation.mjs's
    // own between-checks resets, to charge again without waiting it out.)
    Combat.attackRecoveryOffhand[player] = 0;
    const staminaBeforeCancel = Stamina.current[player];
    assert.equal(tryStartSwingCharge(world, 'hand-right'), true, 'off-hand can charge again once recovered enough to try');
    cancelSwingCharge(world, 'hand-right');
    assert.equal(Combat.chargingOffhand[player], 0, 'cancel clears the off-hand charging flag');
    assert.equal(Stamina.current[player], staminaBeforeCancel, 'cancelling spends no stamina');

    // Winding up a swing with either hand raises a whole-body guard gate --
    // can't block with both hands committed to an attack.
    assert.equal(tryStartSwingCharge(world, 'hand-right'), true, 'off-hand charges again');
    setBlocking(world, player, true);
    assert.equal(Combat.blocking[player], 0, 'blocking refused while the off hand is mid-charge');
    cancelSwingCharge(world, 'hand-right');
  }

  // --- The exploit this design has to close: a single weapon (whichever
  //     literal hand it happens to occupy) is only ever attackable through
  //     ONE shared recovery timer, never two independent ones. ------------
  for (const [label, slot] of [['hand-right (uncommon)', 'hand-right'], ['hand-left (the common single-weapon slot -- findOpenHandSlot fills it first)', 'hand-left']]) {
    const { world, player } = spawnPlayer();
    equip(world, player, 'sword', slot);

    assert.equal(isDualWielding(world, player), false, `${label}: a lone weapon is never "dual-wielding"`);
    assert.equal(mainHand(world, player), slot, `${label}: main input resolves to wherever the lone weapon actually is`);
    assert.equal(getEquippedWeaponInHand(world, player, slot)?.itemEid !== undefined, true, `${label}: the weapon is really there`);

    assert.equal(tryMeleeAttack(world, 'jab'), true, `${label}: the default (main-hand) attack swings the lone weapon`);
    assert.ok(Combat.attackRecovery[player] > 0, `${label}: recovery lands on the shared/primary field regardless of which literal hand this is`);
    assert.equal(Combat.attackRecoveryOffhand[player], 0, `${label}: the offhand field is never touched by a lone weapon`);

    // Explicitly targeting the *literal* slot the weapon is sitting in --
    // exactly what game.ts's off-hand button (always literal `hand-right`)
    // would resolve to if it weren't gated on `isDualWielding` -- must find
    // the SAME shared recovery already ticking, not a second, independent
    // one letting the same weapon swing twice as fast.
    assert.equal(tryMeleeAttack(world, 'jab', slot), false, `${label}: explicitly targeting the lone weapon's own hand still hits the shared cooldown`);
  }

  // --- A two-handed weapon only ever occupies its own literal slot; the
  //     other hand is simply empty, never a second attack on the same item.
  {
    const { world, player } = spawnPlayer();
    equip(world, player, 'quarterstaff', 'hand-left'); // findOpenHandSlot fills left first
    assert.equal(isDualWielding(world, player), false, 'a two-handed weapon is never "dual-wielding" with itself');
    assert.equal(mainHand(world, player), 'hand-left', 'main input finds the two-handed weapon wherever it actually landed');
    assert.equal(getEquippedWeaponInHand(world, player, 'hand-right'), undefined, 'the other hand has nothing -- the item never occupies both slots at once');
    assert.equal(tryMeleeAttack(world, 'jab'), true, 'the two-handed weapon still swings through the default (main-hand) attack');
    assert.ok(Combat.attackRecovery[player] > 0, 'its recovery lands on the shared/primary field');
  }

  // --- Throwables resolve per hand too (a dual-wielded javelin) -----------
  {
    const { world, player } = spawnPlayer();
    equip(world, player, 'javelin', 'hand-left');
    equip(world, player, 'dagger', 'hand-right');
    assert.equal(isDualWielding(world, player), true, 'javelin+dagger is a real dual-wield combo');
    assert.equal(isEquippedWeaponThrowable(world, player), true, 'the main hand (javelin) is throwable');
    assert.equal(isEquippedWeaponThrowable(world, player, 'hand-right'), false, 'the off hand (dagger) is not');
  }

  console.log('dual-wield independent left/right attacks: hand-aware recovery/charging, shared stamina, and the single-weapon exploit close passed');
} finally {
  await server.close();
}
