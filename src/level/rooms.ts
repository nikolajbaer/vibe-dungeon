import type { TileInstance } from "./occupancy";
import type { PropPlacement, ItemSpawn, NpcSpawn, RoomContent, LevelSpawn, StairConnector } from "./placementTypes";

// Auto-discovers every room-content module under ./rooms/ at build time
// (same `import.meta.glob` pattern as src/assets/itemRegistry.ts) and
// flattens all of their tiles/props/items/npcs together. Adding a new room
// means adding one new file under rooms/ that default-exports a
// `RoomContent` — this file never needs editing.
const modules = import.meta.glob("./rooms/*.ts", { eager: true }) as Record<string, { default: RoomContent }>;

const rooms = Object.values(modules).map((m) => m.default);

export const ALL_TILE_INSTANCES: TileInstance[] = rooms.flatMap((r) => r.tiles ?? []);
export const ALL_PROPS: PropPlacement[] = rooms.flatMap((r) => r.props ?? []);
export const ALL_ITEM_SPAWNS: ItemSpawn[] = rooms.flatMap((r) => r.items ?? []);
export const ALL_NPC_SPAWNS: NpcSpawn[] = rooms.flatMap((r) => r.npcs ?? []);
export const ALL_STAIR_CONNECTORS: StairConnector[] = rooms.flatMap((r) => r.stairs ?? []);

// Exactly one room should declare where the player starts — fail loudly at
// build time (same philosophy as occupancy.ts's validateOccupancy) rather
// than silently picking the first/last one if a future room adds a second
// spawn by mistake, or none does.
const spawns = rooms.map((r) => r.spawn).filter((s): s is LevelSpawn => s !== undefined);
if (spawns.length !== 1) {
  throw new Error(`level/rooms: expected exactly one room to declare a spawn point, found ${spawns.length}`);
}
export const LEVEL_SPAWN: LevelSpawn = spawns[0];
