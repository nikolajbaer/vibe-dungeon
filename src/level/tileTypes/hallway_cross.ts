import type { TileType } from "../tiles";

/**
 * A 4-way crossroads variant of `hallway` (issue #86, itself a second
 * retrofit of the T-junction `hallway_junction` added by issue #71): the
 * same 3m x 9m footprint and the same north/south openings (so it's a
 * strict superset of both `hallway`'s and the old `hallway_junction`'s
 * connections — anything already plugged into either end, or into the
 * junction's east branch, still fits), plus a matching opening on the
 * middle segment of its **west** face too. Used to retrofit the level's one
 * T-junction into a real crossroads without moving it — swap the instance's
 * `tileTypeId` from `"hallway_junction"` to `"hallway_cross"` and leave
 * `originCell`/`rotation` untouched (see docs/LEVEL_DESIGN.md's "current
 * limitation" and "worked example" sections for why a face-map change, not
 * a new instance, is what branching off an existing hallway actually
 * requires — this is the exact same technique applied a second time, one
 * side further).
 *
 * The old `hallway_junction` type is retired outright rather than kept
 * alongside this one: it had exactly one instance (`corridor`), and once
 * that instance needs a fourth opening, a strictly-narrower unused type
 * left lying around under `tileTypes/` would just be dead code with a
 * confusing name (it would still literally say "junction" once it's
 * actually a crossroads) — better to evolve it in place, the same way this
 * doc's own "worked example" describes evolving a plain `hallway` into a
 * junction to begin with.
 */
const hallwayCross: TileType = {
  id: "hallway_cross",
  w: 1,
  d: 3,
  h: 1,
  faces: {
    north: ["opening"],
    south: ["opening"],
    east: ["wall", "opening", "wall"],
    west: ["wall", "opening", "wall"],
  },
};

export default hallwayCross;
