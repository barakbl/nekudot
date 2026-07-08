import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { BlobStore, hashBlob } from "../src/log/blobs";

// The content-hash blob store for pasted images (vector-replay). Real IDB semantics
// via fake-indexeddb; SHA-256 via the node global crypto.subtle.

const g = globalThis as { indexedDB?: unknown; IDBKeyRange?: unknown };
g.IDBKeyRange = IDBKeyRange;
beforeEach(() => {
  g.indexedDB = new IDBFactory();
});

describe("BlobStore + hashBlob (paste blob store)", () => {
  it("hashBlob is a stable content address (same bytes -> same key, different -> different)", async () => {
    const a = await hashBlob(new Blob([new Uint8Array([1, 2, 3, 4])]));
    const b = await hashBlob(new Blob([new Uint8Array([1, 2, 3, 4])]));
    const c = await hashBlob(new Blob([new Uint8Array([1, 2, 3, 5])]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("put then get round-trips a blob by hash; an unknown hash is undefined", async () => {
    const store = new BlobStore();
    const blob = new Blob([new Uint8Array([9, 8, 7])], { type: "image/png" });
    const hash = await hashBlob(blob);
    await store.put(hash, blob);
    const got = await store.get(hash);
    expect(got).toBeInstanceOf(Blob);
    const bytes = got ? new Uint8Array(await got.arrayBuffer()) : null;
    expect(bytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(await store.get("00deadbeef")).toBeUndefined();
  });

  it("dedupes by hash: re-putting the same key is idempotent", async () => {
    const store = new BlobStore();
    const blob = new Blob([new Uint8Array([1])]);
    const hash = await hashBlob(blob);
    await store.put(hash, blob);
    await store.put(hash, blob);
    expect(await store.get(hash)).toBeInstanceOf(Blob);
  });
});
