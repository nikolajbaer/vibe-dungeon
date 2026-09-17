import { useEffect, useState } from "preact/hooks";
import { autorun } from "mobx";

/**
 * Small Preact/MobX binding, identical in shape to `src/notice/useObserved.ts`
 * — duplicated here rather than imported so `src/container/` stays as
 * self-contained as `src/hud/`/`src/dialogue/`/`src/inventory/`/`src/notice/`
 * are. Re-renders the calling component whenever any observable read inside
 * `compute` changes.
 */
export function useObserved<T>(compute: () => T): T {
  const [value, setValue] = useState(compute);
  useEffect(() => autorun(() => setValue(compute())), []);
  return value;
}
