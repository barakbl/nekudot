import type { LayersConfig } from "./layered/schema";
import type { PaintSnapshot } from "./store/paint";

export type UndoSnapshot = {
  config: LayersConfig;
  paint: PaintSnapshot;
  description?: string;
};

export type UndoResult<T = UndoSnapshot> = {
  snap: T;
  action?: string;
};

export type UndoStateData<T = UndoSnapshot> = {
  stack: T[];
  pointer: number;
};

// Minimal store interface - UndoManager doesn't know it's IndexedDB. Generic over
// the entry type; defaults to UndoSnapshot so existing call sites are unchanged.
export type UndoBackend<T = UndoSnapshot> = {
  load(): Promise<UndoStateData<T> | null>;
  save(state: UndoStateData<T>): Promise<void>;
  clear(): Promise<void>;
};

// Generic over its entry type T - it only ever reads `description`, so it stays
// behaviour-identical while a later PR can swap in a delta/tile entry type without
// touching the FIFO mechanics. T defaults to UndoSnapshot so the app is unchanged.
export class UndoManager<T extends { description?: string } = UndoSnapshot> {
  private stack: T[] = [];
  private pointer = -1;
  private listeners = new Set<() => void>();

  constructor(
    private store: UndoBackend<T>,
    private maxSize: number,
  ) {}

  async init(): Promise<void> {
    const loaded = await this.store.load();
    if (loaded) {
      this.stack = loaded.stack;
      this.pointer = loaded.pointer;
    }
    this.emit();
  }

  // Replace the in-memory stack + pointer without persisting. Boot seeds the FIFO
  // from the v2 tile chain this way; it must NOT write back, or it would clobber the
  // v2 store / v1 shadow keyframe that own persistence on that path.
  hydrate(stack: T[], pointer: number): void {
    this.stack = stack;
    this.pointer = pointer;
    this.emit();
  }

  push(snap: T): void {
    if (this.pointer < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.pointer + 1);
    }
    this.stack.push(snap);
    this.pointer = this.stack.length - 1;
    while (this.stack.length > this.maxSize) {
      this.stack.shift();
      this.pointer--;
    }
    this.persist();
    this.emit();
  }

  // The snapshot the canvas currently corresponds to (stack tip after a push,
  // the stepped-to entry after undo/redo). Null while the stack is empty.
  current(): T | null {
    return this.stack[this.pointer] ?? null;
  }

  canUndo(): boolean {
    return this.pointer > 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  undo(): UndoResult<T> | null {
    if (!this.canUndo()) return null;
    // The action being undone is the one that produced the current snapshot
    // (which we're about to leave behind).
    const undone = this.stack[this.pointer];
    this.pointer--;
    this.persist();
    this.emit();
    return { snap: this.stack[this.pointer], action: undone.description };
  }

  redo(): UndoResult<T> | null {
    if (!this.canRedo()) return null;
    this.pointer++;
    this.persist();
    this.emit();
    const snap = this.stack[this.pointer];
    return { snap, action: snap.description };
  }

  // Returns the backend clear so callers (reset / New art) can await the
  // committed wipe before reloading — a reload mid-clear left the data behind.
  clear(): Promise<void> {
    this.stack = [];
    this.pointer = -1;
    const cleared = this.store.clear();
    this.emit();
    return cleared;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private persist(): void {
    this.store.save({ stack: this.stack, pointer: this.pointer });
  }
}
