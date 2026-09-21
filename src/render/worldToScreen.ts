import * as THREE from "three";

export interface ScreenPoint {
  x: number;
  y: number;
  /** True when `point` sits behind the camera -- the projected x/y aren't
   * meaningful then (a perspective divide by a negative w mirrors them), so
   * anything placing a DOM element at this position (a floating label, a
   * debug marker) should skip rendering when this is true rather than
   * trusting `x`/`y`. */
  behindCamera: boolean;
}

/**
 * Projects a world-space point to CSS pixel coordinates on `renderer`'s
 * canvas -- the same math `worldToScreen` (the Playwright debug hook in
 * game.ts) has always used, pulled out here so `hudSync.ts` can place a
 * floating enemy-state label at the same screen position `camera` would
 * actually render that point at, without duplicating the projection math.
 */
export function worldToScreen(camera: THREE.Camera, renderer: THREE.WebGLRenderer, point: THREE.Vector3): ScreenPoint {
  const behindCamera = point.clone().applyMatrix4(camera.matrixWorldInverse).z > 0;
  const ndc = point.clone().project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: rect.left + ((ndc.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    behindCamera,
  };
}
