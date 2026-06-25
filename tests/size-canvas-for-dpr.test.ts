import { describe, it, expect } from "vitest";
import { sizeCanvasForDpr } from "../src/canvas-size";

// A minimal canvas stand-in - sizeCanvasForDpr only touches width/height + style.
function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: {} as { width?: string; height?: string },
  } as unknown as HTMLCanvasElement;
}

describe("sizeCanvasForDpr", () => {
  it("sets the backing store to round(css * dpr) and the CSS box to css px", () => {
    const c = fakeCanvas();
    sizeCanvasForDpr(c, 300, 150, 2);
    expect(c.width).toBe(600);
    expect(c.height).toBe(300);
    expect(c.style.width).toBe("300px");
    expect(c.style.height).toBe("150px");
  });

  it("rounds the backing store to whole device pixels; the CSS box stays logical", () => {
    const c = fakeCanvas();
    sizeCanvasForDpr(c, 10, 10, 1.25); // 10 * 1.25 = 12.5 -> 13
    expect(c.width).toBe(13);
    expect(c.height).toBe(13);
    expect(c.style.width).toBe("10px");
    expect(c.style.height).toBe("10px");
  });

  it("at dpr 1 the backing store equals the CSS box", () => {
    const c = fakeCanvas();
    sizeCanvasForDpr(c, 33, 77, 1);
    expect(c.width).toBe(33);
    expect(c.height).toBe(77);
    expect(c.style).toMatchObject({ width: "33px", height: "77px" });
  });
});
