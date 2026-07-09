import { describe, expect, it } from "vitest";
import { BRUSH_DEFS, type BrushContext } from "../src/brushes/registry";
import { applySettingValue } from "../src/base";
import { createBareHost } from "../src/paint-host";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder } from "../src/neighbor-finder";
import type { Store } from "../src/store/base";

// Bug: a Wisp drawn with a Gradient (or any non-default Colour source) replayed as
// solid Primary in the process video, because the brush's OWN dials weren't in the
// recorded StrokeContext (only the connection's were). strokeSnapshot now carries
// brushSettings and hydrateBrush (applyBrushSettings) restores them.

const noop = () => new Proxy({}, { get: () => () => {} }) as unknown as IRenderer;
const store: Store = {
  get: () => undefined,
  set: () => {},
  remove: () => {},
} as unknown as Store;

function makeBrush(name: string) {
  const finder = {
    addPixel: (x: number, y: number) => ({ id: 0, x, y }),
    findNeighbors: () => [],
    allPixels: () => [],
    pixelCount: () => 0,
    livePixelCount: () => 0,
    clear: () => {},
  } as unknown as NeighborFinder;
  const def = BRUSH_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`no brush ${name}`);
  return def.create({
    host: createBareHost(noop(), finder),
    store,
    getInvisibleOverlay: () => noop(),
  } as BrushContext);
}

// Set a brush-own setting through its public descriptor (the same path the panel
// uses), so the test drives the real onChange binding.
function setSetting(brush: ReturnType<typeof makeBrush>, key: string, value: unknown): void {
  const s = brush.getSettings().find((x) => x.key === key);
  if (!s) throw new Error(`no setting ${key}`);
  applySettingValue(s, value);
}

describe("brush-own settings survive record -> replay", () => {
  it("Wisp Colour source roundtrips (was: replayed as Primary)", () => {
    const drawn = makeBrush("Wisp");
    setSetting(drawn, "wispColorSource", "gradient");
    setSetting(drawn, "wispColorSpread", 70);

    const snap = drawn.strokeSnapshot();
    expect(snap.brushSettings.wispColorSource).toBe("gradient");
    expect(snap.brushSettings.wispColorSpread).toBe(70);

    // A fresh Wisp (as replay makes) defaults to "main" (Primary) until restored.
    const replayed = makeBrush("Wisp");
    expect(replayed.flatBrushSettings().wispColorSource).toBe("main");
    replayed.applyBrushSettings(snap.brushSettings);
    expect(replayed.flatBrushSettings().wispColorSource).toBe("gradient");
    expect(replayed.flatBrushSettings().wispColorSpread).toBe(70);
  });

  it("ignores unknown / missing keys and leaves defaults intact", () => {
    const replayed = makeBrush("Wisp");
    const before = replayed.flatBrushSettings().wispDensity;
    replayed.applyBrushSettings({ bogusKey: "x" });
    expect(replayed.flatBrushSettings().wispDensity).toBe(before); // untouched
  });

  it("captures nothing connection-specific in brushSettings (those ride in settings/style)", () => {
    // A non-connecting brush's snapshot still has a brushSettings object.
    const wisp = makeBrush("Wisp");
    const snap = wisp.strokeSnapshot();
    expect(typeof snap.brushSettings).toBe("object");
    expect(Object.keys(snap.brushSettings)).toContain("wispColorSource");
  });
});
