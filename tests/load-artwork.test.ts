import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { loadArtworkFile } from "../src/load-artwork";
import { defaultLayersConfig } from "../src/layered/schema";

// Build a schema-valid manifest object, with optional overrides.
function manifest(over: Record<string, unknown> = {}) {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    canvas: { width: 200, height: 150 },
    config: defaultLayersConfig(),
    files: {
      preview: "preview.png",
      layers: [{ layerIndex: 0, baseFile: "layers/layer0.png" }],
      neighborsMaps: [{ index: 0, file: "neighbors/map0.json" }],
      pixelLog: "pixel-log.jsonl",
    },
    ...over,
  };
}

// Zip a files map into a .nekudot File.
function nekudot(files: Record<string, Uint8Array>): File {
  const u8 = zipSync(files, { level: 0 });
  return new File([u8 as BlobPart], "art.nekudot");
}

// N schema-valid layer/map config + file entries, for the count-limit checks.
const layerCfgs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ index: i, name: `L${i + 1}` }));
const layerFiles = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ layerIndex: i, baseFile: `layers/l${i}.png` }));
const mapCfgs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `map-${i + 1}` }));
const mapFiles = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ index: i, file: `neighbors/m${i}.json` }));

const expectFail = async (file: File, re: RegExp) => {
  const r = await loadArtworkFile(file);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(re);
};

describe("loadArtworkFile validation", () => {
  it("rejects a file that isn't a zip", async () => {
    await expectFail(new File(["not a zip at all"], "art.nekudot"), /valid \.nekudot/i);
  });

  it("rejects a zip with no manifest.json", async () => {
    await expectFail(nekudot({ "stuff.txt": strToU8("hi") }), /no manifest/i);
  });

  it("rejects invalid manifest JSON", async () => {
    await expectFail(nekudot({ "manifest.json": strToU8("{ not json") }), /not valid JSON/i);
  });

  it("rejects a manifest that fails the schema", async () => {
    const bad = manifest();
    delete (bad as Record<string, unknown>).canvas; // required
    await expectFail(nekudot({ "manifest.json": strToU8(JSON.stringify(bad)) }), /Invalid manifest/i);
  });

  it("rejects a manifest from a newer schema version", async () => {
    const m = manifest({ version: 99 });
    await expectFail(nekudot({ "manifest.json": strToU8(JSON.stringify(m)) }), /newer version/i);
  });

  it("rejects an out-of-range canvas size", async () => {
    const m = manifest({ canvas: { width: 99999, height: 150 } });
    await expectFail(nekudot({ "manifest.json": strToU8(JSON.stringify(m)) }), /Canvas size out of range/i);
  });

  it("rejects an entry larger than the per-file cap (zip-bomb defence)", async () => {
    const huge = new Uint8Array(51 * 1024 * 1024); // > 50MB uncompressed (zeros compress tiny)
    await expectFail(
      nekudot({
        "manifest.json": strToU8(JSON.stringify(manifest())),
        "layers/layer0.png": huge,
        "neighbors/map0.json": strToU8("[]"),
      }),
      /too large/i,
    );
  });

  it("rejects a file with more layers than the app supports (max 10)", async () => {
    const m = manifest({
      config: { ...defaultLayersConfig(), layers: layerCfgs(11) },
      files: {
        preview: "preview.png",
        layers: layerFiles(11),
        neighborsMaps: [{ index: 0, file: "neighbors/map0.json" }],
      },
    });
    await expectFail(nekudot({ "manifest.json": strToU8(JSON.stringify(m)) }), /too many layers/i);
  });

  it("rejects a file with an absurd number of memory maps", async () => {
    const m = manifest({
      config: { ...defaultLayersConfig(), neighborsMaps: mapCfgs(65) },
      files: {
        preview: "preview.png",
        layers: [{ layerIndex: 0, baseFile: "layers/layer0.png" }],
        neighborsMaps: mapFiles(65),
      },
    });
    await expectFail(nekudot({ "manifest.json": strToU8(JSON.stringify(m)) }), /too many memory maps/i);
  });

  it("reports a missing referenced layer image", async () => {
    // manifest is valid + small, but the layer PNG it references is absent.
    await expectFail(
      nekudot({
        "manifest.json": strToU8(JSON.stringify(manifest())),
        "neighbors/map0.json": strToU8("[]"),
      }),
      /missing layer image/i,
    );
  });
});
