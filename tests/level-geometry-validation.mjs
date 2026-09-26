import assert from 'node:assert/strict';
import {createServer} from 'vite';
import * as THREE from 'three';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {createArchedDoorLeafGeometry,mergeCollinearWallSegments}=await server.ssrLoadModule('/src/level/tileBuilder.ts');
  const topAt=(geometry,x)=>{
    const p=geometry.attributes.position;
    const ys=[];
    for(let i=0;i<p.count;i++) if(Math.abs(p.getX(i)-x)<1e-4) ys.push(p.getY(i));
    return Math.max(...ys);
  };
  const left=createArchedDoorLeafGeometry(1.5,.3,1);
  const right=createArchedDoorLeafGeometry(1.5,.3,-1);
  assert(topAt(left,.75)>topAt(left,-.75)+.5,'left leaf rises from outer hinge to center apex');
  assert(topAt(right,-.75)>topAt(right,.75)+.5,'right leaf mirrors the arch into the center apex');

  const segment=(start,height=3)=>({orientation:'x',planeCell:2,rangeStartCell:start,wallHeight:height,instanceId:'room',roomSized:true,interiorSign:-1,floor:0});
  const runs=mergeCollinearWallSegments([segment(2),segment(0),segment(1),segment(4),segment(5),segment(6,6)]);
  assert.deepEqual(runs.map(r=>[r.start,r.end,r.seg.wallHeight]),[[0,3,3],[4,6,3],[6,7,6]],'adjacent equal walls merge while gaps and height changes remain boundaries');
  const {applyWorldStoneUV}=await server.ssrLoadModule('/src/level/stoneUV.ts');
  const wall=new THREE.Mesh(new THREE.BoxGeometry(18,3,.3));
  wall.position.set(9,1.5,0);
  applyWorldStoneUV(wall);
  const position=wall.geometry.attributes.position;
  const normal=wall.geometry.attributes.normal;
  const uv=wall.geometry.attributes.uv;
  const front=[];
  for(let i=0;i<position.count;i++) if(normal.getZ(i)>.9) front.push(i);
  assert.equal(Math.max(...front.map(i=>uv.getX(i)))-Math.min(...front.map(i=>uv.getX(i))),6,'18m wall repeats masonry across six 3m cells');
  const narrowLeaf=createArchedDoorLeafGeometry(1.1,.14,1);
  assert(topAt(narrowLeaf,.55)>topAt(narrowLeaf,-.55)+.5,'inset double door keeps its arched outline');
  console.log('Arched doors, continuous wall runs, and world-scale masonry passed');
} finally {await server.close();}
