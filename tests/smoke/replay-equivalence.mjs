// Live-vs-replay PIXEL equivalence smoke (vector-replay P2.2 - the hard KILL gate).
// Records a scripted session in the REAL app via CDP, then in-browser replays the
// recorded event log through the P2.1 engine into an OFFSCREEN LayerManager and
// compares the two flattened bitmaps pixel-for-pixel. Manual (needs Chrome), like
// the other tests/smoke/*-live.mjs harnesses.
//
//   node tests/smoke/replay-equivalence.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4418, DBG = 9353;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE_URL = `http://localhost:${PORT}/`;
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, step = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws, events) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) events.push(m); }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 2; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,760", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  const events = [];
  const checks = [];
  const ok = (name, pass, detail = "") => { checks.push({ name, pass, detail }); console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
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
    const visible = (sel) => E(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e && getComputedStyle(e).display!=='none'})()`);
    const mouse = (type, x, y, buttons) => S("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: buttons ?? 0, clickCount: 1 });
    const reload = async () => { await S("Page.reload"); await waitFor(() => E(`!!document.querySelector('.stage')`), 20000); await sleep(900); };
    const key = async (k, code) => { for (const type of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type, key: k, code }); await sleep(200); };
    // A curved multi-sample stroke, mouse (no pen), within the stage.
    const drawStroke = async (cx, cy, spin) => {
      const r = await E(`(()=>{const b=document.querySelector('.stage').getBoundingClientRect();return{l:b.left,t:b.top,w:b.width,h:b.height}})()`);
      const ox = r.l + r.w / 2 + cx, oy = r.t + r.h / 2 + cy;
      const px = (i) => ox + Math.round(40 * Math.cos(spin + i * 0.5));
      const py = (i) => oy + Math.round(40 * Math.sin(spin + i * 0.5));
      await mouse("mouseMoved", px(0), py(0), 0);
      await mouse("mousePressed", px(0), py(0), 1);
      for (let i = 1; i <= 14; i++) { await mouse("mouseMoved", px(i), py(i), 1); await sleep(14); }
      await mouse("mouseReleased", px(14), py(14), 0);
      await sleep(150);
    };

    // ---- boot + enable recorder (alpha=1 so no wet buffer; a known brush size) ----
    if (!(await waitFor(() => E(`!!document.querySelector('.stage')`), 30000))) throw new Error("app did not boot");
    await sleep(400);
    await E(`localStorage.setItem('app.eventLog','true');localStorage.setItem('app.onboarded','true');localStorage.setItem('app.opacity','1');localStorage.setItem('app.size','8');localStorage.setItem('app.color.main','"#3355ff"');true`);
    await E(`(async()=>{await new Promise((res)=>{const r=indexedDB.deleteDatabase('nekudot-events');r.onsuccess=r.onerror=r.onblocked=()=>res();});return true})()`);
    await reload();
    ok("canvas ready + recorder seam present", !(await visible(".onboarding")) && !!(await E(`!!(window.__replay&&window.__replay.layerManager)`)));

    // ---- draw a scripted session: Round/shaded web (default radial symmetry) then
    // a Marker (a non-connecting, non-frame-driven brush) — brush switch mid-session.
    await drawStroke(-120, -20, 0);
    await drawStroke(-40, 30, 1.2);
    await drawStroke(60, -30, 2.4);
    await key("8", "Digit8"); // switch to Marker
    await drawStroke(150, 20, 3.6);
    await drawStroke(-150, 60, 4.8);
    await sleep(900); // let the last strokeEnd flush() land

    // ---- flatten LIVE, replay OFFSCREEN, flatten REPLAY, diff (all in-browser) ----
    const result = await E(`(async()=>{
      const fnv = (d) => { let h = 0x811c9dc5>>>0; for (let i=0;i<d.length;i++){ h ^= d[i]; h = Math.imul(h, 0x01000193)>>>0; } return h.toString(16); };
      // Count pixels that differ from the background (sampled from the top-left corner).
      const painted = (d) => { const b0=d[0],b1=d[1],b2=d[2]; let n=0; for (let i=0;i<d.length;i+=4){ if (Math.abs(d[i]-b0)>8||Math.abs(d[i+1]-b1)>8||Math.abs(d[i+2]-b2)>8) n++; } return n; };

      const off = await import('/src/replay/offscreen.ts');
      const eng = await import('/src/replay/engine.ts');
      const bw = await import('/src/replay/bare-world.ts');

      // events from IDB
      const db = await new Promise((res,rej)=>{const r=indexedDB.open('nekudot-events');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
      const rows = await new Promise((res,rej)=>{const req=db.transaction('events','readonly').objectStore('events').getAll();req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});
      const hist={}; for(const r of rows) hist[r.t]=(hist[r.t]||0)+1;

      // LIVE bitmap (flatten the real layer manager) — capture BEFORE building the replay
      const live = off.flattenToImageData(window.__replay.layerManager);

      // REPLAY: seed a MemoryStore from localStorage (so symmetry params resolve, no live mutation)
      const store = new bw.MemoryStore();
      for (let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); const raw=localStorage.getItem(k); try{ store.set(k, JSON.parse(raw)); }catch{ store.set(k, raw); } }
      const init = rows.find(e=>e.t==='init');
      const { world, manager } = off.createOffscreenReplayWorld({ width: init.width, height: init.height, layers: init.layers, dpr: window.devicePixelRatio, store });
      eng.replay(rows, world);
      const rep = off.flattenToImageData(manager);

      // diff
      const sameDims = live.width===rep.width && live.height===rep.height;
      let diffPx=0, maxDelta=0;
      if (sameDims) { const a=live.data, b=rep.data; for (let i=0;i<a.length;i+=4){ let d=0; for(let c=0;c<4;c++){ const dd=Math.abs(a[i+c]-b[i+c]); if(dd>d)d=dd; } if(d>0)diffPx++; if(d>maxDelta)maxDelta=d; } }
      const totalPx = live.width*live.height;
      return { events: rows.length, hist, dims: live.width+'x'+live.height, sameDims,
        liveHash: fnv(live.data), replayHash: fnv(rep.data),
        livePainted: painted(live.data), replayPainted: painted(rep.data),
        totalPx, diffPx, diffPct: +(100*diffPx/totalPx).toFixed(3), maxDelta };
    })()`);
    console.log("  " + JSON.stringify(result));

    ok("session recorded (begin==end>=5, samples present)", (result.hist.begin||0) === (result.hist.end||0) && (result.hist.begin||0) >= 5 && (result.hist.samples||0) >= 5, JSON.stringify(result.hist));
    ok("live + replay bitmaps have matching dims", result.sameDims, result.dims);
    ok("live artwork is non-empty", result.livePainted > 0, `${result.livePainted}px painted`);
    ok("replay artwork is non-empty", result.replayPainted > 0, `${result.replayPainted}px painted`);
    ok("PIXEL EQUIVALENCE (live hash === replay hash)", result.liveHash === result.replayHash, `live=${result.liveHash} replay=${result.replayHash} diff=${result.diffPx}px (${result.diffPct}%) maxΔ=${result.maxDelta}`);

    const passed = checks.filter((c) => c.pass).length;
    console.log(`\n${passed === checks.length ? "✓ PASS" : "✗ FAIL"} — ${passed}/${checks.length} replay-equivalence checks`);
    const shot = async (n) => { mkdirSync(OUT, { recursive: true }); const s = await S("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, n), Buffer.from(s.data, "base64")); };
    await shot("replay-equivalence-live.png");
    await send("Target.closeTarget", { targetId });
    return passed === checks.length ? 0 : 1;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("replay-equivalence failed:", e.message); process.exit(1); });
