import { describe, it, expect } from "vitest";
import {
  ALL_CATEGORIES,
  allCategories,
  DEFAULT_CATEGORY,
  categoryById,
  categoryName,
  normalizeCategory,
} from "../src/colors/categories";

describe("categories", () => {
  it("has the curated set incl. Animals + Fruits, with General as the default", () => {
    expect(DEFAULT_CATEGORY).toBe("GENERAL");
    expect(categoryById(DEFAULT_CATEGORY)?.name).toBe("General");
    expect(allCategories().map((c) => c.id)).toEqual(
      expect.arrayContaining([
        "CALM", "HOT", "COOL", "VIBRANT", "EARTHY", "PASTEL", "ANIMALS", "FRUITS", "GENERAL",
      ]),
    );
  });

  it("ids are machine-style, names are titles", () => {
    for (const c of allCategories()) {
      expect(c.id).toMatch(/^[A-Z]+$/);
      expect(c.name[0]).toMatch(/[A-Z]/);
    }
  });

  it("normalizeCategory coerces unknown / non-string values to GENERAL", () => {
    expect(normalizeCategory("CALM")).toBe("CALM");
    expect(normalizeCategory("ANIMALS")).toBe("ANIMALS");
    expect(normalizeCategory("nope")).toBe("GENERAL");
    expect(normalizeCategory(undefined)).toBe("GENERAL");
    expect(normalizeCategory(42)).toBe("GENERAL");
  });

  it("ALL_CATEGORIES is a distinct sentinel, not a real category", () => {
    expect(categoryById(ALL_CATEGORIES)).toBeUndefined();
  });

  it("categoryName falls back to the id for unknowns", () => {
    expect(categoryName("HOT")).toBe("Hot");
    expect(categoryName("ANIMALS")).toBe("Animals");
    expect(categoryName("WAT")).toBe("WAT");
  });
});
