import { describe, it, expect } from "vitest";
import {
  readPenSample,
  penFactor,
  PenSmoother,
  SIZE_FLOOR,
  MOUSE_SAMPLE,
  type PenSample,
} from "../src/pen";
import { createBareHost } from "../src/paint-host";
import { RoundBrush } from "../src/brushes/round";
import { MarkerBrush } from "../src/brushes/marker";
import type { IRenderer, LineStyle } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";

const CHISEL_ANGLE = -Math.PI / 4; // marker's fixed nib angle

// Recording renderer: draw calls are captured, everything else no-ops.
function makeRecorder() {
  const lines: { style?: LineStyle }[] = [];
  const chisels: { angle: number; style?: LineStyle }[] = [];
  const connections: { style?: LineStyle }[] = [];
  const renderer = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (prop === "drawLine")
        return (_a: Pixel, _b: Pixel, style?: LineStyle) =>
          void lines.push({ style });
      if (prop === "drawChisel")
        return (_a: Pixel, _b: Pixel, angle: number, style?: LineStyle) =>
          void chisels.push({ angle, style });
      if (prop === "drawConnection")
        return (_a: Pixel, _b: Pixel, style?: LineStyle) =>
          void connections.push({ style });
      return () => {};
    },
  }) as unknown as IRenderer;
  return { renderer, lines, chisels, connections };
}

function makeFinder(): NeighborFinder {
  const pts: Pixel[] = [];
  let nextId = 0;
  return {
    addPixel(x, y) {
      const p = { id: nextId++, x, y };
      pts.push(p);
      return p;
    },
    findNeighbors(px, radius) {
      return pts.filter(
        (p) => p.id !== px.id && Math.hypot(p.x - px.x, p.y - px.y) <= radius,
      );
    },
    allPixels: () => [...pts],
    pixelCount: () => nextId,
    livePixelCount: () => pts.length,
    clear() {
      pts.length = 0;
    },
  };
}

const pen = (pressure: number, over: Partial<PenSample> = {}): PenSample => ({
  isPen: true,
  pressure,
  tilt: 0,
  azimuth: 0,
  hasTilt: false,
  ...over,
});

describe("readPenSample", () => {
  it("mouse and touch never modulate", () => {
    expect(readPenSample({ pointerType: "mouse", pressure: 0.5 })).toEqual(MOUSE_SAMPLE);
    expect(readPenSample({ pointerType: "touch", pressure: 1 })).toEqual(MOUSE_SAMPLE);
  });

  it("reads and clamps pen pressure", () => {
    expect(readPenSample({ pointerType: "pen", pressure: 0.42 }).pressure).toBeCloseTo(0.42);
    expect(readPenSample({ pointerType: "pen", pressure: 1.5 }).pressure).toBe(1);
    expect(readPenSample({ pointerType: "pen", pressure: 0.42 }).hasTilt).toBe(false);
  });

  it("derives tilt + azimuth from tiltX/tiltY", () => {
    // Leaning 60° toward +x: azimuth 0, tilt 60/90 of the way to flat.
    const s = readPenSample({ pointerType: "pen", pressure: 1, tiltX: 60, tiltY: 0 });
    expect(s.azimuth).toBeCloseTo(0);
    expect(s.tilt).toBeCloseTo(2 / 3, 5);
    expect(s.hasTilt).toBe(true);
    // Leaning toward +y → azimuth π/2.
    const d = readPenSample({ pointerType: "pen", pressure: 1, tiltX: 0, tiltY: 45 });
    expect(d.azimuth).toBeCloseTo(Math.PI / 2);
    expect(d.tilt).toBeCloseTo(0.5, 5);
  });

  it("prefers altitude/azimuth when present; vertical pen has no direction", () => {
    const s = readPenSample({
      pointerType: "pen",
      pressure: 1,
      altitudeAngle: Math.PI / 4,
      azimuthAngle: 2,
    });
    expect(s.tilt).toBeCloseTo(0.5);
    expect(s.azimuth).toBe(2);
    expect(s.hasTilt).toBe(true);
    const vertical = readPenSample({
      pointerType: "pen",
      pressure: 1,
      altitudeAngle: Math.PI / 2,
      azimuthAngle: 2,
    });
    expect(vertical.tilt).toBe(0);
    expect(vertical.hasTilt).toBe(false);
  });
});

