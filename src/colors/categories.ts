// Palette "categories": a small vocabulary for tagging palettes - by feel (Calm,
// Hot, Cool…) or by theme (Animals, Fruits) - so the colour panel can filter by
// category. Each has a machine `id` (stable, stored on the palette + referenced
// from gradients/settings.json) and a human `name` (the UI title). GENERAL is the
// default for any palette that hasn't been tagged.
//
// Formerly "mood"; renamed since the buckets now mix feelings and themes. The ids
// (CALM, HOT, …) are unchanged, so legacy stored values still resolve.

export type Category = { id: string; name: string };

// The curated set. Order is the dropdown order (General last, as the catch-all).
export const CATEGORIES: readonly Category[] = [
  { id: "CALM", name: "Calm" },
  { id: "HOT", name: "Hot" },
  { id: "COOL", name: "Cool" },
  { id: "VIBRANT", name: "Vibrant" },
  { id: "EARTHY", name: "Earthy" },
  { id: "PASTEL", name: "Pastel" },
  { id: "ANIMALS", name: "Animals" },
  { id: "FRUITS", name: "Fruits" },
  { id: "GENERAL", name: "General" },
];

export const DEFAULT_CATEGORY = "GENERAL";

// Sentinel for the "show every category" combo option (not a real palette tag).
export const ALL_CATEGORIES = "ALL";

export function allCategories(): readonly Category[] {
  return CATEGORIES;
}

export function categoryById(id: string | undefined): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

// Coerce an arbitrary stored value to a valid category id, defaulting to GENERAL.
export function normalizeCategory(id: unknown): string {
  return typeof id === "string" && categoryById(id) ? id : DEFAULT_CATEGORY;
}

// The title for a category id (or the id itself if unknown - shouldn't happen).
export function categoryName(id: string): string {
  return categoryById(id)?.name ?? id;
}
