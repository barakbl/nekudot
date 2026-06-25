import { describe, it, expect, vi } from "vitest";
import { createOpacityController } from "../src/app/opacity-controller";

// A tiny in-memory Store stand-in (only get/set are used by the controller).
function fakeStore(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T>(k: string): T | undefined {
      return data.get(k) as T | undefined;
    },
    set<T>(k: string, v: T): void {
      data.set(k, v);
    },
  };
}

describe("opacity controller", () => {
  it("set() writes the renderer alpha and the store together", () => {
    const setGlobalAlpha = vi.fn();
    const store = fakeStore();
    const opacity = createOpacityController({
      layerManager: { setGlobalAlpha },
      store,
      defaultAlpha: 1,
    });

    opacity.set(0.3);

    expect(setGlobalAlpha).toHaveBeenCalledWith(0.3);
    expect(store.get("app.opacity")).toBe(0.3);
  });

  it("get() returns the stored value, or the default when unset", () => {
    const store = fakeStore();
    const opacity = createOpacityController({
      layerManager: { setGlobalAlpha: vi.fn() },
      store,
      defaultAlpha: 0.7,
    });

    expect(opacity.get()).toBe(0.7); // unset -> default
    opacity.set(0.42);
    expect(opacity.get()).toBe(0.42);
  });

  it("isSet() reflects whether a live opacity has been persisted", () => {
    const store = fakeStore();
    const opacity = createOpacityController({
      layerManager: { setGlobalAlpha: vi.fn() },
      store,
      defaultAlpha: 1,
    });

    expect(opacity.isSet()).toBe(false);
    opacity.set(0.5);
    expect(opacity.isSet()).toBe(true);
  });

  it("every set() keeps the renderer and the store in lockstep (no drift)", () => {
    const setGlobalAlpha = vi.fn();
    const store = fakeStore();
    const opacity = createOpacityController({
      layerManager: { setGlobalAlpha },
      store,
      defaultAlpha: 1,
    });

    for (const a of [0.1, 0.9, 0.5]) {
      opacity.set(a);
      expect(setGlobalAlpha).toHaveBeenLastCalledWith(a);
      expect(store.get("app.opacity")).toBe(a);
    }
    expect(setGlobalAlpha).toHaveBeenCalledTimes(3);
  });
});
