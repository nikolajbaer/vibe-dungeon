import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Project page for https://github.com/nikolajbaer/vibe-dungeon,
// served at https://nikolajbaer.github.io/vibe-dungeon/
export default defineConfig({
  base: "/vibe-dungeon/",
  // Proper JSX transform for the Preact-based HUD (src/hud/), instead of
  // hand-rolling esbuild jsx config — see README Design Notes ("HUD" section).
  plugins: [preact()],
});
