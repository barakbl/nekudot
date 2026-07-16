// Tiled real-restore smoke (tile-undo PR10 Half A). Drives the app with
// undoTiles=ON, so undo/redo restore from the DELTA chain (not the full snapshot)
// and every push persists to the v2 IDB store. Asserts undo reverts + redo
// returns the paint, that v2 keys were written, and that a reload survives via the
// v1 fallback - all on real GPU Chrome. Manual, like the other smokes.
//
//   node tests/smoke/tiled-restore.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4422, DBG = 9357;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = `http://localhost:${PORT}/`;
const findChrome = () =>
  [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws, events) {
  let id = 0; const p = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === "Runtime.consoleAPICalled") events.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")); };
  return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); });
}

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,760", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws; const logs = []; const checks = [];
  const ok = (name, pass, detail = "") => { checks.push(pass); console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` - ${detail}` : ""}`); };
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok))) throw new Error("vite did not start");
    let wsUrl;
    if (!(await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; }))) throw new Error("devtools did not start");
    ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws, logs);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable"); await S("DOM.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
    await S("Page.navigate", { url: PAGE_URL });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const mouse = (type, x, y, buttons) => S("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: buttons ?? 0, clickCount: 1 });
    const reload = async () => { await S("Page.reload"); await waitFor(() => E(`!!document.querySelector('.stage')`), 20000); await sleep(1000); };
    const count = () => E(`(()=>{const c=window.__replay.layerManager.all[1].canvas;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>10)n++;return n})()`);
    const clickBtn = (re) => E(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(e=>${re}.test((e.getAttribute('aria-label')||e.title||'')));if(b&&!b.disabled){b.click();return true}return false})()`);
    const drawStroke = async (cx, cy, spin) => {
      const r = await E(`(()=>{const b=document.querySelector('.stage').getBoundingClientRect();return{l:b.left,t:b.top,w:b.width,h:b.height}})()`);
      const ox = r.l + r.w / 2 + cx, oy = r.t + r.h / 2 + cy;
      const px = (i) => ox + Math.round(45 * Math.cos(spin + i * 0.5)); const py = (i) => oy + Math.round(45 * Math.sin(spin + i * 0.5));
      await mouse("mouseMoved", px(0), py(0), 0); await mouse("mousePressed", px(0), py(0), 1);
      for (let i = 1; i <= 14; i++) { await mouse("mouseMoved", px(i), py(i), 1); await sleep(12); }
      await mouse("mouseReleased", px(14), py(14), 0); await sleep(220);
    };

    if (!(await waitFor(() => E(`!!document.querySelector('.stage')`), 30000))) throw new Error("app did not boot");
    await sleep(400);
    await E(`localStorage.setItem('nekudot.undoTiles','on');localStorage.setItem('app.eventLog','true');localStorage.setItem('app.onboarded','true');localStorage.setItem('app.opacity','1');localStorage.setItem('app.size','8');true`);
    await reload();
    ok("app booted with undoTiles=on", !!(await E(`!!(window.__replay&&window.__replay.layerManager)`)));

    await drawStroke(-90, -10, 0); const c1 = await count();
    await drawStroke(60, 30, 1.5); const c2 = await count();
    ok("two strokes painted (c2 > c1 > 0)", c2 > c1 && c1 > 0, `c1=${c1} c2=${c2}`);

    await clickBtn("/undo/i"); await sleep(400); const cu = await count();
    ok("undo restored from the tile chain (paint reverted toward 1 stroke)", cu < c2 * 0.9 && cu > c1 * 0.5, `cu=${cu} (c1=${c1}, c2=${c2})`);
    await clickBtn("/redo/i"); await sleep(400); const cr = await count();
    ok("redo restored from the tile chain (paint returned toward 2 strokes)", cr > cu * 1.1, `cr=${cr} (cu=${cu}, c2=${c2})`);

    const hasV2 = await E(`(async()=>{try{const db=await new Promise((res,rej)=>{const r=indexedDB.open('nekudot-undo');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});const v=await new Promise((res,rej)=>{const req=db.transaction('stacks','readonly').objectStore('stacks').get('meta2');req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)});return !!v&&v.version===2}catch(e){return false}})()`);
    ok("persisted a v2 chain to IDB (meta2)", hasV2);

    await reload();
    const bootedPaint = await E(`(()=>{try{const c=window.__replay.layerManager.all[1].canvas;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>10)n++;return n}catch(e){return -1}})()`);
    ok("reload restored paint (v1 fallback)", bootedPaint > 0, `${bootedPaint}px`);

    const mismatches = logs.filter((l) => /shadow verify mismatch/.test(l));
    const errors = logs.filter((l) => /error|exception|is not a function/i.test(l) && !/mismatch|persist failed|restore failed/.test(l));
    ok("no shadow verify mismatches", mismatches.length === 0, mismatches.slice(0, 2).join(" | "));
    ok("no runtime errors", errors.length === 0, errors.slice(0, 2).join(" | "));

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed === checks.length ? "✓ PASS" : "✗ FAIL"} - ${passed}/${checks.length} tiled-restore checks`);
    await send("Target.closeTarget", { targetId });
    return passed === checks.length ? 0 : 1;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("tiled-restore failed:", e.message); process.exit(1); });
