import type { FileVault } from "./file-vault";
import { LocalDirVault } from "./local-dir-vault";

// The file vault for this build/environment. Today only the local folder (Chrome
// File System Access API). A native-fs backend (Tauri/Electron) or a cloud one
// (Drive/Dropbox) would be chosen here - the single place that knows which
// backend exists - so the rest of the app (folder-sync, the UI) stays
// backend-agnostic and a new backend is a true drop-in.
export function selectVault(): FileVault {
  return new LocalDirVault();
}
