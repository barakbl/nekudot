import type { UndoBackend, UndoSnapshot, UndoStateData } from "../undo";
import { UndoStore, type UndoStoreBackend } from "./undo";

// The on-mode UndoManager backend. The delta chain lives in the v2 keys; this keeps
// the OLD v1 keys (meta/row) holding a 1-deep stack of just the pointer snapshot -
// simultaneously the rollback artifact (a rolled-back build's UndoStore reads it
// unchanged) and the boot safety net when the v2 chain is holed. save() writes only
// stack[pointer], debounced: a full PaintSnapshot per stroke is the exact cost tile
// undo removes. load()/clear() delegate, so it also adopts a pre-migration N-deep v1
// stack on the first on-mode boot (before it shrinks to 1).

const DEBOUNCE_MS = 5000;

export class ShadowKeyframeStore implements UndoBackend<UndoSnapshot> {
  private inner: UndoStore<UndoSnapshot>;
  private pending: UndoStateData<UndoSnapshot> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // The most recent flush, so flush()/clear() callers can await a committed write.
  private tail: Promise<void> = Promise.resolve();

  constructor(
    backend?: UndoStoreBackend,
    private readonly debounceMs = DEBOUNCE_MS,
  ) {
    this.inner = new UndoStore<UndoSnapshot>(backend);
  }

  load(): Promise<UndoStateData<UndoSnapshot> | null> {
    return this.inner.load();
  }

  // Record the latest pointer keyframe and (re)arm the debounce; the real IDB write
  // is deferred so a burst of strokes writes at most one snapshot per window.
  save(state: UndoStateData<UndoSnapshot>): Promise<void> {
    this.pending = oneDeep(state);
    if (this.timer == null && typeof setTimeout !== "undefined") {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.debounceMs);
    }
    return Promise.resolve();
  }

  // Persist any pending keyframe now (pagehide / visibilitychange:hidden). A no-op
  // when nothing is pending.
  flush(): Promise<void> {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const p = this.pending;
    this.pending = null;
    if (!p) return this.tail;
    this.tail = this.inner.save(p);
    return this.tail;
  }

  clear(): Promise<void> {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    return this.inner.clear();
  }
}

// The pointer snapshot as a 1-deep v1 state. Reusing the same snapshot OBJECT lets
// UndoStore's identity diff keep the row across coalesced writes, swapping it only
// when the pointer moves.
function oneDeep(state: UndoStateData<UndoSnapshot>): UndoStateData<UndoSnapshot> {
  const snap = state.stack[state.pointer];
  return snap ? { stack: [snap], pointer: 0 } : { stack: [], pointer: -1 };
}
