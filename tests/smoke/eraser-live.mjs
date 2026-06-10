// Real app: the Eraser is now a brush in the "Other" group (no more navbar tool
// toggle). Selecting it puts the canvas into erase mode; scrubbing over existing
// marks wipes them. It supports connecting (the combo shows) but defaults to "no
// connect" — so by default it only erases its own line; turning on a connect
// mode lets it erase the connecting web too. Verifies: no .tool-toggle; Eraser
// in the brush menu; selecting it shows the Connecting combo and defaults its
// connect mode to "None"; and scrubbing it over opaque marks removes them.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4427, DBG = 9361;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome."); return 0; }
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
    // Start clean, but with a wide brush so strokes/erases cover clearly.
    await E("localStorage.clear(); localStorage.setItem('app.size','10');");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(400);
    mkdirSync(OUT, { recursive: true });

    // Total alpha across the drawing layers (captures partial erasure too).
    const alphaSum = () => E(`(() => {
      const cs=[...document.querySelectorAll('.stage canvas')].filter(c=>c.width>400);
      let s=0;
      for(const c of cs){ const x=c.getContext('2d'); if(!x) continue; const d=x.getImageData(0,0,c.width,c.height).data; for(let i=3;i<d.length;i+=4) s+=d[i]; }
      return s;
    })()`);
    const openBrushMenu = () => E(`document.querySelector('.toolbar .brush-pill').click()`);
    const brushOptions = () => E(`[...document.querySelectorAll('.toolbar .brush-pill .brush-option .opt-label')].map(e=>e.textContent)`);
    const selectBrush = (label) => E(`(()=>{const o=[...document.querySelectorAll('.toolbar .brush-pill .brush-option')].find(x=>x.querySelector('.opt-label')?.textContent===${JSON.stringify(label)}); if(!o) return false; o.click(); return true;})()`);
    const brushLabel = () => E(`document.querySelector('.toolbar .brush-label')?.textContent||''`);
    const connectVisible = () => E(`(()=>{const c=document.querySelector('.toolbar .connect-pill'); return !!c && getComputedStyle(c).display!=='none';})()`);
    // The connecting mode select (value "none" for the eraser's no-connect default).
    const connectMode = () => E(`(()=>{const sels=[...document.querySelectorAll('select')]; for(const s of sels){const o=[...s.options].map(o=>o.value); if(o.includes('both')&&o.includes('none')&&o.includes('stroke')&&o.includes('map')) return s.value;} return '?';})()`);
    const pickBrush = async (label) => { await openBrushMenu(); await sleep(100); const r = await selectBrush(label); await sleep(120); return r; };
    const stroke = async (path) => {
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x: path[0][0], y: path[0][1], button: "left", clickCount: 1, buttons: 1 });
      for (let i = 1; i < path.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: path[i][0], y: path[i][1], button: "left", buttons: 1 });
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: path.at(-1)[0], y: path.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
      await sleep(70);
    };
    // Fill a box region with dense horizontal passes.
    const scrub = async (x0, x1, y0, y1, dy = 6) => {
      for (let y = y0; y <= y1; y += dy) {
        const path = []; for (let x = x0; x <= x1; x += 6) path.push([x, y]);
        await stroke(path);
      }
    };

    // 1) old navbar tool toggle is gone
    const noToolToggle = await E(`!document.querySelector('.toolbar .tool-toggle')`);

    // 2) Eraser is listed in the brush menu (Other group)
    await openBrushMenu(); await sleep(120);
    const opts = await brushOptions();
    const hasEraser = opts.includes("Eraser");
    await openBrushMenu(); await sleep(60); // close

    // 3) draw an opaque filled patch with Squares
    await pickBrush("Squares");
    await scrub(420, 700, 360, 440);
    const drawn = await alphaSum();

    // 4) select Eraser → label updates, Connecting combo shows, mode defaults None
    const picked = await pickBrush("Eraser");
    const label = await brushLabel();
    const combo = await connectVisible();
    const mode = await connectMode();

    // 5) scrub the Eraser densely over (and just past) the patch → alpha drops sharply
    await scrub(410, 710, 352, 448, 3);
    const erased = await alphaSum();
    await S("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(join(OUT, "eraser.png"), Buffer.from(s.data, "base64")));

    const dropPct = drawn > 0 ? Math.round(100 * (drawn - erased) / drawn) : 0;
    console.log(`No tool toggle: ${noToolToggle ? "✓" : "✗"}`);
    console.log(`Eraser in menu: ${hasEraser ? "✓" : "✗"}  (opts: ${JSON.stringify(opts)})`);
    console.log(`Drew opaque patch -> alpha:${drawn}`);
    console.log(`Selected Eraser: ${picked ? "✓" : "✗"}  label:"${label}"  combo:${combo ? "✓" : "✗"}  connect mode:"${mode}"`);
    console.log(`After eraser scrub -> alpha:${erased}  (dropped ${dropPct}%)`);

    const ok =
      noToolToggle && hasEraser &&
      picked && label === "Eraser" && combo && mode === "none" &&
      drawn > 0 && erased < drawn * 0.3;
    console.log(`\n✓ screenshot → ${join(OUT, "eraser.png")}`);
    console.log(ok ? "✓ PASS — Eraser is a brush (Other); no tool toggle; supports connecting (default None); erases on scrub" : "✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("eraser-live failed:", e.message); process.exit(1); });
