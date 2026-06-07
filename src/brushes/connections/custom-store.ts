import { IndexedDbStore } from "../../store/indexeddb";
import type { ConnectionSpec } from "./base";

// User-saved Custom connection presets, persisted in IndexedDB as one array.
// Its own database so it never collides with the paint/pixel-log stores.
const db = new IndexedDbStore("nekudot-connections", "presets");
const KEY = "custom";

export async function loadCustomPresets(): Promise<ConnectionSpec[]> {
  try {
    return (await db.get<ConnectionSpec[]>(KEY)) ?? [];
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
