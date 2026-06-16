import { describe, it, expect } from "vitest";
import { encodeGif } from "../src/clip/encode-gif";

// Build a solid-colour RGBA frame (ImageData-shaped; encodeGif only reads
// data/width/height).
function frame(w: number, h: number, rgb: [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h } as ImageData;
}

describe("encodeGif", () => {
  it("produces a valid GIF89a blob from frames", async () => {
    const frames = [
      frame(8, 8, [255, 0, 0]),
      frame(8, 8, [0, 255, 0]),
      frame(8, 8, [0, 0, 255]),
    ];
    const blob = await encodeGif(frames, 100);
    expect(blob.type).toBe("image/gif");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
    expect(bytes.length).toBeGreaterThan(20);
  });

  it("embeds the nekudot provenance as a GIF comment extension", async () => {
    const blob = await encodeGif([frame(4, 4, [0, 0, 0]), frame(4, 4, [255, 255, 255])], 100);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("https://nekudot.app/");
    // the comment-extension introducer (0x21 0xFE) must appear before the URL
    const url = text.indexOf("https://nekudot.app/");
    let introAt = -1;
    for (let i = 0; i < url; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xfe) introAt = i;
    expect(introAt).toBeGreaterThanOrEqual(0);
    // and it stays a valid GIF89a (header intact)
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
  });

  it("reports progress once per frame, in order", async () => {
    const frames = [frame(4, 4, [10, 10, 10]), frame(4, 4, [20, 20, 20])];
    const seen: number[] = [];
    await encodeGif(frames, 50, (done) => seen.push(done));
    expect(seen).toEqual([1, 2]);
  });
});
