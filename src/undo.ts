import type { LayersConfig } from "./layered/schema";
import type { PaintSnapshot } from "./store/paint";

export type UndoSnapshot = {
  config: LayersConfig;
  paint: PaintSnapshot;
  description?: string;
};

export type UndoResult = {
  snap: UndoSnapshot;
  action?: string;
};

export type UndoStateData = {
  stack: UndoSnapshot[];
  pointer: number;
};

// Minimal store interface — UndoManager doesn't know it's IndexedDB.
export type UndoBackend = {
  load(): Promise<UndoStateData | null>;
  save(state: UndoStateData): Promise<void>;
  clear(): Promise<void>;
};

export class UndoManager {
  private stack: UndoSnapshot[] = [];
  private pointer = -1;
  private listeners = new Set<() => void>();

  constructor(
    private store: UndoBackend,
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

  push(snap: UndoSnapshot): void {
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

  canUndo(): boolean {
    return this.pointer > 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  undo(): UndoResult | null {
    if (!this.canUndo()) return null;
    // The action being undone is the one that produced the current snapshot
    // (which we're about to leave behind).
    const undone = this.stack[this.pointer];
    this.pointer--;
    this.persist();
    this.emit();
    return { snap: this.stack[this.pointer], action: undone.description };
  }

  redo(): UndoResult | null {
    if (!this.canRedo()) return null;
    this.pointer++;
    this.persist();
    this.emit();
    const snap = this.stack[this.pointer];
    return { snap, action: snap.description };
  }

  clear(): void {
    this.stack = [];
    this.pointer = -1;
    this.store.clear();
    this.emit();
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
