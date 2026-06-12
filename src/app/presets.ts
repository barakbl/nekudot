import type { ConnectionBase, ConnectionSpec } from "../brushes/connections/base";
import {
  setCustomPresets,
  normalizeCustomSpecs,
} from "../brushes/connections/registry";
import {
  loadCustomPresets,
  saveCustomPresets,
} from "../brushes/connections/custom-store";
import {
  parsePresetFile,
  downloadPresets,
} from "../brushes/connections/preset-io";
import { showError, showPrompt, showChecklist } from "../confirm";
import { showChip } from "../chip";

// What the presets controller needs from the app. All read lazily, so the
// controller can be created before the navbar exists.
export type PresetsHost = {
  activeConnection(): ConnectionBase | null; // dials of the active brush
  currentStyle(): string; // the selected art-style name
  applyStyle(name: string): void; // apply + select + persist a style
  defaultStyle(): string; // fallback after deleting the active style
  strokeAlpha(): number; // current main-line opacity (the slider value)
  refreshMenu(): void; // rebuild the navbar Connecting combo options
};

export type PresetsController = ReturnType<typeof createPresetsController>;

// User-saved Custom connection presets — the source of truth for the set,
// mirrored into the registry (createConnection/combo) and persisted to
// IndexedDB. Loaded async via restore().
export function createPresetsController(host: PresetsHost) {
  let presets: ConnectionSpec[] = [];

  // Push the new set everywhere it's read: registry, IndexedDB, navbar combo.
  // Normalized first so what's persisted matches what the registry serves
  // (no icon markup, base verified — see normalizeCustomSpecs).
  const commit = (next: ConnectionSpec[]): void => {
    presets = normalizeCustomSpecs(next);
    setCustomPresets(presets);
    void saveCustomPresets(presets);
    host.refreshMenu();
  };

  return {
    isCustom(name: string): boolean {
      return presets.some((s) => s.name === name);
    },

    // Prompt for a name and save the active connection's dials as a preset.
    save(): void {
      const conn = host.activeConnection();
      if (!conn) return;
      // Branching off an active custom preset suggests "<name> copy" so it won't clash.
      const active = presets.find((s) => s.name === host.currentStyle());
      showPrompt({
        title: "Save connection preset",
        placeholder: "Preset name",
        initial: active ? `${active.name} copy` : "",
        confirmLabel: "Save",
        onConfirm: (name) => {
          // Capture the dials + the current main-line opacity (the slider value).
          const spec = conn.toCustomSpec(name, host.strokeAlpha());
          commit([...presets.filter((s) => s.name !== name), spec]); // overwrite by name
          host.applyStyle(name); // apply + select the new preset
          showChip(`Saved preset “${name}”`);
        },
      });
    },

    // Overwrite the active custom preset in place with the current dials.
    update(): void {
      const conn = host.activeConnection();
      const name = host.currentStyle();
      if (!conn || !presets.some((s) => s.name === name)) return;
      const spec = conn.toCustomSpec(name, host.strokeAlpha());
      commit(presets.map((s) => (s.name === name ? spec : s)));
      showChip(`Updated preset “${name}”`);
    },

    remove(name: string): void {
      commit(presets.filter((s) => s.name !== name));
      if (host.currentStyle() === name) host.applyStyle(host.defaultStyle());
      showChip(`Deleted preset “${name}”`);
    },

    // Pick a .preset file and merge its presets in (overwriting same names).
    import(): void {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".preset,application/json";
      input.style.display = "none";
      document.body.appendChild(input); // connected so the file chooser opens reliably
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        const res = parsePresetFile(await file.text()); // zod-validated, all-or-nothing
        if (!res.ok) {
          showError(res.error, "Couldn't import presets");
          return;
        }
        const byName = new Map(presets.map((s) => [s.name, s]));
        for (const p of res.presets) byName.set(p.name, p);
        commit([...byName.values()]);
        const n = res.presets.length;
        showChip(`Imported ${n} preset${n === 1 ? "" : "s"}`);
      });
      input.click();
    },

    // Choose presets via a checklist and download them as one .preset file.
    export(): void {
      if (!presets.length) return;
      showChecklist({
        title: "Export presets",
        message: "Choose which custom presets to export.",
        confirmLabel: "Export",
        items: presets.map((s) => ({ id: s.name, label: s.name, checked: true })),
        onConfirm: (ids) => {
          const chosen = presets.filter((s) => ids.includes(s.name));
          if (!chosen.length) return;
          downloadPresets(chosen);
          showChip(`Exported ${chosen.length} preset${chosen.length === 1 ? "" : "s"}`);
        },
      });
    },

    // Load the persisted set from IndexedDB; true if anything was restored.
    // (No commit: that would write back what was just read.)
    async restore(): Promise<boolean> {
      const loaded = await loadCustomPresets();
      if (!loaded.length) return false;
      presets = loaded;
      setCustomPresets(presets);
      host.refreshMenu();
      return true;
    },
  };
}
