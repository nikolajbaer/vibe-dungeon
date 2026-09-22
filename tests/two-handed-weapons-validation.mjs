import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createWorld, addEntity, addComponent } from 'bitecs';

// Two-handed weapons (ItemAssetDef.twoHanded, currently just the crossbow):
// equipping one clears whatever's in the *other* hand first, equipping
// anything else while one is already out clears it first, and neither hand
// ever reads as "open" while it's equipped -- so a crossbow and a dagger can
// never be held at once, but a future one-handed off-hand item (a sling, a
// dagger) still can be, alongside another one-handed weapon.

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {Carried,Item,PlayerControlled}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {equipItem,equipToOpenHandSlot,findOpenHandSlot,unequipItem}=await server.ssrLoadModule('/src/ecs/systems/items.ts');
  const {default:crossbow}=await server.ssrLoadModule('/src/assets/items/crossbow.ts');
  const {default:dagger}=await server.ssrLoadModule('/src/assets/items/dagger.ts');

  assert.equal(crossbow.twoHanded,true,'the crossbow is flagged two-handed');
  assert.ok(!dagger.twoHanded,'an ordinary one-handed weapon is not');

  // A camera-like stub: equipItem only ever calls camera.add on a viewmodel
  // mesh's Object3D, whose own children/parenting this test doesn't care
  // about at all.
  const fakeCamera = { add() {} };

  function spawnCarriedItem(world, ownerEid, itemTypeId) {
    const eid = addEntity(world);
    addComponent(world, eid, Item);
    addComponent(world, eid, Carried);
    Item.itemTypeId[eid] = itemTypeId;
    Carried.ownerEid[eid] = ownerEid;
    Carried.slot[eid] = 'inventory';
    return eid;
  }

  // findOpenHandSlot: a two-handed weapon in one hand blocks the other too.
  {
    const world = createWorld();
    const player = addEntity(world);
    const bow = spawnCarriedItem(world, player, 'crossbow');
    Carried.slot[bow] = 'hand-right';
    assert.equal(findOpenHandSlot(world, player), undefined, 'no hand reads open while a two-handed weapon occupies either one');
  }

  // Equipping a two-handed weapon unequips whatever was in the other hand.
  {
    const world = createWorld();
    const player = addEntity(world);
    addComponent(world, player, PlayerControlled);
    const dag = spawnCarriedItem(world, player, 'dagger');
    equipItem(world, fakeCamera, dag, 'hand-right');
    assert.equal(Carried.slot[dag], 'hand-right', 'dagger equipped first');

    const bow = spawnCarriedItem(world, player, 'crossbow');
    const equipped = equipToOpenHandSlot(world, fakeCamera, bow);
    assert.equal(equipped, true, 'the crossbow finds a hand to go in (the dagger is displaced, not blocking)');
    assert.equal(Carried.slot[bow], 'hand-left', 'crossbow takes the open hand');
    assert.equal(Carried.slot[dag], 'inventory', 'equipping the crossbow bumped the dagger back to inventory');
  }

  // The reverse: equipping a one-handed item while a two-handed weapon is
  // out unequips the two-handed weapon first, freeing both hands for it.
  {
    const world = createWorld();
    const player = addEntity(world);
    addComponent(world, player, PlayerControlled);
    const bow = spawnCarriedItem(world, player, 'crossbow');
    equipItem(world, fakeCamera, bow, 'hand-left');
    assert.equal(Carried.slot[bow], 'hand-left');

    const dag = spawnCarriedItem(world, player, 'dagger');
    // equipToOpenHandSlot must refuse outright -- findOpenHandSlot correctly
    // reports neither hand as open while the crossbow is equipped.
    assert.equal(equipToOpenHandSlot(world, fakeCamera, dag), false, 'no open hand while the crossbow is equipped');
    assert.equal(Carried.slot[dag], 'inventory', 'the dagger never got equipped');

    // An explicit equipItem call (the paper-doll's equipToSlot path, which
    // bypasses findOpenHandSlot entirely) still has to resolve the conflict
    // itself rather than silently double-occupying a slot.
    equipItem(world, fakeCamera, dag, 'hand-right');
    assert.equal(Carried.slot[dag], 'hand-right', 'the dagger is equipped via the explicit-slot path');
    assert.equal(Carried.slot[bow], 'inventory', 'equipping into either hand bumped the two-handed crossbow out');
  }

  // Two ordinary one-handed items still coexist fine (dual-wield stays
  // possible for anything that isn't flagged two-handed).
  {
    const world = createWorld();
    const player = addEntity(world);
    addComponent(world, player, PlayerControlled);
    const dag1 = spawnCarriedItem(world, player, 'dagger');
    const dag2 = spawnCarriedItem(world, player, 'dagger');
    assert.equal(equipToOpenHandSlot(world, fakeCamera, dag1), true);
    assert.equal(equipToOpenHandSlot(world, fakeCamera, dag2), true);
    assert.notEqual(Carried.slot[dag1], 'inventory');
    assert.notEqual(Carried.slot[dag2], 'inventory');
    assert.notEqual(Carried.slot[dag1], Carried.slot[dag2], 'two one-handed items take one hand each, not the same one');
  }

  console.log('two-handed weapons (crossbow) block the off-hand, displace or get displaced by whatever was equipped passed');
} finally {await server.close();}
