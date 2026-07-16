import { PaintStore, type PaintSnapshot } from "../store/paint";
import { UndoStore } from "../store/undo";
import { UndoManager, type UndoSnapshot } from "../undo";
import type { LayerManager } from "../layered/manager";
import { UndoStats, withStackReporting } from "./undo-stats";
import {
  type CaptureCut,
  type TileHost,
  TileShadow,
  type UndoTilesMode,
  readUndoTilesMode,
} from "./tile-capture";
import { TiledUndoStore } from "../store/undo-tiled";

// Paint persistence + undo plumbing for the app. Every history operation runs
// through one FIFO queue, because captures and restores are async while the
// user keeps acting. Without the queue, a stroke's snapshot (still encoding
// its layer bitmaps) could land AFTER a Cmd+Z that followed it: the pointer
// moves back, then the late push re-appends the undone stroke on top, and the
// visible canvas disagrees with the history tip. Queued, the pending push
// lands first and the undo then undoes exactly that stroke.
//
// Persistence model: the undo row at the pointer IS the persisted paint.
// Every push captures the full state (config + layer blobs + map points) and
// stores it as one IDB row; boot restores the pointer row; undo/redo persist
// only the pointer. There is no separate paint snapshot to keep in sync — the
// standalone PaintStore remains read-only, as the restore source for stacks
// saved before this scheme (and for seeding the very first snapshot).
export class AppHistory {
  private readonly undoManager: UndoManager<UndoSnapshot>;
  private readonly paintStore = new PaintStore();
  // The FIFO. Ops run one at a time in call order; each failure is caught at
  // the op so one bad capture can't leave the chain rejected (which would
  // silently stop history recording for the rest of the session).
  private chain: Promise<void> = Promise.resolve();

  // Instrumentation for the tile-undo baseline; a no-op unless
  // localStorage["nekudot.undoStats"] is on (see undo-stats.ts). Injectable so
  // tests can force it on/off and capture the log.
  private readonly stats: UndoStats;

  // Shadow-mode tile capture + reconstruction verify (tile-undo PR9). Null when
  // the flag is off or no host is wired (node tests). Fail-safe: any error
  // disables it so a shadow bug can never break real undo. Tolerance 0 - the tile
  // path is exact; degraded/full-snapshot layers are skipped by the verifier.
  private tileShadow: TileShadow | null = null;
  private shadowBroken = false;
  // "on" mode (opt-in): the tile chain drives undo/redo restore + persists to v2.
  // Default "shadow" leaves the live path unchanged (capture + verify only).
  private readonly tilesMode: UndoTilesMode = "off";
  private readonly tiledStore: TiledUndoStore | null = null;

  constructor(
    private readonly layerManager: LayerManager,
    maxUndo: number,
    stats: UndoStats = new UndoStats(),
    tileHost?: TileHost,
  ) {
    this.stats = stats;
    const backend = new UndoStore<UndoSnapshot>();
    this.undoManager = new UndoManager<UndoSnapshot>(
      // The stack-bytes tap only wraps the backend when stats are on, so the
      // normal path keeps the bare store with no extra indirection.
      stats.enabled ? withStackReporting(backend, stats) : backend,
      maxUndo,
    );
    this.tilesMode = tileHost ? readUndoTilesMode() : "off";
    if (tileHost && this.tilesMode !== "off") {
      this.tileShadow = new TileShadow(tileHost, maxUndo, (detail) =>
        this.stats.noteTileMismatch(this.tileShadow?.mismatches ?? 0, detail),
      );
      if (this.tilesMode === "on") this.tiledStore = new TiledUndoStore();
    }
  }

