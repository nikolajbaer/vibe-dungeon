import type { RoomContent } from "../placementTypes";

// Room-a: the level's starting room (issue #21), plus a small rest-area
// furniture grouping, a couple of west-wall touches, and the level's first
// two world items (issue #40, extended by #70 and #75). Room A
// (great_hall, unrotated) has its one door on its south face at grid x=0;
// see room-b.ts/corridor.ts for how the rest of the original layout
// connects to it, and docs/LEVEL_DESIGN.md for the tile system itself.
//
// Room-a (great_hall, unrotated, originCell {x:-1,z:0}) spans world x in
// [-3,6], z in [0,9], with its one door on the south face (world z=0, x in
// [0,3]) and interior clear space roughly [-2.85,5.85] x [0.15,8.85] once
// wall thickness is accounted for.
//
// The player spawns at (1.5,7.5) and the villager NPC (issue #36, now the
// first docile archetype — src/assets/npcs/villager.ts) loiters around
// (1.5,3.5), wandering within ~1.5m of that point — both sit on the room's
// x=1.5 north-south spine.
//
// The table+chairs+barrel grouping sits in the north-east corner (x roughly
// 3.7-5.7, z roughly 6.0-8.6), comfortably clear of that spine, clear of the
// door's swing arc (which only reaches a couple meters from the doorway),
// and clear of the north wall. The candelabra/banners fill in the room's
// otherwise-bare west side, well clear of all of the above. The sword and
// gem sit near the player's spawn point, on either side, off the NPC's
// home/wander spot and its path down to the corridor door.

const tableX = 4.3;
const tableZ = 7.2;

const roomA: RoomContent = {
  tiles: [
    {
      id: "room-a",
      tileTypeId: "great_hall",
      originCell: { x: -1, z: 0 },
      rotation: 0,
      sectorId: "room-a",
    },
  ],
  // Spawn point, inside room-a (9m x 9m), facing south (-z) down the
  // corridor — matches the old level's "start in room A, corridor heads
  // away from you" feel.
  spawn: { x: 1.5, z: 7.5, yaw: 0 },
  props: [
    { id: "table", x: tableX, z: tableZ },
    // Chair facing north into the table, seated on the table's south side.
    { id: "chair", x: tableX, z: tableZ - 0.85, rotation: 0 },
    // Chair facing west into the table, seated on the table's east side.
    { id: "chair", x: tableX + 1.05, z: tableZ, rotation: -Math.PI / 2 },
    // Barrel tucked further into the corner, past the table (kept short of
    // the north wall's interior face at z~8.85).
    { id: "barrel", x: tableX + 1.0, z: tableZ + 1.2 },

    // West-side touches: a candelabra roughly mid-room on the west wall,
    // plus a banner on each of the west and north walls — clear of the
    // NPC's wander circle (center (1.5,3.5), radius 1.5), the player's
    // spawn, both item spawns below, the door swing arc, and the NE
    // furniture grouping above.
    { id: "candelabra", x: -2.3, z: 4.6 },
    // North wall banner, west of the furniture grouping (which sits up
    // against the same wall further east, around x~5.3).
    { id: "banner", x: -1.3, z: 8.8, rotation: Math.PI },
    // West wall banner, south of the candelabra.
    { id: "banner", x: -2.8, z: 2.2, rotation: Math.PI / 2 },
  ],
  items: [
    { id: "sword", x: 4, z: 7 },
    { id: "gem", x: -1, z: 7 },
  ],
  npcs: [{ id: "villager", x: 1.5, z: 3.5 }],
  // A single-page notice on the east wall (narration devices) — clear of
  // the NE furniture grouping (z 6.0-8.6) by mounting it further south, and
  // a deliberate hint at room-b's locked door before the player ever
  // reaches it.
  readables: [
    {
      id: "poster",
      x: 5.7,
      z: 3.0,
      rotation: -Math.PI / 2,
      title: "Notice",
      pages: [
        "Travelers report a sealed passage beyond the old corridor door.\n\nThose without a key are advised not to linger there. Something guards it.",
      ],
    },
  ],
};

export default roomA;
