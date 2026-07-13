import { describe, it, expect, beforeEach } from "vitest";
import { UndoManager, type UndoSnapshot, type UndoStateData, type UndoBackend } from "../src/undo";

// In-memory backend so the manager's stack/pointer logic can be tested headless.
class FakeBackend implements UndoBackend {
  saved: UndoStateData | null = null;
  preset: UndoStateData | null = null;
  saves = 0;
  cleared = 0;
  // When a gate is armed, clear() blocks on it so a test can prove callers
  // await the committed wipe rather than fire-and-forgetting it.
  private clearGate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;
  deferClear() {
    this.clearGate = new Promise<void>((r) => (this.openGate = r));
  }
  releaseClear() {
    this.openGate?.();
  }
  async load() {
    return this.preset;
  }
  async save(state: UndoStateData) {
    // store a copy so later mutations don't alias
    this.saved = { stack: state.stack.slice(), pointer: state.pointer };
    this.saves++;
  }
  async clear() {
    this.cleared++;
    if (this.clearGate) await this.clearGate;
  }
}

const snap = (description: string): UndoSnapshot =>
  ({ description, config: {}, paint: {} }) as unknown as UndoSnapshot;

describe("UndoManager", () => {
  let store: FakeBackend;
  let mgr: UndoManager;
  beforeEach(() => {
    store = new FakeBackend();
    mgr = new UndoManager(store, 5);
  });

  it("starts empty and cannot undo/redo", () => {
    expect(mgr.isEmpty()).toBe(true);
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.undo()).toBeNull();
    expect(mgr.redo()).toBeNull();
  });

  it("undo/redo walk the stack and report the action", () => {
    mgr.push(snap("a"));
    mgr.push(snap("b"));
    mgr.push(snap("c"));
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);

    // Undo "c" → land on "b", and report that "c" was undone.
    const u = mgr.undo();
    expect(u?.action).toBe("c");
    expect(u?.snap.description).toBe("b");
    expect(mgr.canRedo()).toBe(true);

    // Redo → back to "c".
    const r = mgr.redo();
    expect(r?.snap.description).toBe("c");
    expect(mgr.canRedo()).toBe(false);
  });

  it("pushing after an undo truncates the redo branch", () => {
    mgr.push(snap("a"));
    mgr.push(snap("b"));
    mgr.push(snap("c"));
    mgr.undo(); // now at "b"
    mgr.undo(); // now at "a"
    expect(mgr.canRedo()).toBe(true);
    mgr.push(snap("d")); // replaces b,c
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.undo()?.snap.description).toBe("a");
  });

  it("evicts the oldest snapshot past maxSize", () => {
    for (const d of ["a", "b", "c", "d", "e", "f", "g"]) mgr.push(snap(d));
    // maxSize 5 → only the last 5 remain (c..g); a and b were evicted.
    expect(mgr.redo()).toBeNull(); // sitting at the newest
    let last: ReturnType<typeof mgr.undo> = null;
    while (mgr.canUndo()) last = mgr.undo();
    expect(last?.snap.description).toBe("c"); // oldest still reachable
    expect(mgr.undo()).toBeNull(); // can't go past it
  });

  it("clear empties the stack and clears the store", async () => {
    mgr.push(snap("a"));
    mgr.push(snap("b"));
    await mgr.clear();
    expect(mgr.isEmpty()).toBe(true);
    expect(mgr.canUndo()).toBe(false);
    expect(store.cleared).toBe(1);
  });

  it("clear() resolves only after the backend clear commits", async () => {
    // The in-memory wipe is synchronous, but the returned promise must not
    // resolve until the backend clear has committed — reset reloads the instant
    // it resolves, and a reload mid-wipe left the old stack behind.
    mgr.push(snap("a"));
    store.deferClear();
    let resolved = false;
    const done = mgr.clear().then(() => {
      resolved = true;
    });
    expect(mgr.isEmpty()).toBe(true); // in-memory wipe already happened
    await Promise.resolve();
    expect(resolved).toBe(false); // still waiting on the backend commit
    store.releaseClear();
    await done;
    expect(resolved).toBe(true);
  });

  it("persists to the backend on push/undo/redo", async () => {
    mgr.push(snap("a"));
    mgr.push(snap("b"));
    expect(store.saves).toBeGreaterThanOrEqual(2);
    expect(store.saved?.pointer).toBe(1);
    mgr.undo();
    expect(store.saved?.pointer).toBe(0);
  });

  it("init restores a persisted stack", async () => {
    store.preset = { stack: [snap("x"), snap("y")], pointer: 1 };
    await mgr.init();
    expect(mgr.isEmpty()).toBe(false);
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.undo()?.snap.description).toBe("x");
  });

  it("notifies subscribers", () => {
    let n = 0;
    const off = mgr.subscribe(() => n++);
    mgr.push(snap("a")); // emit
    mgr.push(snap("b")); // emit
    mgr.undo(); // emit
    expect(n).toBe(3);
    off();
    mgr.push(snap("c"));
    expect(n).toBe(3); // no more after unsubscribe
  });
});
