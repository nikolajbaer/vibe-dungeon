import type { RoomContent } from "../placementTypes";

// The castle great hall wing (great-hall wing task): a proper feast hall
// branching off room-a's own west wall, plus the Maester's study branching
// off *that* — the level's first real castle-interior wing, distinct in
// footprint, height, and feel from every corridor-and-great_hall run built
// so far (design pillar #2/#3: geographically distinct, gives the map
// actual shape via a genuine branch off an already-placed room).
//
// ## World layout (cell coordinates; multiply by UNIT=3 for world meters —
// see docs/LEVEL_DESIGN.md's "How to add a new tile instance")
//
// - `castle-hall` (`castle_hall`, unrotated): originCell {x:-5,z:-1}, 12m x
//   18m (4x6 cells), 9m ceiling. Its east door (local z index 2, world cell
//   (-2,1)) borders `room-a`'s own new west opening (see `rooms/room-a.ts`)
//   at world x=-3, z in [3,6] — the two share that exact boundary directly,
//   no connecting corridor segment, the same "hub opens straight into an
//   adjacent room" shape `training_hub.ts` already uses for its own
//   spokes. Its west door (local z index 4, world cell (-5,3)) borders the
//   study below at world x=-15, z in [9,12]. South (throne) and north
//   (presumed main entrance) stay solid walls on both sides — see
//   `tileTypes/castle_hall.ts`'s own doc comment for why the entrance can
//   never be a real openable door, and this file's own header comment above
//   for why the entrance is on the north wall specifically, not the south.
// - `maester-study` (`study`, unrotated): originCell {x:-7,z:2}, 6m x 9m
//   (2x3 cells), 3m ceiling — half the hall's footprint/height, the same
//   "distinct kind of space" scaling `side_chamber` uses relative to
//   `great_hall`. Its one door (local z index 1, world cell (-6,3)) is the
//   other side of the hall's west opening above.
//
// Both new instances sit entirely west of room-a/the existing corridor
// complex (world x <= -3), open ground before this task — and clear of the
// training wing (east of room-a, x >= 18), the same "run away from the
// existing map, not through it" approach `rooms/stairwell.ts` took for its
// own wing.
//
// One adjacency *isn't* clear, though, and it's exactly why the entrance and
// throne sit where they do: the hall's south wall (z=-3) runs directly along
// the stairwell wing's own west-corridor/stair-lower cells (z=-2, x in
// [-6,-1]) — the corridor that climbs to the dormitory one floor up. That
// wall is solid either way (no door was ever possible there — see
// `tileTypes/castle_hall.ts`), but it means "south" is not open ground the
// way "north" (z=15, genuinely past the map's own edge in this direction —
// nothing else is placed anywhere near it) is. The throne — architecturally
// just a dead end either way — backs onto the south wall, and the
// (decorative, never-opening) main entrance sits on the north wall instead,
// so the one wall a player might actually read as "this leads outside" isn't
// the one secretly backed by an interior stairwell down to the dormitory.

const hallCenterX = -9; // castle-hall's own x center: (-15 + -3) / 2
const hallHeraldry = { primaryColor: 0x1f2a5c, accentColor: 0xc9a227 }; // royal blue/gold, distinct from every other room's heraldry

