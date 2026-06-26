export abstract class Store {
  abstract get<T>(key: string): T | undefined;
  // Persist a value under a key. The value must be defined: `set(key, undefined)`
  // is a compile error (the parameter resolves to `never`). JSON.stringify of
  // undefined is undefined, so localStorage would store the literal string
  // "undefined" - the key lingers and reads back as a parse error. To clear a
  // value use remove(key). A possibly-undefined value (`T | undefined`) is
  // rejected too: narrow it, or branch on remove() first. (null is allowed - it
  // round-trips through JSON.)
  abstract set<T>(key: string, value: T extends undefined ? never : T): void;
  // Delete a key outright. Use this to clear a value - NOT `set(key, undefined)`.
  abstract remove(key: string): void;
}
