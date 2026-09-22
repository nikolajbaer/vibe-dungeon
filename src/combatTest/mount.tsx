import { render } from "preact";
import { OpponentConfigurator, type OpponentConfig } from "./OpponentConfigurator";

export function mountOpponentConfigurator(
  container: HTMLElement,
  onSpawn: (config: OpponentConfig) => void,
  onOpenChange: (open: boolean) => void,
): void {
  const el = document.createElement("div");
  el.id = "opponent-config-overlay";
  container.appendChild(el);
  render(<OpponentConfigurator onSpawn={onSpawn} onOpenChange={onOpenChange} />, el);
}
