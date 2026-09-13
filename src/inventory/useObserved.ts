import { useEffect, useState } from "preact/hooks";
import { autorun } from "mobx";

/**
 * Small Preact/MobX binding, identical in shape to `src/hud/useObserved.ts`
 * — duplicated here rather than imported so `src/inventory/` stays as
 * self-contained as `src/hud/` is (see README Design Notes, "Inventory
 * pattern"). Re-renders the calling component whenever any observable read
 * inside `compute` changes.
 */
export function useObserved<T>(compute: () => T): T {
  const [value, setValue] = useState(compute);
  useEffect(() => autorun(() => setValue(compute())), []);
  return value;
}
