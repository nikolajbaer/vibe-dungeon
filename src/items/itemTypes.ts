// Item-type definitions (issue #39): a small static registry, data-driven
// like src/level/tiles.ts's TILE_TYPES — this module only defines what an
// item *is* (name, icon, equip slot); which items exist in the world and
// where is hardcoded placement in game.ts, same pattern as the NPC spawn.

/** The only equip-slot *kind* an item type can declare today — "hand" means
 * it can go into either `hand-left` or `hand-right` (see `Carried` in
 * ecs/components.ts); `null` means the item has no equip slot at all
 * (inventory/curio only, e.g. the gem). */
export type EquipSlotKind = "hand" | null;

export interface ItemType {
  id: string;
  name: string;
  /** Unicode glyph used as this item's icon everywhere in the UI (paper
   * doll, inventory list) — no image/texture assets for items (issue #39). */
  icon: string;
  slot: EquipSlotKind;
}

export const SWORD: ItemType = { id: "sword", name: "Sword", icon: "🗡️", slot: "hand" };
export const GEM: ItemType = { id: "gem", name: "Gem", icon: "💎", slot: null };

export const ITEM_TYPES: Record<string, ItemType> = {
  [SWORD.id]: SWORD,
  [GEM.id]: GEM,
};
