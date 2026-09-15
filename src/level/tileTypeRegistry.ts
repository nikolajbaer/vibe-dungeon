import type { TileType } from "./tiles";

// Auto-discovers every tile type module under ./tileTypes/ at build time —
// same `import.meta.glob` pattern as src/assets/itemRegistry.ts, and for the
// same reason: adding a new tile type means adding one new file here, never
// editing this one. Sits *next to* (not inside) tileTypes/ so the glob can't
// accidentally match this file itself.
const modules = import.meta.glob("./tileTypes/*.ts", { eager: true }) as Record<string, { default: TileType }>;

export const TILE_TYPES: Record<string, TileType> = {};
for (const path in modules) {
  const type = modules[path].default;
  if (TILE_TYPES[type.id]) {
    throw new Error(`tileTypeRegistry: duplicate tile type id "${type.id}" (from ${path})`);
  }
  TILE_TYPES[type.id] = type;
}
