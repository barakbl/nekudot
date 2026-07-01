import { describe, it, expect } from "vitest";
import { ShapesBrush } from "../src/brushes/shapes";

// resolveFillColor() is a tri-state the shapes brushes depend on:
//   fillMode "none"      -> null      (drawAt skips the fill: a hollow shape)
//   fillMode "main"      -> undefined (the renderer fills with the Primary strokeStyle)
//   fillMode "secondary" -> the stored secondary hex (an explicit fill colour)
// Swapping null and undefined would silently fill shapes that should be hollow
// (or vice versa), so lock the three branches. ShapesBrush.drawAt (Squares mode,
// the default) forwards the resolved colour as host.fillRect's 5th arg, and skips
// fillRect entirely when it is null - so the recorded fills tell us which branch fired.
class TestSquares extends ShapesBrush {
  setFill(mode: "none" | "main" | "secondary"): void {
    this.fillMode = mode;
  }
}

function setup(mode: "none" | "main" | "secondary", secondary = "#abcdef") {
  const fills: (string | undefined)[] = [];
  const tracked: Record<string, unknown> = {
    fillRect: (
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      color?: string,
    ) => fills.push(color),
    addPixel: (x: number, y: number) => ({ id: 0, x, y }),
    selectedMapId: () => "",
    isErasing: () => false,
    strokeWidth: () => 1,
    strokeAlpha: () => 1,
  };
  const host = new Proxy(tracked, {
    get: (t, p) => (p in t ? t[p as string] : () => {}),
  }) as never;
  const store = {
    get: (k: string) => (k === "app.color.secondary" ? secondary : undefined),
    set() {},
  } as never;
  const brush = new TestSquares(host, 1, store);
  brush.setFill(mode);

  // March far enough to place at least one square (drawAt runs per placement).
  brush.strokeStart(0, 0);
  for (let x = 100; x <= 600; x += 100) brush.stroke(x, 0, true);
  return fills;
}

describe("shapes resolveFillColor tri-state", () => {
  it('"none" produces a hollow shape (fillRect never called)', () => {
    expect(setup("none")).toEqual([]);
  });

  it('"main" fills with undefined so the renderer uses the Primary strokeStyle', () => {
    const fills = setup("main");
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((c) => c === undefined)).toBe(true);
  });

  it('"secondary" fills with the stored secondary hex', () => {
    const fills = setup("secondary", "#abcdef");
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((c) => c === "#abcdef")).toBe(true);
  });
});
