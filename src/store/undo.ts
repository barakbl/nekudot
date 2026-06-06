import { IndexedDbStore } from "./indexeddb";

// Persistence layer for the undo stack. Callers (UndoManager) only see
// load/save/clear; the IDB backend is an implementation detail.

export class UndoStore<T> {
  private backend: IndexedDbStore;
  private key: string;

  constructor(dbName = "nekudot-undo", storeName = "stacks", key = "stack") {
    this.backend = new IndexedDbStore(dbName, storeName);
    this.key = key;
  }

  async load(): Promise<T | null> {
    try {
      return await this.backend.get<T>(this.key);
    } catch (e) {
      console.warn("UndoStore.load failed", e);
      return null;
    }
  }

  async save(state: T): Promise<void> {
    try {
      await this.backend.put(this.key, state);
    } catch (e) {
      console.warn("UndoStore.save failed", e);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.backend.delete(this.key);
    } catch (e) {
      console.warn("UndoStore.clear failed", e);
    }
  }
}
