import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Served at the custom domain https://vibe-dungeon.nikolaj.dev/ (see the
// CNAME file, which Vite copies from public/ into the build output). Base
// must be "/" (domain root), not the old GitHub Pages project-page path
// "/vibe-dungeon/" (https://nikolajbaer.github.io/vibe-dungeon/) — with the
// custom domain live, that old base made every built asset URL 404 (e.g.
// "/vibe-dungeon/assets/index-*.js" against a site actually served at "/"),
// which is why the deployed site stopped loading (blank page) even though
// every "Deploy to GitHub Pages" run kept reporting success.
export default defineConfig({
  base: "/",
  // Proper JSX transform for the Preact-based HUD (src/hud/), instead of
  // hand-rolling esbuild jsx config — see README Design Notes ("HUD" section).
  plugins: [preact()],
  build: { rollupOptions: { input: { game: 'index.html', character: 'character.html' } } },
});
