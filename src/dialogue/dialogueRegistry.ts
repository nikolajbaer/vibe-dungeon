import type { DialogueTree } from "./types";

// Auto-discovers every dialogue tree module under ./trees/ at build time
// (Vite's `import.meta.glob`, eager — these are plain data, cheap to bundle
// unconditionally), the same pattern src/assets/itemRegistry.ts uses. This
// file never needs editing to add a new NPC's dialogue.
//
// Deliberately sits *next to* (not inside) trees/, not e.g. trees/registry.ts
// — a glob of "./trees/*.ts" from here can't accidentally match this file
// itself, so there's no self-exclusion check to get wrong.
const modules = import.meta.glob("./trees/*.ts", { eager: true }) as Record<string, { default: DialogueTree }>;

export const DIALOGUE_REGISTRY: Record<string, DialogueTree> = {};
for (const path in modules) {
  const tree = modules[path].default;
  if (DIALOGUE_REGISTRY[tree.id]) {
    throw new Error(`dialogueRegistry: duplicate dialogue tree id "${tree.id}" (from ${path})`);
  }
  DIALOGUE_REGISTRY[tree.id] = tree;
}
