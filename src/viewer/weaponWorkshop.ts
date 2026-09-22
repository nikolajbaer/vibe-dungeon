import * as THREE from "three";
import { ITEM_REGISTRY } from "../assets/itemRegistry";
import {
  cancelViewmodelCharge,
  debugMountViewmodel,
  getViewmodelAnimationDebugState,
  getViewmodelTuning,
  resetViewmodelTuning,
  setViewmodelTuning,
  startViewmodelBlock,
  startViewmodelCharge,
  stopViewmodelBlock,
  triggerViewmodelSwing,
  viewmodelSwingSystem,
  type HandSlot,
  type ViewmodelTuning,
} from "../ecs/systems/items";

// Standalone preview for weapon viewmodel animations (weapon.html) — lets
// jab/swing/block be triggered and every animation constant retuned live,
// in place of editing src/ecs/systems/items.ts's tuning values, reloading
// the whole game, navigating to a weapon, equipping it via the inventory
// UI, and attacking to see the effect. Same "standalone workshop page"
// pattern as src/characters/workshop.ts (character.html).
//
// `debugMountViewmodel`/`viewmodelSwingSystem` only ever index plain
// arrays by item id (see their own doc comments in items.ts) — no real ECS
// world or player entity is needed here, just this one fixed fake id.
const ITEM_EID = 1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11131a);
// Same FOV and rotation order as the real game's camera (src/game.ts), so
// a weapon's on-screen framing here matches exactly what a player sees.
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 100);
camera.rotation.order = "YXZ";
// A viewmodel mesh is parented directly to the camera (camera.add, see
// equipItem/debugMountViewmodel) — the camera itself must be in the scene
// graph for those children to actually render, same as game.ts.
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xc6dcff, 0x535064, 2.2));
const grid = new THREE.GridHelper(20, 20, 0x40516b, 0x29364a);
grid.position.set(0, -1.4, -3);
scene.add(grid);

// -- Weapon/hand selection --------------------------------------------------

const weaponSelect = document.querySelector<HTMLSelectElement>("#weapon")!;
const handSelect = document.querySelector<HTMLSelectElement>("#hand")!;
for (const def of Object.values(ITEM_REGISTRY)) {
  if (def.slot !== "hand" || !def.createViewmodelMesh) continue;
  weaponSelect.add(new Option(def.name, def.id));
}
if (ITEM_REGISTRY.sword?.createViewmodelMesh) weaponSelect.value = "sword";

function mount(): void {
  debugMountViewmodel(camera, ITEM_EID, weaponSelect.value, handSelect.value as HandSlot);
}
weaponSelect.onchange = mount;
handSelect.onchange = mount;
mount();

// -- Attack/block triggers ---------------------------------------------------

function jab(): void {
  triggerViewmodelSwing(ITEM_EID, "jab", getViewmodelTuning().swingDuration);
}
function chargeSwing(): void {
  startViewmodelCharge(ITEM_EID);
}
function releaseSwing(): void {
  triggerViewmodelSwing(ITEM_EID, "swing", getViewmodelTuning().swingDuration);
}
function cancelSwing(): void {
  cancelViewmodelCharge(ITEM_EID);
}
function block(): void {
  startViewmodelBlock(ITEM_EID);
}
function unblock(): void {
  stopViewmodelBlock(ITEM_EID);
}

const swingBtn = document.querySelector<HTMLButtonElement>("#swing")!;
const blockBtn = document.querySelector<HTMLButtonElement>("#block")!;
document.querySelector<HTMLButtonElement>("#jab")!.onclick = jab;
document.querySelector<HTMLButtonElement>("#cancel")!.onclick = cancelSwing;

function bindHold(btn: HTMLButtonElement, start: () => void, end: () => void): void {
  const press = () => {
    btn.classList.add("held");
    start();
  };
  const release = () => {
    if (!btn.classList.contains("held")) return;
    btn.classList.remove("held");
    end();
  };
  btn.addEventListener("pointerdown", press);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointerleave", release);
  btn.addEventListener("pointercancel", release);
}
bindHold(swingBtn, chargeSwing, releaseSwing);
bindHold(blockBtn, block, unblock);

addEventListener("keydown", (e) => {
  if (e.repeat || (e.target as HTMLElement)?.tagName === "SELECT") return;
  if (e.code === "KeyJ") jab();
  if (e.code === "Space") {
    e.preventDefault();
    swingBtn.classList.add("held");
    chargeSwing();
  }
  if (e.code === "KeyF") {
    blockBtn.classList.add("held");
    block();
  }
});
addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    swingBtn.classList.remove("held");
    releaseSwing();
  }
  if (e.code === "KeyF") {
    blockBtn.classList.remove("held");
    unblock();
  }
});

