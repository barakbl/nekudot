export abstract class Store {
  abstract get<T>(key: string): T | undefined;
  abstract set<T>(key: string, value: T): void;
}
