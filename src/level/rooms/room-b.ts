import type { RoomContent } from "../placementTypes";

// Room-b's content (issue #70): a "shrine" grouping — two banners flanking a
// candelabra — plus a couple of storage barrels, for a look distinct from
// room-a's dining-table feel.
//
// Room-b (great_hall_branch, rotation 180, originCell {x:-1,z:-6}) — working
// out its bounds the same way as room-a's, but through the 180-degree
// rotation: `rotateOnce` (../occupancy.ts) turns a face's local label into
// the opposite world-axis label on each 90-degree step, so two steps (180)
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
// (Cellar wing task) The bandit that used to guard this room has moved
// downstairs — see `rooms/cellar.ts` — leaving this a quiet room again (the
// "not every room needs a spawn" pacing pillar). Its tile type changed from
// plain `great_hall` to `great_hall_branch` (see that type's own doc
// comment) specifically to open a second connection: local west's middle
// segment, which 180 degrees rotates to this instance's world **east** side
// (see the header comment above on how 180 flips east/west) — following
// the exact same "(x,z)->(w-1-x,d-1-z)" cell mapping as the door above, that
// opening lands on world cell (1,-5), i.e. world meters x=6 (this room's own
// east wall), z in [-15,-12] — the middle third of the east wall, clear of
// the shrine (z<=-16.9) and barrels (x=-2.3, on the opposite wall). A short
// staircase down to the cellar continues east from there (`rooms/cellar.ts`).
//
// The warning poster below sits just north of that new opening, on the same
// east wall, angled to be readable on the way in from the corridor before a
// player would even reach the stairs down — the same "foreshadow before you
// get there" narrative device `rooms/side-chamber.ts`'s journal scroll uses
// for this room's own (now-relocated) bandit, just as a fixed in-place sign
// rather than a carried scroll (see docs/LEVEL_DESIGN.md's "how to add a
// readable" section on picking a fixture vs. an item for this).

const shrineZ = -17.8; // banners flush against the south wall's interior face (~-17.85)
const shrineBanner = { primaryColor: 0x1f4a3a, accentColor: 0xc9a227 }; // green/gold, a different heraldry than room-a's red/gold

const roomB: RoomContent = {
  tiles: [
    {
      id: "room-b",
      tileTypeId: "great_hall_branch",
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
  // main path with something more than the lantern alone. The bandit itself
  // has since moved to the cellar (see above), but the locked door/key
  // pairing is left as-is -- it's still a meaningful gate on the shrine
  // room and the new stairs down beyond it.
  lockedDoors: [{ x: 0, z: -4, side: "posZ", requiredItemTypeId: "key" }],
  props: [
    { id: "banner", x: 0.4, z: shrineZ, params: shrineBanner },
    { id: "banner", x: 2.6, z: shrineZ, params: shrineBanner },
    { id: "candelabra", x: 1.5, z: -16.9 },
    { id: "barrel", x: -2.3, z: -12.0 },
    // Holds a coin pile (commodity/stackable inventory) -- demonstrates the
    // `ContentsEntry` {id, count} shape (as opposed to the bare-string form
    // room-a's gem-holding barrel uses) and gives the container panel's
    // quantity picker something to exercise on the "take" side.
    { id: "barrel", x: -2.3, z: -13.2, contents: [{ id: "coin", count: 15 }] },
  ],
  readables: [
    {
      id: "poster",
      x: 5.7,
      z: -11.0,
      rotation: -Math.PI / 2, // mounted on the east wall, facing west into the room
      title: "Warning",
      pages: [
        "The stair beyond this wall was sealed for a reason none of us remember anymore.\n\nWhatever is down there, it hasn't come up. Leave it that way.",
      ],
    },
  ],
};

export default roomB;
