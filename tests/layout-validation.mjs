import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });

try {
  const rooms = await server.ssrLoadModule("/src/level/rooms.ts");
  const occupancyModule = await server.ssrLoadModule("/src/level/occupancy.ts");

  const unitTile = {
    id: "layout-test-unit",
    w: 1,
    d: 1,
    h: 1,
    faces: {
      north: ["wall"],
      east: ["wall"],
      south: ["wall"],
      west: ["wall"],
    },
  };
  assert.throws(
    () =>
      occupancyModule.buildOccupancyIndex(
        [
          { id: "duplicate", tileTypeId: unitTile.id, originCell: { x: 0, z: 0 }, rotation: 0, sectorId: "a" },
          { id: "duplicate", tileTypeId: unitTile.id, originCell: { x: 2, z: 0 }, rotation: 0, sectorId: "b" },
        ],
        { [unitTile.id]: unitTile },
      ),
    /duplicate tile instance id "duplicate"/,
    "duplicate ids fail before distant instances can be merged into one slab",
  );

  const instances = rooms.ALL_TILE_INSTANCES;
  const ids = instances.map((instance) => instance.id);
  assert.equal(new Set(ids).size, ids.length, "tile instance ids must be globally unique");

  const occupancy = occupancyModule.buildOccupancyIndex(instances);
  occupancyModule.validateOccupancy(occupancy);

  const cellsFor = (instanceId) =>
    [...occupancy.entries()].filter(([, cell]) => cell.instanceId === instanceId);

  assert.equal(cellsFor("stair-upper").length, 3, "dormitory upper stair owns exactly its three cells");
  assert.equal(cellsFor("stair-lower").length, 3, "dormitory lower stair owns exactly its three cells");
  assert.equal(cellsFor("cellar-stair-upper").length, 3, "cellar upper stair owns exactly its three cells");
  assert.equal(cellsFor("cellar-stair-lower").length, 3, "cellar lower stair owns exactly its three cells");

  const landing = occupancy.get(occupancyModule.worldCellKey(-7, -2, 1));
  const stairTop = occupancy.get(occupancyModule.worldCellKey(-6, -2, 1));
  assert.equal(landing?.instanceId, "upper-landing", "dormitory landing occupies the cell west of the stair tip");
  assert.equal(stairTop?.instanceId, "stair-upper", "upper stair occupies the cell east of the dormitory landing");
  assert.notEqual(landing?.sides.posX, "wall", "dormitory landing is open toward the stair");
  assert.notEqual(stairTop?.sides.negX, "wall", "upper stair is open toward the dormitory landing");

  console.log(`Layout validation passed: ${instances.length} tile instances, ${occupancy.size} occupied cells.`);
} finally {
  await server.close();
}
