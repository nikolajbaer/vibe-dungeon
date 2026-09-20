import * as THREE from "three";
import type { FurnitureAssetDef } from "../types";
import { woodMaterial } from "./table";

// Wall-backed bookshelf (dormitory furnishing) — a tall wood frame with a
// few shelves and a scatter of flat, variously-colored "book" boxes on each
// one. Purely decorative, like table.ts/bed.ts: a static floor obstacle, no
// container/interact behavior (there's no book-reading mechanic here, only
// `Readable` fixtures/scrolls — a bookshelf is set dressing, not a new
// readable). Builds facing local +z (its open shelf face), meant to be
// placed flush against a wall with `rotation` pointing that face into the
// room, the same convention banner.ts/poster.ts use for wall-mounted decor.

const SHELF_WIDTH = 0.9;
const SHELF_DEPTH = 0.28;
const SHELF_HEIGHT = 1.7;
const SHELF_BOARD_THICKNESS = 0.03;
const SHELF_COUNT = 4; // including the bottom and top boards

let bookColors = [0x7a1f1f, 0x1f4a3a, 0x2b3a6b, 0x6b4423, 0x8a6d1a, 0x4a2b5c];

/** Cached per-color book materials, reused across every bookshelf instance
 * (there's only ever one bookshelf mesh built per placement, but the flat
 * colors themselves are cheap to share like every other material factory
 * here). */
const bookMats = new Map<number, THREE.MeshStandardMaterial>();
function bookMaterial(color: number): THREE.MeshStandardMaterial {
  let mat = bookMats.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
    bookMats.set(color, mat);
  }
  return mat;
}

/** A tall frame with evenly-spaced shelf boards, each holding a row of thin
 * "book" boxes of varying width/height/color -- enough visual noise to read
 * as a shelf of books at a glance without modeling individual spines. */
function createBookshelfMesh(): THREE.Group {
  const group = new THREE.Group();
  group.userData.surfaceMaterial = "wood";
  const wood = woodMaterial();

  const sideGeo = new THREE.BoxGeometry(SHELF_BOARD_THICKNESS, SHELF_HEIGHT, SHELF_DEPTH);
  for (const sign of [-1, 1] as const) {
    const side = new THREE.Mesh(sideGeo, wood);
    side.position.set(sign * (SHELF_WIDTH / 2 - SHELF_BOARD_THICKNESS / 2), SHELF_HEIGHT / 2, 0);
    group.add(side);
  }

  const back = new THREE.Mesh(new THREE.BoxGeometry(SHELF_WIDTH, SHELF_HEIGHT, SHELF_BOARD_THICKNESS), wood);
  back.position.set(0, SHELF_HEIGHT / 2, -SHELF_DEPTH / 2 + SHELF_BOARD_THICKNESS / 2);
  group.add(back);

  const shelfGeo = new THREE.BoxGeometry(SHELF_WIDTH, SHELF_BOARD_THICKNESS, SHELF_DEPTH);
  const gap = SHELF_HEIGHT / (SHELF_COUNT - 1);
  let colorIndex = 0;
  for (let i = 0; i < SHELF_COUNT; i++) {
    const shelfY = i * gap;
    const shelf = new THREE.Mesh(shelfGeo, wood);
    shelf.position.set(0, shelfY, 0);
    group.add(shelf);

    if (i === SHELF_COUNT - 1) continue; // no books balanced on the very top board

    // Fill the row above this shelf with a handful of thin book boxes of
    // varying width, packed left-to-right until the row's out of room.
    let cursor = -SHELF_WIDTH / 2 + SHELF_BOARD_THICKNESS + 0.04;
    const rowTop = shelfY + gap * 0.75;
    while (cursor < SHELF_WIDTH / 2 - SHELF_BOARD_THICKNESS - 0.04) {
      const bookWidth = 0.05 + (colorIndex % 3) * 0.015;
      const bookHeight = rowTop - shelfY - 0.02 - (colorIndex % 2) * 0.08;
      if (cursor + bookWidth > SHELF_WIDTH / 2 - SHELF_BOARD_THICKNESS - 0.04) break;
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(bookWidth, bookHeight, SHELF_DEPTH - 0.06),
        bookMaterial(bookColors[colorIndex % bookColors.length]),
      );
      book.position.set(cursor + bookWidth / 2, shelfY + SHELF_BOARD_THICKNESS / 2 + bookHeight / 2, 0);
      group.add(book);
      cursor += bookWidth + 0.01;
      colorIndex++;
    }
  }

  return group;
}

const bookshelf: FurnitureAssetDef = {
  id: "bookshelf",
  createMesh: () => createBookshelfMesh(),
  footprint: { hx: SHELF_WIDTH / 2, hz: SHELF_DEPTH / 2, hy: SHELF_HEIGHT / 2 },
};

export default bookshelf;
