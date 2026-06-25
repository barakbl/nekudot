import { Store } from "./base";

export class LocalStorageStore extends Store {
  get<T>(key: string): T | undefined {
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // quota exceeded or localStorage disabled — silently drop
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage disabled — nothing to remove
    }
  }
}
