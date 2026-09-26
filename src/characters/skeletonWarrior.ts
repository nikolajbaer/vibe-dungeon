import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createHumanoidBase, type HumanoidOptions } from './humanoidBase';

type Weight = [string, number][];
const BONE = 0xcfc2a0, EDGE = 0xe3d6b7, AGED = 0xa99a7e, SOCKET = 0x1b1916;

/** One small cutout atlas gives the hollow cage six paired ribs. Generated
 * once, shared by every skeleton; no rib meshes, transparency sorting or DOM. */
let ribTexture: THREE.DataTexture | undefined;
export function getSkeletonRibTexture(): THREE.DataTexture {
  if (ribTexture) return ribTexture;
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size;
    const front = Math.cos(u * Math.PI * 2);
    let distance = Infinity;
    for (let row = 0; row < 6; row++) {
      const course = .10 + row * .137 + .065 * (1 - front);
      distance = Math.min(distance, Math.abs(v - course));
    }
    const thickness = .026;
    const edge = Math.max(0, 1 - distance / thickness);
    const grain = Math.sin(x * 1.7 + y * .73) * Math.sin(y * .41 - x * .83) * .035;
    const shade = .74 + .26 * Math.sqrt(edge) + grain;
    const offset = (y * size + x) * 4;
    data[offset] = Math.round(221 * shade);
    data[offset + 1] = Math.round(208 * shade);
    data[offset + 2] = Math.round(175 * shade);
    data[offset + 3] = distance < thickness ? 255 : 0;
  }
  ribTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  ribTexture.name = 'skeleton-ribs-256';
  ribTexture.colorSpace = THREE.SRGBColorSpace;
  ribTexture.wrapS = THREE.RepeatWrapping;
  ribTexture.magFilter = THREE.LinearFilter;
  ribTexture.minFilter = THREE.LinearMipmapLinearFilter;
  ribTexture.generateMipmaps = true;
  ribTexture.needsUpdate = true;
  return ribTexture;
}

/** Shares the human bind pose, all 23 joints, weapon attachment and clips.
 * Bone pieces are merged into one skin; the alpha-tested cage is group two. */
