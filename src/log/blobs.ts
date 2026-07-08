import { createDbOpener } from "../store/open-idb";

// Content-hash blob store for the event log (vector-replay): pasted images live
// here, keyed by the SHA-256 hex of their bytes, and a PasteImage event only
// carries that hash. Keyed by hash (not autoIncrement) so re-pasting the same
// image stores it once. A close sibling of EventLogStore (src/log/store.ts) on its
// own db; never evicts (the log references these hashes).

const DB_NAME = "nekudot-blobs";
const DB_VERSION = 1;
const STORE = "blobs";
const OPEN_TIMEOUT_MS = 4000;

export type BlobBackend = {
  put(hash: string, blob: Blob): Promise<void>;
  get(hash: string): Promise<Blob | undefined>;
};

export class BlobStore implements BlobBackend {
  private readonly open = createDbOpener({
    dbName: DB_NAME,
    version: DB_VERSION,
    timeoutMs: OPEN_TIMEOUT_MS,
    upgrade: (db) => {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); // out-of-line keys (the hash)
    },
  });

  async put(hash: string, blob: Blob): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async get(hash: string): Promise<Blob | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(hash);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
  }
}

// SHA-256 hex of a blob's bytes - the content-address key. Same bytes -> same key,
// so paste dedupes and replay resolves the image by hash.
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
