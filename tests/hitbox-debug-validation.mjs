import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {addComponent,addEntity,createWorld}=await import('bitecs');
  const {Carried,Combat,Health,Item,Object3DRef,PlayerControlled,Stackable,Viewmodel}=await server.ssrLoadModule('/src/ecs/components.ts');
  const {applyMeleeDamage}=await server.ssrLoadModule('/src/ecs/systems/combat.ts');
  const hitboxDebug=await server.ssrLoadModule('/src/ecs/systems/hitboxDebug.ts');

  const world=createWorld();
  const scene=new THREE.Scene();

  // A non-player combatant (a stand-in NPC): a plain mesh, no weapon equipped.
  const npc=addEntity(world);
  addComponent(world,npc,Health);addComponent(world,npc,Object3DRef);
  Health.current[npc]=Health.max[npc]=100;
  const npcMesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,1));
  npcMesh.position.set(5,0,5);scene.add(npcMesh);
  Object3DRef[npc]=npcMesh;

  // The player: Object3DRef is the camera (see game.ts), never boxed itself.
  const player=addEntity(world),sword=addEntity(world),crossbow=addEntity(world),bolt=addEntity(world);
  addComponent(world,player,PlayerControlled);addComponent(world,player,Health);addComponent(world,player,Object3DRef);addComponent(world,player,Combat);
  Health.current[player]=Health.max[player]=100;
  const camera=new THREE.PerspectiveCamera();
  Object3DRef[player]=camera;
  Combat.attackRecovery[player]=0;Combat.parryStartup[player]=0;Combat.parryWindow[player]=0;Combat.parryRecovery[player]=0;Combat.parryMitigation[player]=0;Combat.agility[player]=0;

  assert.equal(hitboxDebug.isHitboxDebugEnabled(),false,'starts disabled');
  hitboxDebug.setHitboxDebugEnabled(true);
  assert.equal(hitboxDebug.isHitboxDebugEnabled(),true);

  hitboxDebug.hitboxDebugSystem(world,scene,0.016);
  const boxHelpers=()=>scene.children.filter(c=>c.type==='BoxHelper');
  assert.equal(boxHelpers().length,1,'only the NPC gets a character box -- the player has no visible body to wrap');

  // Equip a melee weapon (sword) on the player, with a Viewmodel mesh (as
  // equipItem would set up) -- a weapon box should appear.
  addComponent(world,sword,Item);addComponent(world,sword,Carried);
  Item.itemTypeId[sword]='sword';Carried.ownerEid[sword]=player;Carried.slot[sword]='hand-right';
  const swordMesh=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,1));
  camera.add(swordMesh);
  Viewmodel[sword]=swordMesh;
  hitboxDebug.hitboxDebugSystem(world,scene,0.016);
  assert.equal(boxHelpers().length,2,'the player\'s equipped melee weapon now gets a box too');

  // Swap to a ranged weapon (crossbow + bolts): no meleeDamage, so no weapon
  // box -- this is the explicit "not for ranged weapons" requirement.
  addComponent(world,player,Carried); // no-op if already present via sword; harmless
  Carried.slot[sword]='inventory'; // unequip the sword
  addComponent(world,crossbow,Item);addComponent(world,crossbow,Carried);
  Item.itemTypeId[crossbow]='crossbow';Carried.ownerEid[crossbow]=player;Carried.slot[crossbow]='hand-right';
  addComponent(world,bolt,Item);addComponent(world,bolt,Carried);addComponent(world,bolt,Stackable);
  Item.itemTypeId[bolt]='bolt';Carried.ownerEid[bolt]=player;Carried.slot[bolt]='inventory';Stackable.count[bolt]=5;
  const crossbowMesh=new THREE.Group();
  camera.add(crossbowMesh);
  Viewmodel[crossbow]=crossbowMesh;
  hitboxDebug.hitboxDebugSystem(world,scene,0.016);
  assert.equal(boxHelpers().length,1,'a ranged weapon (crossbow) never gets a hitbox -- only the NPC\'s box remains');

  // Re-equip the sword and confirm a scored hit flashes both the struck
  // character's box and the attacker's weapon box red, fading back to white.
  Carried.slot[sword]='hand-right';Carried.slot[crossbow]='inventory';
  hitboxDebug.hitboxDebugSystem(world,scene,0.016);
  assert.equal(boxHelpers().length,2,'sword re-equipped, its box is back');

  const damage=applyMeleeDamage(world,npc,10,player); // mitigation is 0 (no parry state on npc)
  assert.ok(damage>0,'the hit actually dealt damage');
  hitboxDebug.hitboxDebugSystem(world,scene,0.01); // small dt -- well within the flash window
  const charHelper=scene.children.find(c=>c.type==='BoxHelper'&&c.object===npcMesh);
  const weaponHelper=scene.children.find(c=>c.type==='BoxHelper'&&c.object===swordMesh);
  assert.equal(charHelper.material.color.getHex(),0xff0000,'the struck NPC\'s hitbox flashes red on a scored hit');
  assert.equal(weaponHelper.material.color.getHex(),0xff0000,'the attacker\'s weapon hitbox flashes red too');

  hitboxDebug.hitboxDebugSystem(world,scene,10); // far past the flash duration
  assert.equal(charHelper.material.color.getHex(),0xffffff,'the flash fades back to white');
  assert.equal(weaponHelper.material.color.getHex(),0xffffff,'the weapon flash fades back to white too');

  // A parried hit (mitigation > 0) must not flash -- mirrors the same gate
  // that decides whether to play the hit-reaction animation.
  addComponent(world,npc,Combat);
  Combat.attackRecovery[npc]=0;Combat.parryStartup[npc]=0;Combat.parryWindow[npc]=1;Combat.parryRecovery[npc]=0;Combat.parryMitigation[npc]=0.5;Combat.agility[npc]=0;
  applyMeleeDamage(world,npc,10,player);
  hitboxDebug.hitboxDebugSystem(world,scene,0.01);
  assert.equal(charHelper.material.color.getHex(),0xffffff,'a parried hit does not flash the defender\'s hitbox');
  assert.equal(weaponHelper.material.color.getHex(),0xffffff,'a parried hit does not flash the attacker\'s weapon either');

  hitboxDebug.setHitboxDebugEnabled(false);
  assert.equal(boxHelpers().length,0,'disabling the toggle removes every hitbox helper from the scene');

  console.log('hitbox debug toggle, melee-only weapon boxes, and scored-hit flash/fade passed');
} finally {await server.close();}
