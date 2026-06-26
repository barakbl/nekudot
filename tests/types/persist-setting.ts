import type { BrushBase, SettingValue } from "../../src/base";

// Compile-time lock (parity with tests/types/store-set.ts): a brush setting's
// value - and therefore persistSetting's value parameter - must never be
// undefined, so a setting can't be laundered through `unknown` and persisted as
// the literal string "undefined". This file is type-checked by tsc (see the
// tsconfig "include") but never executed.
//
// If the contract regresses (SettingValue or the persistSetting parameter starts
// admitting undefined), _AssertDefined resolves to `never` and the `= true`
// assignments below fail the typecheck gate.
type _AssertDefined<T> = [undefined] extends [T] ? never : true;

export const _settingValueIsDefined: _AssertDefined<SettingValue> = true;
export const _persistSettingValueIsDefined: _AssertDefined<
  Parameters<BrushBase["persistSetting"]>[1]
> = true;