describe("penFactor", () => {
  it("sweeps from the floor to 1, monotonically", () => {
    expect(penFactor(0, SIZE_FLOOR)).toBe(SIZE_FLOOR);
    expect(penFactor(1, SIZE_FLOOR)).toBe(1);
    const mid = penFactor(0.5, SIZE_FLOOR);
    expect(mid).toBeGreaterThan(SIZE_FLOOR);
    expect(mid).toBeLessThan(1);
  });

  it("gamma shapes the response: higher demands firmer pressure", () => {
    const soft = penFactor(0.5, 0, 0.3);
    const def = penFactor(0.5, 0);
    const firm = penFactor(0.5, 0, 2);
    expect(soft).toBeGreaterThan(def);
    expect(firm).toBeLessThan(def);
    // Endpoints are gamma-independent.
    expect(penFactor(1, 0, 2)).toBe(1);
    expect(penFactor(0, 0.15, 2)).toBe(0.15);
  });
});

describe("PenSmoother", () => {
  it("passes the first sample through, then eases toward new values", () => {
    const sm = new PenSmoother();
    expect(sm.smooth(pen(1)).pressure).toBe(1);
    const eased = sm.smooth(pen(0)).pressure;
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(1);
    sm.reset();
    expect(sm.smooth(pen(0)).pressure).toBe(0); // fresh stroke, no carry-over
  });

  it("mouse samples pass through untouched and reset the state", () => {
    const sm = new PenSmoother();
    sm.smooth(pen(1));
    expect(sm.smooth(MOUSE_SAMPLE)).toEqual(MOUSE_SAMPLE);
    expect(sm.smooth(pen(0)).pressure).toBe(0); // state was reset
  });

  it("the step controls the lag: 1 = raw samples", () => {
    const raw = new PenSmoother();
    raw.smooth(pen(1), 1);
    expect(raw.smooth(pen(0), 1).pressure).toBe(0); // no smoothing at all
    const heavy = new PenSmoother();
    heavy.smooth(pen(1), 0.05);
    expect(heavy.smooth(pen(0), 0.05).pressure).toBeCloseTo(0.95); // barely moves
  });
});

describe("Round brush modulation", () => {
  it("a mouse stroke carries no width/alpha overrides (pixel-identical path)", () => {
    const { renderer, lines } = makeRecorder();
    const brush = new RoundBrush(createBareHost(renderer, makeFinder()), 1);
    brush.strokeStart(0, 0);
    brush.stroke(0, 0);
    brush.stroke(10, 0);
    for (const l of lines) {
      expect(l.style?.width).toBeUndefined();
      expect(l.style?.alpha).toBeUndefined();
    }
  });

  it("pressure → size: light pressure narrows the segment; full pressure doesn't override", () => {
    const { renderer, lines } = makeRecorder();
    const brush = new RoundBrush(createBareHost(renderer, makeFinder()), 1);
    brush.strokeStart(0, 0);
    brush.stroke(0, 0, true, pen(0));
    expect(lines.at(-1)?.style?.width).toBeLessThan(1); // host width is 1
    brush.strokeEnd();
    brush.stroke(5, 0, true, pen(1));
    expect(lines.at(-1)?.style?.width).toBeUndefined(); // factor 1 → no override
  });

  it("pressure → opacity only when bound", () => {
    const { renderer, lines } = makeRecorder();
    const brush = new RoundBrush(createBareHost(renderer, makeFinder()), 1);
    brush.stroke(0, 0, true, pen(0.4));
    expect(lines.at(-1)?.style?.alpha).toBeUndefined();
    (brush as unknown as { penPressureAlpha: boolean }).penPressureAlpha = true;
    brush.strokeEnd();
    brush.stroke(5, 0, true, pen(0.4));
    const alpha = lines.at(-1)?.style?.alpha;
    expect(alpha).toBeDefined();
    expect(alpha!).toBeLessThan(1);
  });

  it("wet buffer is skipped only for a pen with an opacity binding", () => {
    const { renderer } = makeRecorder();
    const brush = new RoundBrush(createBareHost(renderer, makeFinder()), 1);
    expect(brush.bufferedStroke()).toBe(true);
    expect(brush.bufferedStroke(pen(0.5))).toBe(true); // size binding is fine
    (brush as unknown as { penPressureAlpha: boolean }).penPressureAlpha = true;
    expect(brush.bufferedStroke(pen(0.5))).toBe(false);
    expect(brush.bufferedStroke(MOUSE_SAMPLE)).toBe(true); // mouse keeps the buffer
  });

  it("tilt → size multiplies with pressure when both are bound", () => {
    const { renderer, lines } = makeRecorder();
    const brush = new RoundBrush(createBareHost(renderer, makeFinder()), 1);
    (brush as unknown as { penTiltSize: boolean }).penTiltSize = true;
    // Full pressure but vertical pen: tilt factor at the floor → still narrow.
    brush.stroke(0, 0, true, pen(1, { tilt: 0 }));
    expect(lines.at(-1)?.style?.width).toBeLessThan(1);
  });
});

