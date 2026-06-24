import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Minimal DOM stub (same pattern as active-connection.test.ts) with an async
// toBlob, so captures genuinely take time — that's what the races are made of.
// `toBlobDelay` slows the encoding; `failNextToBlob` makes one capture reject.
// ---------------------------------------------------------------------------
let toBlobDelay = 1;
let failNextToBlob = false;

function makeCanvasStub(): HTMLCanvasElement {
  const canvas: Record<string, unknown> = {
    width: 0,
    height: 0,
    style: {},
    remove() {},
    toBlob(cb: (b: Blob | null) => void) {
      if (failNextToBlob) {
        failNextToBlob = false;
        throw new Error("toBlob boom");
      }
      setTimeout(() => cb(null), toBlobDelay);
    },
  };
  const ctx = new Proxy(
    { canvas } as Record<string, unknown>,
    {
      get: (t, p) => (p in t ? t[p as string] : () => {}),
      set: (t, p, v) => {
        t[p as string] = v;
        return true;
      },
    },
  );
  canvas.getContext = () => ctx;
  return canvas as unknown as HTMLCanvasElement;
}

(globalThis as { document?: unknown }).document = {
  createElement: (tag: string) =>
    tag === "canvas"
      ? makeCanvasStub()
      : { style: {}, appendChild() {}, remove() {} },
};

import { LayerManager } from "../src/layered/manager";
import { AppHistory } from "../src/app/history";

const container = { style: {}, appendChild() {} } as unknown as HTMLElement;
const newManager = (): LayerManager =>
  new LayerManager({ container, size: { width: 100, height: 100 }, dpr: 1 });

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
    expect(captured).toBe("layer-1"); // the name at push time, not the later one
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
