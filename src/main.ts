import { startGame } from "./game";
import { mountMainMenu } from "./menu/mount";

// Entry point: shows the main menu on load (issue #33) rather than jumping
// straight into the game. The three.js scene/ECS world (startGame — see
// game.ts) isn't created at all until the player presses Play.

const container = document.getElementById("app")!;
mountMainMenu(container, () => startGame(container));
