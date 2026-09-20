import { itemIconUrl } from "../assets/itemIcons";

interface ItemIconProps {
  itemTypeId: string;
  fallback: string;
  class?: string;
}

/** Shared inventory/container icon presentation. Startup-generated mesh
 * renders are preferred; the authored Unicode icon remains the robust
 * fallback for browsers where a temporary WebGL context cannot be made. */
export function ItemIcon({ itemTypeId, fallback, class: className }: ItemIconProps) {
  const src = itemIconUrl(itemTypeId);
  return src
    ? <img class={`${className ?? ""} inv-item-icon-image`.trim()} src={src} alt="" aria-hidden="true" />
    : <span class={className}>{fallback}</span>;
}
