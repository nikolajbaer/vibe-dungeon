import { useEffect, useState } from "preact/hooks";
import { autorun } from "mobx";

/**
 * Small Preact/MobX binding, identical in shape to `src/hud/useObserved.ts`
 * — duplicated here rather than imported so `src/dialogue/` stays as
 * self-contained as `src/hud/`/`src/inventory/` are. Re-renders the calling
 * component whenever any observable read inside `compute` changes.
 */
export function useObserved<T>(compute: () => T): T {
  const [value, setValue] = useState(compute);
  useEffect(() => autorun(() => setValue(compute())), []);
  return value;
}
