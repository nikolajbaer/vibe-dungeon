import type { RoomContent } from "../placementTypes";

// Room-b's content (issue #70): a "shrine" grouping — two banners flanking a
// candelabra — plus a couple of storage barrels, for a look distinct from
// room-a's dining-table feel. A bandit (the first aggressive archetype —
// src/assets/npcs/bandit.ts) now guards the room too, on the x=1.5 spine
// like room-a's villager, clear of the barrels (x=-2.3) and the shrine
// (z<=-16.9) — a player walking in through the door is within its 6m aggro
// range almost immediately, which is the intended "surprise encounter"
// feel for the room's first hostile.
//
// Room-b (great_hall, rotation 180, originCell {x:-1,z:-6}) — working out
// its bounds the same way as room-a's, but through the 180-degree rotation:
// `rotateOnce` (../occupancy.ts) turns a face's local label into the
// opposite world-axis label on each 90-degree step, so two steps (180)
// leaves every face's *sign* flipped from its unrotated placement — the
// tile's local "south" door (the middle segment of the 3-wide face) ends up
// on the instance's world +z side instead of -z. Concretely: originCell
// {x:-1,z:-6} places the same 3x3 footprint at world cell x in [-1,1], z in
// [-6,-4], i.e. world meters x in [-3,6] (identical to room-a) and z in
// [-18,-9], with interior clear space roughly [-2.85,5.85] x [-17.85,-9.15].
// The door lands on the instance's *max*-z face (world z=-9, x in [0,3]) —
// the edge nearer the corridor, which itself runs south from room-a's door
// at world z=0 down to world z=-9 — so the door swings into the room toward
// -z, same as the corridor-facing doors elsewhere.
//
// Room-b has no hardcoded occupants beyond what's here, so the only things
// to stay clear of are the door's swing arc (near x in [0,3], z in
// [~-11,-9]) and the walls themselves.

const shrineZ = -17.8; // banners flush against the south wall's interior face (~-17.85)
const shrineBanner = { primaryColor: 0x1f4a3a, accentColor: 0xc9a227 }; // green/gold, a different heraldry than room-a's red/gold

const roomB: RoomContent = {
  tiles: [
    {
      id: "room-b",
      tileTypeId: "great_hall",
      originCell: { x: -1, z: -6 },
      rotation: 180,
      sectorId: "room-b",
    },
  ],
  // Room-b's one door (world z=-9, x in [0,3] — see the header comment) sits
  // on cell (0,-4)'s posZ face: the door is authored on this instance's
  // local "south" face, which the 180-degree rotation maps to the world
  // +z side, and cellZ=-4 is this footprint's max-z (north-most) row, the
  // one bordering the corridor. Locked, so the bandit encounter isn't the
  // very first thing behind room-a's door — its key sits in the
  // side-chamber (see rooms/side-chamber.ts), rewarding the detour off the
  // main path with something more than the lantern alone.
  lockedDoors: [{ x: 0, z: -4, side: "posZ", requiredItemTypeId: "key" }],
  props: [
    { id: "banner", x: 0.4, z: shrineZ, params: shrineBanner },
    { id: "banner", x: 2.6, z: shrineZ, params: shrineBanner },
    { id: "candelabra", x: 1.5, z: -16.9 },
    { id: "barrel", x: -2.3, z: -12.0 },
    { id: "barrel", x: -2.3, z: -13.2 },
  ],
  // Carries a gem (issue: lootable corpses) -- killing the bandit guarding
  // this room drops it, giving the encounter a reward beyond just clearing
  // the way through.
  npcs: [{ id: "bandit", x: 1.5, z: -13, contents: ["gem"] }],
};

export default roomB;
