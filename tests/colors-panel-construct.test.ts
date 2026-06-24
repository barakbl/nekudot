import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll } from "vitest";

// Permissive DOM stub - just enough for the colour popover (and the modules it
// imports) to load + build headlessly. The point of this test is to catch
// *construction-time* errors (e.g. a const used before its initialization, which
// throws a ReferenceError at startup and takes the whole app down) that the other
// unit tests miss because none of them instantiate the panel. The DOM behaviour
// itself isn't asserted here.
function makeEl(): unknown {
  const backing: Record<string, unknown> = {
    style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  };
  return new Proxy(backing, {
    get: (t, p) =>
      p in t ? t[p as string] : typeof p === "string" ? () => undefined : undefined,
    set: (t, p, v) => {
      t[p as string] = v;
      return true;
    },
  });
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: () => makeEl(),
    addEventListener() {},
    removeEventListener() {},
  };
  (globalThis as { window?: unknown }).window = {
    addEventListener() {},
    removeEventListener() {},
  };
  (globalThis as { localStorage?: unknown }).localStorage = {
    store: {} as Record<string, string>,
    getItem(k: string): string | null {
      return this.store[k] ?? null;
    },
    setItem(k: string, v: string): void {
      this.store[k] = v;
    },
  };
});

describe("createPalettePanel construction", () => {
  it("builds without throwing and exposes el/open/close", async () => {
    // Dynamic import so the DOM stub is in place before help.ts (and friends)
    // run their module-level side effects.
    const { createPalettePanel } = await import("../src/colors/panel");
    const p = createPalettePanel();
    expect(p.el).toBeTruthy();
    expect(typeof p.open).toBe("function");
    expect(typeof p.close).toBe("function");
  });
});