describe("Marker chisel angle", () => {
  it("follows the pen's azimuth when tilted, falls back when not", () => {
    const { renderer, chisels } = makeRecorder();
    const marker = new MarkerBrush(createBareHost(renderer, makeFinder()));
    marker.strokeStart(0, 0);
    marker.stroke(5, 0, true, pen(1, { hasTilt: true, tilt: 0.5, azimuth: 1.2 }));
    expect(chisels.at(-1)?.angle).toBeCloseTo(1.2);
    marker.stroke(10, 0, true, pen(1)); // vertical pen → no usable direction
    expect(chisels.at(-1)?.angle).toBeCloseTo(CHISEL_ANGLE);
    marker.stroke(15, 0); // mouse
    expect(chisels.at(-1)?.angle).toBeCloseTo(CHISEL_ANGLE);
  });

  it("stays fixed when 'Chisel follows pen' is off", () => {
    const { renderer, chisels } = makeRecorder();
    const marker = new MarkerBrush(createBareHost(renderer, makeFinder()));
    (marker as unknown as { chiselFollowsPen: boolean }).chiselFollowsPen = false;
    marker.strokeStart(0, 0);
    marker.stroke(5, 0, true, pen(1, { hasTilt: true, tilt: 0.5, azimuth: 1.2 }));
    expect(chisels.at(-1)?.angle).toBeCloseTo(CHISEL_ANGLE);
  });
});

describe("pressure → web dials", () => {
  // Pre-seed neighbors so connect() has candidates, then compare zero-pressure
  // strokes with the density binding on vs off.
  const strokeOnce = (webDensity: boolean) => {
    const { renderer, connections } = makeRecorder();
    const finder = makeFinder();
    for (let i = 0; i < 20; i++) finder.addPixel(i, i % 5);
    const brush = new RoundBrush(createBareHost(renderer, finder), 7);
    brush.activeConnection()!.applyFlat({ density: 80, radius: 100 });
    (brush as unknown as { penWebDensity: boolean }).penWebDensity = webDensity;
    brush.strokeStart(2, 2);
    brush.stroke(2, 2, true, pen(0));
    return connections.length;
  };

  it("zero pressure with the binding on draws no web; without it the web is unchanged", () => {
    expect(strokeOnce(false)).toBeGreaterThan(0);
    expect(strokeOnce(true)).toBe(0);
  });
});

describe("Pen section settings", () => {
  it("stroke brushes expose the bindings; web toggles only with a connection", () => {
    const { renderer } = makeRecorder();
    const host = createBareHost(renderer, makeFinder());
    const keys = (b: { getSettings(): { key: string; section?: string }[] }) =>
      b.getSettings().filter((s) => s.section === "Pen").map((s) => s.key);
    expect(keys(new RoundBrush(host, 1))).toEqual([
      "penPressureSize",
      "penPressureAlpha",
      "penTiltSize",
      "penTiltAlpha",
      "penWebDensity",
      "penWebRadius",
      "penSmoothing",
      "penResponse",
    ]);
    expect(keys(new MarkerBrush(host))).toEqual([
      "penPressureSize",
      "penPressureAlpha",
      "penTiltSize",
      "penTiltAlpha",
      "penSmoothing",
      "penResponse",
      "penChisel",
    ]);
  });

  it("the Response slider changes the modulated width at mid pressure", () => {
    const widthAt = (response: number) => {
      const { renderer, lines } = makeRecorder();
      const brush = new RoundBrush(createBareHost(renderer, makeFinder()), 1);
      (brush as unknown as { penResponse: number }).penResponse = response;
      brush.stroke(0, 0, true, pen(0.5));
      return lines.at(-1)?.style?.width ?? 1;
    };
    expect(widthAt(0)).toBeGreaterThan(widthAt(50)); // softer → wider at half pressure
    expect(widthAt(100)).toBeLessThan(widthAt(50)); // firmer → narrower
  });

  it("Smoothing 0 tracks raw pressure instantly", () => {
    const { renderer, lines } = makeRecorder();
    const brush = new RoundBrush(createBareHost(renderer, makeFinder()), 1);
    (brush as unknown as { penSmoothing: number }).penSmoothing = 0;
    brush.stroke(0, 0, true, pen(0));
    brush.stroke(5, 0, true, pen(1)); // raw jump: factor 1 → no width override
    expect(lines.at(-1)?.style?.width).toBeUndefined();
  });
});
