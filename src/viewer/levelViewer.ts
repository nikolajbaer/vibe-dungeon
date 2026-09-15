import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createWorld } from "bitecs";
import { buildLevel } from "../level/level";
import { buildOccupancyIndex, type OccupancyIndex } from "../level/occupancy";
import { UNIT } from "../level/tiles";
import { ALL_TILE_INSTANCES, ALL_ITEM_SPAWNS, ALL_NPC_SPAWNS, LEVEL_SPAWN } from "../level/rooms";
import { NPC_REGISTRY } from "../assets/npcRegistry";
import { ITEM_REGISTRY } from "../assets/itemRegistry";
import { npcAnimationSystem } from "../ecs/systems/npcAnimation";

// The level viewer (menu's "View Tiles"): an external, free-orbit look at
// the *authored* level — every tile instance, sector, and NPC/item spawn —
// rather than the first-person playthrough `game.ts` renders. Reuses
// `buildLevel` outright (same geometry/entities a real playthrough gets, so
// what you see here is never out of sync with what you'd see in-game) and
// layers three annotations on top that only make sense from outside: a
// translucent sector-colored floor tint per cell, floating labeled markers
// for every NPC/item/the player's spawn point, and hidden ceilings so an
// orbit camera above the level can actually see into every room.
//
// Deliberately no player entity and no `npcSystem`/`movementSystem`/
// `collisionSystem` — this is a static layout review, not a playable mode,
// so NPCs stay put at their authored spawn point rather than wandering
// (which would defeat the point of a spawn-position marker). `npcAnimationSystem`
// still runs, purely so idle sway reads as "yes, this is the same animated
// rig the real game uses" rather than a frozen T-pose.

const SECTOR_OVERLAY_OPACITY = 0.45;
const SECTOR_OVERLAY_Y = 0.05; // just above the floor slab (-0.1..+0.1) to avoid z-fighting

/** Deterministic (id -> color) so the same sector always gets the same
 * color across a session and across reloads, without hand-authoring a
 * palette that would need updating every time a new sector is added. */
function hashColor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return new THREE.Color(`hsl(${hue}, 65%, 55%)`).getHex();
}

/** A small billboard text label — no font-loading/text-geometry library, just
 * a `THREE.Sprite` textured from a 2D canvas, the standard lightweight
 * three.js technique for "a bit of readable text floating in the scene". */
function makeLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const fontSize = 42;
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  const textWidth = ctx.measureText(text).width;
  canvas.width = Math.ceil(textWidth) + 24;
  canvas.height = fontSize + 20;
  // Canvas sizing resets the 2D context, so font/fill have to be re-applied.
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(10, 10, 16, 0.75)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  const WORLD_UNITS_PER_PX = 0.011;
  sprite.scale.set(canvas.width * WORLD_UNITS_PER_PX, canvas.height * WORLD_UNITS_PER_PX, 1);
  sprite.renderOrder = 999; // always readable, never occluded by level geometry
  return sprite;
}

/** One translucent quad per occupied cell, tinted by that cell's sector —
 * the fastest way to answer "which rooms did I actually group into which
 * sector" at a glance, since sector boundaries otherwise only show up as
 * authoring data with no visual today (see README "Sectors"). Returns the
 * id->color map used for the legend so the two stay in sync by construction. */
function addSectorOverlays(scene: THREE.Scene, occupancy: OccupancyIndex): Map<string, number> {
  const colors = new Map<string, number>();
  const geometry = new THREE.PlaneGeometry(UNIT * 0.92, UNIT * 0.92);
  for (const [key, cell] of occupancy) {
    let color = colors.get(cell.sectorId);
    if (color === undefined) {
      color = hashColor(cell.sectorId);
      colors.set(cell.sectorId, color);
    }
    const [x, z] = key.split(",").map(Number);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: SECTOR_OVERLAY_OPACITY, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x * UNIT + UNIT / 2, SECTOR_OVERLAY_Y, z * UNIT + UNIT / 2);
    scene.add(mesh);
  }
  return colors;
}

function addNpcMarkers(scene: THREE.Scene): void {
  for (const spawn of ALL_NPC_SPAWNS) {
    const archetype = NPC_REGISTRY[spawn.id];
    const aggressive = archetype?.behavior === "aggressive";
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 6), new THREE.MeshBasicMaterial({ color: aggressive ? 0xd9433f : 0x4caf7d }));
    mesh.position.set(spawn.x, 2.3, spawn.z);
    scene.add(mesh);

    const label = makeLabel(`${archetype?.name ?? spawn.id} (${archetype?.behavior ?? "unknown"})`, "#fff");
    label.position.set(spawn.x, 2.85, spawn.z);
    scene.add(label);
  }
}

function addItemMarkers(scene: THREE.Scene): void {
  for (const spawn of ALL_ITEM_SPAWNS) {
    const item = ITEM_REGISTRY[spawn.id];
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xffcc44 }));
    mesh.position.set(spawn.x, spawn.y ?? 1, spawn.z);
    mesh.position.y += 0.7; // float above the item's own world mesh, not through it
    scene.add(mesh);

    const label = makeLabel(item ? `${item.icon} ${item.name}` : spawn.id, "#ffe9a8");
    label.position.set(spawn.x, mesh.position.y + 0.45, spawn.z);
    scene.add(label);
  }
}

