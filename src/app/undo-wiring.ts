import { showChip } from "../chip";
import type { AppHistory } from "./history";
import type { LayerManager } from "../layered/manager";
import { prettyLayerName } from "../layered/schema";
import type { UndoSnapshot } from "../undo";

// Undo/redo actions + the per-stroke persistence push. The AppHistory instance
// (the undo stack + paint snapshot) and its init/clear/subscribe stay in main;
// this owns the thin wrappers around it. layersBox is read lazily - it's created
// after this wiring, but only runs at undo/redo time, long after it exists.
export function createUndoWiring(deps: {
  history: AppHistory;
  layerManager: LayerManager;
  applyStageBackground: () => void;
  getLayersBox: () => { refreshPreviews: () => void };
}) {
  const { history, layerManager, applyStageBackground, getLayersBox } = deps;

  const pushUndo = (description: string) => void history.push(description);

  const activeLayerName = (): string =>
    prettyLayerName(layerManager.all[layerManager.activeIdx]?.config.name ?? "active layer");

  // No persist here: the undo/redo that triggered this already saved the new
  // pointer, and the pointer row is what boot restores from.
  const applyUndoSnapshot = async (snap: UndoSnapshot) => {
    layerManager.applyConfig(snap.config);
    await layerManager.applyPaintData(snap.paint);
    applyStageBackground();
    getLayersBox().refreshPreviews();
  };

  // Undo/redo go through the history queue (behind any in-flight stroke pushes,
  // serialized with each other); the chip shows once the restore completed.
  const doUndo = () => {
    void history.undo(applyUndoSnapshot).then((action) => {
      if (action) showChip(`Undo: ${action}`);
    });
  };
  const doRedo = () => {
    void history.redo(applyUndoSnapshot).then((action) => {
      if (action) showChip(`Redo: ${action}`);
    });
  };

  return { pushUndo, activeLayerName, doUndo, doRedo };
}
