import { z } from "zod";
import { DASH_STYLES } from "./connecting-types";
import { IndexedDbStore } from "./store/indexeddb";
import { isKnownBrush } from "./brushes/registry";

// brush_type is just the brush's name(); validated against the brush registry
// (the single source of truth) rather than a hardcoded list, so adding a brush
// needs no change here. Unknown names fail validation and are dropped, exactly
// as before.
export type BrushType = string;

// Generous sanity bounds — far beyond any real canvas (max dim 8192) or brush
// width. They don't reject legitimate data; they reject garbage from a crafted
// or corrupt file (the log is untrusted input once it comes from a .nekudot).
const MAX_COORD = 100_000;
const MAX_WIDTH = 10_000;

// One append-only row per pixel deposited into a neighbors-map tree.
export const PixelLogEntrySchema = z.object({
  brush_type: z.string().min(1).refine(isKnownBrush, { message: "unknown brush type" }),
  dash: z.enum(DASH_STYLES),
  width: z.number().finite().nonnegative().max(MAX_WIDTH), // main brush stroke width
  x: z.number().finite().min(-MAX_COORD).max(MAX_COORD),
  y: z.number().finite().min(-MAX_COORD).max(MAX_COORD),
  layer_id: z.string().min(1), // active layer the pixel was painted on
  pixel_map_id: z.string().min(1), // neighbors map the pixel entered
});
export type PixelLogEntry = z.infer<typeof PixelLogEntrySchema>;

const DB_KEY = "entries";
// Bound persisted/in-memory growth; drop oldest beyond this (append-only log).
const MAX_ENTRIES = 100_000;

export class PixelLog {
  private entries: PixelLogEntry[] = [];
  private store = new IndexedDbStore("nekudot-pixel-log", "log");
  private dirty = false;

  // Restore persisted entries (validated; bad rows dropped).
  async init(): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    try {
      const saved = await this.store.get<unknown[]>(DB_KEY);
      if (Array.isArray(saved)) {
        this.entries = saved
          .map((e) => PixelLogEntrySchema.safeParse(e))
          .filter((r): r is { success: true; data: PixelLogEntry } => r.success)
          .map((r) => r.data);
      }
    } catch (e) {
      console.warn("PixelLog.init failed", e);
    }
  }

  // Construction is type-checked; validation happens on load and on write.
  append(entry: PixelLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty || typeof indexedDB === "undefined") return;
    this.dirty = false;
    try {
      await this.store.put(DB_KEY, this.entries);
    } catch (e) {
      console.warn("PixelLog.flush failed", e);
    }
  }

  async clear(): Promise<void> {
    this.entries = [];
    this.dirty = false;
    if (typeof indexedDB === "undefined") return;
    try {
      await this.store.delete(DB_KEY);
    } catch (e) {
      console.warn("PixelLog.clear failed", e);
    }
  }

  get count(): number {
    return this.entries.length;
  }

  // Replace the log from a JSONL blob (e.g. a loaded .nekudot). This is
  // untrusted input, so every line is schema-validated (same as init/save):
  // unparseable lines and rows that fail PixelLogEntrySchema — unknown brush,
  // out-of-range numbers, missing fields — are dropped.
  async loadRawJSONL(text: string): Promise<void> {
    const parsed: PixelLogEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let json: unknown;
      try {
        json = JSON.parse(trimmed);
      } catch {
        continue; // skip unparseable line
      }
      const r = PixelLogEntrySchema.safeParse(json);
      if (r.success) parsed.push(r.data);
    }
    this.entries =
      parsed.length > MAX_ENTRIES ? parsed.slice(parsed.length - MAX_ENTRIES) : parsed;
    this.dirty = true;
    await this.flush();
  }

  // Newline-delimited JSON, one validated entry per line (invalid rows skipped).
  toJSONL(): string {
    const out: string[] = [];
    for (const e of this.entries) {
      const r = PixelLogEntrySchema.safeParse(e);
      if (r.success) out.push(JSON.stringify(r.data));
    }
    return out.join("\n");
  }
}

// Shared instance: brushes append to it, save-artwork reads it for the zip.
export const pixelLog = new PixelLog();
