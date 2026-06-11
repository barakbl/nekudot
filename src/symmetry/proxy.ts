import type { LineStyle, LineConnectType } from "../renderer";
import type { Pixel } from "../neighbor-finder";
import type { GeometryMethod } from "../paint-host";
import {
  type Transform,
  applyPoint,
  applyAngle,
  isIdentity,
  isPassthrough,
} from "./transforms";

// Wraps the LayerManager (which is the brushes' IRenderer + NeighborFinder +
// ConnectRouter all at once) so that, while a symmetry mode is active, every
// drawn mark AND every deposited point is replayed at each transform. When the
// transform list is just the identity (symmetry off) it forwards untouched, so
// there's zero behaviour change.
//
// A Proxy forwards every method to the base by default; we override exactly
// the geometry-bearing entry points listed in GEOMETRY_METHODS (paint-host.ts)
// — the overrides table below is typed against that list, so the two cannot
// drift apart without a compile error (tests/symmetry-coverage.test.ts guards
// new renderer methods being added without classification).
// Searches (findNeighbors / findNeighborsInMap) stay at the master coordinate;
// the mirrored points already live in the map, so the web connects across the
// symmetry and the connection lines are then copied to each transform.
export function makeSymmetryProxy<T extends object>(
  base: T,
  getTransforms: () => readonly Transform[],
  getBaseOpacity: () => number,
): T {
  const b = base as Record<string, (...a: unknown[]) => unknown>;
  const off = () => isPassthrough(getTransforms());

  const tp = (t: Transform, p: Pixel): Pixel => {
    const q = applyPoint(t, p.x, p.y);
    return { id: p.id, x: q.x, y: q.y };
  };
  // Style alpha, faded per copy. Falls back to the stroke opacity so a faded
  // (aMul<1) tile copy still shows the fade even when the caller left alpha off.
  const lineStyle = (style: LineStyle | undefined, aMul: number): LineStyle => ({
    ...style,
    alpha: (style?.alpha ?? getBaseOpacity()) * aMul,
  });
  const fillAlpha = (alpha: number | undefined, aMul: number): number =>
    (alpha ?? getBaseOpacity()) * aMul;

  const overrides: Record<GeometryMethod, (...a: never[]) => unknown> = {
    drawLine(p1: Pixel, p2: Pixel, style?: LineStyle, kind?: LineConnectType) {
      if (off()) return b.drawLine(p1, p2, style, kind);
      for (const t of getTransforms())
        b.drawLine(tp(t, p1), tp(t, p2), lineStyle(style, t.aMul), kind);
    },
    drawConnection(p1: Pixel, p2: Pixel, style?: LineStyle, kind?: LineConnectType) {
      if (off()) return b.drawConnection(p1, p2, style, kind);
      for (const t of getTransforms())
        b.drawConnection(tp(t, p1), tp(t, p2), lineStyle(style, t.aMul), kind);
    },
    drawConnectionToLayer(
      layerId: string,
      p1: Pixel,
      p2: Pixel,
      style?: LineStyle,
      kind?: LineConnectType,
    ) {
      if (off()) return b.drawConnectionToLayer(layerId, p1, p2, style, kind);
      for (const t of getTransforms())
        b.drawConnectionToLayer(layerId, tp(t, p1), tp(t, p2), lineStyle(style, t.aMul), kind);
    },
    drawChisel(p1: Pixel, p2: Pixel, angle: number, style?: LineStyle) {
      if (off()) return b.drawChisel(p1, p2, angle, style);
      for (const t of getTransforms())
        b.drawChisel(tp(t, p1), tp(t, p2), applyAngle(t, angle), lineStyle(style, t.aMul));
    },
    strokeRect(x: number, y: number, w: number, h: number, style?: LineStyle, angle = 0) {
      if (off()) return b.strokeRect(x, y, w, h, style, angle);
      for (const t of getTransforms()) {
        const q = applyPoint(t, x, y);
        b.strokeRect(q.x, q.y, w, h, lineStyle(style, t.aMul), applyAngle(t, angle));
      }
    },
    fillRect(x: number, y: number, w: number, h: number, color?: string, angle = 0, alpha?: number) {
      if (off()) return b.fillRect(x, y, w, h, color, angle, alpha);
      for (const t of getTransforms()) {
        const q = applyPoint(t, x, y);
        b.fillRect(q.x, q.y, w, h, color, applyAngle(t, angle), fillAlpha(alpha, t.aMul));
      }
    },
    strokeCircle(x: number, y: number, r: number, style?: LineStyle) {
      if (off()) return b.strokeCircle(x, y, r, style);
      for (const t of getTransforms()) {
        const q = applyPoint(t, x, y);
        b.strokeCircle(q.x, q.y, r, lineStyle(style, t.aMul));
      }
    },
    fillCircle(x: number, y: number, r: number, color?: string, alpha?: number) {
      if (off()) return b.fillCircle(x, y, r, color, alpha);
      for (const t of getTransforms()) {
        const q = applyPoint(t, x, y);
        b.fillCircle(q.x, q.y, r, color, fillAlpha(alpha, t.aMul));
      }
    },
    strokeEllipse(x: number, y: number, rx: number, ry: number, angle: number, style?: LineStyle) {
      if (off()) return b.strokeEllipse(x, y, rx, ry, angle, style);
      for (const t of getTransforms()) {
        const q = applyPoint(t, x, y);
        b.strokeEllipse(q.x, q.y, rx, ry, applyAngle(t, angle), lineStyle(style, t.aMul));
      }
    },
    fillEllipse(x: number, y: number, rx: number, ry: number, angle: number, color?: string, alpha?: number) {
      if (off()) return b.fillEllipse(x, y, rx, ry, angle, color, alpha);
      for (const t of getTransforms()) {
        const q = applyPoint(t, x, y);
        b.fillEllipse(q.x, q.y, rx, ry, applyAngle(t, angle), color, fillAlpha(alpha, t.aMul));
      }
    },
    // Deposits: drop the master point, then a copy at every other transform so
    // the memory (and thus the connecting web) is mirrored too.
    addPixel(x: number, y: number): Pixel {
      const master = b.addPixel(x, y) as Pixel;
      if (off()) return master;
      for (const t of getTransforms()) {
        if (isIdentity(t)) continue;
        const q = applyPoint(t, x, y);
        b.addPixel(q.x, q.y);
      }
      return master;
    },
    addPixelToMap(mapId: string, x: number, y: number): Pixel {
      const master = b.addPixelToMap(mapId, x, y) as Pixel;
      if (off()) return master;
      for (const t of getTransforms()) {
        if (isIdentity(t)) continue;
        const q = applyPoint(t, x, y);
        b.addPixelToMap(mapId, q.x, q.y);
      }
      return master;
    },
  };

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop in overrides)
        return overrides[prop as GeometryMethod];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as T;
}
