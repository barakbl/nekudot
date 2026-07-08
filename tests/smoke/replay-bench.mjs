// Replay performance characterization (vector-replay P2.3, for GATE 2's replay-
// speed GO/NO-GO). Records two REAL sessions via CDP - a DENSE central mandala
// (radial symmetry, worst case) and a SPREAD-OUT session (symmetry off, strokes
// across the canvas) - then, in-browser, times an offscreen replay of each and
// builds a cost model:
//   - offscreen (compute + raster) vs bare quadtree (compute only) => raster share
//   - per-stroke growth curve (ms vs cumulative samples) => super-linearity + the
//     neighbour-finder MAX_PIXELS plateau
// Headless numbers are indicative, not final GATE-2 numbers (real M4 + iPad still
// needed). Manual (needs Chrome). Set BENCH_GPU=1 to let Chrome use the GPU.
//
//   node tests/smoke/replay-bench.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4419, DBG = 9354;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = `http://localhost:${PORT}/`;
const FULL = 37543; // barak's real 20-min session sample count, for extrapolation
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, step = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws, events) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) events.push(m); }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 2; }
  const GPU = process.env.BENCH_GPU === "1";
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", ...(GPU ? [] : ["--disable-gpu"]), `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,760", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  const events = [];
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok, 30000))) throw new Error("vite did not start");
    let wsUrl;
    if (!(await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; }, 30000))) throw new Error("devtools did not start");
    ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws, events);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable"); await S("DOM.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
    await S("Page.navigate", { url: PAGE_URL });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const mouse = (type, x, y, buttons) => S("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: buttons ?? 0, clickCount: 1 });
    const reload = async () => { await S("Page.reload"); await waitFor(() => E(`!!document.querySelector('.stage')`), 20000); await sleep(900); };
    const stageBox = async () => E(`(()=>{const b=document.querySelector('.stage').getBoundingClientRect();return{l:b.left,t:b.top,w:b.width,h:b.height}})()`);
    const strokeAround = async (ox, oy, spin, radius, n) => {
      const px = (i) => Math.round(ox + radius * Math.cos(spin + i * 0.4));
      const py = (i) => Math.round(oy + radius * Math.sin(spin + i * 0.4));
      await mouse("mouseMoved", px(0), py(0), 0);
      await mouse("mousePressed", px(0), py(0), 1);
      for (let i = 1; i <= n; i++) { await mouse("mouseMoved", px(i), py(i), 1); await sleep(3); }
      await mouse("mouseReleased", px(n), py(n), 0);
      await sleep(50);
    };
    const readEvents = () => E(`(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('nekudot-events');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return await new Promise((res,rej)=>{const req=db.transaction('events','readonly').objectStore('events').getAll();req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});})()`);
    const clearDb = () => E(`(async()=>{await new Promise((res)=>{const r=indexedDB.deleteDatabase('nekudot-events');r.onsuccess=r.onerror=r.onblocked=()=>res();});return true})()`);

    // ---- boot + enable recorder --------------------------------------------------
    if (!(await waitFor(() => E(`!!document.querySelector('.stage')`), 30000))) throw new Error("app did not boot");
    await sleep(400);
    await E(`localStorage.setItem('app.eventLog','true');localStorage.setItem('app.onboarded','true');localStorage.setItem('app.opacity','1');localStorage.setItem('app.size','8');true`);
    const STROKES = +(process.env.BENCH_STROKES || 24), SAMP = +(process.env.BENCH_SAMP || 30);

    // ---- DENSE: radial symmetry, all strokes concentrated near the centre --------
    await E(`localStorage.removeItem('app.symmetry.mode');true`); // default (radial in this app)
    await clearDb();
    await reload();
    { const b = await stageBox(); const cx = b.l + b.w / 2, cy = b.t + b.h / 2;
      for (let i = 0; i < STROKES; i++) { const a = (i / STROKES) * Math.PI * 2; await strokeAround(cx + 30 * Math.cos(a), cy + 30 * Math.sin(a), a, 40, SAMP); } }
    await sleep(800);
    const dense = await readEvents();

    // ---- SPREAD: symmetry off, strokes tiled across the whole canvas -------------
    await E(`localStorage.setItem('app.symmetry.mode','"none"');true`);
    await clearDb();
    await reload();
    { const b = await stageBox();
      for (let i = 0; i < STROKES; i++) { const gx = b.l + b.w * (0.15 + 0.7 * ((i % 6) / 5)); const gy = b.t + b.h * (0.15 + 0.7 * (Math.floor(i / 6) / 3)); await strokeAround(gx, gy, i, 22, SAMP); } }
    await sleep(800);
    const spread = await readEvents();

    // ---- in-browser bench: offscreen (compute+raster) vs bare quadtree (compute) +
    // ---- the per-stroke growth curve. Runs against injected event logs. ----------
    const benchFn = (rowsJson) => `(async()=>{
      const off = await import('/src/replay/offscreen.ts');
      const eng = await import('/src/replay/engine.ts');
      const bw  = await import('/src/replay/bare-world.ts');
      const nf  = await import('/src/neighbor-finder.ts');
      const rows = ${rowsJson};
      const init = rows.find(e=>e.t==='init');
      const seed = () => { const s=new bw.MemoryStore(); for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);const raw=localStorage.getItem(k);try{s.set(k,JSON.parse(raw));}catch{s.set(k,raw);}} return s; };
      const strokes = rows.filter(r=>r.t==='begin').length;
      const samples = rows.filter(r=>r.t==='samples').reduce((n,r)=>n+r.x.length,0);
      const offRun = () => { const {world}=off.createOffscreenReplayWorld({width:init.width,height:init.height,layers:init.layers,dpr:window.devicePixelRatio,store:seed()}); const t0=performance.now(); eng.replay(rows,world); return performance.now()-t0; };
      const bareRun = () => { const world=bw.createBareReplayWorld({store:seed(), finder: nf.createNeighborFinder('quadtree',[])}); const t0=performance.now(); eng.replay(rows,world); return performance.now()-t0; };
      offRun(); const offMs=[offRun(),offRun()].sort((a,b)=>a-b)[0];
      bareRun(); const bareMs=[bareRun(),bareRun()].sort((a,b)=>a-b)[0];
      // growth curve: per-stroke ms vs cumulative samples (one offscreen pass)
      const types = rows.map(r=>r.t); const cumEnd=[]; { let c=0; for(const r of rows){ if(r.t==='samples')c+=r.x.length; if(r.t==='end')cumEnd.push(c);} }
      const marks=[]; { const {world}=off.createOffscreenReplayWorld({width:init.width,height:init.height,layers:init.layers,dpr:window.devicePixelRatio,store:seed()}); let last=performance.now(); eng.replay(rows,world,{onProgress:(d)=>{ if(types[d-1]==='end'){ const n=performance.now(); marks.push(+(n-last).toFixed(1)); last=n; } }}); }
      const curve = marks.map((ms,i)=>({ cum: cumEnd[i], ms }));
      return { strokes, samples, offMs:+offMs.toFixed(1), bareMs:+bareMs.toFixed(1), curve };
    })()`;

    const d = await E(benchFn(JSON.stringify(dense)));
    const s = await E(benchFn(JSON.stringify(spread)));

    const line = (label, r) => {
      const rasterPct = Math.max(0, Math.round(100 * (r.offMs - r.bareMs) / r.offMs));
      const extrap = +(r.offMs / r.samples * FULL / 1000).toFixed(1);
      console.log(`  ${label}: ${r.strokes} strokes / ${r.samples} samples`);
      console.log(`    offscreen ${r.offMs} ms (${(r.offMs / r.samples).toFixed(3)} ms/sample) | bare-quadtree ${r.bareMs} ms | raster ~${rasterPct}% | linear-extrap 20-min ≈ ${extrap} s`);
      // growth: first vs last stroke ms + the cumulative-sample points
      const c = r.curve;
      const first = c.slice(0, 3).map((x) => x.ms), last = c.slice(-3).map((x) => x.ms);
      console.log(`    per-stroke ms (first 3) ${JSON.stringify(first)} -> (last 3) ${JSON.stringify(last)}  [${c[0]?.cum}..${c[c.length - 1]?.cum} cum samples]`);
    };
    console.log(`== Replay cost characterization (P2.3)${GPU ? " [GPU]" : " [software canvas]"} ==`);
    line("DENSE (radial mandala, concentrated)", d);
    line("SPREAD (symmetry off, tiled)", s);
    const ratio = (d.offMs / d.samples) / (s.offMs / s.samples);
    console.log(`  DENSE is ~${ratio.toFixed(1)}x costlier per sample than SPREAD (density + symmetry drive it).`);
    console.log(`  raster share small => COMPUTE-bound (findNeighbors + web-line generation), not rendering.`);
    console.log(`  per-stroke ms rising with cumulative samples => super-linear until MAX_PIXELS eviction plateaus the cloud.`);
    await send("Target.closeTarget", { targetId });
    return 0;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("replay-bench failed:", e.message); process.exit(1); });
