import type { RoomContent } from "../placementTypes";

// The main corridor (issue #21) connecting room-a's door to room-b's — a
// single 9m hallway_junction instance (originally a plain `hallway`; issue
// #71 retrofitted it to `hallway_junction` to add the branch-corridor/
// side-chamber's connection point, without moving it — see
// docs/LEVEL_DESIGN.md's "worked example" section for why a face-map change
// on this exact instance, rather than a new one, is what branching off an
// already-placed straight run requires). No decorations or items live here.

const corridor: RoomContent = {
  tiles: [
    {
      id: "corridor",
      tileTypeId: "hallway_junction",
      originCell: { x: 0, z: -3 },
      rotation: 0,
      sectorId: "corridor",
    },
  ],
};

export default corridor;
