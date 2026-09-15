import type { NpcArchetypeDef } from "./types";

// Auto-discovers every NPC archetype module under ./npcs/ at build time —
// same `import.meta.glob` pattern as itemRegistry.ts/furnitureRegistry.ts.
// Adding a new archetype (a new docile or aggressive "kind" of character)
// means adding one new file here, never editing this one.
const modules = import.meta.glob("./npcs/*.ts", { eager: true }) as Record<string, { default: NpcArchetypeDef }>;

export const NPC_REGISTRY: Record<string, NpcArchetypeDef> = {};
for (const path in modules) {
  const archetype = modules[path].default;
  if (NPC_REGISTRY[archetype.id]) {
    throw new Error(`npcRegistry: duplicate NPC archetype id "${archetype.id}" (from ${path})`);
  }
  NPC_REGISTRY[archetype.id] = archetype;
}
