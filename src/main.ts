import { startGame } from "./game";
import { startLevelViewer } from "./viewer/levelViewer";
import { mountMainMenu } from "./menu/mount";
import { initPhysics } from "./physics/world";

// Entry point: shows the main menu on load (issue #33) rather than jumping
// straight into the game. The three.js scene/ECS world (startGame — see
// game.ts) isn't created at all until the player presses Play; likewise the
// level viewer's own scene isn't built until "View Tiles" is pressed.
//
// The level viewer is the one mode that comes back here afterward (via its
// "← Menu" button) — the game itself is still a one-way trip for this pass,
// same as before.

const container = document.getElementById("app")!;

function showMenu(): void {
  mountMainMenu(container, () => startGame(container), () => startLevelViewer(container, showMenu));
}

// Rapier is WASM and has to finish loading before either mode can build a
// physics world, so the menu only appears once it's ready — both entry
// points are then free to be synchronous, as they were before physics
// existed. `.then` rather than top-level await: tsconfig targets ES2020,
// which predates it.
initPhysics().then(showMenu);
