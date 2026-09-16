import type { RoomContent } from "../placementTypes";

// The main corridor (issue #21) connecting room-a's door to room-b's — a
// single 9m instance retrofitted twice in place, never moved:
//   - issue #71: plain `hallway` -> `hallway_junction`, adding an east
//     opening (the branch-corridor/side-chamber connection).
//   - issue #86: `hallway_junction` -> `hallway_cross`, adding a matching
//     west opening (the stairwell wing's connection — see
//     `rooms/stairwell.ts`), turning the T-junction into a real 4-way
//     crossroads.
// See docs/LEVEL_DESIGN.md's "worked example" sections for why a face-map
// change on this exact instance, rather than a new one, is what branching
// off an already-placed straight run requires each time. No decorations or
// items live here.

const corridor: RoomContent = {
  tiles: [
    {
      id: "corridor",
      tileTypeId: "hallway_cross",
      originCell: { x: 0, z: -3 },
      rotation: 0,
      sectorId: "corridor",
    },
  ],
};

export default corridor;