/** Matches `inputSystem`'s yaw convention (`ecs/systems/input.ts`: forward
 * at yaw 0 is world -z) so the arrow actually points the way the player
 * will really be facing on spawn, not an arbitrary guess. */
function addPlayerSpawnMarker(scene: THREE.Scene): void {
  const { x, z, yaw } = LEVEL_SPAWN;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshBasicMaterial({ color: 0x35d6ff }));
  mesh.position.set(x, 1.6, z);
  scene.add(mesh);

  const facing = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  scene.add(new THREE.ArrowHelper(facing, mesh.position, 1.2, 0x35d6ff, 0.35, 0.25));

  const label = makeLabel("Player spawn", "#9be8ff");
  label.position.set(x, 2.2, z);
  scene.add(label);
}

function hideCeilings(scene: THREE.Scene): void {
  scene.traverse((child) => {
    if (child.userData.slabKind === "ceiling") child.visible = false;
  });
}

interface LevelBounds {
  centerX: number;
  centerZ: number;
  radius: number;
}

function computeLevelBounds(occupancy: OccupancyIndex): LevelBounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const key of occupancy.keys()) {
    const [x, z] = key.split(",").map(Number);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const centerX = ((minX + maxX + 1) / 2) * UNIT;
  const centerZ = ((minZ + maxZ + 1) / 2) * UNIT;
  const sizeX = (maxX - minX + 1) * UNIT;
  const sizeZ = (maxZ - minZ + 1) * UNIT;
  return { centerX, centerZ, radius: Math.max(sizeX, sizeZ, UNIT * 3) };
}

function setupViewerHud(container: HTMLElement, onExit: () => void, sectorColors: Map<string, number>): () => void {
  const el = document.createElement("div");
  el.id = "viewer-hud";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "viewer-back-btn";
  backBtn.textContent = "← Menu";
  backBtn.addEventListener("click", onExit);
  el.appendChild(backBtn);

  const legend = document.createElement("div");
  legend.className = "viewer-legend";
  const title = document.createElement("strong");
  title.textContent = "Sectors";
  legend.appendChild(title);
  for (const [sectorId, color] of sectorColors) {
    const row = document.createElement("div");
    row.className = "viewer-legend-row";
    const swatch = document.createElement("span");
    swatch.className = "viewer-legend-swatch";
    swatch.style.background = `#${color.toString(16).padStart(6, "0")}`;
    row.appendChild(swatch);
    row.appendChild(document.createTextNode(sectorId));
    legend.appendChild(row);
  }
  el.appendChild(legend);

  container.appendChild(el);
  return () => el.remove();
}

/**
 * Starts the level viewer, taking over `container` the same way `startGame`
 * does. Calls `onExit` once (after fully tearing itself down: render loop,
 * controls, renderer, DOM overlay, resize listener) when the "← Menu" button
 * is pressed, so the caller can safely remount the main menu in response.
 */
export function startLevelViewer(container: HTMLElement, onExit: () => void): void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2e38);

  // Bright, flat, shadow-free lighting — the moody torch-driven look
  // (game.ts) is exactly wrong for a layout review, where the goal is
  // "read every surface clearly", not atmosphere. Torch point lights from
  // `buildLevel` are still present underneath this; they just don't matter
  // next to a light this strong.
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const world = createWorld();
  buildLevel(world, scene); // same geometry/entities a real playthrough gets

  const occupancy = buildOccupancyIndex(ALL_TILE_INSTANCES);
  hideCeilings(scene);
  const sectorColors = addSectorOverlays(scene, occupancy);
  addNpcMarkers(scene);
  addItemMarkers(scene);
  addPlayerSpawnMarker(scene);

  const bounds = computeLevelBounds(occupancy);
  camera.position.set(bounds.centerX + bounds.radius * 0.7, bounds.radius * 1.1, bounds.centerZ + bounds.radius * 0.7);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(bounds.centerX, 1, bounds.centerZ);
  controls.enableDamping = true;
  controls.maxDistance = bounds.radius * 6;
  controls.update();

  const removeHud = setupViewerHud(container, exit, sectorColors);

  // Debug-only hook for automated (Playwright) testing — lets a test place
  // the orbit camera exactly (e.g. dead overhead) rather than approximating
  // it via synthetic mouse-drag deltas, mirroring `window.__vibeDungeonDebug`
  // in game.ts.
  (window as unknown as { __vibeDungeonViewerDebug: unknown }).__vibeDungeonViewerDebug = {
    setCamera: (pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) => {
      camera.position.set(pos.x, pos.y, pos.z);
      controls.target.set(target.x, target.y, target.z);
      controls.update();
    },
    getBounds: () => bounds,
  };

  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", handleResize);

  const clock = new THREE.Clock();
  let rafId: number;
  function frame() {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    npcAnimationSystem(world, dt, false); // idle sway only — no npcSystem, nothing should actually move
    controls.update();
    renderer.render(scene, camera);
  }
  frame();

  function exit(): void {
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", handleResize);
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    removeHud();
    onExit();
  }
}
