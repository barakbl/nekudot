// Palette "moods": a small vocabulary for tagging palettes by feel, so the colour
// panel can filter by mood. Each mood has a machine `id` (stable, stored on the
// palette + referenced from gradients/settings.json) and a human `name` (the title
// shown in the UI, free to read nicely). GENERAL is the default for any palette
// that hasn't been tagged.
import { z } from "zod";

export type Mood = { id: string; name: string };

// The curated set. Order is the dropdown order (General last, as the catch-all).
export const MOODS: readonly Mood[] = [
  { id: "CALM", name: "Calm" },
  { id: "HOT", name: "Hot" },
  { id: "COOL", name: "Cool" },
  { id: "VIBRANT", name: "Vibrant" },
  { id: "EARTHY", name: "Earthy" },
  { id: "PASTEL", name: "Pastel" },
  { id: "GENERAL", name: "General" },
];

export const DEFAULT_MOOD = "GENERAL";

// Sentinel for the "show every mood" combo option (not a real palette tag).
export const ALL_MOODS = "ALL";

// Accepts any of the known mood ids (case-insensitive on load isn't needed: ids
// are authored upper-case). Anything else is coerced to GENERAL by normalizeMood.
export const MoodIdSchema = z.enum(
  MOODS.map((m) => m.id) as [string, ...string[]],
);

export function allMoods(): readonly Mood[] {
  return MOODS;
}

export function moodById(id: string | undefined): Mood | undefined {
  return MOODS.find((m) => m.id === id);
}

// Coerce an arbitrary stored value to a valid mood id, defaulting to GENERAL.
export function normalizeMood(id: unknown): string {
  return typeof id === "string" && moodById(id) ? id : DEFAULT_MOOD;
}

// The title for a mood id (or the id itself if unknown - shouldn't happen).
export function moodName(id: string): string {
  return moodById(id)?.name ?? id;
}
