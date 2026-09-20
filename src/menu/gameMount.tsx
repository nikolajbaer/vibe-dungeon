import { render } from "preact";
import { InGameMenu } from "./InGameMenu";

export function mountInGameMenu(container: HTMLElement): void {
  const el = document.createElement("div");
  el.id = "game-menu-overlay";
  container.appendChild(el);
  render(<InGameMenu />, el);
}
