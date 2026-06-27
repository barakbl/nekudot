// A place Nekudot can read/write its files outside the browser's own storage:
// today a local folder (Chrome File System Access API), later a cloud provider
// (Dropbox, Drive). The app talks ONLY to this interface, so a new backend is a
// drop-in - that's the "ready for a holistic cloud solution" the ticket asks for.
//
// Everything is async (the underlying APIs are); simplicity comes from WHEN we
// call it - only on an explicit user action, never autosave/background sync.

export type VaultEntry = {
  // Stable identity. For a local folder id == name; a cloud backend (Drive) would
  // use its own opaque id, since names there aren't unique and can be renamed.
  id: string;
  name: string;
  lastModified: number; // epoch ms; for sorting a future gallery
};

export interface FileVault {
  // Can this vault run here at all? (Chromium for the local folder; configured
  // credentials for a cloud one.) The UI hides the feature when false.
  readonly supported: boolean;

  // A short human label for the connected destination (the folder name), or null
  // when nothing is connected.
  label(): string | null;

  // The name of a previously-connected destination whose permission has lapsed
  // (needs a user gesture to re-grant), or null - lets the UI offer "Reconnect".
  pendingLabel(): string | null;

  // True when there's a usable, permitted destination right now.
  isConnected(): boolean;

  // Establish a destination. MUST be called from a user gesture. Resolves true on
  // success, false if the user cancelled.
  connect(): Promise<boolean>;

  // Forget the destination.
  disconnect(): Promise<void>;

  // Re-attach a previously-connected destination at boot. Silent when permission
  // still holds; returns false if a fresh connect() (a user gesture) is needed.
  restore(): Promise<boolean>;

  // Create or overwrite a file by name.
  write(name: string, blob: Blob): Promise<void>;

  // Read a file by name, or null if it doesn't exist.
  read(name: string): Promise<Blob | null>;

  // List the vault's files (newest first) - format-agnostic; the app layer filters
  // to artworks. The seam the future gallery builds on; not in the v1 UI yet.
  list(): Promise<VaultEntry[]>;
}
