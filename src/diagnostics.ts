// Opt-in field diagnostics. Off by default and a no-op until enabled (from App
// settings -> Diagnostics). Once on, key brush/stroke/render events plus runtime
// errors land in a capped ring buffer the user can copy or download and send
// over - so a device-only bug (e.g. invisible strokes on an old iPad) can be
// diagnosed without a debugger attached.
//
// dlog() is intentionally cheap when disabled, so it's safe to leave on stroke
// start / canvas setup. Nothing here runs at import time, so the module is inert
// in tests until setDiagnostics(true) is called.

type Entry = { t: number; cat: string; msg: string; data?: unknown };

const MAX_ENTRIES = 2000;
const entries: Entry[] = [];
let enabled = false;
let hooked = false;

export function isDiagnostics(): boolean {
  return enabled;
}

export function setDiagnostics(on: boolean): void {
  enabled = on;
  if (!on) return;
  attachErrorHooks();
  dlog("session", "diagnostics enabled");
  dlog("env", "snapshot", envSnapshot());
}

// Record one event. No-op (and allocation-free past the guard) when disabled.
export function dlog(cat: string, msg: string, data?: unknown): void {
  if (!enabled) return;
  entries.push({ t: Date.now(), cat, msg, data });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function clearDiagnostics(): void {
  entries.length = 0;
}

export function diagnosticsCount(): number {
  return entries.length;
}

// The captured log as one shareable text blob, with a fresh environment snapshot
// on top (so it reflects the moment of export).
export function diagnosticsText(): string {
  const out: string[] = [];
  out.push("# Nekudot diagnostics");
  out.push("captured: " + new Date().toISOString());
  out.push("app: v" + (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"));
  out.push("");
  out.push("## environment");
  for (const [k, v] of Object.entries(envSnapshot())) out.push(`${k}: ${fmt(v)}`);
  out.push("");
  out.push(`## log (${entries.length} entries)`);
  for (const e of entries) {
    const ts = new Date(e.t).toISOString().slice(11, 23);
    const data = e.data === undefined ? "" : " " + fmt(e.data);
    out.push(`${ts} [${e.cat}] ${e.msg}${data}`);
  }
  return out.join("\n") + "\n";
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function attachErrorHooks(): void {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  window.addEventListener("error", (e) => {
    dlog("error", String(e.message), {
      src: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error?.stack
        ? String(e.error.stack).split("\n").slice(0, 4).join(" | ")
        : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    dlog("error", "unhandledrejection", {
      reason: String((e as PromiseRejectionEvent).reason),
    });
  });
}

function envSnapshot(): Record<string, unknown> {
  if (typeof window === "undefined") return { note: "no window" };
  const w = window;
  const dpr = w.devicePixelRatio || 1;
  let scheme = "?";
  try {
    scheme = w.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    /* ignore */
  }
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    devicePixelRatio: dpr,
    viewport: `${w.innerWidth}x${w.innerHeight}`,
    screen: `${screen.width}x${screen.height}`,
    colorScheme: scheme,
    maxTouchPoints: navigator.maxTouchPoints,
    pointerEvents: "PointerEvent" in w,
    eyeDropper: "EyeDropper" in w,
    // A "BLANK" readback means the canvas exceeded the GPU's max backing area -
    // a classic old-iPad cause of invisible drawing.
    canvasProbe: probeCanvas(Math.round(w.innerWidth * dpr), Math.round(w.innerHeight * dpr)),
  };
}

// Fill the far corner of a w×h canvas and read it back: "ok" if the pixel
// survived, "BLANK" if the canvas was too big for the GPU to back, else the error.
function probeCanvas(w: number, h: number): string {
  try {
    const c = document.createElement("canvas");
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    const ctx = c.getContext("2d");
    if (!ctx) return `no-context @ ${w}x${h}`;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(c.width - 2, c.height - 2, 2, 2);
    const px = ctx.getImageData(c.width - 1, c.height - 1, 1, 1).data;
    const ok = px[0] > 200 && px[1] < 60 && px[2] < 60;
    return `${ok ? "ok" : "BLANK"} @ ${c.width}x${c.height}`;
  } catch (e) {
    return `error @ ${w}x${h}: ${String(e)}`;
  }
}
