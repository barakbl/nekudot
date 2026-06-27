// A tiny software-rasterizing 2D canvas: just enough of the
// CanvasRenderingContext2D surface for the layer-compositing paths to run on
// REAL pixels under the node test env (node/happy-dom hand back a canvas that
// never rasterizes). Both compositing paths under test drive THIS one
// implementation - the clip recorder via raw ctx.fillRect/drawImage and the
// export path via CanvasRenderer.fillBackground/drawSource - so any divergence
// in layer order, per-layer opacity or background substitution shows up as a
// pixel diff. Only axis-aligned transforms (identity + the dpr scale) and
// source-over are supported - all those two paths use; anything else throws so
// an unexpected code path can't pass silently. The filename has no `.test.` so
// vitest doesn't pick it up as a suite.

export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

export type SoftCanvas = {
  width: number;
  height: number;
  style: Record<string, string>;
  getContext(type: "2d"): SoftCtx;
  toBlob(cb: (b: Blob | null) => void): void;
  remove(): void;
};

function parseHex(c: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m) throw new Error(`software-canvas: unsupported fillStyle ${c}`);
  const h = m[1].length === 3 ? m[1].replace(/(.)/g, "$1$1") : m[1];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

type SavedState = {
  a: number;
  d: number;
  e: number;
  f: number;
  globalAlpha: number;
  fillStyle: string;
  globalCompositeOperation: string;
};

class SoftCtx {
  canvas!: SoftCanvas;
  width = 0;
  height = 0;
  data = new Uint8ClampedArray(0);

  // Axis-aligned transform (a,d = scale; e,f = translate). b/c (rotation/skew)
  // are unsupported and rejected in setTransform.
  a = 1;
  d = 1;
  e = 0;
  f = 0;
  globalAlpha = 1;
  fillStyle = "#000000";
  globalCompositeOperation = "source-over";
  // Set by CanvasRenderer's ctor; never read back by the paths under test.
  lineCap = "butt";
  lineJoin = "miter";
  strokeStyle = "#000000";
  lineWidth = 1;

