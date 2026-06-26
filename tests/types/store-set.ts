import type { LocalStorageStore } from "../../src/store/local_storage";

// Compile-time lock for the B8 invariant: Store.set must reject an undefined (or
// possibly-undefined) value, so a bug can never persist the literal string
// "undefined" to localStorage (use remove(key) to clear instead). This file is
// type-checked by `tsc` (see the tsconfig "include") but never executed - it
// holds no runtime tests and isn't matched by the vitest glob. If the guard ever
// regresses, the @ts-expect-error directives stop erroring and tsc fails.
export function _storeSetRejectsUndefined(
  store: LocalStorageStore,
  maybe: string | undefined,
): void {
  // @ts-expect-error - undefined is not a valid value; use store.remove(key).
  store.set("k", undefined);
  // @ts-expect-error - a possibly-undefined value must be narrowed first.
  store.set("k", maybe);

  // A defined value is fine, and null round-trips through JSON so it's allowed.
  store.set("k", "ok");
  store.set("k", null);
}
