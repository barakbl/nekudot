# Architecture report: async/sync model, boot, and what to improve

Measured 2026-06-12 against the live app (headless Chrome via CDP, dev server,
1276x709 stage at dpr 2, instrumented `toBlob` / IndexedDB `put` /
`localStorage.setItem` / long-task observer). Bundle numbers from production
builds (`vite build`, plus a probe build with zod externalized).

## 1. How sync vs async works today

### The synchronous hot path (good - keep it)
Pointer event -> `app/drawing-input.ts` -> `BrushBase.stroke()` -> Canvas2D
calls on the active layer. No awaits anywhere in the draw path; coalesced
sub-samples are drawn in the same task. Measured: **zero long tasks** during
boot and during 60-point strokes - the UI thread never janks. PNG encoding
(`toBlob`) happens off the main thread in Chrome, so even heavy persistence
doesn't block drawing.

### The asynchronous rails
- **History FIFO** (`app/history.ts`): init / push / undo / redo / clear /
  persist all run through one queue (since `49be6f1`). Captures sample state
  synchronously at the call; only blob encoding and IDB writes happen async.
- **PixelLog** (`pixel-log.ts`): rows append in memory synchronously; `flush()`
  on stroke end rewrites the whole array to IDB.
- **Custom presets** (`app/presets.ts`): restored from IDB after boot; a
  persisted custom art style applies late (the default covers the gap).
- **Stores**: every IDB/localStorage failure is `console.warn` or silently
  swallowed; nothing surfaces to the user.

### Boot sequence
1. Module evaluation builds the entire DOM synchronously (stage, layers,
   panels, navbar) - cold DCL **70 ms**, warm **57 ms** (dev server).
2. `history.init(...)` is enqueued during evaluation (guaranteed first in the
   queue): restores persisted paint -> pixel log -> undo stack -> seeds an
   "Initial state" snapshot if empty. Warm reload showed restored paint
   visible essentially immediately (~1 ms after the pill appeared).
3. Brush settings + theme restore synchronously from localStorage.

There are no external assets: one JS bundle + one CSS file, no fonts, no
network calls after load. JS heap after boot: ~6 MB.

## 2. Measured costs

| What | Measured |
|---|---|
| Cold boot DCL / warm | 70 ms / 57 ms |
| Canvas backing memory (2 layers + 5 aux canvases) | **55 MB** at dpr 2; ~13.8 MB per full-screen canvas; 5 layers => ~95-110 MB |
| Per stroke end | **4 full-canvas PNG encodes** (2 layers x [undo capture + paint persist]) + **3 IDB puts** (paint snapshot, whole undo stack, whole pixel log) |
| Encode backlog under bursts | cumulative `toBlob` callback latency reached **~39 s** across a 9-stroke burst - callbacks lag seconds behind their calls; IDB puts pile up (16 observed draining) |
| Storage growth | 2.8 MB after ~10 small strokes on a near-blank canvas |
| Bundle | 237.5 KB min / 68.8 KB gz; **zod ~72 KB min (~19 KB gz, ~30%)**, fflate ~12 KB (used subset), d3-quadtree ~5 KB |
| Resize / unload handling | none in the codebase |

## 3. Improvements - stability

**S1. Gate input during boot restore.** A stroke drawn while `history.init` is
still restoring gets stomped by `applyPaintData` (and its points survive in the
maps, leaving ghost connections). Ignore pointer-down until init resolves (or
show a brief "restoring" state). Small, removes the last boot race.

**S2. Flush on `pagehide`/`visibilitychange`.** With the measured multi-second
write backlog under bursts, closing the tab right after drawing can lose the
last strokes' paint/undo/pixel-log writes. On hide: kick a final
`persistPaint()` + `pixelLog.flush()` and let pending IDB transactions drain.

