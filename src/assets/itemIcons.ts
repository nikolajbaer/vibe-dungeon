import * as THREE from "three";
import { ITEM_REGISTRY } from "./itemRegistry";

const ICON_SIZE = 96;
const iconUrls: Record<string, string> = {};

/** Returns the startup-rendered icon for an item, or undefined so the UI
 * can fall back to the item's Unicode authoring hint. */
export function itemIconUrl(itemTypeId: string): string | undefined {
  return iconUrls[itemTypeId];
}

/**
 * Renders every registered world mesh once when play starts. One temporary
 * renderer/context is shared across the whole catalog and released
 * immediately afterwards; inventory/container re-renders only reuse the
 * cached PNG data URLs and never touch WebGL again.
 */
export function generateItemIcons(): void {
  for (const key of Object.keys(iconUrls)) delete iconUrls[key];

  let renderer: THREE.WebGLRenderer | undefined;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(2);
    renderer.setSize(ICON_SIZE, ICON_SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x000000, 0);

    for (const def of Object.values(ITEM_REGISTRY)) {
      try {
        const scene = new THREE.Scene();
        const root = new THREE.Group();
        root.add(def.createWorldMesh());
        scene.add(root);

        let box = new THREE.Box3().setFromObject(root);
        root.position.sub(box.getCenter(new THREE.Vector3()));
        box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, size.z, .001) * .72;

        // A slightly enlarged back-face shell gives every silhouette a
        // restrained light-gray edge against the translucent dark UI.
        const outline = root.clone(true);
        outline.scale.setScalar(1.045);
        outline.traverse(object => {
          if (object instanceof THREE.Mesh) {
            object.material = new THREE.MeshBasicMaterial({ color: 0xc8cdd2, side: THREE.BackSide });
          }
        });
        scene.add(outline);

        const camera = new THREE.OrthographicCamera(-extent, extent, extent * .83, -extent * .83, .01, 100);
        camera.position.set(2.7, 2.05, 3.35).normalize().multiplyScalar(6);
        camera.lookAt(0, 0, 0);
        scene.add(new THREE.HemisphereLight(0xfff5df, 0x30343a, 2.3));
        const key = new THREE.DirectionalLight(0xffe3ad, 4.4);
        key.position.set(-3, 5, 4);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xb9d7ee, 1.8);
        rim.position.set(4, 1, -3);
        scene.add(rim);

        renderer.render(scene, camera);
        iconUrls[def.id] = renderer.domElement.toDataURL("image/png");
      } catch (error) {
        console.warn(`Could not render inventory icon for ${def.id}; using fallback.`, error);
      }
    }
  } catch (error) {
    console.warn("Could not initialize inventory icon renderer; using Unicode fallbacks.", error);
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
