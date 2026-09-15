import type { FurnitureAssetDef } from "./types";

// Auto-discovers every furniture/prop asset module under ./furniture/ at
// build time — same `import.meta.glob` pattern as itemRegistry.ts, and for
// the same reason: adding a new prop means adding one new file here, never
// editing this one.
const modules = import.meta.glob("./furniture/*.ts", { eager: true }) as Record<
  string,
  { default: FurnitureAssetDef }
>;

export const FURNITURE_REGISTRY: Record<string, FurnitureAssetDef> = {};
for (const path in modules) {
  const def = modules[path].default;
  if (FURNITURE_REGISTRY[def.id]) {
    throw new Error(`furnitureRegistry: duplicate furniture id "${def.id}" (from ${path})`);
  }
  FURNITURE_REGISTRY[def.id] = def;
}
