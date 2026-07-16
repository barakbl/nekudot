import { describe, it, expect } from "vitest";

import {
  MAX_PATCH_SIDE,
  type PatchPixels,
  decodePatch,
  encodePatch,
  hasCompressionStream,
} from "../src/store/patch-codec";

// Node has CompressionStream but no ImageData/canvas, so these exercise the
// deflate-raw path (the exact one). The PNG fallback needs a real canvas and is
// covered by tests/smoke/patch-codec.mjs.

const makePixels = (
  w: number,
  h: number,
  fill: (d: Uint8ClampedArray, o: number, i: number) => void,
): PatchPixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) fill(data, i * 4, i);
  return { data, width: w, height: h };
};

// A patch with opaque, fully transparent, AND low-alpha (a=1) pixels - the case a
// premultiplying codec would corrupt.
const mixedPixels = (w: number, h: number): PatchPixels =>
  makePixels(w, h, (d, o, i) => {
    d[o] = (i * 37) & 255;
    d[o + 1] = (i * 91) & 255;
    d[o + 2] = (i * 17) & 255;
    d[o + 3] = i % 3 === 0 ? 1 : i % 3 === 1 ? 0 : 255;
  });

const bytesOf = async (blob: Blob): Promise<number[]> =>
  Array.from(new Uint8Array(await blob.arrayBuffer()));

describe("patch-codec (deflate-raw path)", () => {
  it("has CompressionStream in this environment", () => {
    expect(hasCompressionStream()).toBe(true);
  });

  it("round-trips byte-exact, including low-alpha pixels", async () => {
    const px = mixedPixels(4, 3);
    const back = await decodePatch(await encodePatch(px));
    expect(back.width).toBe(4);
    expect(back.height).toBe(3);
    expect(Array.from(back.data)).toEqual(Array.from(px.data));
  });

  it("preserves non-square dimensions and >255 sides", async () => {
    const wide = makePixels(300, 2, (d, o, i) => {
      d[o] = i & 255;
      d[o + 3] = 255;
    });
    const back = await decodePatch(await encodePatch(wide));
    expect([back.width, back.height]).toEqual([300, 2]);
    expect(Array.from(back.data)).toEqual(Array.from(wide.data));
  });

  it("is encode-decode-encode stable (deterministic, no premultiply drift)", async () => {
    const px = mixedPixels(5, 5);
    const b1 = await encodePatch(px);
    const x1 = await decodePatch(b1);
    const b2 = await encodePatch(x1);
    expect(await bytesOf(b2)).toEqual(await bytesOf(b1));
  });

  it("tags the codec in the blob type", async () => {
    const blob = await encodePatch(mixedPixels(2, 2));
    expect(blob.type).toContain("deflate-raw");
  });

  it("enforces the 4096-px side cap", async () => {
    const empty = new Uint8ClampedArray(0);
    await expect(
      encodePatch({ data: empty, width: MAX_PATCH_SIDE + 1, height: 1 }),
    ).rejects.toThrow(/4096/);
    await expect(
      encodePatch({ data: empty, width: 1, height: MAX_PATCH_SIDE + 1 }),
    ).rejects.toThrow(/4096/);
    // exactly the cap is allowed
    const atCap = makePixels(MAX_PATCH_SIDE, 1, (d, o) => {
      d[o + 3] = 255;
    });
    await expect(encodePatch(atCap)).resolves.toBeInstanceOf(Blob);
  });

  it("rejects a blob that isn't a patch", async () => {
    await expect(decodePatch(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrow(
      /bad magic/,
    );
  });
});
