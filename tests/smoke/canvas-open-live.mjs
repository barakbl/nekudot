// Real app: opening a fresh canvas from the Start page must FRAME it - centred
// and fully inside the window - without needing a manual "Reset view" click.
// The bug: a Start-page pick (or any new-canvas action) changed the canvas size
// but left the camera matrix laid out for the *previous* size, so the canvas
// landed off-centre / half off-screen until you hit the camera-reset icon.
//
// Each scenario boots fresh (cleared storage so the Start page shows), picks a
// size, and measures the canvas's on-screen bounding box from the stage's
// *visible* CSS transform - the same thing the eye sees. We assert the box is
// centred in the window and within its bounds. Covers desktop landscape, an
// iPhone viewport, and an in-session "size X after size Y" change (no reload).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4432, DBG = 9366;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome — skipping."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore", detached: true });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "about:blank"], { stdio: "ignore", detached: true });
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
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

    const metrics = (w, h, mobile) => S("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 3 : 1, mobile: !!mobile });

    // The canvas's on-screen bounding box, derived from the stage's visible CSS
    // transform (canvas px -> viewport px) + the viewport's screen offset. The
    // stage's CSS size IS the canvas size (LayerManager.applyContainerSize).
    const frameProbe = `(() => {
      const stage = document.querySelector('.stage');
      const vpEl = document.querySelector('.viewport');
      const vp = vpEl.getBoundingClientRect();
      const cw = stage.offsetWidth, ch = stage.offsetHeight;
      const m = new DOMMatrix(getComputedStyle(stage).transform);
      const pts = [[0,0],[cw,0],[0,ch],[cw,ch]].map(([x,y]) => { const p = m.transformPoint(new DOMPoint(x,y)); return { x: p.x + vp.left, y: p.y + vp.top }; });
      const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
      const left=Math.min(...xs), right=Math.max(...xs), top=Math.min(...ys), bottom=Math.max(...ys);
      return { left, right, top, bottom, vw: window.innerWidth, vh: window.innerHeight, cw, ch, scale: Math.hypot(m.a, m.b) };
    })()`;

    const clickOnboarding = (label) => E(`(() => { const b = [...document.querySelectorAll('.onboarding-btn')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b) { b.click(); return true; } return false; })()`);

    const TOL = 3; // px — the framing math is exact; this only absorbs rounding.
    const results = [];
    // A new canvas is well-framed when it's centred in the window and fully inside it.
    const judge = (name, f, opts = {}) => {
      const cx = (f.left + f.right) / 2, cy = (f.top + f.bottom) / 2;
      const centeredX = Math.abs(cx - f.vw / 2) <= TOL;
      const centeredY = Math.abs(cy - f.vh / 2) <= TOL;
      const inBounds = f.left >= -TOL && f.top >= -TOL && f.right <= f.vw + TOL && f.bottom <= f.vh + TOL;
      // "Fills" (full-screen pick): box should span almost the whole window.
      const fills = opts.fill ? (f.right - f.left >= f.vw - 8 && f.bottom - f.top >= f.vh - 8) : true;
      const pass = centeredX && centeredY && inBounds && fills;
      const box = `box=[${f.left.toFixed(0)},${f.top.toFixed(0)}..${f.right.toFixed(0)},${f.bottom.toFixed(0)}] win=${f.vw}x${f.vh} canvas=${f.cw}x${f.ch} scale=${f.scale.toFixed(2)}`;
      results.push([name, pass, `${box} centred=${centeredX && centeredY} inBounds=${inBounds}${opts.fill ? ` fills=${fills}` : ""}`]);
      return f;
    };

    // Boot fresh so the Start page (onboarding) shows, at the given viewport.
    const freshStart = async (w, h, mobile) => {
      await metrics(w, h, mobile);
      await S("Page.navigate", { url: PAGE });
      await waitFor(() => E("!!document.querySelector('.stage')"));
      await E("localStorage.clear()"); await E("try{indexedDB.deleteDatabase('nekudot')}catch(e){}");
      await S("Page.navigate", { url: PAGE });
      await waitFor(() => E("!!document.querySelector('.stage')"));
      await waitFor(() => E(`(() => { const o = document.querySelector('.onboarding'); return o && getComputedStyle(o).display !== 'none'; })()`));
      await sleep(150);
    };

    // Run a scenario but never let one failure hide the others' results.
    const scenario = async (name, fn, opts) => {
      try { judge(name, await fn(), opts); }
      catch (e) { results.push([name, false, `ERROR: ${e.message}`]); }
    };

    // --- Desktop landscape (1100x720) ---
    await scenario("desktop: Square after full-screen boot", async () => {
      await freshStart(1100, 720, false);
      await clickOnboarding("Square 1:1"); await sleep(200);
      return E(frameProbe);
    });

    await scenario("desktop: Full screen", async () => {
      await freshStart(1100, 720, false);
      await clickOnboarding("Full screen"); await sleep(200);
      return E(frameProbe);
    }, { fill: true });

    // --- In-session "size X after size Y" (no reload): full screen -> square.
    //     Reopen the Start page with the `g` shortcut, confirm, pick Square - a
    //     size that differs from the current framing, so a stale camera shows.
    await scenario("desktop: Square after Full screen (in-session)", async () => {
      await freshStart(1100, 720, false);
      await clickOnboarding("Full screen"); await sleep(200);
      await E(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }))`);
      // showStartPage uses a destructive confirm, so the action button is
      // .confirm-btn-destructive — pick the non-cancel button to be robust.
      const confirmBtn = `document.querySelector('.confirm-actions .confirm-btn:not(.confirm-btn-cancel)')`;
      if (!(await waitFor(() => E(`!!${confirmBtn}`), 4000)))
        throw new Error("Start page confirm never opened");
      await E(`${confirmBtn}.click()`);
      await waitFor(() => E(`(() => { const o = document.querySelector('.onboarding'); return o && getComputedStyle(o).display !== 'none'; })()`));
      await sleep(150);
      await clickOnboarding("Square 1:1"); await sleep(200);
      return E(frameProbe);
    });

    // --- iPhone viewport (390x844, dpr 3, mobile) ---
    await scenario("iPhone: Full screen", async () => {
      await freshStart(390, 844, true);
      await clickOnboarding("Full screen"); await sleep(200);
      return E(frameProbe);
    }, { fill: true });

    await scenario("iPhone: Square 1:1", async () => {
      await freshStart(390, 844, true);
      await clickOnboarding("Square 1:1"); await sleep(200);
      return E(frameProbe);
    });

    let ok = true;
    for (const [name, pass, detail] of results) { console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`); ok = ok && pass; }
    console.log(ok ? "\n✓ PASS — every freshly-opened canvas is framed (centred + on-screen) with no manual reset" : "\n✗ FAIL — a freshly-opened canvas was not framed");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} try { process.kill(-br.pid, "SIGKILL"); } catch {} try { process.kill(-dev.pid, "SIGKILL"); } catch {} }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("canvas-open-live failed:", e.message); process.exit(1); });
