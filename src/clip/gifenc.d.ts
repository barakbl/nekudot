// Minimal ambient types for gifenc (it ships no .d.ts). Covers only the bits we
// use: build an encoder, quantize a frame to a <=256 palette, map pixels to it.
declare module "gifenc" {
  export interface GifFrameOptions {
    palette?: number[][];
    delay?: number; // ms
    repeat?: number; // first frame only: 0 = loop forever, -1 = no loop
    transparent?: boolean | number;
    dispose?: number;
    first?: boolean;
  }
  export interface GifEncoder {
    writeFrame(
      index: Uint8Array | number[],
      width: number,
      height: number,
      opts?: GifFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }
  export function GIFEncoder(): GifEncoder;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: Record<string, unknown>,
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;
}
