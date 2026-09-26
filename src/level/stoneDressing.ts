import * as THREE from "three";

type Piece = "trim" | "corner" | "jamb" | "arch" | "keystone";
type Pose = { position: THREE.Vector3; scale: THREE.Vector3; rotation: THREE.Quaternion };

/** A handful of shared geometries and materials for the whole dungeon. No
 * dressing gets a physics body; the masonry behind it supplies collision. */
export class StoneDressing {
  private pieces = new Map<Piece, Pose[]>();
  private add(kind: Piece, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, roll = 0): void {
    const list = this.pieces.get(kind) ?? [];
    list.push({
      position: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(sx, sy, sz),
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, roll, "YXZ")),
    });
    this.pieces.set(kind, list);
  }

  wallTrim(orientation: "x" | "z", plane: number, start: number, end: number, height: number, base: number): void {
    const length = end - start;
    // Short, separated ashlar blocks, proud of each wall face by 5cm.
    const count = Math.max(1, Math.ceil(length / .48));
    const step = length / count;
    for (let i = 0; i < count; i++) {
      const along = start + (i + .5) * step;
      for (const sign of [-1, 1]) {
        for (const y of [base + .15, base + height - .17]) {
          if (orientation === "x") this.add("trim", plane + sign * .185, y, along, .13, .19, step - .025);
          else this.add("trim", along, y, plane + sign * .185, step - .025, .19, .13);
        }
      }
    }
  }

  corner(x: number, z: number, height: number, base: number): void {
    const count = Math.floor(height / .46);
    for (let i = 0; i < count; i++) {
      // Stagger the corner courses so the silhouette reads as interlocking stone.
      const longX = i % 2 === 0;
      this.add("corner", x, base + .25 + i * .46, z, longX ? .47 : .37, .39, longX ? .37 : .47);
    }
  }

  doorFrame(orientation: "x" | "z", plane: number, center: number, radius: number, spring: number, rise: number, base: number): void {
    const yaw = orientation === "x" ? Math.PI / 2 : 0;
    const place = (kind: Piece, u: number, y: number, sx: number, sy: number, sz: number, roll = 0) => {
      const x = orientation === "x" ? plane : center + u;
      const z = orientation === "x" ? center + u : plane;
      this.add(kind, x, base + y, z, sx, sy, sz, yaw, roll);
    };
    for (const side of [-1, 1]) {
      const courses = Math.floor(spring / .35);
      for (let i = 0; i < courses; i++) place("jamb", side * (radius + .08), (i + .5) * spring / courses, .19, spring / courses - .018, .44);
    }
    // Faceted voussoirs follow the arch. Keep the center free for one larger keystone.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const u = side * radius * (i + .5) / 5;
        const y = spring + rise * Math.sqrt(1 - (u / radius) ** 2);
        const slope = -rise * u / (radius * radius * Math.sqrt(1 - (u / radius) ** 2));
        place("arch", u, y + .075, .25, .16, .44, Math.atan(slope));
      }
    }
    place("keystone", 0, spring + rise + .08, .32, .27, .49);
  }

  singleFrame(orientation: "x" | "z", plane: number, center: number, halfWidth: number, height: number, base: number): void {
    const yaw = orientation === "x" ? Math.PI / 2 : 0;
    for (const side of [-1, 1]) {
      const along = center + side * (halfWidth + .08);
      const count = Math.max(1, Math.floor(height / .35));
      for (let i = 0; i < count; i++) {
        const x = orientation === "x" ? plane : along;
        const z = orientation === "x" ? along : plane;
        this.add("jamb", x, base + (i + .5) * height / count, z, .19, height / count - .018, .44, yaw);
      }
    }
    const blocks = Math.max(1, Math.ceil(halfWidth * 2 / .3));
    for (let i = 0; i < blocks; i++) {
      const along = center - halfWidth + (i + .5) * (halfWidth * 2 / blocks);
      this.add("arch", orientation === "x" ? plane : along, base + height + .08, orientation === "x" ? along : plane, halfWidth * 2 / blocks - .018, .16, .44, yaw);
    }
  }

  flush(scene: THREE.Scene): void {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xa59b87, roughness: .93 });
    const keyMaterial = new THREE.MeshStandardMaterial({ color: 0xbdb19b, roughness: .92 });
    const matrix = new THREE.Matrix4();
    for (const [kind, poses] of this.pieces) {
      if (!poses.length) continue;
      const mesh = new THREE.InstancedMesh(geometry, kind === "keystone" ? keyMaterial : material, poses.length);
      mesh.name = `stoneDressing:${kind}`;
      mesh.userData.stoneDressing = kind;
      for (let i = 0; i < poses.length; i++) {
        const { position, scale, rotation } = poses[i];
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = kind !== "trim";
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
}

/** A small two-sided cloth hanging; sparse corridor placement keeps the
 * silhouettes distinct from the torches without creating more lights. */
export function addHallwayHanging(scene: THREE.Scene, x: number, z: number, orientation: "x" | "z", sign: 1 | -1, base: number): void {
  const group = new THREE.Group();
  group.name = "hallwayHanging";
  group.position.set(x + (orientation === "x" ? sign * .08 : 0), base + 1.78, z + (orientation === "z" ? sign * .08 : 0));
  if (orientation === "x") group.rotation.y = Math.PI / 2;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.78, 1.15), new THREE.MeshStandardMaterial({ color: 0x633d3b, roughness: 1, side: THREE.DoubleSide }));
  cloth.position.y = -.16;
  group.add(cloth);
  const rod = new THREE.Mesh(new THREE.BoxGeometry(.96, .045, .055), new THREE.MeshStandardMaterial({ color: 0x4d3928, roughness: .85 }));
  rod.position.y = .44;
  group.add(rod);
  scene.add(group);
}