export function createSkeletonWarriorRig(options: Pick<HumanoidOptions, 'weapon'> = { weapon: 'shortSword' }) {
  const rig = createHumanoidBase({...options, nasalHelmet: true});
  // Fit the shared rounded iron helmet above the skeleton's brows. Keep
  // its shortened nasal guard clear of the triangular nose aperture.
  const helmet = rig.mesh.getObjectByName('nasalHelmet')!;
  helmet.position.y += .044;
  const nasalGuard = rig.mesh.getObjectByName('noseGuard')!;
  nasalGuard.scale.y = .47;
  nasalGuard.position.set(0, .17, .121);
  const ids = Object.fromEntries(rig.skeleton.bones.map((bone, i) => [bone.name, i]));
  const joints = Object.fromEntries(rig.skeleton.bones.map(bone => [bone.name, bone.getWorldPosition(new THREE.Vector3())]));
  const parts: THREE.BufferGeometry[] = [];
  const rigid = (name: string): Weight => [[name, 1]];
  const add = (source: THREE.BufferGeometry, weights: Weight | ((p: THREE.Vector3) => Weight), color = BONE, collect = true) => {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (source !== geometry) source.dispose();
    geometry.clearGroups();
    const positions = geometry.getAttribute('position');
    // Reshape the visible bones without changing the shared animation rig:
    // pelvis width -33%, hands 2x about their wrist attachment.
    if (Array.isArray(weights)) {
      const name = weights[0][0];
      if (name === 'hips') {
        for (let i = 0; i < positions.count; i++) positions.setX(i, positions.getX(i) * .67);
      } else if (/^(hand|thumb)\./.test(name)) {
        const wrist = joints[`hand.${name.split('.')[1]}`];
        for (let i = 0; i < positions.count; i++) {
          positions.setXYZ(i,
            wrist.x + (positions.getX(i) - wrist.x) * 2,
            wrist.y + (positions.getY(i) - wrist.y) * 2,
            wrist.z + (positions.getZ(i) - wrist.z) * 2);
        }
      }
    }
    const indices: number[] = [], values: number[] = [], colors: number[] = [];
    const c = new THREE.Color(color), point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      const w = typeof weights === 'function' ? weights(point) : weights;
      for (let j = 0; j < 4; j++) { indices.push(w[j] ? ids[w[j][0]] : 0); values.push(w[j]?.[1] ?? 0); }
      colors.push(c.r, c.g, c.b);
    }
    if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.count * 2), 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(values, 4));
    geometry.computeVertexNormals();
    if (collect) parts.push(geometry);
    return geometry;
  };
  const rod = (a: THREE.Vector3, b: THREE.Vector3, radius: number, bone: string, color = BONE, shaped = false) => {
    const length = a.distanceTo(b);
    const geometry = new THREE.CylinderGeometry(radius, radius, length, radius <= .019 ? 4 : 6, shaped ? 3 : 1);
    if (shaped) {
      const position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        const t = (position.getY(i) / length + .5);
        const factor = t < .1 || t > .9 ? 1.3 : .78;
        position.setX(i, position.getX(i) * factor);
        position.setZ(i, position.getZ(i) * factor);
      }
    }
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    geometry.translate(...a.clone().add(b).multiplyScalar(.5).toArray());
    add(geometry, rigid(bone), color);
  };
  const box = (position: number[], size: number[], bone: string, color = BONE, roll = 0) => {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    geometry.rotateZ(roll); geometry.translate(position[0], position[1], position[2]);
    add(geometry, rigid(bone), color);
  };
  const knob = (position: THREE.Vector3, radius: number, bone: string, color = EDGE) => {
    add(new THREE.OctahedronGeometry(radius).translate(...position.toArray()), rigid(bone), color);
  };
  const plate = (points: number[][], depth: number, bone: string, color = BONE) => {
    const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geometry.translate(0, 0, points[0][2] - depth / 2);
    add(geometry, rigid(bone), color);
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // Vertebral column remains visible through the rib cutouts and abdomen.
  rod(v(0, .91, -.025), v(0, 1.46, -.035), .019, 'spine', AGED);
  for (let i = 0; i < 10; i++) {
    const y = .98 + i * .044;
    box([0, y, -.035], [.055, .030, .052], y < 1.16 ? 'spine' : 'chest', BONE);
  }
  for (let i = 0; i < 3; i++) box([0, 1.46 + i * .026, 0], [.05, .019, .052], 'neck', EDGE);
  rod(v(0, 1.42, -.007), v(0, 1.557, -.007), .011, 'neck', AGED);

  const cage = new THREE.CylinderGeometry(1, 1, 1, 12, 3, true);
  const cagePositions = cage.getAttribute('position');
  for (let i = 0; i < cagePositions.count; i++) {
    const t = cagePositions.getY(i) + .5;
    const width = t < .34 ? .14 + t * .15 : .191 - (t - .34) * .045;
    cagePositions.setXYZ(i, cagePositions.getX(i) * width, 1.105 + t * .295, cagePositions.getZ(i) * (.10 + .025 * Math.sin(t * Math.PI)));
  }
  const ribs = add(cage, p => { const t = THREE.MathUtils.clamp((p.y - 1.10) / .20, 0, 1); return [['spine', 1 - t], ['chest', t]]; }, 0xffffff, false);
  rod(v(0, 1.19, .11), v(0, 1.393, .104), .018, 'chest', EDGE);
  for (const side of [-1, 1]) {
    rod(v(side * .015, 1.397, .065), v(side * .189, 1.381, .009), .019, 'chest', EDGE);
    plate([[side * .038, 1.36, -.095], [side * .145, 1.35, -.095], [side * .112, 1.22, -.095]], .016, 'chest', AGED);
  }

  // Iliac wings and two open pelvic loops preserve the unmistakable bony waist.
  for (const side of [-1, 1]) {
    plate([[side * .04, .93, -.012], [side * .13, 1.015, -.012], [side * .185, .995, -.012], [side * .19, .923, -.012], [side * .12, .856, -.012], [side * .065, .863, -.012]], .065, 'hips');
    const curve: THREE.Vector3[] = [];
    for (let i = 0; i <= 7; i++) {
      const a = i / 7 * Math.PI * 2;
      curve.push(v(side * (.071 + Math.cos(a) * .046), .853 + Math.sin(a) * .052, .040));
    }
    for (let i = 0; i < curve.length - 1; i++) rod(curve[i], curve[i + 1], .015, 'hips');
  }
  box([0, .893, -.026], [.055, .13, .055], 'hips', AGED);
  rod(v(-.061, .817, .039), v(.061, .817, .039), .019, 'hips');

  for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
    const arm = `upperArm.${side}`, elbow = `forearm.${side}`, hand = `hand.${side}`;
    const hip = `upperLeg.${side}`, knee = `lowerLeg.${side}`, foot = `foot.${side}`;
    rod(joints[arm], joints[elbow], .022, arm, BONE, true);
    knob(joints[arm], .035, arm); knob(joints[elbow], .029, elbow);
    for (const offset of [-.014, .014]) rod(joints[elbow].clone().add(v(offset, -.018, 0)), joints[hand].clone().add(v(offset * .72, 0, 0)), .0115, elbow, BONE, true);
    rod(joints[hip], joints[knee], .026, hip, BONE, true);
    knob(joints[hip], .036, hip); knob(joints[knee].clone().add(v(0, 0, .013)), .035, knee);
    rod(joints[knee].clone().add(v(-sign * .009, -.021, 0)), joints[foot], .021, knee, BONE, true);
    rod(joints[knee].clone().add(v(sign * .027, -.025, -.006)), joints[foot].clone().add(v(sign * .018, .013, -.006)), .010, knee);
    knob(joints[foot], .028, foot);
    const hx = joints[hand].x;
    box([hx, .834, .001], [.046, .048, .027], hand, AGED);
    for (let i = 0; i < 4; i++) {
      const x = hx + (i - 1.5) * .012;
      rod(v(x, .837, .013), v(x, .798, .018), .006, hand, EDGE);
      rod(v(x, .798, .018), v(x, .75 + Math.abs(i - 1.5) * .006, .041), .0055, hand);
    }
    rod(v(hx - sign * .025, .841, .010), v(hx - sign * .037, .805, .033), .008, `thumb.${side}`);
    for (let i = 0; i < 4; i++) {
      const x = joints[foot].x + (i - 1.5) * .021;
      rod(v(joints[foot].x + (i - 1.5) * .009, .073, -.014), v(x, .042, .116), .012, foot);
      rod(v(x, .042, .116), v(x, .031, .179 - Math.abs(i - 1.5) * .011), .009, `toe.${side}`);
    }
    knob(joints[foot].clone().add(v(0, -.033, -.020)), .035, foot, AGED);
  }

  // Faceted cranial shell. Remove the front below the forehead so the eye
  // cavities are genuinely recessed, rather than black stickers on a sphere.
  const skull = new THREE.SphereGeometry(1, 12, 7).toNonIndexed();
  skull.scale(.119, .126, .102); skull.translate(0, 1.665, -.013);
  const source = skull.getAttribute('position');
  const kept: number[] = [];
  const clipPolygon = (polygon: THREE.Vector3[], distance: (point: THREE.Vector3) => number) => {
    const result: THREE.Vector3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = distance(a), db = distance(b);
      if (da >= 0) result.push(a);
      if ((da >= 0) !== (db >= 0)) result.push(a.clone().lerp(b, da / (da - db)));
    }
    return result;
  };
  for (let i = 0; i < source.count; i += 3) {
    let polygon = Array.from({length: 3}, (_, k) => new THREE.Vector3().fromBufferAttribute(source, i + k));
    polygon = clipPolygon(polygon, p => Math.max(.025 - p.z, p.y - (1.683 + Math.abs(p.x) * .26)));
    polygon = clipPolygon(polygon, p => p.y - 1.605);
    for (let k = 1; k < polygon.length - 1; k++) kept.push(...polygon[0].toArray(), ...polygon[k].toArray(), ...polygon[k + 1].toArray());
  }
  const shell = new THREE.BufferGeometry(); shell.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  add(shell, rigid('head')); skull.dispose();
  for (const side of [-1, 1]) {
    // Sloping inner brow + high outer corner gives a stern, angry expression.
    plate([[side * .012, 1.683, .068], [side * .097, 1.711, .068], [side * .104, 1.663, .068], [side * .063, 1.642, .068], [side * .022, 1.651, .068]], .012, 'head', SOCKET);
    rod(v(side * .015, 1.686, .109), v(side * .096, 1.711, .071), .0155, 'head', EDGE);
    rod(v(side * .096, 1.709, .067), v(side * .108, 1.661, .06), .013, 'head');
    rod(v(side * .105, 1.664, .068), v(side * .060, 1.640, .105), .018, 'head', EDGE);
    rod(v(side * .060, 1.640, .105), v(side * .040, 1.618, .109), .014, 'head');
    rod(v(side * .079, 1.64, -.008), v(side * .075, 1.566, .026), .014, 'head', AGED);
    rod(v(side * .075, 1.566, .026), v(side * .039, 1.553, .093), .017, 'head');
  }
  rod(v(0, 1.704, .098), v(0, 1.658, .106), .014, 'head', EDGE);
  plate([[0, 1.655, .112], [.017, 1.624, .112], [-.017, 1.624, .112]], .006, 'head', SOCKET);
  for (const side of [-1, 1]) rod(v(0, 1.659, .119), v(side * .021, 1.622, .116), .006, 'head', EDGE);
  box([0, 1.619, .081], [.095, .025, .040], 'head');
  box([0, 1.585, .082], [.096, .030, .014], 'head', SOCKET);
  box([0, 1.552, .082], [.090, .020, .041], 'head', BONE);
  for (let i = 0; i < 8; i++) {
    const x = (i - 3.5) * .012;
    const z = .108 - Math.abs(x) * .22;
    box([x, 1.604, z], [.010, .017, .018], 'head', EDGE);
    box([x, 1.571, z], [.010, .015, .017], 'head', EDGE);
  }

  const solid = mergeGeometries(parts, false)!;
  const geometry = mergeGeometries([solid, ribs], true)!;
  for (const part of parts) part.dispose();
  solid.dispose(); ribs.dispose();
  rig.mesh.geometry.dispose();
  (rig.mesh.material as THREE.Material).dispose();
  rig.mesh.geometry = geometry;
  rig.mesh.material = [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, flatShading: true }),
    new THREE.MeshStandardMaterial({ map: getSkeletonRibTexture(), alphaTest: .45, side: THREE.DoubleSide, roughness: .94, flatShading: true }),
  ];
  rig.mesh.name = 'SkeletonWarrior';
  rig.mesh.userData.bodyTriangles = geometry.getAttribute('position').count / 3;
  rig.mesh.userData.bodyMaterialPasses = 2;
  geometry.computeBoundingSphere();
  return rig;
}

let sharedRig: ReturnType<typeof createSkeletonWarriorRig> | undefined;
export function getSkeletonWarriorRig() { return sharedRig ??= createSkeletonWarriorRig(); }