**S3. Surface persistence failures.** Quota exhaustion today = silent
(`LocalStorageStore.set` swallows; IDB stores only `console.warn`). The user
keeps drawing believing work is saved. Show a one-time chip ("changes are not
being saved") and retry with backoff.

**S4. Multi-tab safety.** Two tabs share the same IDB keys (paint snapshot,
undo stack, pixel log) - last writer wins, and the stacks interleave
nonsensically. Cheapest: Web Locks (`navigator.locks`) around the app, second
tab gets read-only + a notice. Or BroadcastChannel detection + warning.

**S5. Window resize / dpr change.** Canvas size is fixed at boot; resizing the
window (or moving to a different-dpr display) leaves the stage misaligned until
reload. Decide a policy - at minimum re-center and clamp; overlays could be
rebuilt on `resize` cheaply since they're transient.

**S6. Coalesce queued persists.** Only the newest paint snapshot matters; when
several `persistPaint` ops are queued, the older ones still encode and write.
Skip an op if a newer persist is already queued.

## 4. Improvements - efficiency

**E1. Stop PNG-encoding for undo (biggest win).** Each stroke end encodes every
layer twice (undo capture + persist). In-memory undo doesn't need PNG at all:
snapshot layers with `createImageBitmap(canvas)` (fast, GPU-side copy) and keep
bitmaps in the 10-deep stack; encode PNG only for the IDB-persisted latest
state. This removes the 4-encodes-per-stroke pipeline and the burst backlog
entirely. (Persisting the undo stack across reloads can keep encoding lazily or
be dropped - it's a nice-to-have.)

**E2. Incremental undo persistence.** `UndoStore.save` rewrites the entire
stack (10 snapshots x layers x PNG bytes) into IDB on every push. Store one row
per snapshot + a small pointer row: push = 1 blob put + 1 tiny put; eviction =
1 delete.

**E3. Append-only pixel log in IDB.** `PixelLog.flush` rewrites all (up to
100k) rows per stroke. Use auto-increment keys and append only the new rows
since the last flush; trim with a ranged delete.

**E4. Dirty-layer tracking.** A stroke touches one layer, yet persist encodes
all of them. Track a per-layer dirty flag; reuse the previous blob for clean
layers.

**E5. Split the bundle.** zod is ~30% of the app and fflate is only used for
save/load. Dynamic-import the artwork save/load path (fflate +
nekudot-schema + preset-io, which also pulls most zod usage); if the remaining
boot-path zod (LayersConfigSchema, connecting-types schemas) is replaced with
small hand-rolled guards, initial JS drops to roughly 150 KB min / ~45 KB gz.

**E6. Canvas memory.** ~13.8 MB per full-screen dpr-2 canvas; with 5 layers +
overlays + wet buffer that's ~120 MB+ (more on larger/retina screens). The
guide/highlight overlays don't need dpr-2 fidelity - rendering them at dpr 1
halves their cost; everything else is inherent to the layered design and fine.

**E7. Throttle localStorage writes.** Sliders persist on every `input` event
(synchronous JSON.stringify + write on the main thread). Persist on change-end
or behind a rAF. Minor, free.

**E8. Parallelize restore.** `applyPaintData` awaits each layer's
`createImageBitmap` serially; `Promise.all` them. Matters for many-layer
artworks on reload.

## 5. What's already solid (keep)

- Fully synchronous draw path, zero long tasks observed.
- The serialized history FIFO with point-in-time captures (race fix `49be6f1`).
- Lazy wet-stroke buffer; on-demand highlight overlay sizing.
- Bounded growth: point clouds capped (MAX_PIXELS 50k, oldest-evicted), pixel
  log capped (100k rows).
- Defensive load path: zod-validated manifest, per-entry inflate caps
  (zip-bomb defence), validated pixel-log rows.
- No external/runtime assets; instant warm restore.

## 6. Suggested order

1. E1 + E2 (kills the write amplification and the burst backlog - the main
   stability *and* efficiency lever)
2. S2 (durability on close - cheap once E1 shrinks the backlog)
3. S1 (boot input gate - small)
4. S3 (quota surfacing - small)
5. E3, E4, E7 (write-path trims)
6. E5 (bundle split)
7. S4, S5, E6, E8 (as they start to matter)
