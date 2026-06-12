import { IndexedDbStore } from "../../store/indexeddb";
import { sanitizeStoredSpecs } from "./preset-io";
import type { ConnectionSpec } from "./base";

// User-saved Custom connection presets, persisted in IndexedDB as one array.
// Its own database so it never collides with the paint/pixel-log stores.
const db = new IndexedDbStore("nekudot-connections", "presets");
const KEY = "custom";

export async function loadCustomPresets(): Promise<ConnectionSpec[]> {
  try {
    // Validated + normalized like an import: stored rows predate the current
    // code (or were poisoned by an old import), so they're untrusted too.
    return sanitizeStoredSpecs(await db.get<unknown>(KEY));
  } catch (e) {
    console.warn("loadCustomPresets failed", e);
    return [];
  }
}

export async function saveCustomPresets(specs: ConnectionSpec[]): Promise<void> {
  try {
    await db.put(KEY, specs);
  } catch (e) {
    console.warn("saveCustomPresets failed", e);
  }
}
