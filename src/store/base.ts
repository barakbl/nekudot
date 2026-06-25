export abstract class Store {
  abstract get<T>(key: string): T | undefined;
  abstract set<T>(key: string, value: T): void;
  // Delete a key outright. Use this to clear a value - NOT `set(key, undefined)`,
  // which writes the literal string "undefined" (the key lingers and reads as
  // a parse error).
  abstract remove(key: string): void;
}
