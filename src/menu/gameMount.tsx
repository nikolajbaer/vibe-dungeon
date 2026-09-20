import { render } from "preact";
import { InGameMenu, type InGameMenuProps } from "./InGameMenu";

export function mountInGameMenu(container: HTMLElement, props: InGameMenuProps): void {
  const el = document.createElement("div");
  el.id = "game-menu-overlay";
  container.appendChild(el);
  render(<InGameMenu {...props} />, el);
}
