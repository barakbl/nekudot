import type { LayerManager } from "../layered/manager";
import { LocalStorageStore } from "../store/local_storage";
import { selectVault } from "../sync/select-vault";
import type { FileVault } from "../sync/file-vault";
import { buildArtworkBlob } from "../save-artwork";
import { timestamp } from "../export";
import { NEKUDOT_ARTWORK_SUFFIX } from "../nekudot-schema";
import { buildSettingsBundleText, importSettingsFromText } from "./settings-io";
import { MAX_SETTINGS_BYTES, SETTINGS_FILE_SUFFIX } from "../settings-file";
import { showChip } from "../chip";
import { showError } from "../confirm";

// Folder sync (Chrome only): connect a local folder once, then save/load the
// settings bundle and the current artwork there - no download/upload dialog each
// time. The controller wires the generic FileVault (chosen by selectVault) to the
// app's build/parse helpers; a different backend later changes nothing here.

const SETTINGS_FILE = `app${SETTINGS_FILE_SUFFIX}`;
// The current artwork's filename in the folder, so re-saving overwrites the same
// file. Reset when the drawing is replaced (new/blank/mandala/load) so the next
// save starts a fresh file instead of clobbering the previous drawing. Per-device
// state - intentionally NOT part of the exported settings bundle.
const ART_FILE_KEY = "app.sync.artFile";

// Normalize an uploaded file's name into a safe in-folder name: basename only (no
// path separators, no control chars) with the artwork extension. Returns null if
// nothing usable remains. Keeps writes scoped to a single entry in the folder.
function toArtFileName(name: string): string | null {
  const base = (name.split(/[/\\]/).pop() ?? "")
    .split("")
    .filter((c) => c.charCodeAt(0) >= 0x20) // drop control chars
    .join("")
    .trim();
  if (!base || base === "." || base === "..") return null;
  return new RegExp(`\\${NEKUDOT_ARTWORK_SUFFIX}$`, "i").test(base)
    ? base
    : `${base.replace(/\.[^.]*$/, "")}${NEKUDOT_ARTWORK_SUFFIX}`;
}

export type FolderSync = ReturnType<typeof createFolderSync>;

export function createFolderSync(deps: {
  manager: LayerManager;
  // Fires whenever connection/filename state changes, so the UI can re-render.
  onChange?: () => void;
  // Injection seams (default to the real implementations) so the controller is
  // unit-testable without the File System Access API or a real LayerManager.
  vault?: FileVault;
  buildArtwork?: () => Promise<Blob>;
  buildSettingsText?: () => Promise<string>;
  applySettingsText?: (text: string) => void;
}) {
  const vault = deps.vault ?? selectVault();
  const buildArtwork = deps.buildArtwork ?? (() => buildArtworkBlob(deps.manager));
  const buildSettingsText = deps.buildSettingsText ?? buildSettingsBundleText;
  const applySettingsText = deps.applySettingsText ?? importSettingsFromText;
  const store = new LocalStorageStore();
  const notify = () => deps.onChange?.();

  // Ensure a folder is connected, connecting (a user gesture) if not. Returns
  // false if the user cancelled, so callers can bail quietly.
  async function ensureConnected(): Promise<boolean> {
    if (vault.isConnected()) return true;
    const ok = await vault.connect();
    if (ok) {
      const name = vault.label();
      showChip(name ? `Connected ${name}` : "Folder connected");
      notify();
    }
    return ok;
  }

  // Drop the remembered artwork filename (next sync starts a fresh file).
  const forget = (): void => {
    if (store.get<string>(ART_FILE_KEY) === undefined) return;
    store.remove(ART_FILE_KEY);
    notify();
  };

  return {
    get supported(): boolean {
      return vault.supported;
    },
    isConnected: (): boolean => vault.isConnected(),
    folderName: (): string | null => vault.label(),
    // The prior folder whose grant lapsed, so the UI can offer a one-click reconnect.
    pendingFolderName: (): string | null => vault.pendingLabel(),
    currentArtworkFile: (): string | null =>
      store.get<string>(ART_FILE_KEY) ?? null,

    // Re-attach a previously connected folder at boot (silent if still permitted).
    async restore(): Promise<void> {
      try {
        await vault.restore();
        // Re-render whether it reconnected or only surfaced a lapsed folder to reconnect.
        if (vault.isConnected() || vault.pendingLabel()) notify();
      } catch (e) {
        console.warn("folder restore failed", e);
      }
    },

    async connect(): Promise<void> {
      try {
        await ensureConnected();
      } catch (e) {
        console.error("folder connect failed", e);
        showError("Couldn't open that folder.", "Folder");
      }
    },

    async disconnect(): Promise<void> {
      await vault.disconnect();
      showChip("Folder disconnected");
      notify();
    },

    async saveSettings(): Promise<void> {
      try {
        if (!(await ensureConnected())) return;
        const text = await buildSettingsText();
        await vault.write(
          SETTINGS_FILE,
          new Blob([text], { type: "application/json" }),
        );
        showChip(`Saved ${SETTINGS_FILE}`);
      } catch (e) {
        console.error("save settings to folder failed", e);
        showError("Couldn't save settings to the folder.", "Folder");
      }
    },

    async loadSettings(): Promise<void> {
      try {
        if (!(await ensureConnected())) return;
        const blob = await vault.read(SETTINGS_FILE);
        if (!blob) {
          showError(`No ${SETTINGS_FILE} in that folder yet.`, "Folder");
          return;
        }
        if (blob.size > MAX_SETTINGS_BYTES) {
          showError("That settings file is too large.", "Folder");
          return;
        }
        applySettingsText(await blob.text()); // validates, confirms, reloads
      } catch (e) {
        console.error("load settings from folder failed", e);
        showError("Couldn't read settings from the folder.", "Folder");
      }
    },

    async syncArtwork(): Promise<void> {
      try {
        if (!(await ensureConnected())) return;
        const blob = await buildArtwork();
        const name =
          store.get<string>(ART_FILE_KEY) ??
          `art_${timestamp()}${NEKUDOT_ARTWORK_SUFFIX}`;
        await vault.write(name, blob);
        // Only remember the name once the write actually succeeded.
        store.set(ART_FILE_KEY, name);
        showChip(`Saved ${name}`);
        notify();
      } catch (e) {
        console.error("sync artwork to folder failed", e);
        showError("Couldn't sync the artwork to the folder.", "Folder");
      }
    },

    // Adopt an uploaded/opened file's name as the current artwork file, so a
    // later sync overwrites that same file instead of making a timestamped
    // duplicate. An unusable name falls back to forgetting (next sync generates).
    setArtworkFile(name: string): void {
      const safe = toArtFileName(name);
      if (!safe) {
        forget();
        return;
      }
      store.set(ART_FILE_KEY, safe);
      notify();
    },

    // The drawing was replaced (new/blank/mandala): the next sync should create a
    // fresh file rather than overwrite the previous drawing's.
    forgetArtworkFile: forget,
  };
}
