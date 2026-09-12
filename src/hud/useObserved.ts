import { useEffect, useState } from "preact/hooks";
import { autorun } from "mobx";

/**
 * Small Preact/MobX binding: re-renders the calling component whenever any
 * observable read inside `compute` changes. Deliberately hand-rolled instead
 * of pulling in `mobx-react-lite` (which assumes a React runtime and would
 * need `preact/compat` aliasing to work here) — this is the one primitive
 * every HUD component needs, so keeping it tiny and dependency-free is
 * simpler than wiring a compat shim for one hook's worth of behavior.
 */
export function useObserved<T>(compute: () => T): T {
  const [value, setValue] = useState(compute);
  useEffect(() => autorun(() => setValue(compute())), []);
  return value;
}
