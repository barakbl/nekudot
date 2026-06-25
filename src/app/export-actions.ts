import type { LayerManager } from "../layered/manager";
import type { Theme } from "../menu";
import { exportArt, shareArt } from "../export";

// Export + share the flattened artwork (the canvas menu's Export / Share). Both
// flatten against exportBackground(), where "transparent" keeps the PNG's alpha.
// Share downloads the image + copies a caption (no native share sheet here), so
// it chips the result. Both surface failures (flatten / encode / download) to the
// user instead of swallowing them, and chip the empty-canvas case.
export function createExportActions(deps: {
  layerManager: LayerManager;
  exportBackground: () => string;
  showChip: (msg: string) => void;
  showError: (message: string, title?: string) => void;
}) {
  const { layerManager, exportBackground, showChip, showError } = deps;

  return {
    exportImage: async () => {
      try {
        const res = await exportArt(layerManager, {
          backgroundColor: exportBackground(),
          prefix: "art",
        });
        if (res === "empty") showChip("Nothing to export yet");
      } catch (e) {
        console.error("exportArt failed", e);
        showError("Couldn't export the image.", "Export failed");
      }
    },
    shareImage: async () => {
      try {
        const res = await shareArt(layerManager, {
          backgroundColor: exportBackground(),
          prefix: "nekudot",
        });
        if (res === "downloaded")
          showChip("Image saved + caption copied — attach it to share");
        else if (res === "empty") showChip("Nothing to share yet");
      } catch (e) {
        console.error("shareArt failed", e);
        showError("Couldn't share the image.", "Share failed");
      }
    },
  };
}

// Apply a theme at runtime: "auto" follows the OS, otherwise pin it on the root.
// The saved theme is applied at boot in createStage; this is the live toggle
// (App settings + onboarding).
export function applyTheme(theme: Theme): void {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
