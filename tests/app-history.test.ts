import { describe, it, expect, beforeEach, vi } from "vitest";

// This suite uses the shared LayerManager harness, extended with an ASYNC toBlob
// so captures genuinely take time - that's what the races are made of.
// `toBlobDelay` slows the encoding; `failNextToBlob` makes one capture reject.
let toBlobDelay = 1;
let failNextToBlob = false;
const raceToBlob = (cb: (b: Blob | null) => void) => {
  if (failNextToBlob) {
    failNextToBlob = false;
    throw new Error("toBlob boom");
  }
  setTimeout(() => cb(null), toBlobDelay);
};

import type { LayerManager } from "../src/layered/manager";
import { AppHistory } from "../src/app/history";
import { UndoStats } from "../src/app/undo-stats";
import {
  installDocumentStub,
  makeCanvasStub,
  newManager,
} from "./_layer-manager-harness";

installDocumentStub(() => makeCanvasStub(raceToBlob));

// There is no IndexedDB in node — the Paint/Undo stores warn and fall back to
// null/no-op, which is exactly the bare environment these tests want.

describe("AppHistory serialization", () => {
  let manager: LayerManager;
  let history: AppHistory;

  beforeEach(async () => {
    toBlobDelay = 1;
    failNextToBlob = false;
    manager = newManager();
    history = new AppHistory(manager, 10);
    await history.init(async () => {}); // seeds "Initial state"
  });

  it("an undo right after a push undoes that push (the pending capture lands first)", async () => {
    history.push("stroke 1"); // capture still encoding its blobs
    const applied: (string | undefined)[] = [];
    const action = await history.undo(async (snap) => {
      applied.push(snap.description);
    });
    // Unqueued, the undo would run before the push landed: nothing to undo
    // (action null), and the stroke would then re-append on top of it.
    expect(action).toBe("stroke 1");
    expect(applied).toEqual(["Initial state"]);
    expect(history.canRedo()).toBe(true);
  });

  it("captures are point-in-time: config sampled at push, not when blobs finish", async () => {
    toBlobDelay = 10;
    const pushed = history.push("rename race");
    manager.setName(0, "renamed-later"); // mutate while the capture encodes
    await pushed;
    await history.undo(async () => {}); // back to Initial
    let captured: string | undefined;
    const action = await history.redo(async (snap) => {
      captured = snap.config.layers[0].name;
    });
    expect(action).toBe("rename race");
    expect(captured).toBe("Layer 1"); // the name at push time, not the later one
  });

  it("a failed capture is dropped without poisoning later pushes", async () => {
    failNextToBlob = true;
    await history.push("bad"); // capture rejects; the op is caught
    await history.push("good");
    const action = await history.undo(async () => {});
    expect(action).toBe("good");
  });

  it("clear() wipes pushes queued before it instead of letting them resurface", async () => {
    history.push("stale stroke"); // pending when the user confirms New art
    void history.clear();
    await history.push("New art");
    expect(history.canUndo()).toBe(false); // only "New art" in the fresh stack
    expect(await history.undo(async () => {})).toBeNull();
  });

  it("clear() resolves only after both IDB clears commit (so reset can't reload mid-wipe)", async () => {
    // Make the underlying undo + paint clears deferred; clear() must await both.
    // Before the fix the enqueued op didn't await them, so clear() resolved
    // immediately and resetToDefault reloaded before the wipe committed.
    let resolveUndo!: () => void;
    let resolvePaint!: () => void;
    const undoCleared = new Promise<void>((r) => (resolveUndo = r));
    const paintCleared = new Promise<void>((r) => (resolvePaint = r));
    const h = history as unknown as {
      undoManager: { clear: () => Promise<void> };
      paintStore: { clear: () => Promise<void> };
    };
    h.undoManager.clear = () => undoCleared;
    h.paintStore.clear = () => paintCleared;

    let resolved = false;
    const done = history.clear().then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false); // still waiting on the deferred clears

    resolveUndo();
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false); // one done, still waiting on the other

    resolvePaint();
    await done;
    expect(resolved).toBe(true);
  });

  it("init awaits the legacy paint drop before completing (restore branch)", async () => {
    // When boot restores a persisted pointer row, init drops the legacy paint
    // snapshot. That drop must be awaited: a tab closed right after boot would
    // otherwise leave the stale snapshot to resurface on the next boot.
    const m = newManager();
    const h = new AppHistory(m, 10);
    const inner = h as unknown as {
      undoManager: { init: () => Promise<void>; current: () => unknown };
      paintStore: { clear: () => Promise<void> };
    };
    // Force the restore branch and make the legacy drop deferred.
    inner.undoManager.init = async () => {};
    inner.undoManager.current = () => ({ config: {}, paint: {} });
    let releaseClear!: () => void;
    let clearDone = false;
    inner.paintStore.clear = () =>
      new Promise<void>((r) => (releaseClear = r)).then(() => {
        clearDone = true;
      });

    let initDone = false;
    const done = h.init(async () => {}).then(() => {
      initDone = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(initDone).toBe(false); // blocked on the deferred legacy drop
    releaseClear();
    await done;
    expect(initDone).toBe(true);
    expect(clearDone).toBe(true);
  });

  it("with stats off, the instrumentation never fires through push/undo", async () => {
    const log = vi.fn();
    const h = new AppHistory(manager, 10, new UndoStats({ enabled: false, log }));
    await h.init(async () => {});
    await h.push("stroke 1");
    await h.undo(async () => {});
    expect(log).not.toHaveBeenCalled();
  });

  it("with stats on, push logs a capture and undo logs a restore", async () => {
    const log = vi.fn();
    const h = new AppHistory(manager, 10, new UndoStats({ enabled: true, log, now: () => 0 }));
    await h.init(async () => {}); // seeds "Initial state" (a push)
    await h.push("stroke 1");
    await h.undo(async () => {});
    const text = log.mock.calls.map((c) => c[0]).join("\n");
    expect(text).toContain('capture "stroke 1"');
    expect(text).toContain("undo restore:");
    expect(text).toContain("stack:"); // the backend save tap reported bytes
  });

  it("rapid undo+redo serialize their applies (no interleaving)", async () => {
    await history.push("stroke 1");
    let inFlight = 0;
    let maxInFlight = 0;
    const apply = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    };
    const [u, r] = await Promise.all([history.undo(apply), history.redo(apply)]);
    expect(u).toBe("stroke 1");
    expect(r).toBe("stroke 1");
    expect(maxInFlight).toBe(1);
  });
});
