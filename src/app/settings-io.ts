import { LocalStorageStore } from "../store/local_storage";
import { triggerDownload, timestamp } from "../export";
import { showConfirm, showError } from "../confirm";
import { showChip } from "../chip";
import {
  loadCustomPresets,
  saveCustomPresets,
} from "../brushes/connections/custom-store";
import {
  loadCustomPalettes,
  saveCustomPalettes,
  ensureSeeded,
} from "../colors/store";
import {
  serializeSettingsBundle,
  parseSettingsBundle,
  readAppSettings,
  applyAppSettings,
  MAX_SETTINGS_BYTES,
  SETTINGS_FILE_SUFFIX,
  type SettingsBundle,
} from "../settings-file";

// Export/import of the "global settings" bundle (.nekudotapp): the App-settings
// toggles + custom presets + every saved palette. The file/store plumbing around
// the validation + app-key mapping in settings-file.ts; the panels call
// exportSettings / importSettings as callbacks so they stay free of the stores.

// Gather the whole config into the .nekudotapp bundle text. Shared by the
// download path and folder-sync.
export async function buildSettingsBundleText(): Promise<string> {
  const store = new LocalStorageStore();
  const [presets, palettes] = await Promise.all([
    loadCustomPresets(),
    loadCustomPalettes(),
  ]);
  return serializeSettingsBundle(
    { app: readAppSettings(store), presets, palettes },
    new Date().toISOString(),
  );
}

// Gather the whole config and download it as one .nekudotapp file.
export async function exportSettings(): Promise<void> {
  const text = await buildSettingsBundleText();
  triggerDownload(
    new Blob([text], { type: "application/json" }),
    `nekudot-settings_${timestamp()}${SETTINGS_FILE_SUFFIX}`,
  );
  showChip("Exported settings");
}

// Apply a validated bundle to the stores, then reload so every live side-effect
// (theme, gradient space, pen section, gradient sources…) re-runs cleanly from
// boot - the same strategy as Reset, instead of a fragile per-setting re-apply.
// Only categories the file actually contained are replaced; the artwork stores
// (paint/undo/pixel-log) are never touched.
async function applyBundle(bundle: SettingsBundle): Promise<void> {
  if (bundle.app) applyAppSettings(new LocalStorageStore(), bundle.app);
  if (bundle.presets) await saveCustomPresets(bundle.presets);
  if (bundle.palettes) {
    // Settle the bundled-gradient seeding first (it sets the seeded flag), then
    // overwrite wholesale. Otherwise the post-reload seed could re-add defaults
    // the file dropped, or an in-flight first-run seed could clobber the import.
    await ensureSeeded();
    await saveCustomPalettes(bundle.palettes);
  }
  location.reload();
}

// Validate bundle text, confirm the (destructive) replace, then apply + reload.
// Shared by the file-picker import and the folder load; the reload (on confirm)
// dismisses whichever surface opened it.
export function importSettingsFromText(text: string): void {
  const res = parseSettingsBundle(text);
  if (!res.ok) {
    showError(res.error, "Couldn't import settings");
    return;
  }
  const { app, presets, palettes } = res.bundle;
  if (!app && !presets && !palettes) {
    showError("This file has no settings to import.", "Couldn't import settings");
    return;
  }
  showConfirm({
    title: "Import settings?",
    message:
      "This replaces your current app settings, custom presets and palettes with the ones in this file, then reloads. Your artwork is not affected.",
    confirmLabel: "Import and reload",
    destructive: true,
    onConfirm: () => void applyBundle(res.bundle),
  });
}

// Pick a .nekudotapp file, validate it, confirm the (destructive) replace, then
// apply + reload. Works from both the App settings panel and onboarding.
export function importSettings(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = `${SETTINGS_FILE_SUFFIX},application/json`;
  input.style.display = "none";
  document.body.appendChild(input); // connected so the chooser opens reliably
  // Clean up whether the user picks a file (change) or dismisses the OS dialog
  // (cancel) - otherwise a cancelled pick leaks the detached input.
  input.addEventListener("cancel", () => input.remove());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (file.size > MAX_SETTINGS_BYTES) {
      showError("That file is too large to be a settings file.", "Couldn't import settings");
      return;
    }
    importSettingsFromText(await file.text());
  });
  input.click();
}
