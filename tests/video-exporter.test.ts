import { describe, expect, it } from "vitest";
import {
  VIDEO_CANDIDATES,
  bitrateFor,
  createVideoExporter,
  evenDim,
  fpsFromDelay,
  pickVideoCandidate,
  type VideoCandidate,
} from "../src/clip/encode-webm";

// The actual WebCodecs encode is browser-only (no VideoEncoder in node) and is
// covered by the live CDP smoke; here we pin the pure selection/config logic.

describe("video export helpers", () => {
  it("evenDim drops an odd last row/column", () => {
    expect(evenDim(640)).toBe(640);
    expect(evenDim(427)).toBe(426);
    expect(evenDim(1)).toBe(0);
  });

  it("fpsFromDelay inverts the per-frame delay, never below 1", () => {
    expect(fpsFromDelay(1000 / 12)).toBe(12);
    expect(fpsFromDelay(1000 / 30)).toBe(30);
    expect(fpsFromDelay(100000)).toBe(1); // very slow -> clamp to 1 fps
    // delay 0 must not divide-by-zero -> a finite fps (delay floored to 1ms).
    expect(Number.isFinite(fpsFromDelay(0))).toBe(true);
    expect(fpsFromDelay(0)).toBeGreaterThanOrEqual(1);
  });

  it("bitrateFor stays inside the [1, 12] Mbps window", () => {
    expect(bitrateFor(16, 16, 12)).toBe(1_000_000); // tiny -> floor
    expect(bitrateFor(4000, 4000, 60)).toBe(12_000_000); // huge -> ceiling
    const mid = bitrateFor(640, 360, 12);
    expect(mid).toBeGreaterThanOrEqual(1_000_000);
    expect(mid).toBeLessThanOrEqual(12_000_000);
  });
});

describe("pickVideoCandidate", () => {
  const probeAll = async () => ({ supported: true });
  const probeNone = async () => ({ supported: false });

  it("returns the first candidate the browser supports (MP4 preferred)", async () => {
    const c = await pickVideoCandidate(VIDEO_CANDIDATES, probeAll);
    expect(c?.container).toBe("mp4");
    expect(c?.ext).toBe("mp4");
  });

  it("falls through to the next when earlier codecs are unsupported", async () => {
    // Only VP9 supported.
    const probe = async (cfg: VideoEncoderConfig) => ({
      supported: cfg.codec.startsWith("vp09"),
    });
    const c = await pickVideoCandidate(VIDEO_CANDIDATES, probe);
    expect(c?.container).toBe("webm");
    expect(c?.muxerCodec).toBe("V_VP9");
  });

  it("skips a candidate whose probe throws", async () => {
    const probe = async (cfg: VideoEncoderConfig) => {
      if (cfg.codec.startsWith("avc")) throw new TypeError("unknown codec");
      return { supported: true };
    };
    const c = await pickVideoCandidate(VIDEO_CANDIDATES, probe);
    expect(c?.container).toBe("webm");
  });

  it("returns null when nothing is supported", async () => {
    expect(await pickVideoCandidate(VIDEO_CANDIDATES, probeNone)).toBeNull();
  });

  it("returns null in an environment without VideoEncoder", async () => {
    // No injected probe + no global VideoEncoder (node) -> no video export.
    expect(await pickVideoCandidate(VIDEO_CANDIDATES)).toBeNull();
  });

  it("maps a candidate to a well-formed exporter shape", () => {
    const mp4: VideoCandidate = VIDEO_CANDIDATES[0];
    expect(mp4).toMatchObject({ ext: "mp4", mime: "video/mp4", avc: true, muxerCodec: "avc" });
  });
});

describe("createVideoExporter", () => {
  it("resolves to null when WebCodecs is unavailable (node)", async () => {
    expect(await createVideoExporter()).toBeNull();
  });
});