  private stack: SavedState[] = [];

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(Math.max(0, w * h) * 4);
  }

  save(): void {
    this.stack.push({
      a: this.a,
      d: this.d,
      e: this.e,
      f: this.f,
      globalAlpha: this.globalAlpha,
      fillStyle: this.fillStyle,
      globalCompositeOperation: this.globalCompositeOperation,
    });
  }

  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.a = s.a;
    this.d = s.d;
    this.e = s.e;
    this.f = s.f;
    this.globalAlpha = s.globalAlpha;
    this.fillStyle = s.fillStyle;
    this.globalCompositeOperation = s.globalCompositeOperation;
  }

  scale(sx: number, sy: number): void {
    this.a *= sx;
    this.d *= sy;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (b !== 0 || c !== 0) throw new Error("software-canvas: rotation/skew unsupported");
    this.a = a;
    this.d = d;
    this.e = e;
    this.f = f;
  }

  // source-over blend of one pixel; sa is the already-combined source alpha.
  private blend(idx: number, r: number, g: number, b: number, sa: number): void {
    if (sa <= 0) return;
    if (this.globalCompositeOperation !== "source-over")
      throw new Error(`software-canvas: ${this.globalCompositeOperation} unsupported`);
    const dr = this.data[idx];
    const dg = this.data[idx + 1];
    const db = this.data[idx + 2];
    const da = this.data[idx + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) {
      this.data[idx] = this.data[idx + 1] = this.data[idx + 2] = this.data[idx + 3] = 0;
      return;
    }
    this.data[idx] = (r * sa + dr * da * (1 - sa)) / oa;
    this.data[idx + 1] = (g * sa + dg * da * (1 - sa)) / oa;
    this.data[idx + 2] = (b * sa + db * da * (1 - sa)) / oa;
    this.data[idx + 3] = oa * 255;
  }

  // device-space bounds of a logical rect under the axis-aligned transform.
  private box(x: number, y: number, w: number, h: number) {
    const x0 = Math.round(this.a * x + this.e);
    const y0 = Math.round(this.d * y + this.f);
    const x1 = Math.round(this.a * (x + w) + this.e);
    const y1 = Math.round(this.d * (y + h) + this.f);
    return {
      left: Math.max(0, Math.min(x0, x1)),
      right: Math.min(this.width, Math.max(x0, x1)),
      top: Math.max(0, Math.min(y0, y1)),
      bottom: Math.min(this.height, Math.max(y0, y1)),
    };
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b] = parseHex(this.fillStyle);
    const box = this.box(x, y, w, h);
    for (let py = box.top; py < box.bottom; py++)
      for (let px = box.left; px < box.right; px++)
        this.blend((py * this.width + px) * 4, r, g, b, this.globalAlpha);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const box = this.box(x, y, w, h);
    for (let py = box.top; py < box.bottom; py++)
      for (let px = box.left; px < box.right; px++) {
        const i = (py * this.width + px) * 4;
        this.data[i] = this.data[i + 1] = this.data[i + 2] = this.data[i + 3] = 0;
      }
  }

  // drawImage(img, dx, dy) | (img, dx, dy, dw, dh) | (img, sx, sy, sw, sh, dx, dy, dw, dh)
  drawImage(img: SoftCanvas, ...args: number[]): void {
    const src = img.getContext("2d");
    let sx = 0;
    let sy = 0;
    let sw = src.width;
    let sh = src.height;
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (args.length === 2) {
      [dx, dy] = args;
      dw = sw;
      dh = sh;
    } else if (args.length === 4) {
      [dx, dy, dw, dh] = args;
    } else if (args.length === 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    } else {
      throw new Error("software-canvas: bad drawImage arity");
    }
    const X0 = Math.round(this.a * dx + this.e);
    const Y0 = Math.round(this.d * dy + this.f);
    const X1 = Math.round(this.a * (dx + dw) + this.e);
    const Y1 = Math.round(this.d * (dy + dh) + this.f);
    const left = Math.max(0, Math.min(X0, X1));
    const right = Math.min(this.width, Math.max(X0, X1));
    const top = Math.max(0, Math.min(Y0, Y1));
    const bottom = Math.min(this.height, Math.max(Y0, Y1));
    const spanX = X1 - X0 || 1;
    const spanY = Y1 - Y0 || 1;
    for (let py = top; py < bottom; py++) {
      const v = sy + Math.floor(((py - Y0) / spanY) * sh);
      for (let px = left; px < right; px++) {
        const u = sx + Math.floor(((px - X0) / spanX) * sw);
        if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
        const si = (v * src.width + u) * 4;
        const sa = (src.data[si + 3] / 255) * this.globalAlpha;
        this.blend((py * this.width + px) * 4, src.data[si], src.data[si + 1], src.data[si + 2], sa);
      }
    }
  }

  getImageData(x: number, y: number, w: number, h: number): Pixels {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++)
      for (let col = 0; col < w; col++) {
        const sx = x + col;
        const sy = y + row;
        if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) continue;
        const si = (sy * this.width + sx) * 4;
        const di = (row * w + col) * 4;
        out[di] = this.data[si];
        out[di + 1] = this.data[si + 1];
        out[di + 2] = this.data[si + 2];
        out[di + 3] = this.data[si + 3];
      }
    return { data: out, width: w, height: h };
  }
}

export function makeSoftCanvas(width = 0, height = 0): SoftCanvas {
  const ctx = new SoftCtx();
  const canvas = {
    style: {} as Record<string, string>,
    getContext: () => ctx,
    toBlob: (cb: (b: Blob | null) => void) => cb(null),
    remove() {},
  };
  Object.defineProperty(canvas, "width", {
    get: () => ctx.width,
    set: (v: number) => ctx.resize(v, ctx.height),
    enumerable: true,
  });
  Object.defineProperty(canvas, "height", {
    get: () => ctx.height,
    set: (v: number) => ctx.resize(ctx.width, v),
    enumerable: true,
  });
  ctx.canvas = canvas as unknown as SoftCanvas;
  if (width || height) ctx.resize(width, height);
  return canvas as unknown as SoftCanvas;
}