const castleHallWing: RoomContent = {
  tiles: [
    {
      id: "castle-hall",
      tileTypeId: "castle_hall",
      originCell: { x: -5, z: -1 },
      rotation: 0,
      sectorId: "castle-hall",
    },
    {
      id: "maester-study",
      tileTypeId: "study",
      originCell: { x: -7, z: 2 },
      rotation: 0,
      sectorId: "maester-study",
    },
  ],
  props: [
    // Presumed main entrance, north wall (world z~14.85) — decorative only,
    // never a real door (see tileTypes/castle_hall.ts). Flanked by the two
    // watching guards below. North, not south, specifically because north is
    // genuinely open ground beyond the wall (the map's own edge) where south
    // instead backs onto the stairwell wing's own corridor -- see this
    // file's header comment. Rotation pi so the doors (which face local +z
    // by default) face south, into the room, from this north wall.
    { id: "grand-doors", x: hallCenterX, z: 14.85, rotation: Math.PI },

    // Long feast tables down the center of the hall, clear of both the
    // entrance (guards need room to stand) and the throne dais.
    { id: "table", x: hallCenterX, z: 3 },
    { id: "feast", x: hallCenterX, z: 3, y: 0.75 },
    { id: "table", x: hallCenterX, z: 6.5 },
    { id: "chair", x: hallCenterX, z: 6.5 - 0.85, rotation: 0 },
    { id: "chair", x: hallCenterX, z: 6.5 + 0.85, rotation: Math.PI },
    { id: "table", x: hallCenterX, z: 10 },
    { id: "feast", x: hallCenterX, z: 10, y: 0.75, rotation: Math.PI },

    // Columns flanking the tables in two rows, well clear of the side
    // doors (east door z in [3,6], west door z in [9,12]) since both
    // rows sit 3.5m in from either wall.
    { id: "column", x: hallCenterX - 2.5, z: 1, params: { height: 8.5 } },
    { id: "column", x: hallCenterX + 2.5, z: 1, params: { height: 8.5 } },
    { id: "column", x: hallCenterX - 2.5, z: 6.5, params: { height: 8.5 } },
    { id: "column", x: hallCenterX + 2.5, z: 6.5, params: { height: 8.5 } },
    { id: "column", x: hallCenterX - 2.5, z: 12, params: { height: 8.5 } },
    { id: "column", x: hallCenterX + 2.5, z: 12, params: { height: 8.5 } },

    // Stained-glass windows on both long walls, clear of the side doors and
    // the entrance/throne ends.
    { id: "stained-glass-window", x: -3.15, z: 1, rotation: -Math.PI / 2 },
    { id: "stained-glass-window", x: -3.15, z: 13, rotation: -Math.PI / 2 },
    { id: "stained-glass-window", x: -14.85, z: 1, rotation: Math.PI / 2 },
    { id: "stained-glass-window", x: -14.85, z: 13, rotation: Math.PI / 2 },

    // A grander hearth than room-a's (see fireplace.ts's own `scale` param),
    // east wall, clear of both the room-a door and the north window.
    // At 1.6x scale the hearth is .64m deep. Set its back at the hall's
    // inner wall face (-3.15), so it cannot emerge in room-a next door.
    { id: "fireplace", x: -3.79, z: 7.5, rotation: -Math.PI / 2, params: { scale: 1.6 } },

    // The throne, far (south) wall from the entrance, flanked by the
    // hall's own royal-blue-and-gold heraldry. Rotation 0 (the default,
    // facing local +z) so it faces north, up the hall toward the entrance.
    { id: "throne", x: hallCenterX, z: -1.7, rotation: 0 },
    { id: "banner", x: hallCenterX - 1.5, z: -2.8, rotation: 0, params: hallHeraldry },
    { id: "banner", x: hallCenterX + 1.5, z: -2.8, rotation: 0, params: hallHeraldry },

    // Study: desk against the west wall (Maester stands just east of it,
    // see npcs below), flanking bookshelves on the solid north/south walls,
    // a candelabra by the door, and its own smaller windows (per the brief)
    // on the west wall, clear of the desk.
    { id: "desk", x: -20.7, z: 10.5, rotation: Math.PI / 2 },
    { id: "bookshelf", x: -17.5, z: 14.8, rotation: Math.PI },
    { id: "bookshelf", x: -17.5, z: 6.2, rotation: 0 },
    { id: "candelabra", x: -15.3, z: 6.3 },
    { id: "stained-glass-window", x: -20.85, z: 7, rotation: Math.PI / 2, params: { width: 0.9 } },
    { id: "stained-glass-window", x: -20.85, z: 13.5, rotation: Math.PI / 2, params: { width: 0.9 } },
  ],
  npcs: [
    // Two guards watching the (never-opening) main entrance, flanking the
    // grand doors -- see assets/npcs/castle-guard.ts for why this is its
    // own archetype rather than reusing guard.ts's training-wing-specific
    // dialogue.
    { id: "castle-guard", x: hallCenterX - 2, z: 13.5 },
    { id: "castle-guard", x: hallCenterX + 2, z: 13.5 },
    // The Maester, at his desk in the study -- a background-story fixture
    // for a future task (see assets/npcs/maester.ts's own doc comment).
    { id: "maester", x: -19.5, z: 10.5 },
  ],
};

export default castleHallWing;
