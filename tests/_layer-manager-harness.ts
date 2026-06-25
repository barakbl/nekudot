// Shared headless harness for the LayerManager tests. LayerManager builds real
// <canvas>-backed layers, so we give it just enough of `document` + a canvas 2D
// context (every ctx method is a no-op) to run in the node test environment -
// exercising the real manager rather than a re-implementation. The filename has
// no `.test.` so vitest doesn't pick it up as a suite.
import { LayerManager } from "../src/layered/manager";

// A canvas stub. `toBlob` defaults to resolving null synchronously; pass a custom
// one (e.g. an async, failure-injecting toBlob) for tests that exercise capture
// races - that is the only piece that differs between the LayerManager suites.
export function makeCanvasStub(
  toBlob: (cb: (b: Blob | null) => void) => void = (cb) => cb(null),
): HTMLCanvasElement {
  const canvas: Record<string, unknown> = {
    width: 0,
    height: 0,
    style: {},
    remove() {},
    toBlob,
  };
  const ctx = new Proxy({ canvas } as Record<string, unknown>, {
    get: (t, p) => (p in t ? t[p as string] : () => {}),
    set: (t, p, v) => {
      t[p as string] = v;
      return true;
    },
  });
  canvas.getContext = () => ctx;
  return canvas as unknown as HTMLCanvasElement;
}

// Install a `document` stub whose createElement("canvas") returns `makeCanvas()`.
// Call this at the top of a test module, before constructing a LayerManager.
export function installDocumentStub(
  makeCanvas: () => HTMLCanvasElement = () => makeCanvasStub(),
): void {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) =>
      tag === "canvas"
        ? makeCanvas()
        : { style: {}, appendChild() {}, remove() {} },
  };
}

const container = { style: {}, appendChild() {} } as unknown as HTMLElement;

// A fresh store-less manager (seeded from defaultLayersConfig: two layers + one map).
export function newManager(
  size: { width: number; height: number } = { width: 100, height: 100 },
): LayerManager {
  return new LayerManager({ container, size, dpr: 1 });
}
