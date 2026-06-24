// Real app: the pan/zoom/rotate camera (src/app/viewport.ts) + pointer mapping.
// The whole point of the camera is "you draw where you point" under any view, so
// every check is internals-free: draw a short stroke at a known SCREEN point,
// find the painted centroid (in canvas pixels), forward-map it through the
// stage's *visible* CSS transform, and assert it lands back under the cursor.
// Covers: 100%; Cmd/Ctrl+wheel zoom; window-resize auto-fit (issue #3:
// oversized canvas stays reachable); 2-finger pinch+twist gesture; and the
// Reset-view toolbar button (back to no zoom / no rotation).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4431, DBG = 9365;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome — skipping."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    await waitFor(async () => (await fetch(PAGE)).ok);
    let u; await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); u = r?.webSocketDebuggerUrl; return !!u; });
    ws = await new Promise((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await E("localStorage.clear()"); await E("indexedDB.deleteDatabase('nekudot')");
    // Fat, fully-opaque brush so a single dab gives a clean, symmetric centroid.
    await E("localStorage.setItem('app.size','10'); localStorage.setItem('app.opacity','1')");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(500);
    // Cleared storage means a first run, so the Start page (onboarding) covers
    // the canvas - dismiss it (revealing the default canvas) before drawing,
    // else every dab lands on the overlay.
    const dismissOnboarding = () => E(`(() => { const b = document.querySelector('.onboarding-close'); const o = document.querySelector('.onboarding'); if (b && o && getComputedStyle(o).display !== 'none') { b.click(); return true; } return false; })()`);
    await dismissOnboarding(); await sleep(150);

    // ---- page-side helpers (re-injectable: the page reloads for F/G) ---------
    const injectView = () => E(`(${() => {
      window.__view = {
        // The stage's *visible* transform (canvas px -> viewport px) + the
        // viewport's screen offset = screen coords. This is what the eye sees.
        screenOf(px, py) {
          const stage = document.querySelector(".stage");
          const vp = document.querySelector(".viewport").getBoundingClientRect();
          const m = new DOMMatrix(getComputedStyle(stage).transform);
          const p = m.transformPoint(new DOMPoint(px, py));
          return { x: p.x + vp.left, y: p.y + vp.top };
        },
        matrix() {
          const m = new DOMMatrix(getComputedStyle(document.querySelector(".stage")).transform);
          return { scale: Math.hypot(m.a, m.b), rotDeg: (Math.atan2(m.b, m.a) * 180) / Math.PI };
        },
        clear() {
          for (const c of document.querySelectorAll(".stage canvas")) {
            const ctx = c.getContext("2d", { willReadFrequently: true });
            ctx.clearRect(0, 0, c.width, c.height);
          }
        },
        // Centroid (in canvas px) of the most-painted layer canvas.
        centroid() {
          let best = null, bestN = 0;
          for (const c of document.querySelectorAll(".stage canvas")) {
            const ctx = c.getContext("2d", { willReadFrequently: true });
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            let n = 0, sx = 0, sy = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i + 3] > 20) { const px = (i / 4) % c.width, py = Math.floor((i / 4) / c.width); n++; sx += px; sy += py; }
            }
            if (n > bestN) { bestN = n; best = { x: sx / n, y: sy / n, n }; }
          }
          return best;
        },
        // Total opaque pixels across all layer canvases (for undo/redo checks).
        painted() {
          let n = 0;
          for (const c of document.querySelectorAll(".stage canvas")) {
            const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
          }
          return n;
        },
      };
    }})()`);
    await injectView();

    const clearCanvas = () => E(`window.__view.clear()`);
    const matrix = () => E(`window.__view.matrix()`);

    // Lay a single dab at the SCREEN point (cx,cy) - a symmetric mark whose
    // centroid is the point itself, free of any stroke-direction bias - then
    // return how far the painted centroid (forward-mapped to screen) is from it.
    const drawAndError = async (cx, cy) => {
      await clearCanvas();
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1, buttons: 1 });
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1, buttons: 1 });
      await sleep(150);
      const c = await E(`window.__view.centroid()`);
      if (!c) return { err: Infinity, n: 0 };
      const s = await E(`window.__view.screenOf(${c.x}, ${c.y})`);
      return { err: Math.hypot(s.x - cx, s.y - cy), n: c.n };
    };

    const TOL = 9; // screen px
    const results = [];

    // A) 100% — the canvas is centred at scale 1; a click must paint under it.
    await E(`window.__view && document.querySelector('[title="Reset view"]').click()`); await sleep(150);
    const m0 = await matrix();
    const a = await drawAndError(620, 360);
    results.push(["100% mapping", a.err <= TOL && a.n > 0, `err=${a.err.toFixed(1)}px n=${a.n} scale=${m0.scale.toFixed(2)} rot=${m0.rotDeg.toFixed(1)}°`]);

    // B) Cmd/Ctrl + wheel zoom-in about a point, then map a click.
    for (let i = 0; i < 6; i++) await S("Input.dispatchMouseEvent", { type: "mouseWheel", x: 620, y: 360, deltaX: 0, deltaY: -120, modifiers: 2 });
    await sleep(150);
    const mZoom = await matrix();
    const b = await drawAndError(700, 300);
    results.push(["zoom mapping (Cmd+wheel)", mZoom.scale > m0.scale * 1.3 && b.err <= TOL && b.n > 0, `scale=${mZoom.scale.toFixed(2)} err=${b.err.toFixed(1)}px n=${b.n}`]);

    // C) Shrink the window below the canvas size -> auto-fit keeps it reachable.
    await E(`document.querySelector('[title="Reset view"]').click()`); await sleep(120);
    await S("Emulation.setDeviceMetricsOverride", { width: 520, height: 420, deviceScaleFactor: 1, mobile: false });
    await E(`window.dispatchEvent(new Event('resize'))`); await sleep(200);
    const mFit = await matrix();
    const c = await drawAndError(260, 210, 14);
    results.push(["resize auto-fit (issue #3)", mFit.scale < 1 && c.err <= TOL && c.n > 0, `scale=${mFit.scale.toFixed(2)} err=${c.err.toFixed(1)}px n=${c.n}`]);
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    await E(`window.dispatchEvent(new Event('resize'))`); await sleep(120);

    // D) Two-finger pinch (zoom) + twist (rotate) gesture changes the camera, and
    //    one-finger drawing still maps correctly afterwards.
    await E(`document.querySelector('[title="Reset view"]').click()`); await sleep(120);
    const tp = (x, y, id) => ({ x, y, id });
    const touch = (type, pts) => S("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
    // start with two fingers around the centre, then spread + rotate them.
    await touch("touchStart", [tp(560, 360, 1), tp(680, 360, 2)]);
    for (let s = 1; s <= 10; s++) {
      const ang = (s / 10) * 0.6; // ~34° twist
      const spread = 60 + s * 12;
      const cxg = 620, cyg = 360;
      const ax = cxg - Math.cos(ang) * spread, ay = cyg - Math.sin(ang) * spread;
      const bx = cxg + Math.cos(ang) * spread, by = cyg + Math.sin(ang) * spread;
      await touch("touchMove", [tp(ax, ay, 1), tp(bx, by, 2)]);
      await sleep(16);
    }
    await touch("touchEnd", []);
    await sleep(150);
    const mGesture = await matrix();
    const gestureMoved = mGesture.scale > m0.scale * 1.2 && Math.abs(mGesture.rotDeg) > 8;
    const d = await drawAndError(620, 360, 16);
    results.push(["2-finger pinch+twist", gestureMoved && d.err <= TOL && d.n > 0, `scale=${mGesture.scale.toFixed(2)} rot=${mGesture.rotDeg.toFixed(1)}° err=${d.err.toFixed(1)}px n=${d.n}`]);

    // E) Reset view -> no rotation, scale back to the fit/100% baseline.
    await E(`document.querySelector('[title="Reset view"]').click()`); await sleep(150);
    const mReset = await matrix();
    const resetOk = Math.abs(mReset.rotDeg) < 0.5 && Math.abs(mReset.scale - m0.scale) < 0.02;
    results.push(["Reset view button", resetOk, `scale=${mReset.scale.toFixed(2)} rot=${mReset.rotDeg.toFixed(1)}°`]);

    // F+G) The reported bug: a 2-finger tap must really UNDO (not just flash the
    //      chip), and a 3-finger tap must really REDO. Fresh state so the canvas
    //      holds exactly one stroke; a multi-finger tap must touch the real art.
    await E("localStorage.clear()"); await E("indexedDB.deleteDatabase('nekudot')");
    await E("localStorage.setItem('app.size','12'); localStorage.setItem('app.opacity','1')");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(500); await injectView();
    await dismissOnboarding(); await sleep(150);
    await E(`document.querySelector('[title="Reset view"]').click()`); await sleep(120);
    // one committed stroke
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: 500, y: 320, button: "left", clickCount: 1, buttons: 1 });
    for (let x = 500; x <= 600; x += 10) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: 320, button: "left", buttons: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: 600, y: 320, button: "left", clickCount: 1, buttons: 1 });
    await sleep(200);
    const nDraw = await E(`window.__view.painted()`);
    // 2-finger tap -> undo
    await touch("touchStart", [tp(420, 300, 1), tp(620, 300, 2)]);
    await touch("touchEnd", []);
    await sleep(220);
    const undoChip = await E(`document.querySelector('.undo-chip')?.textContent || ''`);
    const nUndo = await E(`window.__view.painted()`);
    results.push(["2-finger tap really undoes", /undo/i.test(undoChip) && nDraw > 0 && nUndo < nDraw * 0.2, `chip="${undoChip}" painted ${nDraw}->${nUndo}`]);
    // 3-finger tap -> redo
    await touch("touchStart", [tp(420, 300, 1), tp(520, 300, 2), tp(620, 300, 3)]);
    await touch("touchEnd", []);
    await sleep(220);
    const redoChip = await E(`document.querySelector('.undo-chip')?.textContent || ''`);
    const nRedo = await E(`window.__view.painted()`);
    results.push(["3-finger tap really redoes", /redo/i.test(redoChip) && nRedo > nDraw * 0.8, `chip="${redoChip}" painted ${nUndo}->${nRedo}`]);

    let ok = true;
    for (const [name, pass, detail] of results) { console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`); ok = ok && pass; }
    console.log(ok ? "\n✓ PASS — draw-where-you-point holds across zoom/fit/rotate; Reset view works" : "\n✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("viewport-live failed:", e.message); process.exit(1); });
