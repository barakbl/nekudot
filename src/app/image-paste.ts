import type { Viewport } from "./viewport";
import type { LayerManager } from "../layered/manager";
import { sizeCanvasForDpr } from "../canvas-size";

// Paste-an-image-onto-the-canvas flow. Listening for a clipboard image, it
// drops the image into a PLACEMENT session: a preview rendered on the canvas
// (so it tracks the pan/zoom/rotate camera) with a drag-to-move body and four
// corner handles to resize (aspect-locked). "Place" (or Enter) bakes it onto
// the active layer through onBaked - which pushes an undo entry; "Cancel" (or
// Esc) drops it with no change. Big images are scaled down to fit on arrival.
export function bindImagePaste(opts: {
  stage: HTMLElement; // preview canvas mounts here (transforms with the camera)
  viewport: Viewport; // client<->canvas mapping + current scale
  layerManager: LayerManager; // bake target + canvas size
  dpr: number;
  onBaked: () => void; // pushUndo + refresh previews, in main
}): { dispose: () => void; handleCameraChange: () => void } {
  const { stage, viewport, layerManager, dpr } = opts;

  const HANDLE = 12; // on-screen handle size (px); kept constant via 1/scale
  const HIT = 11; // on-screen handle hit radius (px)
  const MIN = 16; // min image size in canvas px

  type Img = { src: CanvasImageSource; w: number; h: number };
  type Box = { x: number; y: number; w: number; h: number };
  const CORNERS = ["tl", "tr", "br", "bl"] as const;
  type Corner = (typeof CORNERS)[number];

  // Active session, or null. Only one image is placed at a time.
  let session: {
    img: Img;
    aspect: number;
    box: Box;
    canvas: HTMLCanvasElement;
    bar: HTMLElement;
    teardown: () => void;
  } | null = null;

  const cornerPt = (b: Box, c: Corner) => ({
    x: c === "tl" || c === "bl" ? b.x : b.x + b.w,
    y: c === "tl" || c === "tr" ? b.y : b.y + b.h,
  });
  // The corner opposite `c` stays fixed while resizing from `c`.
  const opposite: Record<Corner, Corner> = { tl: "br", tr: "bl", br: "tl", bl: "tr" };

  const render = () => {
    if (!session) return;
    const { canvas, box, img } = session;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = viewport.scale || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in logical canvas px
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.drawImage(img.src, box.x, box.y, box.w, box.h);
    // Bounding box + handles, sized in 1/scale so they read ~constant on screen.
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = "#2563eb";
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash([]);
    const hs = HANDLE / s;
    for (const c of CORNERS) {
      const p = cornerPt(box, c);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5 / s;
      ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
      ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    }
    ctx.restore();
  };

  const hitCorner = (cx: number, cy: number): Corner | null => {
    if (!session) return null;
    const r = HIT / (viewport.scale || 1);
    for (const c of CORNERS) {
      const p = cornerPt(session.box, c);
      if (Math.abs(cx - p.x) <= r && Math.abs(cy - p.y) <= r) return c;
    }
    return null;
  };
  const inBox = (cx: number, cy: number): boolean => {
    if (!session) return false;
    const b = session.box;
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  };

  const bake = () => {
    if (!session) return;
    const { img, box } = session;
    layerManager.drawImageRect(img.src, box.x, box.y, box.w, box.h);
    end();
    opts.onBaked();
  };

  const end = () => {
    if (!session) return;
    session.teardown();
    session = null;
  };

  const startSession = (img: Img) => {
    end(); // replace any in-progress placement
    const cs = layerManager.currentSize;
    // Fit inside the canvas on arrival (only ever scale DOWN), then centre.
    const fit = Math.min(1, cs.width / img.w, cs.height / img.h);
    const w = img.w * fit;
    const h = img.h * fit;
    const box: Box = { x: (cs.width - w) / 2, y: (cs.height - h) / 2, w, h };

    const canvas = document.createElement("canvas");
    canvas.className = "paste-preview";
    sizeCanvasForDpr(canvas, cs.width, cs.height, dpr);
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.zIndex = "10000"; // above the layers + other stage overlays
    canvas.style.touchAction = "none";
    canvas.style.cursor = "move";
    stage.appendChild(canvas);

    // Action bar (Place / Cancel), fixed on screen regardless of the camera.
    const bar = document.createElement("div");
    bar.className = "paste-bar";
    const place = document.createElement("button");
    place.className = "confirm-btn confirm-btn-primary";
    place.textContent = "Place";
    const cancel = document.createElement("button");
    cancel.className = "confirm-btn confirm-btn-cancel";
    cancel.textContent = "Cancel";
    const hint = document.createElement("span");
    hint.className = "paste-hint";
    hint.textContent = "Drag to move · corners to resize";
    bar.append(hint, cancel, place);
    document.body.appendChild(bar);

    // ---- interaction --------------------------------------------------------
    let mode: "none" | "move" | Corner = "none";
    let moveOff = { x: 0, y: 0 }; // pointer offset from box top-left while moving
    let anchor = { x: 0, y: 0 }; // fixed opposite corner while resizing

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // never let the stage's draw handler see this
      const p = viewport.toCanvas(e.clientX, e.clientY);
      const c = hitCorner(p.x, p.y);
      if (c) {
        mode = c;
        anchor = cornerPt(box, opposite[c]);
      } else if (inBox(p.x, p.y)) {
        mode = "move";
        moveOff = { x: p.x - box.x, y: p.y - box.y };
      } else {
        return; // outside: ignore (use Cancel to dismiss)
      }
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const p = viewport.toCanvas(e.clientX, e.clientY);
      if (mode === "none") {
        canvas.style.cursor = hitCorner(p.x, p.y)
          ? "nwse-resize"
          : inBox(p.x, p.y)
            ? "move"
            : "default";
        return;
      }
      e.stopPropagation();
      if (!session) return; // always non-null when mode !== "none"; guard for the type narrower
      if (mode === "move") {
        box.x = p.x - moveOff.x;
        box.y = p.y - moveOff.y;
      } else {
        // Aspect-locked resize anchored to the opposite corner.
        const { aspect } = session;
        let w = Math.abs(p.x - anchor.x);
        let h = Math.abs(p.y - anchor.y);
        if (w / aspect > h) h = w / aspect;
        else w = h * aspect;
        w = Math.max(MIN, w);
        h = w / aspect;
        const right = mode === "tr" || mode === "br";
        const down = mode === "bl" || mode === "br";
        box.x = right ? anchor.x : anchor.x - w;
        box.y = down ? anchor.y : anchor.y - h;
        box.w = w;
        box.h = h;
      }
      render();
    };
    const onUp = (e: PointerEvent) => {
      if (mode === "none") return;
      e.stopPropagation();
      mode = "none";
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); bake(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(); }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    place.addEventListener("click", bake);
    cancel.addEventListener("click", end);
    window.addEventListener("keydown", onKey, true);

    session = {
      img,
      aspect: img.w / img.h,
      box,
      canvas,
      bar,
      teardown: () => {
        window.removeEventListener("keydown", onKey, true);
        canvas.remove();
        bar.remove();
      },
    };
    render();
  };

  const loadImage = async (file: File): Promise<Img | null> => {
    if ("createImageBitmap" in window) {
      try {
        const b = await createImageBitmap(file);
        return { src: b, w: b.width, h: b.height };
      } catch {
        /* fall through to the <img> path */
      }
    }
    return new Promise((res) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => res({ src: img, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        res(null);
      };
      img.src = url;
    });
  };

  const onPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let file: File | null = null;
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        file = it.getAsFile();
        break;
      }
    }
    if (!file) return; // not an image paste - leave it for whoever wants it
    e.preventDefault();
    void loadImage(file).then((img) => {
      if (img) startSession(img);
    });
  };

  document.addEventListener("paste", onPaste);

  return {
    dispose: () => {
      end();
      document.removeEventListener("paste", onPaste);
    },
    // Called on every camera change so the box/handles re-render at the right
    // 1/scale size (the image itself tracks the camera via the CSS transform).
    handleCameraChange: () => render(),
  };
}
