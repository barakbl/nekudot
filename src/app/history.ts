import { PaintStore, type PaintSnapshot } from "../store/paint";
import { UndoStore } from "../store/undo";
import { UndoManager, type UndoSnapshot } from "../undo";
import type { LayerManager } from "../layered/manager";

// Paint persistence + undo plumbing: captures config+paint snapshots of the
// LayerManager, keeps undo pushes ordered (captures are async), and persists
// the live paint to IndexedDB.
export class AppHistory {
  readonly undoManager: UndoManager;
  private readonly paintStore = new PaintStore();
  private pushChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly layerManager: LayerManager,
    maxUndo: number,
  ) {
    const undoStore = new UndoStore<{ stack: UndoSnapshot[]; pointer: number }>();
    this.undoManager = new UndoManager(undoStore, maxUndo);
  }

  // Queue an undo snapshot of the current state. The capture starts right away
  // (so the snapshot reflects the moment of the call); pushes land in order.
  push(description: string): void {
    const pending = this.capture(description);
    this.pushChain = this.pushChain.then(async () => {
      this.undoManager.push(await pending);
    });
  }

  persistPaint(): void {
    this.layerManager.getPaintData().then((snap) => this.paintStore.save(snap));
  }

  loadPaint(): Promise<PaintSnapshot | null> {
    return this.paintStore.load();
  }

  private async capture(description: string): Promise<UndoSnapshot> {
    const paint = await this.layerManager.getPaintData();
    return { config: this.layerManager.getConfig(), paint, description };
  }
}
