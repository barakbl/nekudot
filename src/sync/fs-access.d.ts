// File System Access API surface the local-folder vault uses that TS 5.9's
// lib.dom doesn't yet declare. Chromium-only and feature-detected at runtime
// (LocalDirVault.supported); declared here so the typed paths compile. The base
// FileSystem*Handle types ARE in lib.dom - only these extensions are missing.
export {};

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: "read" | "readwrite";
  }
  // Non-standard permission methods (Chromium). Optional so callers guard them.
  interface FileSystemHandle {
    queryPermission?(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
    requestPermission?(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
  }
  interface Window {
    showDirectoryPicker(options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }): Promise<FileSystemDirectoryHandle>;
  }
}
