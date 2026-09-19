import * as THREE from 'three';
import dagger from '../assets/items/dagger';
import sword from '../assets/items/sword';
import woodenSword from '../assets/items/wooden_sword';

export type HumanoidSpecies = 'human' | 'elf' | 'goblin' | 'dwarf';
export interface HumanoidOptions { species?: HumanoidSpecies; skin?: number; tunic?: number; trousers?: number; weapon?: 'shortSword' | 'dagger' | 'woodenSword'; }
const presets = {
  human: { scale: [1, 1, 1], ear: .04, skin: 0xc68d67 },
  elf: { scale: [.88, 1, .92], ear: .13, skin: 0xd4aa87 },
  goblin: { scale: [.86, 1, .94], ear: .17, skin: 0x7d9961 },
  dwarf: { scale: [1.22, .77, 1.15], ear: .04, skin: 0xb77e59 },
};

/** Faceted, UV-mapped body with normalized blended weights. +Z is forward.
 * All presets share topology and bone names; proportions are baked into the
 * bind pose, not applied as a nonuniform transform above the animated rig.
 * Hands are mittens (with thumbs), not individually articulated fingers.
 */
export function createHumanoidBase(options: HumanoidOptions = {}) {
  const preset = presets[options.species ?? 'human'];
  const [sx, sy, sz] = preset.scale;
  // Apply the same proportion edits to bind joints and weighted vertices.
  // Translate limbs rather than shrinking their thickness or hand size.
  const shapeX = (x: number, y: number, names: string[]) => {
    if (names.some(name => /^(clavicle|upperArm|forearm|hand|thumb)\./.test(name)))
      return x - Math.sign(x) * .026;
    if (names.some(name => /^(upperLeg|lowerLeg|foot|toe)\./.test(name)))
      return x + Math.sign(x) * .015;
    const width = y <= .94 ? 1.10 : y <= 1.04 ? 1.10 - (y - .94) :
      y <= 1.38 ? 1 - .12 * Math.min(1, (y - 1.04) / .26) :
      1 - .12 * Math.max(0, (1.47 - y) / .09);
    return x * width;
  };
  const bones: THREE.Bone[] = [];
  const ids: Record<string, number> = {};
  const positions: Record<string, THREE.Vector3> = {};
  const addBone = (name: string, parent: string | null, x: number, y: number, z = 0) => {
    const bone = new THREE.Bone(); bone.name = name;
    const p = new THREE.Vector3(shapeX(x, y, [name]) * sx, y * sy, z * sz);
    bone.position.copy(p);
    if (parent) { bone.position.sub(positions[parent]); bones[ids[parent]].add(bone); }
    ids[name] = bones.length; positions[name] = p; bones.push(bone);
  };
  addBone('hips', null, 0, .89);
  addBone('spine', 'hips', 0, 1.05);
  addBone('chest', 'spine', 0, 1.29);
  addBone('neck', 'chest', 0, 1.47);
  addBone('head', 'neck', 0, 1.53);
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    addBone(`clavicle.${side}`, 'chest', s * .10, 1.37);
    addBone(`upperArm.${side}`, `clavicle.${side}`, s * .245, 1.37);
    addBone(`forearm.${side}`, `upperArm.${side}`, s * .30, 1.10);
    addBone(`hand.${side}`, `forearm.${side}`, s * .325, .86);
    addBone(`thumb.${side}`, `hand.${side}`, s * .29, .81, .035);
    addBone(`upperLeg.${side}`, 'hips', s * .105, .88);
    addBone(`lowerLeg.${side}`, `upperLeg.${side}`, s * .105, .48);
    addBone(`foot.${side}`, `lowerLeg.${side}`, s * .105, .08);
    addBone(`toe.${side}`, `foot.${side}`, s * .105, .045, .15);
  }
  const p: number[] = [], uv: number[] = [], colors: number[] = [], si: number[] = [], sw: number[] = [], indices: number[] = [];
  type Weight = [string, number][];
  // Rings: y, x radius, z radius, center x, center z, weights.
  type Ring = [number, number, number, number, number, Weight];
  const skin = options.skin ?? preset.skin, cloth = options.tunic ?? 0x456b73;
  const pants = options.trousers ?? 0x343944, leather = 0x45342c;
  let island = 0;
  const loft = (rings: Ring[], color: number, sides = 10) => {
    const start = p.length / 3, c = new THREE.Color(color);
    const tile = island++;
    const vertex = (x: number, y: number, z: number, weights: Weight, u: number, v: number) => {
      if (weights.length === 1 && weights[0][0].startsWith('foot.') && z > .09) {
        const foot = weights[0][0], t = Math.min(1, (z - .09) / .09);
        weights = [[foot, 1 - t], [foot.replace('foot.', 'toe.'), t]];
      }
      p.push(shapeX(x, y, weights.map(([name]) => name)) * sx, y * sy, z * sz); colors.push(c.r, c.g, c.b);
      uv.push(((tile % 8) + .05 + u * .9) / 8, (Math.floor(tile / 8) + .05 + v * .9) / 8);
      for (let k = 0; k < 4; k++) { si.push(weights[k] ? ids[weights[k][0]] : 0); sw.push(weights[k]?.[1] ?? 0); }
    };
    rings.forEach(([y, rx, rz, x, z, w], j) => {
      for (let i = 0; i <= sides; i++) {
        const a = i / sides * Math.PI * 2;
        vertex(x + Math.cos(a) * rx, y, z + Math.sin(a) * rz, w, i / sides, j / (rings.length - 1));
      }
    });
    for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < sides; i++) {
      const a = start + j * (sides + 1) + i, b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    for (const j of [0, rings.length - 1]) {
      const [y, , , x, z, w] = rings[j]; const center = p.length / 3;
      vertex(x, y, z, w, .5, j === 0 ? 0 : 1);
      for (let i = 0; i < sides; i++) {
        const a = start + j * (sides + 1) + i;
        if (j === 0) indices.push(center, a, a + 1); else indices.push(center, a + 1, a);
      }
    }
  };
  const w = (a: string, b?: string, t = .5): Weight => b ? [[a, 1 - t], [b, t]] : [[a, 1]];
  loft([
    [.83,.19,.115,0,0,w('hips')], [.94,.18,.12,0,0,w('hips')],
    [1.04,.145,.095,0,0,w('hips','spine',.8)], [1.15,.17,.105,0,0,w('spine','chest')],
    [1.30,.215,.125,0,.005,w('chest')], [1.38,.22,.10,0,0,w('chest')],
    [1.43,.10,.075,0,0,w('chest','neck')],
  ], cloth, 12);
  loft([[1.41,.065,.061,0,0,w('neck')],[1.54,.062,.06,0,0,w('head')]],skin);
  loft([[1.51,.065,.07,0,.015,w('head')],[1.55,.095,.085,0,.02,w('head')],
    [1.62,.112,.10,0,0,w('head')],[1.71,.105,.095,0,-.005,w('head')],
    [1.77,.07,.065,0,-.01,w('head')],[1.79,.025,.025,0,-.01,w('head')]],skin,12);
  // Brow, bridge and nose give the silhouette an unambiguous front.
  loft([[1.59,.027,.025,0,.104,w('head')],[1.62,.033,.044,0,.112,w('head')],
    [1.67,.017,.018,0,.09,w('head')]],skin,6);
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const arm=`upperArm.${side}`, elbow=`forearm.${side}`, hand=`hand.${side}`;
    loft([[.845,.038,.038,s*.325,0,w(hand)], [.91,.047,.046,s*.322,0,w(elbow)],
      [1.01,.06,.053,s*.312,0,w(elbow)],[1.10,.052,.049,s*.30,0,w(arm,elbow)],
      [1.18,.069,.066,s*.28,0,w(arm)],[1.205,.074,.071,s*.276,0,w(arm)]],skin);
    loft([[1.20,.076,.073,s*.276,0,w(arm)],[1.29,.081,.078,s*.258,0,w(arm)],
      [1.38,.080,.077,s*.235,0,w(arm,'chest',.25)]],cloth);
    loft([[.73,.028,.027,s*.329,.012,w(hand)],[.76,.046,.031,s*.33,.012,w(hand)],
      [.82,.048,.035,s*.329,.005,w(hand)],[.86,.037,.036,s*.325,0,w(hand)]],skin,8);
    loft([[.765,.015,.017,s*.274,.038,w(`thumb.${side}`)],
      [.82,.025,.024,s*.287,.027,w(`thumb.${side}`)]],skin,6);
    const thigh=`upperLeg.${side}`, knee=`lowerLeg.${side}`, foot=`foot.${side}`;
    loft([[.10,.047,.05,s*.105,0,w(foot)],[.24,.068,.065,s*.105,-.012,w(knee)],
      [.37,.073,.071,s*.105,-.008,w(knee)],[.48,.062,.066,s*.105,0,w(thigh,knee)],
      [.57,.077,.078,s*.105,0,w(thigh)],[.72,.088,.095,s*.105,0,w(thigh)],
      [.89,.091,.10,s*.105,0,w(thigh,'hips',.35)]],pants);
    loft([[.015,.073,.139,s*.105,.07,w(foot)],[.06,.078,.142,s*.105,.068,w(foot)],
      [.12,.057,.085,s*.105,.025,w(foot)],[.23,.058,.063,s*.105,0,w(knee,foot,.75)]],leather);
    loft([[1.59,.015,.021,s*.108,0,w('head')],[1.64,.023,.024,s*.12,0,w('head')],
      [preset.ear>.05?1.70:1.666,.007,.01,s*(preset.ear>.05?.113+preset.ear:.124),-.005,w('head')]],skin,6);
    loft([[1.631,.022,.008,s*.047,.088,w('head')],[1.652,.022,.008,s*.047,.093,w('head')]],0x20272a,6);
    loft([[1.659,.03,.012,s*.047,.088,w('head')],[1.674,.029,.011,s*.047,.089,w('head')]],0x594235,6);
  }
  // A narrow belt provides a replaceable costume boundary.
  loft([[.945,.188,.126,0,0,w('hips','spine',.04)],[.984,.175,.119,0,0,w('hips','spine',.352)]],leather,12);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(si,4));
  geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(sw,4)); geo.setIndex(indices); geo.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,flatShading:true}));
  mesh.name = `Humanoid_${options.species ?? 'human'}`;
  mesh.add(bones[0]); mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones); mesh.bind(skeleton);
  mesh.castShadow=true; mesh.receiveShadow=true; mesh.frustumCulled=false;
  const duration=1.1, samples=32;
  const times=Array.from({length:samples+1},(_,i)=>i*duration/samples);
  const tracks: THREE.KeyframeTrack[]=[];
  const rotations: Record<string,number[]>={};
  const rotate=(name:string,x:number,y=0,z=0)=>{
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z));
    (rotations[name]??=[]).push(q.x,q.y,q.z,q.w);
  };
  const hipValues:number[]=[];
  for(let i=0;i<=samples;i++) {
    const phase=i/samples, a=phase*Math.PI*2;
    const hipY=(.865+.008*Math.cos(a*2))*sy;
    hipValues.push(0,hipY,0);
    rotate('hips',0,.065*Math.cos(a),.018*Math.sin(a));
    rotate('spine',0,-.045*Math.cos(a));
    rotate('chest',.02,-.11*Math.cos(a),-.015*Math.sin(a));
    // Counter the accumulated torso yaw to keep the gaze mostly forward.
    rotate('head',-.015,.09*Math.cos(a));
    for(const [side,offset] of [['L',0],['R',.5]] as const) {
      const t=(phase+offset)%1;
      // Stance foot travels rearward at constant velocity. Swing foot lifts
      // and returns; analytic two-bone IK supplies the sampled rotations.
      const swing=t>=.6, u=swing?(t-.6)/.4:t/.6;
      const z=(swing?-.18+.36*(u*u*(3-2*u)):.18-.36*u)*sz;
      const lift=swing?.105*Math.sin(Math.PI*u):0;
      const dy=(.08+lift)*sy-(hipY-.01*sy);
      const length=.4*sy, d=Math.min(Math.hypot(dy,z),length*1.999);
      const knee=2*Math.acos(d/(2*length));
      const thigh=Math.atan2(-z,-dy)-knee/2;
      rotate(`upperLeg.${side}`,thigh);
      rotate(`lowerLeg.${side}`,knee);
      rotate(`foot.${side}`,-thigh-knee);
      rotate(`upperArm.${side}`,.25*Math.cos((phase+offset)*Math.PI*2),0,side==='L'?.045:-.045);
      rotate(`forearm.${side}`,-.16-.06*Math.sin((phase+offset)*Math.PI*2));
    }
  }
  for(const [name,values] of Object.entries(rotations)) tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,times,values));
  tracks.push(new THREE.VectorKeyframeTrack('hips.position',times,hipValues));
  const walk=new THREE.AnimationClip('walk',duration,tracks);
  type Angles = [number, number, number];
  type Pose = { y: number; z?: number; joints: Record<string, Angles> };
  // Every clip keys every rotation so transitions cannot retain a stale pose.
  const poseClip = (name: string, end: number, poseAt: (t: number) => Pose, ground = false) => {
    const count = Math.ceil(end * 30), ts: number[] = [], roots: number[] = [];
    const qs = bones.map(() => [] as number[]);
    for (let frame = 0; frame <= count; frame++) {
      const t = frame * end / count, pose = poseAt(t); ts.push(t);
      bones.forEach((bone, i) => {
        const angles = pose.joints[bone.name] ?? [0, 0, 0];
        bone.quaternion.setFromEuler(new THREE.Euler(...angles));
        qs[i].push(...bone.quaternion.toArray());
      });
      bones[0].position.set(0, pose.y * sy, (pose.z ?? 0) * sz);
      if (ground) {
        mesh.updateMatrixWorld(true); skeleton.update();
        let minY = Infinity; const v = new THREE.Vector3();
        for (let i = 0; i < geo.attributes.position.count; i++) {
          mesh.getVertexPosition(i, v); minY = Math.min(minY, v.y);
        }
        bones[0].position.y += Math.max(0, .008 * sy - minY);
      }
      roots.push(...bones[0].position.toArray());
    }
    skeleton.pose(); mesh.updateMatrixWorld(true);
    return new THREE.AnimationClip(name, end, [
      ...bones.map((b, i) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, ts, qs[i])),
      new THREE.VectorKeyframeTrack('hips.position', ts, roots),
    ]);
  };
  const idle = poseClip('idle', 6, t => {
    const a = t / 6 * Math.PI * 2, breath = Math.sin(a * 2);
    return { y: .89, joints: {
      spine: [.012 * breath, .025 * Math.sin(a), 0],
      chest: [.018 * breath, -.04 * Math.sin(a), .012 * Math.sin(a)],
      head: [-.025 * breath, .22 * Math.sin(a), -.025 * Math.sin(a)],
      'upperArm.L': [.025 * breath, 0, .035], 'upperArm.R': [-.025 * breath, 0, -.035],
      'forearm.L': [-.12 - .025 * breath, 0, 0], 'forearm.R': [-.12 + .025 * breath, 0, 0],
    } };
  });
  const keyed = (keys: { t: number; pose: Pose }[]) => (t: number): Pose => {
    const k = Math.min(keys.length - 2, Math.max(0, keys.findIndex(key => key.t >= t) - 1));
    const a = keys[k], b = keys[k + 1];
    const u = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1), f = u * u * (3 - 2 * u);
    const mix = (x: number, y: number) => x + (y - x) * f;
    const joints: Record<string, Angles> = {};
    for (const bone of bones) {
      const av = a.pose.joints[bone.name] ?? [0, 0, 0], bv = b.pose.joints[bone.name] ?? [0, 0, 0];
      joints[bone.name] = av.map((x, i) => mix(x, bv[i])) as Angles;
    }
    return { y: mix(a.pose.y, b.pose.y), z: mix(a.pose.z ?? 0, b.pose.z ?? 0), joints };
  };
  const neutral: Pose = { y: .89, joints: {} };
  const hit = poseClip('hit', .75, keyed([
    { t: 0, pose: neutral },
    { t: .12, pose: { y: .87, joints: {
      spine: [-.08, .04, 0], chest: [-.18, .09, -.04], head: [-.24, -.08, .06],
      'upperArm.L': [-.65, 0, .22], 'upperArm.R': [-.5, 0, -.18],
      'forearm.L': [-.8, 0, 0], 'forearm.R': [-.65, 0, 0],
    } } },
    { t: .3, pose: { y: .875, joints: { chest: [.12, -.04, .025], head: [.1, .04, 0],
      'upperArm.L': [-.22, 0, .08], 'upperArm.R': [-.18, 0, -.08],
      'forearm.L': [-.4, 0, 0], 'forearm.R': [-.32, 0, 0] } } },
    { t: .75, pose: neutral },
  ]), true);
  const sprawled: Record<string, Angles> = {
    hips: [-Math.PI / 2, 0, 0], chest: [.025, 0, 0], head: [.06, .25, .08],
    'upperArm.L': [0, 0, .68], 'upperArm.R': [0, 0, -.48],
    'forearm.L': [-.12, 0, 0], 'forearm.R': [-.2, 0, 0],
    'upperLeg.L': [-.07, 0, .08], 'upperLeg.R': [-.05, 0, -.10],
    'lowerLeg.L': [.12, 0, 0], 'lowerLeg.R': [.1, 0, 0],
  };
  const death = poseClip('death', 2.4, keyed([
    { t: 0, pose: neutral },
    { t: .18, pose: { y: .87, joints: { chest: [-.15, 0, 0], head: [-.18, 0, 0],
      'upperArm.L': [-.3, 0, .12], 'upperArm.R': [-.25, 0, -.1] } } },
    { t: .6, pose: { y: .66, z: -.06, joints: { hips: [-.38, 0, 0], chest: [.12, 0, 0],
      'upperLeg.L': [-.6, 0, .06], 'upperLeg.R': [-.45, 0, -.06],
      'lowerLeg.L': [1.0, 0, 0], 'lowerLeg.R': [.85, 0, 0],
      'upperArm.L': [-.15, 0, .5], 'upperArm.R': [-.1, 0, -.4] } } },
    { t: 1.02, pose: { y: .30, z: -.15, joints: { ...sprawled, hips: [-1.15, 0, 0],
      'upperLeg.L': [-.35, 0, .08], 'lowerLeg.L': [.65, 0, 0], 'lowerLeg.R': [.4, 0, 0] } } },
    { t: 1.3, pose: { y: .12, z: -.22, joints: { ...sprawled, head: [-.08, .2, .06] } } },
    { t: 1.48, pose: { y: .14, z: -.22, joints: { ...sprawled, chest: [.045, 0, 0] } } },
    { t: 1.85, pose: { y: .12, z: -.22, joints: sprawled } },
    { t: 2.4, pose: { y: .12, z: -.22, joints: sprawled } },
  ]), true);
  // A compact right-handed guard: both knees loaded, elbows close, off-hand
  // protecting the ribs. Local hip motion returns to guard; gameplay owns travel.
  const guard: Pose = { y: .73, joints: {
    hips: [.07, -.14, 0], spine: [.10, -.07, 0], chest: [.18, -.14, 0], head: [-.25, .35, 0],
    'upperLeg.L': [-.58, 0, .09], 'upperLeg.R': [-.68, 0, -.09],
    'lowerLeg.L': [1.12, 0, 0], 'lowerLeg.R': [1.12, 0, 0],
    'foot.L': [-.61, 0, 0], 'foot.R': [-.51, 0, 0],
    'upperArm.R': [-.25, -.08, -.12], 'forearm.R': [-1.30, 0, 0], 'hand.R': [-.20, 0, 0],
    'upperArm.L': [-.35, .08, .16], 'forearm.L': [-1.6, 0, 0], 'hand.L': [0, 0, -.12],
  } };
  const combatIdle = poseClip('combatIdle', 3, t => {
    const breathe = Math.sin(t / 3 * Math.PI * 2);
    return { ...guard, joints: { ...guard.joints,
      chest: [.18 + .012 * breathe, -.14, 0], head: [-.25 - .012 * breathe, .35, 0],
    } };
  }, true);
  const attack = poseClip('attack', 1.7, keyed([
    { t: 0, pose: guard },
    { t: .32, pose: { ...guard, y: .70, z: -.025, joints: { ...guard.joints,
      hips: [.09, -.24, 0], spine: [.14, -.18, 0], chest: [.25, -.31, 0], head: [-.22, .58, 0],
      'upperArm.R': [-.12, -.08, -.10], 'forearm.R': [-1.4, 0, 0],
    } } },
    { t: .62, pose: { ...guard, y: .59, z: .17, joints: { ...guard.joints,
      hips: [.14, .20, 0], spine: [.19, .20, 0], chest: [.34, .44, 0], head: [-.16, -.78, 0],
      // The right foot plants forward while the left leg stays loaded behind.
      'upperLeg.R': [-1.28, 0, -.09], 'lowerLeg.R': [.78, 0, 0], 'foot.R': [.36, 0, 0],
      'upperLeg.L': [.08, 0, .09], 'lowerLeg.L': [1.30, 0, 0], 'foot.L': [-1.48, 0, 0],
      'upperArm.R': [-1.67, -.96, -.055], 'forearm.R': [-.10, 0, 0], 'hand.R': [-.80, -.60, .50],
      'upperArm.L': [-.22, .08, .20], 'forearm.L': [-1.65, 0, 0],
    } } },
    { t: .82, pose: { ...guard, y: .62, z: .13, joints: { ...guard.joints,
      hips: [.12, .14, 0], spine: [.16, .14, 0], chest: [.30, .31, 0], head: [-.18, -.58, 0],
      'upperLeg.R': [-1.10, 0, -.09], 'lowerLeg.R': [.90, 0, 0], 'foot.R': [.10, 0, 0],
      'upperLeg.L': [-.05, 0, .09], 'lowerLeg.L': [1.22, 0, 0], 'foot.L': [-1.28, 0, 0],
      'upperArm.R': [-1.48, -.76, -.065], 'forearm.R': [-.30, 0, 0], 'hand.R': [-.65, -.45, .35],
    } } },
    // Pull the right foot and weapon back into the original crouched guard.
    { t: 1.28, pose: guard },
    { t: 1.7, pose: guard },
  ]), true);
  // Short, reactive weapon deflection: lift the right hand across the face,
  // meet the blow outside the lead shoulder, then settle back into guard.
  const parry = poseClip('parry', .9, keyed([
    { t: 0, pose: guard },
    { t: .16, pose: { ...guard, y: .70, joints: { ...guard.joints,
      hips: [.01, -.20, 0], spine: [-.08, -.24, 0], chest: [-.10, -.35, -.05], head: [.06, .50, .04],
      'upperArm.R': [-.88, -.34, -.34], 'forearm.R': [-1.18, .08, .10], 'hand.R': [-2.12, -.85, -2.50],
      'upperArm.L': [-.42, .10, .20], 'forearm.L': [-1.72, 0, 0],
    } } },
    { t: .30, pose: { ...guard, y: .68, z: .025, joints: { ...guard.joints,
      hips: [-.03, .10, 0], spine: [-.12, .18, 0], chest: [-.22, .40, .08], head: [.10, -.58, -.06],
      'upperArm.R': [-1.55, .65, -.48], 'forearm.R': [-.67, 0, 0], 'hand.R': [2.50, -.74, -1.58],
      'upperArm.L': [-.38, .10, .22], 'forearm.L': [-1.70, 0, 0],
    } } },
    { t: .46, pose: { ...guard, y: .70, joints: { ...guard.joints,
      spine: [-.06, .06, 0], chest: [-.10, .12, .03], head: [.04, -.10, 0],
      'upperArm.R': [-.82, -.22, -.34], 'forearm.R': [-1.18, .05, .10], 'hand.R': [-.25, -.10, -.55],
    } } },
    { t: .72, pose: guard },
    { t: .9, pose: guard },
  ]), true);
  // High boxing guard and a committed right cross. The shoulder/hip turn and
  // small right-foot drive put the fist on an equal-height opponent's face.
  const boxingGuard: Pose = { y: .78, joints: {
    hips: [.06, -.10, 0], spine: [.10, -.06, 0], chest: [.16, -.10, 0], head: [-.18, .18, 0],
    'upperLeg.L': [-.38, 0, .07], 'upperLeg.R': [-.48, 0, -.07],
    'lowerLeg.L': [.78, 0, 0], 'lowerLeg.R': [.88, 0, 0],
    'foot.L': [-.42, 0, 0], 'foot.R': [-.38, 0, 0],
    'upperArm.R': [-1.80, 1.05, -.10], 'forearm.R': [-2.0, 0, 0], 'hand.R': [-.15, 0, -.12],
    'upperArm.L': [-1.80, -1.05, .10], 'forearm.L': [-2.0, 0, 0], 'hand.L': [-.15, 0, .12],
  } };
  const unarmedStrike = poseClip('unarmedStrike', 1.25, keyed([
    { t: 0, pose: boxingGuard },
    { t: .24, pose: { ...boxingGuard, y: .76, z: -.02, joints: { ...boxingGuard.joints,
      hips: [.08, -.28, 0], spine: [.13, -.24, 0], chest: [.22, -.34, 0], head: [-.20, .48, 0],
      'upperArm.R': [-.62, -.18, -.15], 'forearm.R': [-2.02, 0, -.06],
    } } },
    { t: .48, pose: { ...boxingGuard, y: .70, z: .12, joints: { ...boxingGuard.joints,
      hips: [.12, .30, 0], spine: [.18, .28, 0], chest: [.30, .55, 0], head: [-.16, -.72, 0],
      'upperLeg.R': [-.88, 0, -.07], 'lowerLeg.R': [.68, 0, 0], 'foot.R': [.12, 0, 0],
      'upperArm.R': [2.68, -.67, -.61], 'forearm.R': [0, 0, 0], 'hand.R': [-.14, -.08, .08],
      'upperArm.L': [-1.88, -1.02, .16], 'forearm.L': [-2.05, 0, .08],
    } } },
    { t: .64, pose: { ...boxingGuard, y: .72, z: .08, joints: { ...boxingGuard.joints,
      hips: [.10, .20, 0], spine: [.15, .18, 0], chest: [.25, .34, 0], head: [-.18, -.42, 0],
      'upperLeg.R': [-.72, 0, -.07], 'lowerLeg.R': [.74, 0, 0],
      'upperArm.R': [2.90, -.50, -.40], 'forearm.R': [-.42, 0, 0],
    } } },
    { t: .98, pose: boxingGuard },
    { t: 1.25, pose: boxingGuard },
  ]), true);
  // One-handed overhead diagonal power strike for a top-heavy axe or mace.
  const chop = poseClip('chop', 1.45, keyed([
    { t: 0, pose: guard },
    { t: .24, pose: { ...guard, y: .74, z: -.04, joints: { ...guard.joints,
      hips: [.05, -.30, 0], spine: [-.04, -.28, 0], chest: [-.12, -.46, -.06], head: [-.10, .58, .04],
      'upperArm.R': [-2.42, -.32, -.30], 'forearm.R': [-.62, 0, .05], 'hand.R': [.12, 0, -.10],
      'upperArm.L': [-.62, .12, .20], 'forearm.L': [-1.78, 0, 0],
    } } },
    { t: .42, pose: { ...guard, y: .73, z: -.045, joints: { ...guard.joints,
      hips: [.05, -.32, 0], spine: [-.05, -.30, 0], chest: [-.14, -.48, -.06], head: [-.10, .60, .04],
      'upperArm.R': [-2.42, -.32, -.30], 'forearm.R': [-.62, 0, .05], 'hand.R': [-3.06, -.77, -2.02],
      'upperArm.L': [-.62, .12, .20], 'forearm.L': [-1.78, 0, 0],
    } } },
    { t: .64, pose: { ...guard, y: .70, z: .04, joints: { ...guard.joints,
      hips: [.12, .18, 0], spine: [.24, .22, 0], chest: [.42, .44, .10], head: [-.22, -.58, -.08],
      'upperLeg.R': [-.88, 0, -.09], 'lowerLeg.R': [.92, 0, 0],
      'upperArm.R': [-.67, -1.22, -.44], 'forearm.R': [-1.13, 0, 0], 'hand.R': [-.76, -.42, 1.15],
      'upperArm.L': [-.40, .10, .24], 'forearm.L': [-1.72, 0, 0],
    } } },
    { t: .82, pose: { ...guard, y: .68, z: .08, joints: { ...guard.joints,
      hips: [.14, .26, 0], spine: [.28, .30, 0], chest: [.48, .56, .14], head: [-.25, -.72, -.10],
      'upperLeg.R': [-.98, 0, -.09], 'lowerLeg.R': [.98, 0, 0],
      'upperArm.R': [-.54, -1.12, -.38], 'forearm.R': [-1.18, 0, 0], 'hand.R': [-.82, -.38, 1.08],
    } } },
    { t: 1.12, pose: guard },
    { t: 1.45, pose: guard },
  ]), true);
  // Fast lead-hand straight: a small shoulder pop with no committed step.
  const unarmedJab = poseClip('unarmedJab', .5, keyed([
    { t: 0, pose: boxingGuard },
    { t: .18, pose: { ...boxingGuard, y: .76, z: .045, joints: { ...boxingGuard.joints,
      hips: [.06, -.04, 0], chest: [.15, -.18, 0], head: [-.18, .22, 0],
      'upperArm.L': [-2.68, .80, .50], 'forearm.L': [0, 0, 0], 'hand.L': [-.10, .06, -.06],
    } } },
    { t: .34, pose: boxingGuard },
    { t: .5, pose: boxingGuard },
  ]), true);
  // Bare-hand power chop: a downward hammer-fist using the same weight
  // transfer as the armed chop, but keeping the fist aligned with forearm.
  const unarmedChop = poseClip('unarmedChop', 1, keyed([
    { t: 0, pose: boxingGuard },
    { t: .30, pose: { ...boxingGuard, y: .75, z: -.03, joints: { ...boxingGuard.joints,
      hips: [.04, -.25, 0], spine: [-.05, -.22, 0], chest: [-.10, -.38, 0], head: [-.08, .45, 0],
      'upperArm.R': [-2.45, -.25, -.25], 'forearm.R': [-.35, 0, 0], 'hand.R': [0, 0, 0],
    } } },
    { t: .58, pose: { ...boxingGuard, y: .69, z: .10, joints: { ...boxingGuard.joints,
      hips: [.13, .20, 0], spine: [.24, .24, 0], chest: [.42, .45, .10], head: [-.22, -.58, 0],
      'upperArm.R': [-.48, -1.02, -.36], 'forearm.R': [-.18, 0, 0], 'hand.R': [0, 0, 0],
    } } },
    { t: .82, pose: boxingGuard },
    { t: 1, pose: boxingGuard },
  ]), true);
  // Horizontal one-handed cut, driven by hips and shoulders rather than a
  // fencing thrust. This is the armed counterpart to the boxing cross.
  const weaponCross = poseClip('weaponCross', .75, keyed([
    { t: 0, pose: guard },
    { t: .20, pose: { ...guard, y: .70, z: -.02, joints: { ...guard.joints,
      hips: [.08, -.34, 0], spine: [.12, -.30, 0], chest: [.20, -.48, 0], head: [-.18, .58, 0],
      'upperArm.R': [-.72, -.32, -.20], 'forearm.R': [-1.12, 0, 0], 'hand.R': [-.65, -.30, -.45],
    } } },
    { t: .42, pose: { ...guard, y: .66, z: .10, joints: { ...guard.joints,
      hips: [.12, .34, 0], spine: [.18, .34, 0], chest: [.30, .66, 0], head: [-.16, -.80, 0],
      'upperArm.R': [-1.12, -1.15, -.30], 'forearm.R': [-.35, 0, 0], 'hand.R': [-.42, -.30, .75],
    } } },
    { t: .60, pose: guard },
    { t: .75, pose: guard },
  ]), true);
  const unarmedParry = poseClip('unarmedParry', .75, keyed([
    { t: 0, pose: boxingGuard },
    { t: .18, pose: { ...boxingGuard, y: .75, z: -.02, joints: { ...boxingGuard.joints,
      spine: [-.10, -.12, 0], chest: [-.18, -.24, 0], head: [.08, .30, 0],
      'upperArm.L': [-1.50, -.72, .35], 'forearm.L': [-1.28, 0, .15],
      'upperArm.R': [-1.48, .72, -.35], 'forearm.R': [-1.28, 0, -.15],
    } } },
    { t: .42, pose: boxingGuard },
    { t: .75, pose: boxingGuard },
  ]), true);
  const retimeClip = (source: THREE.AnimationClip, name: string, duration: number) => {
    const clip = source.clone();
    const scale = duration / source.duration;
    clip.name = name;
    clip.duration = duration;
    for (const track of clip.tracks) for (let i = 0; i < track.times.length; i++) track.times[i] *= scale;
    return clip;
  };
  const weaponJab = retimeClip(attack, 'weaponJab', .5);
  const unarmedCross = retimeClip(unarmedStrike, 'unarmedCross', .75);
  const weaponChop = retimeClip(chop, 'weaponChop', 1);
  if (options.weapon) {
    const weapon = options.weapon === 'dagger' ? dagger.createWorldMesh() : options.weapon === 'woodenSword' ? woodenSword.createWorldMesh() : sword.createWorldMesh();
    weapon.name = options.weapon;
    weapon.scale.setScalar(options.weapon === 'dagger' ? .82 : .72);
    weapon.rotation.x = Math.PI / 2;
    weapon.position.set(0, -.065 * sy, .014 * sz);
    bones[ids['hand.R']].add(weapon);
  }
  // Existing NPC state machine uses idle/hit; workshop labels these loiter/damage.
  const canonicalClips={
    idle,walk,hit,death,combatIdle,parry,unarmedParry,
    weaponJab,weaponCross,weaponChop,
    unarmedJab,unarmedCross,unarmedChop,
  };
  // Non-enumerable aliases preserve older callers without exporting the
  // same AnimationClip multiple times into GLB files.
  const clips=canonicalClips as typeof canonicalClips & {attack:typeof attack;unarmedStrike:typeof unarmedStrike;chop:typeof chop};
  Object.defineProperties(clips,{
    attack:{value:attack,enumerable:false},
    unarmedStrike:{value:unarmedStrike,enumerable:false},
    chop:{value:chop,enumerable:false},
  });
  mesh.animations=Object.values(clips);
  return {mesh,skeleton,clips};
}
