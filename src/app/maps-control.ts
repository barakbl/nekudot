import type { LayerManager } from "../layered/manager";
import type { MapsControl } from "../layered/maps-box";
import { showConfirm } from "../confirm";
import { showChip } from "../chip";

// Controller behind the memory-maps editor (the subpanel opened from the navbar
// Maps icon): wires its per-map actions (flash / select / rename / delete +
// live dot counts) and the "Live view" toggle to the LayerManager, the flash
// highlighter and undo.
export function createMapsControl(
  layerManager: LayerManager,
  highlightMap: (index: number) => void,
  pushUndo: (description: string) => void,
  getHighlightColor: () => string,
  onPickHighlightColor: (anchor: HTMLElement) => void,
  // "Live view" (the persistent hot-map highlight) shared with the navbar icon.
  isLiveView: () => boolean,
  setLiveView: (on: boolean) => void,
): MapsControl {
  return {
    getHighlightColor,
    onPickHighlightColor,
    isLiveView,
    setLiveView,
    getInfo: () => {
      const activeIdx = layerManager.selectedNeighborsMapIdx;
      return {
        maps: layerManager.allNeighborsMaps.map((m, i) => ({
          name: m.config.name,
          dots: m.finder.livePixelCount(),
          active: i === activeIdx,
        })),
      };
    },
    onFlashActive: () => highlightMap(layerManager.selectedNeighborsMapIdx),
    onFlashMap: (i) => highlightMap(i),
    onAddMap: () => {
      const nm = layerManager.addNeighborsMap(); // made active by the manager
      pushUndo(`Add ${nm.config.name}`);
    },
    onRenameMap: (i, name) => {
      const prev = layerManager.allNeighborsMaps[i]?.config.name;
      layerManager.setNeighborsMapName(i, name); // no-op if blank/unchanged
      if (prev && layerManager.allNeighborsMaps[i]?.config.name !== prev)
        pushUndo(`Rename ${prev} → ${name}`);
    },
    onSelectMap: (i) => {
      layerManager.selectNeighborsMap(i); // not an undo step
      const name = layerManager.allNeighborsMaps[i]?.config.name ?? "map";
      showChip(`Selected “${name}”`);
      highlightMap(i); // flash it so the choice is visible
    },
    onDeleteMap: (i) => {
      const name = layerManager.allNeighborsMaps[i]?.config.name ?? "map";
      showConfirm({
        title: "Delete map?",
        message: `Delete the “${name}” map and the dots it remembers?`,
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => {
          if (layerManager.removeNeighborsMap(i)) {
            showChip(`Deleted “${name}”`);
            pushUndo(`Delete ${name}`);
          }
        },
      });
    },
    subscribe: (fn) => layerManager.subscribe(fn),
  };
}
