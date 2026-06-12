import { PaintStore, type PaintSnapshot } from "../store/paint";
import { UndoStore } from "../store/undo";
import { UndoManager, type UndoSnapshot } from "../undo";
import type { LayerManager } from "../layered/manager";

// Paint persistence + undo plumbing for the app. Every history operation runs
// through one FIFO queue, because captures and restores are async while the
// user keeps acting. Without the queue, a stroke's snapshot (still encoding
// its layer bitmaps) could land AFTER a Cmd+Z that followed it: the pointer
// moves back, then the late push re-appends the undone stroke on top, and the
// visible canvas disagrees with the history tip. Queued, the pending push
// lands first and the undo then undoes exactly that stroke.
export class AppHistory {
  private readonly undoManager: UndoManager;
  private readonly paintStore = new PaintStore();
  // The FIFO. Ops run one at a time in call order; each failure is caught at
  // the op so one bad capture can't leave the chain rejected (which would
  // silently stop history recording for the rest of the session).
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly layerManager: LayerManager,
    maxUndo: number,
  ) {
    const undoStore = new UndoStore<{ stack: UndoSnapshot[]; pointer: number }>();
    this.undoManager = new UndoManager(undoStore, maxUndo);
  }

  private enqueue(op: () => Promise<void> | void): Promise<void> {
    const next = this.chain.then(op).catch((e) => {
      console.warn("AppHistory: operation failed", e);
    });
    this.chain = next;
    return next;
  }

  // Boot restore. Call during module evaluation so it's first in the queue —
  // then a stroke finished while the async IDB load is still running waits
  // behind it instead of being overwritten by the loaded stack. Restores the
  // persisted paint via the caller's callback (which owns the UI refresh),
  // loads the persisted undo stack, and seeds an initial snapshot when there
  // is none.
  init(
    restorePaint: (paint: PaintSnapshot | null) => Promise<void>,
  ): Promise<void> {
    return this.enqueue(async () => {
      await restorePaint(await this.paintStore.load());
      await this.undoManager.init();
      if (this.undoManager.isEmpty()) {
        this.undoManager.push(await this.capture("Initial state"));
      }
    });
  }

  // Queue an undo snapshot of the current state. The capture samples the
  // state NOW — config and map points synchronously, and toBlob copies each
  // layer bitmap at invocation — so later mutations can't bleed in; the queue
  // only decides when the finished snapshot enters the stack, in call order.
  push(description: string): Promise<void> {
    const pending = this.capture(description);
    return this.enqueue(async () => {
      this.undoManager.push(await pending);
    });
  }

  // Undo/redo run through the same queue — behind any in-flight pushes, so a
  // Cmd+Z right after a stroke undoes that stroke — and `apply` (the caller's
  // restore-to-canvas) is awaited inside the op, so rapid steps can't
  // interleave their per-layer restores. Resolves with the stepped action's
  // description, or null when there was nothing to step.
  undo(apply: (snap: UndoSnapshot) => Promise<void>): Promise<string | null> {
    return this.step("undo", apply);
  }
  redo(apply: (snap: UndoSnapshot) => Promise<void>): Promise<string | null> {
    return this.step("redo", apply);
  }

  private step(
    kind: "undo" | "redo",
    apply: (snap: UndoSnapshot) => Promise<void>,
  ): Promise<string | null> {
    let action: string | null = null;
    return this.enqueue(async () => {
      const result =
        kind === "undo" ? this.undoManager.undo() : this.undoManager.redo();
      if (!result) return;
      await apply(result.snap);
      action = result.action ?? null;
    }).then(() => action);
  }

  // Wipe the history (New art / Load artwork). Queued, so a stroke snapshot
  // still encoding when the user confirms the dialog is wiped with the rest
  // instead of resurfacing inside the fresh stack.
  clear(): Promise<void> {
    return this.enqueue(() => {
      this.undoManager.clear();
    });
  }

  // Button-state reads stay instantaneous (no queue) — they only gate UI and
  // are re-read on every history event via subscribe.
  canUndo(): boolean {
    return this.undoManager.canUndo();
  }
  canRedo(): boolean {
    return this.undoManager.canRedo();
  }
  subscribe(fn: () => void): () => void {
    return this.undoManager.subscribe(fn);
  }

  // Persist the live paint to IDB. The snapshot is sampled at the call; the
  // save runs in queue order, so a slow earlier snapshot can't finish late
  // and overwrite a newer one.
  persistPaint(): void {
    const pending = this.layerManager.getPaintData();
    void this.enqueue(async () => {
      await this.paintStore.save(await pending);
    });
  }

  private capture(description: string): Promise<UndoSnapshot> {
    // Both halves are sampled synchronously here; only the blob encoding is
    // awaited. (getPaintData invokes toBlob on every layer before returning.)
    const config = this.layerManager.getConfig();
    return this.layerManager
      .getPaintData()
      .then((paint) => ({ config, paint, description }));
  }
}
