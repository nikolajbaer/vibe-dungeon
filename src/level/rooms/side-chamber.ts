import type { RoomContent } from "../placementTypes";
import { CRATE_HEIGHT } from "../../assets/furniture/crate";

// Side-chamber: the first branch off the original room-a/corridor/room-b
// line (issue #71) — both the branch-corridor and side-chamber tile
// instances live in this one file since they were authored together as one
// feature (a room file doesn't need to place exactly one physical room —
// see placementTypes.ts's `RoomContent` doc comment) — plus, per #71/#75, a
// small stack of supply crates and a barrel (a quiet, unpopulated
// storeroom-style detail, see docs/LEVEL_DESIGN.md's pacing pillar) and a
// lantern as the "dead-end detour" pillar's reward for exploring off the
// main path.
//
// Side-chamber (side_chamber, unrotated, originCell {x:4,z:-2}) spans world
// x in [12,18], z in [-6,0], with its one door on the west face's near
// (z<0 half) segment — world x=12, z in [-6,-3]. The crate/barrel clutter
// sits in the room's south-east corner (x roughly 16-17.4, z roughly -5.6 to
// -4.6), clear of the door and its swing arc, clear of the room's other
// three walls, and clear of the branch corridor's approach. The lantern
// sits in the room's north-east corner instead — clear of the door/swing
// (south-west), clear of the crates/barrel (south-east), and clear of all
// four interior wall faces by well over a meter on every side.

const baseX = 16.7;
const baseZ = -5.0;

const sideChamber: RoomContent = {
  tiles: [
    {
      id: "branch-corridor",
      tileTypeId: "hallway",
      originCell: { x: 1, z: -2 },
      rotation: 90,
      sectorId: "branch-corridor",
    },
    {
      id: "side-chamber",
      tileTypeId: "side_chamber",
      originCell: { x: 4, z: -2 },
      rotation: 0,
      sectorId: "side-chamber",
    },
  ],
  props: [
    { id: "crate", x: baseX, z: baseZ, rotation: 0.15 },
    { id: "crate", x: baseX - 0.05, y: CRATE_HEIGHT, z: baseZ + 0.05, rotation: -0.35 },
    { id: "barrel", x: baseX - 0.9, z: baseZ - 0.3 },
  ],
  // The lantern (issue #71's original reward) plus a key (issue: locked
  // doors) that unlocks room-b's door — see rooms/room-b.ts's
  // `lockedDoors`. Placed well clear of the lantern, the crates/barrel
  // clutter, and all four interior wall faces.
  items: [
    { id: "lantern", x: 16, z: -1.3 },
    { id: "key", x: 13.3, z: -1.3 },
  ],
};

export default sideChamber;
