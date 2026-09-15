import type { ItemAssetDef } from "./types";

// Auto-discovers every item asset module under ./items/ at build time
// (Vite's `import.meta.glob`, eager since these are all tiny
// procedural-geometry factories worth bundling unconditionally, not
// lazy-loading candidates). This file never needs editing to add a new
// weapon/potion/curio — see types.ts's header comment for why that matters.
//
// Deliberately sits *next to* (not inside) items/, not e.g.
// items/registry.ts — a glob of "./items/*.ts" from here can't accidentally
// match this file itself, so there's no self-exclusion check to get wrong.
const modules = import.meta.glob("./items/*.ts", { eager: true }) as Record<string, { default: ItemAssetDef }>;

export const ITEM_REGISTRY: Record<string, ItemAssetDef> = {};
for (const path in modules) {
  const def = modules[path].default;
  if (ITEM_REGISTRY[def.id]) {
    throw new Error(`itemRegistry: duplicate item id "${def.id}" (from ${path})`);
  }
  ITEM_REGISTRY[def.id] = def;
}
