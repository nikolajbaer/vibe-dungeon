import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

// Regression check for a real entity leak: `corpseCleanupSystem` used to
// only ever call `Object3DRef[eid].removeFromParent()` on the corpse's own
// mesh, never touching any arrow/bolt/javelin still `Embedded` (stuck) in
// it. Those items' own `Object3D` rides along with the corpse's subtree
// when it's unhooked from the scene -- so it does visibly disappear -- but
// nothing ever called `removeEntity` on the *bitECS* entity itself, which
// would otherwise sit in `world` forever, still matching every
// `[Item, ...]`/`[Embedded, ...]` query from then on.

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { addComponent, addEntity, createWorld, entityExists } = await import('bitecs');
  const { Dead, DeathSector, Embedded, Item, Object3DRef } = await server.ssrLoadModule('/src/ecs/components.ts');
  const { corpseCleanupSystem, MIN_LINGER_SECONDS } = await server.ssrLoadModule('/src/ecs/systems/corpseCleanup.ts');

  const world = createWorld();

  function spawnCorpse(sectorId) {
    const eid = addEntity(world);
    addComponent(world, eid, Dead);
    addComponent(world, eid, DeathSector);
    DeathSector.sectorId[eid] = sectorId;
    DeathSector.lingerRemaining[eid] = 0; // already past its minimum on-screen time
    const mesh = new THREE.Object3D();
    mesh.userData.eid = eid; // same tagging convention npcAnimation.ts's real rig uses
    const chest = new THREE.Object3D();
    chest.name = 'chest';
    mesh.add(chest);
    Object3DRef[eid] = mesh;
    return { eid, mesh, chest };
  }

  function spawnEmbeddedItem(parent) {
    const eid = addEntity(world);
    addComponent(world, eid, Item);
    addComponent(world, eid, Embedded);
    Item.itemTypeId[eid] = 'bolt';
    const mesh = new THREE.Object3D();
    parent.add(mesh); // real reparent, same shape as `stickTarget(...).attach(group)`
    Object3DRef[eid] = mesh;
    return eid;
  }

  const corpseA = spawnCorpse('sector-a');
  const arrowInA1 = spawnEmbeddedItem(corpseA.chest);
  const arrowInA2 = spawnEmbeddedItem(corpseA.mesh); // stuck directly on the root, not a bone (a non-humanoid case)

  const corpseB = spawnCorpse('sector-b');
  const arrowInB = spawnEmbeddedItem(corpseB.chest);

  // An embedded item that isn't attached to *any* corpse at all (e.g. one
  // stuck in a wall/prop -- makeRecoverableBolt's other embed case) must
  // never be swept up just for carrying `Embedded`.
  const looseWallEid = addEntity(world);
  addComponent(world, looseWallEid, Item);
  addComponent(world, looseWallEid, Embedded);
  Item.itemTypeId[looseWallEid] = 'bolt';
  const wallMesh = new THREE.Object3D(); // no corpse (or anything userData.eid-tagged) as an ancestor
  Object3DRef[looseWallEid] = wallMesh;

  // Only corpseA has left its death sector -- the player is standing in
  // corpseB's own sector, so it must not be touched yet.
  corpseCleanupSystem(world, 'sector-b', MIN_LINGER_SECONDS + 0.1);

  assert.equal(DeathSector.sectorId[corpseA.eid], undefined, 'corpseA is marked cleaned up');
  assert.equal(corpseA.mesh.parent, null, "corpseA's own mesh is unhooked from the scene");
  assert.equal(entityExists(world, corpseA.eid), true, "the corpse's own entity is kept around (unchanged design), just its mesh removed");
  assert.equal(entityExists(world, arrowInA1), false, 'an arrow embedded in a bone of the cleaned-up corpse is actually removed, not just visually gone');
  assert.equal(entityExists(world, arrowInA2), false, 'same for one embedded directly on the corpse root (no bone)');

  assert.equal(DeathSector.sectorId[corpseB.eid], 'sector-b', "corpseB hasn't been cleaned up -- the player is still in its sector");
  assert.equal(entityExists(world, arrowInB), true, "corpseB's own still-standing arrow is untouched");
  assert.equal(entityExists(world, looseWallEid), true, 'an embedded item stuck in a wall/prop (no corpse ancestor) is never swept up by this system');

  console.log('corpse cleanup: an embedded arrow/bolt/javelin is actually removed (not just visually orphaned) once its host corpse is cleaned up, and only its own corpse\'s items passed');
} finally {
  await server.close();
}
