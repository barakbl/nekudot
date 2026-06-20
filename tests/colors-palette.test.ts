import { describe, it, expect } from "vitest";
import {
  builtinPalettes,
  clampColors,
  DEFAULT_APP_COLORS,
  MAX_RECENT,
  MAX_SWATCHES,
  normalizeHex,
  pushRecent,
} from "../src/colors/palette";

describe("normalizeHex", () => {
  it("lower-cases and adds the leading #", () => {
    expect(normalizeHex("#FFFFFF")).toBe("#ffffff");
    expect(normalizeHex("ABCDEF")).toBe("#abcdef");
  });
  it("expands #rgb shorthand to #rrggbb", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("f0a")).toBe("#ff00aa");
  });
  it("rejects non-hex / wrong-length input", () => {
    expect(normalizeHex("xyz")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("clampColors", () => {
  it("normalizes, dedupes (case-insensitive), and drops invalid entries", () => {
    expect(clampColors(["#FFF", "#ffffff", "#fff", "nope", "#abc"])).toEqual([
      "#ffffff",
      "#aabbcc",
    ]);
  });
  it("caps at MAX_SWATCHES", () => {
    const many = Array.from({ length: MAX_SWATCHES + 30 }, (_, i) => {
      const h = i.toString(16).padStart(6, "0");
      return `#${h}`;
    });
    expect(clampColors(many)).toHaveLength(MAX_SWATCHES);
  });
});

describe("pushRecent", () => {
  it("puts the newest colour first", () => {
    let list: string[] = [];
    list = pushRecent(list, "#ff0000");
    list = pushRecent(list, "#00ff00");
    expect(list).toEqual(["#00ff00", "#ff0000"]);
  });
  it("dedupes case-insensitively, moving the colour to the front", () => {
    const list = pushRecent(["#ff0000", "#00ff00"], "#FF0000");
    expect(list).toEqual(["#ff0000", "#00ff00"]);
  });
  it("caps at MAX_RECENT, keeping the most recent", () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_RECENT + 5; i++) list = pushRecent(list, `#0000${i.toString(16).padStart(2, "0")}`);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe(`#0000${(MAX_RECENT + 4).toString(16).padStart(2, "0")}`);
  });
  it("leaves the list unchanged for invalid input", () => {
    expect(pushRecent(["#ff0000"], "nope")).toEqual(["#ff0000"]);
  });
});

describe("builtinPalettes", () => {
  it("starts with the 12 App Colors and includes the connection gradients, all read-only", () => {
    const b = builtinPalettes();
    expect(b[0].name).toBe("App Colors");
    expect(b[0].colors).toHaveLength(DEFAULT_APP_COLORS.length);
    expect(b[0].colors).toHaveLength(12);
    expect(b.map((p) => p.id)).toContain("conn:sunset");
    expect(b.every((p) => p.builtin === true)).toBe(true);
  });
});