// -- Live tuning sliders ------------------------------------------------------

interface SliderSpec {
  key: keyof ViewmodelTuning;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: SliderSpec[] = [
  { key: "swingDuration", label: "Swing/jab duration (s)", min: 0.05, max: 2, step: 0.01 },
  { key: "stabDistance", label: "Jab distance (m)", min: 0, max: 1, step: 0.01 },
  { key: "stabInward", label: "Jab inward drift (m)", min: 0, max: 0.3, step: 0.005 },
  { key: "chargeRaiseSeconds", label: "Charge raise time (s)", min: 0.02, max: 1, step: 0.01 },
  { key: "sweepWind", label: "Chamber translate (m)", min: 0, max: 1, step: 0.01 },
  { key: "sweepReach", label: "Release reach (m)", min: 0, max: 1.5, step: 0.01 },
  { key: "sweepRiseWind", label: "Chamber rise (m)", min: -0.5, max: 0.5, step: 0.01 },
  { key: "sweepDropPeak", label: "Release drop (m)", min: -1, max: 0.5, step: 0.01 },
  { key: "sweepYawWind", label: "Chamber yaw (rad)", min: 0, max: 3, step: 0.01 },
  { key: "sweepYawReach", label: "Release yaw (rad)", min: 0, max: 3, step: 0.01 },
  { key: "sweepRollWind", label: "Chamber roll (rad)", min: -2, max: 2, step: 0.01 },
  { key: "sweepRollReach", label: "Release roll (rad)", min: -2, max: 2, step: 0.01 },
  { key: "blockRaiseSeconds", label: "Block raise time (s)", min: 0.02, max: 1, step: 0.01 },
  { key: "blockLowerSeconds", label: "Block lower time (s)", min: 0.02, max: 1, step: 0.01 },
  { key: "blockRaise", label: "Block raise (m)", min: 0, max: 0.5, step: 0.01 },
  { key: "blockInward", label: "Block inward (m)", min: 0, max: 0.5, step: 0.01 },
  { key: "blockForward", label: "Block forward (m)", min: 0, max: 0.5, step: 0.01 },
  { key: "blockPitch", label: "Block pitch (rad)", min: -1, max: 1, step: 0.01 },
  { key: "blockRoll", label: "Block roll (rad)", min: -2, max: 2, step: 0.01 },
  { key: "blendSeconds", label: "Blend time (s)", min: 0, max: 0.5, step: 0.01 },
];

const slidersEl = document.querySelector<HTMLDivElement>("#sliders")!;
const inputs = new Map<keyof ViewmodelTuning, HTMLInputElement>();
const values = new Map<keyof ViewmodelTuning, HTMLSpanElement>();
for (const spec of SLIDERS) {
  const row = document.createElement("div");
  row.className = "slider-row";
  const label = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = spec.label;
  const value = document.createElement("span");
  label.append(name, value);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.oninput = () => {
    const num = Number(input.value);
    value.textContent = num.toFixed(3);
    setViewmodelTuning({ [spec.key]: num } as Partial<ViewmodelTuning>);
  };
  row.append(label, input);
  slidersEl.append(row);
  inputs.set(spec.key, input);
  values.set(spec.key, value);
}

function syncSliders(): void {
  const current = getViewmodelTuning();
  for (const spec of SLIDERS) {
    const value = current[spec.key];
    inputs.get(spec.key)!.value = String(value);
    values.get(spec.key)!.textContent = value.toFixed(3);
  }
}
syncSliders();
document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => {
  resetViewmodelTuning();
  syncSliders();
};

// -- Debug hook, status readout and render loop ------------------------------

Object.assign(window, { weaponWorkshop: { getState: getViewmodelAnimationDebugState, camera, scene } });

const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  viewmodelSwingSystem(dt);
  const state = getViewmodelAnimationDebugState()[0];
  statusEl.textContent = state
    ? `${state.attackType}${state.charging ? " (holding)" : ""}  ${state.charging ? state.chargeElapsed.toFixed(2) : state.elapsed.toFixed(2)}/${state.charging ? "∞" : state.duration.toFixed(2)}s`
    : "resting";
  renderer.render(scene, camera);
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
