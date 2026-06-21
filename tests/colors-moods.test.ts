import { describe, it, expect } from "vitest";
import {
  ALL_MOODS,
  allMoods,
  DEFAULT_MOOD,
  moodById,
  moodName,
  normalizeMood,
} from "../src/colors/moods";

describe("moods", () => {
  it("has the 7 curated moods, with General as the default", () => {
    expect(allMoods()).toHaveLength(7);
    expect(DEFAULT_MOOD).toBe("GENERAL");
    expect(moodById(DEFAULT_MOOD)?.name).toBe("General");
    expect(allMoods().map((m) => m.id)).toEqual(
      expect.arrayContaining(["CALM", "HOT", "COOL", "VIBRANT", "EARTHY", "PASTEL", "GENERAL"]),
    );
  });

  it("ids are machine-style, names are titles", () => {
    for (const m of allMoods()) {
      expect(m.id).toMatch(/^[A-Z]+$/);
      expect(m.name[0]).toMatch(/[A-Z]/);
    }
  });

  it("normalizeMood coerces unknown / non-string values to GENERAL", () => {
    expect(normalizeMood("CALM")).toBe("CALM");
    expect(normalizeMood("nope")).toBe("GENERAL");
    expect(normalizeMood(undefined)).toBe("GENERAL");
    expect(normalizeMood(42)).toBe("GENERAL");
  });

  it("ALL_MOODS is a distinct sentinel, not a real mood", () => {
    expect(moodById(ALL_MOODS)).toBeUndefined();
  });

  it("moodName falls back to the id for unknowns", () => {
    expect(moodName("HOT")).toBe("Hot");
    expect(moodName("WAT")).toBe("WAT");
  });
});
