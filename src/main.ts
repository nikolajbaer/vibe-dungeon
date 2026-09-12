import { startGame } from "./game";

// Entry point: boots the ECS-driven dungeon-crawler vertical slice (player
// controller, collision, doors — see game.ts). Replaces the hello-world
// rotating-cube smoke test.

const container = document.getElementById("app")!;
startGame(container);
