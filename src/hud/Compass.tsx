import { hudStore } from "./store";
import { useObserved } from "./useObserved";
import { COMPASS_CARDINALS, compassLabelOffset } from "./compassMath";

const RADIUS_PX = 22;

/**
 * Top-right orientation compass, stacked just below the equipment bar
 * (`EquipmentBar.tsx`, same corner) — lets the player (and level design/
 * writing describing rooms and directions in terms of N/S/E/W) read their
 * current facing at a glance.
 *
 * Works like a real handheld compass card, not a top-down map: the N/E/S/W
 * labels orbit the dial (via `compassLabelOffset`, `hudStore.headingDeg`
 * driving the rotation every frame from `hudSync.ts`), while a single fixed
 * notch at the top of the housing marks "forward" — whichever label is
 * currently under that notch is the direction the player is facing. Labels
 * are positioned by absolute pixel offset rather than a CSS `rotate()` on
 * the whole dial specifically so the glyphs themselves stay upright as they
 * orbit, rather than tumbling with the dial.
 */
export function Compass() {
  const { headingDeg } = useObserved(() => ({ headingDeg: hudStore.headingDeg }));

  return (
    <div class="hud-compass" data-testid="hud-compass">
      <div class="hud-compass-pointer" />
      <div class="hud-compass-dial">
        {COMPASS_CARDINALS.map(({ label, bearing }) => {
          const { x, y } = compassLabelOffset(bearing, headingDeg, RADIUS_PX);
          return (
            <span
              key={label}
              class={label === "N" ? "hud-compass-label hud-compass-label-north" : "hud-compass-label"}
              style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` }}
              data-testid={`hud-compass-label-${label}`}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