  private guardShadow<T>(fn: () => T): T | undefined {
    if (!this.tileShadow || this.shadowBroken) return undefined;
    try {
      return fn();
    } catch (e) {
      this.shadowBroken = true;
      this.tileShadow = null;
      console.warn("AppHistory: tile shadow disabled after error", e);
      return undefined;
    }
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
  // behind it instead of being overwritten by the loaded stack. Loads the
  // persisted undo stack and restores the pointer row's paint via the
  // caller's callback (which owns the UI refresh); with no stack, falls back
  // to the legacy standalone paint snapshot and seeds an initial snapshot.
  init(
    restorePaint: (paint: PaintSnapshot | null) => Promise<void>,
  ): Promise<void> {
    // Log the storage estimate at boot (no-op when the flag is off). Deliberately
    // not awaited: it must not gate the first FIFO op behind a storage query.
    void this.stats.logStorageEstimate();
    return this.enqueue(async () => {
      await this.undoManager.init();
      const current = this.undoManager.current();
      if (current) {
        await restorePaint(current.paint);
        // The stack rows are the paint source of truth now; drop the legacy
        // snapshot so a later stack wipe can't resurface stale paint. Awaited so
        // boot only completes once the drop has committed.
        await this.paintStore.clear();
      } else {
        await restorePaint(await this.paintStore.load());
        this.undoManager.push(await this.capture("Initial state"));
      }
      // Seed the shadow base from the just-restored live state (after this, every
      // stroke's delta is captured and verified against it).
      this.guardShadow(() => this.tileShadow?.seedBase());
    });
  }

  // Queue an undo snapshot of the current state. The capture samples the
  // state NOW — config and map points synchronously, and toBlob copies each
  // layer bitmap at invocation — so later mutations can't bleed in; the queue
  // only decides when the finished snapshot enters the stack, in call order.
  push(description: string): Promise<void> {
    const pending = this.stats.measureCapture(description, this.capture(description));
    // Same atomic moment as the snapshot cut above (both sample the live state now).
    const cut = this.guardShadow(() => this.tileShadow?.cut()) ?? null;
    return this.enqueue(async () => {
      this.undoManager.push(await pending);
      if (cut) await this.commitAndVerify(cut);
      if (this.tilesMode === "on") await this.persistTiles();
    });
  }

  private async persistTiles(): Promise<void> {
    if (!this.tileShadow || !this.tiledStore || this.shadowBroken) return;
    try {
      await this.tiledStore.save(await this.tileShadow.serialize());
    } catch (e) {
      console.warn("AppHistory: tile persist failed", e);
    }
  }

  private async commitAndVerify(cut: CaptureCut): Promise<void> {
    const shadow = this.tileShadow;
    if (!shadow || this.shadowBroken) return;
    try {
      await shadow.commitCut(cut);
      await shadow.verify(0);
    } catch (e) {
      this.shadowBroken = true;
      this.tileShadow = null;
      console.warn("AppHistory: tile shadow disabled after error", e);
    }
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
      if (this.tilesMode === "on" && this.tileShadow && !this.shadowBroken) {
        this.tileShadow.step(kind);
        await this.stats.measureRestore(kind, () => this.restoreOnMode(result.snap, apply));
        await this.persistTiles();
      } else {
        await this.stats.measureRestore(kind, () => apply(result.snap));
        if (this.tileShadow) await this.stepAndVerify(kind);
      }
      action = result.action ?? null;
    }).then(() => action);
  }

  // Wipe the history (New art / Load artwork). Queued, so a stroke snapshot
  // still encoding when the user confirms the dialog is wiped with the rest
  // instead of resurfacing inside the fresh stack. Also drops any legacy
  // paint snapshot — if the tab closes before the caller's follow-up push
  // lands, the next boot must not restore the pre-wipe paint.
  clear(): Promise<void> {
    return this.enqueue(async () => {
      // Await both IDB clears so the returned promise only resolves once they've
      // actually committed. resetToDefault reloads the instant this resolves, and
      // a reload mid-clear left the data behind (the reset didn't stick); the
      // queued follow-up push (New art / Load artwork) also now lands after the
      // wipe, not racing it.
      await Promise.all([
        this.undoManager.clear(),
        this.paintStore.clear(),
        this.tiledStore?.clear() ?? Promise.resolve(),
      ]);
      this.guardShadow(() => this.tileShadow?.reset());
    });
  }

  // On-mode restore: apply the tile-reconstructed paint through the normal apply
  // path; on any failure or an add/remove-layer step (reconstruct returns null),
  // fall back to today's snapshot so paint is never lost.
  private async restoreOnMode(
    snap: UndoSnapshot,
    apply: (snap: UndoSnapshot) => Promise<void>,
  ): Promise<void> {
    try {
      const paint = this.tileShadow ? await this.tileShadow.reconstructPaintSnapshot() : null;
      if (paint) {
        await apply({ config: snap.config, paint });
        return;
      }
    } catch (e) {
      console.warn("AppHistory: tile restore failed, using snapshot", e);
    }
    await apply(snap);
  }

  private async stepAndVerify(kind: "undo" | "redo"): Promise<void> {
    const shadow = this.tileShadow;
    if (!shadow || this.shadowBroken) return;
    try {
      shadow.step(kind);
      await shadow.verify(0);
    } catch (e) {
      this.shadowBroken = true;
      this.tileShadow = null;
      console.warn("AppHistory: tile shadow disabled after error", e);
    }
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

  private capture(description: string): Promise<UndoSnapshot> {
    // Both halves are sampled synchronously here; only the blob encoding is
    // awaited. (getPaintData invokes toBlob on every layer before returning.)
    const config = this.layerManager.getConfig();
    return this.layerManager
      .getPaintData()
      .then((paint) => ({ config, paint, description }));
  }
}
