// Ticket B9 ("GIF == export"): the clip recorder composites every frame on its
// own raw, downscaled, opaque ctx (kept separate from export for perf), so its
// layer order / per-layer opacity / background handling only mirrors the canonical
// export path (flattenLayers) by convention. This test composites a small fixture
// BOTH ways on a shared software rasterizer and asserts the frames are pixel-equal,
// so any future drift in order/opacity/bg fails CI. The two deliberate recorder
// behaviours - downscaling above MAX_DIM and substituting white for a transparent
// paper - are accounted for: the fixture stays below MAX_DIM (scale == 1, matching
// dims) and the transparent case is checked against an explicit white export.
import { describe, it, expect, vi } from "vitest";

import { CanvasRenderer } from "../src/renderer";
import { flattenLayers } from "../src/export";
import { ClipRecorder, CAPTURE_FPS } from "../src/clip/recorder";
import type { LayerManager } from "../src/layered/manager";
import { installDocumentStub, newManager } from "./_layer-manager-harness";
import { makeSoftCanvas, type Pixels } from "./_software-canvas";

// Layer canvases (and the recorder's own capture canvas) must rasterize for real,
// so back document.createElement("canvas") with the software canvas.
installDocumentStub(() => makeSoftCanvas() as unknown as HTMLCanvasElement);
// The recorder reads window.matchMedia (mobile vs desktop duration) and
// window.setInterval (capture timer); node has neither.
if (typeof (globalThis as { window?: unknown }).window === "undefined")
  (globalThis as { window?: unknown }).window = globalThis;
if (typeof (globalThis as { matchMedia?: unknown }).matchMedia !== "function")
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });

const W = 40;
const H = 30; // < MAX_DIM (640) so the recorder keeps scale 1 -> dims match export

// Three full-canvas solid layers at distinct colours AND distinct (<100)
// opacities: the composited result then depends on order, every layer's opacity,
// and the background, so a parity check constrains all three. Opacity < 100
// everywhere also means a transparent export keeps some alpha < 255.
function buildFixture(): LayerManager {
  const m = newManager({ width: W, height: H });
  m.addLayer(); // 3 layers (the seed config has 2)
  const colors = ["#d21f1f", "#1fd21f", "#1f1fd2"];
  const opacity = [80, 60, 30];
  for (const layer of m.orderedLayers()) {
    layer.renderer.fillBackground(colors[layer.config.index]);
    m.setOpacity(layer.config.index, opacity[layer.config.index]);
  }
  return m;
}

// The canonical path: flatten onto a software canvas we can read back.
function exportPixels(m: LayerManager, bg: string): Pixels {
  const flat = makeSoftCanvas(W, H);
  const ctx = flat.getContext("2d");
  m.createMatchingRenderer = () =>
    new CanvasRenderer(ctx as unknown as CanvasRenderingContext2D, { dpr: 1 });
  flattenLayers(m, { backgroundColor: bg });
  return ctx.getImageData(0, 0, W, H);
}

// The clip path: drive the real ClipRecorder and read its first captured frame.
function recorderFrame(m: LayerManager, bg: string): Pixels {
  vi.useFakeTimers();
  try {
    const rec = new ClipRecorder(m, () => bg);
    rec.start(); // captures frame 0 immediately
    vi.advanceTimersByTime(Math.ceil(1000 / CAPTURE_FPS) + 2); // one more tick -> >= 2 frames
    const clip = rec.stop();
    if (!clip) throw new Error("recorder produced no clip");
    expect({ w: clip.width, h: clip.height }).toEqual({ w: W, h: H });
    return clip.frames[0];
  } finally {
    vi.useRealTimers();
  }
}

// First differing channel (or null), as a readable message for the assertion.
function firstDiff(a: Pixels, b: Pixels): string | null {
  if (a.width !== b.width || a.height !== b.height)
    return `dims ${a.width}x${a.height} vs ${b.width}x${b.height}`;
  for (let p = 0; p < a.data.length; p += 4)
    for (let c = 0; c < 4; c++)
      if (a.data[p + c] !== b.data[p + c]) {
        const px = p / 4;
        const x = px % a.width;
        const y = Math.floor(px / a.width);
        const rgba = (d: Uint8ClampedArray) => `[${d[p]},${d[p + 1]},${d[p + 2]},${d[p + 3]}]`;
        return `(${x},${y}) ch${c}: ${a.data[p + c]} vs ${b.data[p + c]} | A=${rgba(a.data)} B=${rgba(b.data)}`;
      }
  return null;
}

function hasTransparency(img: Pixels): boolean {
  for (let p = 3; p < img.data.length; p += 4) if (img.data[p] < 255) return true;
  return false;
}

describe("clip recorder == export compositing (ticket B9)", () => {
  it("an opaque-background frame is pixel-identical to flattenLayers", () => {
    const m = buildFixture();
    const bg = "#202020";
    expect(firstDiff(recorderFrame(m, bg), exportPixels(m, bg))).toBeNull();
  });

  it("substitutes white for a transparent paper, matching an explicit white export", () => {
    const m = buildFixture();
    // The recorder's transparent->white frame equals an opaque white export...
    expect(firstDiff(recorderFrame(m, "transparent"), exportPixels(m, "#ffffff"))).toBeNull();
    // ...and that substitution is real: export keeps the paper transparent, the
    // GIF frame is always fully opaque.
    expect(hasTransparency(exportPixels(m, "transparent"))).toBe(true);
    expect(hasTransparency(recorderFrame(m, "transparent"))).toBe(false);
  });

  it("the parity check is order-sensitive (reversing layers diverges)", () => {
    const m = buildFixture();
    const forward = recorderFrame(m, "#202020");
    m.reorderByIds(m.all.map((l) => l.config.id).reverse());
    // Same opacities/colours, bottom-to-top order flipped -> the export must now
    // differ from the original recorder frame, proving the test would catch an
    // order regression rather than passing on an order-insensitive fixture.
    expect(firstDiff(forward, exportPixels(m, "#202020"))).not.toBeNull();
  });
});
