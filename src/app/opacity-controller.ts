import type { LayerManager } from "../layered/manager";
import type { Store } from "../store/base";

// The single owner of the live applied opacity ("app.opacity"). It has two
// consumers that read it from different places: the renderer draws every
// deposited point at the LayerManager's global alpha, while the symmetry proxy
// and the brush/settings previews read the persisted "app.opacity" value. If a
// write updated one without the other, the deposited points and the drawn line
// would diverge - so every write goes through set(), which touches both. Reads
// go through get(). The per-(brush, art-style) remembered opacity is a separate
// concern (see opacity-store.ts); this owns only the one live applied value.

const KEY = "app.opacity";

export type OpacityController = {
  // The live applied opacity (0..1).
  get(): number;
  // Apply an opacity everywhere at once: the renderer's global alpha AND the
  // persisted live value. The only sanctioned way to change "app.opacity".
  set(a: number): void;
  // Whether a live opacity has ever been persisted (vs. never set).
  isSet(): boolean;
};

export function createOpacityController(deps: {
  layerManager: Pick<LayerManager, "setGlobalAlpha">;
  store: Pick<Store, "get" | "set">;
  // Fallback when nothing is persisted yet (the boot-time `app.opacity ?? 1`).
  defaultAlpha: number;
}): OpacityController {
  const { layerManager, store, defaultAlpha } = deps;
  return {
    get: () => store.get<number>(KEY) ?? defaultAlpha,
    set: (a) => {
      layerManager.setGlobalAlpha(a); // renderer: the deposited points
      store.set(KEY, a); // persisted live value: proxy + previews read it
    },
    isSet: () => store.get<number>(KEY) !== undefined,
  };
}
