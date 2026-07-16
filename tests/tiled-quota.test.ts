import { describe, it, expect, vi } from "vitest";

import { recoverTileQuota } from "../src/app/history";
import type { StoredChain } from "../src/store/undo-tiled";

// A full-disk DOMException surfaces as a QuotaExceededError; recovery keys off its
// name, so a plain Error carrying that name stands in fine.
const quotaErr = () => {
  const e = new Error("disk full");
  e.name = "QuotaExceededError";
  return e;
};

class FakeShadow {
  redoTailDrops = 0;
  compactions = 0;
  dropRedoTail(): boolean {
    this.redoTailDrops++;
    return true;
  }
  async compactNow(): Promise<void> {
    this.compactions++;
  }
  async serialize(): Promise<StoredChain> {
    return {} as StoredChain;
  }
}

// Throws `failWith` for the first `failCount` saves, then succeeds.
class FakeStore {
  saves = 0;
  constructor(
    private failCount: number,
    private failWith: Error = quotaErr(),
  ) {}
  async save(): Promise<void> {
    this.saves++;
    if (this.saves <= this.failCount) throw this.failWith;
  }
}

describe("recoverTileQuota", () => {
  it("dropping the redo tail alone can make room (no compaction, no toast)", async () => {
    const shadow = new FakeShadow();
    const store = new FakeStore(0); // the post-shrink retry succeeds
    const notify = vi.fn();
    await recoverTileQuota(shadow, store, notify);
    expect(shadow.redoTailDrops).toBe(1);
    expect(shadow.compactions).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("escalates to compaction when the shrink retry still fails", async () => {
    const shadow = new FakeShadow();
    const store = new FakeStore(1); // first retry fails, the post-compact retry lands
    const notify = vi.fn();
    await recoverTileQuota(shadow, store, notify);
    expect(shadow.redoTailDrops).toBe(1);
    expect(shadow.compactions).toBe(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("warns once and keeps in-memory history when nothing frees room", async () => {
    const shadow = new FakeShadow();
    const store = new FakeStore(99); // every save keeps throwing quota
    const notify = vi.fn();
    await recoverTileQuota(shadow, store, notify);
    expect(shadow.redoTailDrops).toBe(1);
    expect(shadow.compactions).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("stops without a toast on a non-quota error (shrinking won't fix it)", async () => {
    const shadow = new FakeShadow();
    const store = new FakeStore(1, new Error("some other failure"));
    const notify = vi.fn();
    await recoverTileQuota(shadow, store, notify);
    expect(shadow.redoTailDrops).toBe(1);
    expect(shadow.compactions).toBe(0); // bailed after the non-quota retry
    expect(notify).not.toHaveBeenCalled();
  });
});
