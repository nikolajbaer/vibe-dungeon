import assert from 'node:assert/strict';
import {createServer} from 'vite';

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
  console.log('Arched door silhouette and continuous wall-run merging passed');
} finally {await server.close();}
