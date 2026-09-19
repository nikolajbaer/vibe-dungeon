import assert from 'node:assert/strict';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {createHumanoidBase}=await server.ssrLoadModule('/src/characters/humanoidBase.ts');
  for(const [hair,color] of [['short',0xe0bd72],['short',0x171514],['long',0x654321]]){
    const rig=createHumanoidBase({hair,hairColor:color,tunic:0x345678});
    const cap=rig.mesh.getObjectByName('hair');assert(cap,`${hair} hair exists`);
    assert.equal(cap.material.color.getHex(),color);
    assert.equal(!!rig.mesh.getObjectByName('longHair'),hair==='long');
  }
  const guard=createHumanoidBase({chainmail:true,nasalHelmet:true});
  for(const name of ['chainmail','nasalHelmet','noseGuard'])assert(guard.mesh.getObjectByName(name),`${name} exists`);
  console.log('short/long blond, black and brown hair plus chainmail nasal helmet passed');
} finally {await server.close();}
