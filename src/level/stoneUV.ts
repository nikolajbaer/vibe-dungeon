import * as THREE from "three";
import { UNIT } from "./tiles";

/** Project masonry onto world axes at one texture tile per 3m cell. The
 * material's repeat controls how many stones fit in that cell; a 3m wall and
 * an 18m wall therefore use the same block size and align at their join. */
export function applyWorldStoneUV(mesh: THREE.Mesh): void {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  if (!position || !normal || !uv) return;
  const point = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    direction.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
    if (Math.abs(direction.y) > .7) uv.setXY(i, point.x / UNIT, point.z / UNIT);
    else if (Math.abs(direction.x) > Math.abs(direction.z)) uv.setXY(i, point.z / UNIT, point.y / UNIT);
    else uv.setXY(i, point.x / UNIT, point.y / UNIT);
  }
  uv.needsUpdate = true;
}
