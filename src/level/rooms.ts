import type { PropPlacement, ItemSpawn, RoomContent } from "./placementTypes";

// Auto-discovers every room-content module under ./rooms/ at build time
// (same `import.meta.glob` pattern as src/assets/itemRegistry.ts) and
// flattens all of their props/items together. Adding a new room's content
// means adding one new file under rooms/ that default-exports a
// `RoomContent` — this file never needs editing.
const modules = import.meta.glob("./rooms/*.ts", { eager: true }) as Record<string, { default: RoomContent }>;

const rooms = Object.values(modules).map((m) => m.default);

export const ALL_PROPS: PropPlacement[] = rooms.flatMap((r) => r.props ?? []);
export const ALL_ITEM_SPAWNS: ItemSpawn[] = rooms.flatMap((r) => r.items ?? []);
