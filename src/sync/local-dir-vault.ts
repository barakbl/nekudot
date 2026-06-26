import { IndexedDbStore } from "../store/indexeddb";
import type { FileVault, VaultEntry } from "./file-vault";

// FileVault backed by a local folder via the Chrome File System Access API. The
// chosen directory handle is persisted in IndexedDB (handles are structured-
// cloneable, so IDB stores them natively) and re-attached on the next visit -
// re-requesting permission when the browser has let the grant lapse.

const handles = new IndexedDbStore("nekudot-sync", "handles");
const DIR_KEY = "dir";

export class LocalDirVault implements FileVault {
  private dir: FileSystemDirectoryHandle | null = null;
  // A handle restored from storage whose permission lapsed: kept so connect()
  // can re-request it (under a user gesture) instead of forcing a fresh pick.
  private pending: FileSystemDirectoryHandle | null = null;

  readonly supported =
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function";

  label(): string | null {
    return this.dir?.name ?? null;
  }

  isConnected(): boolean {
    return this.dir !== null;
  }

  async restore(): Promise<boolean> {
    if (!this.supported) return false;
    let handle: FileSystemDirectoryHandle | null;
    try {
      handle = await handles.get<FileSystemDirectoryHandle>(DIR_KEY);
    } catch {
      handle = null;
    }
    if (!handle) return false;
    if ((await queryPerm(handle)) === "granted") {
      this.dir = handle;
      return true;
    }
    this.pending = handle; // re-grant needs a gesture; surfaced via connect()
    return false;
  }

  async connect(): Promise<boolean> {
    if (!this.supported) return false;
    // Re-grant a previously chosen folder without a fresh pick when possible.
    if (this.pending) {
      const granted = (await requestPerm(this.pending)) === "granted";
      if (granted) {
        this.dir = this.pending;
        this.pending = null;
        return true;
      }
      this.pending = null; // fall through to a fresh pick
    }
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ id: "nekudot", mode: "readwrite" });
    } catch {
      return false; // user dismissed the OS dialog (AbortError)
    }
    await safePut(handle);
    this.dir = handle;
    return true;
  }

  async disconnect(): Promise<void> {
    this.dir = null;
    this.pending = null;
    try {
      await handles.delete(DIR_KEY);
    } catch {
      // best-effort; a stale handle is harmless (re-grant fails -> re-pick)
    }
  }

  async write(name: string, blob: Blob): Promise<void> {
    const dir = await this.ensureWritable();
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(blob);
    } finally {
      await w.close();
    }
  }

  async read(name: string): Promise<Blob | null> {
    const dir = this.requireDir();
    try {
      const fh = await dir.getFileHandle(name);
      return await fh.getFile();
    } catch {
      return null; // not found (NotFoundError) or unreadable
    }
  }

  async list(): Promise<VaultEntry[]> {
    const dir = this.requireDir();
    const out: VaultEntry[] = [];
    for await (const handle of dir.values()) {
      if (handle.kind === "file" && handle.name.endsWith(".nekudot")) {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({ name: handle.name, lastModified: file.lastModified });
      }
    }
    return out.sort((a, b) => b.lastModified - a.lastModified);
  }

  private requireDir(): FileSystemDirectoryHandle {
    if (!this.dir) throw new Error("No folder connected");
    return this.dir;
  }

  // Confirm write permission right before a write (the browser can downgrade a
  // grant). Always called from a user gesture - a sync button - so prompting via
  // requestPermission is allowed.
  private async ensureWritable(): Promise<FileSystemDirectoryHandle> {
    const dir = this.requireDir();
    if ((await queryPerm(dir)) !== "granted") {
      if ((await requestPerm(dir)) !== "granted") {
        throw new Error("Folder write permission denied");
      }
    }
    return dir;
  }
}

// Permission helpers. A handle without the (non-standard) permission methods -
// e.g. an origin-private handle - isn't gated by them, so treat absence as
// "granted" rather than blocking.
async function queryPerm(h: FileSystemHandle): Promise<PermissionState> {
  return (await h.queryPermission?.({ mode: "readwrite" })) ?? "granted";
}
async function requestPerm(h: FileSystemHandle): Promise<PermissionState> {
  return (await h.requestPermission?.({ mode: "readwrite" })) ?? "granted";
}
async function safePut(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await handles.put(DIR_KEY, handle);
  } catch {
    // persistence is a convenience; if it fails the folder still works this session
  }
}
