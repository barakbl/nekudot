// Ground truth: draw a real stroke in the REAL app via CDP (one deposit per
// dispatched move), measure the composited canvas ink, and compare to a faithful
// Harmony port fed the IDENTICAL points. Tests the whole pipeline (pointer loop +
// engine + main line at the real brush opacity), not an isolated harness.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4410, DBG = 9344;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE_URL = `http://localhost:${PORT}/`;
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 40000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

// path points (sine), ~6px apart, in the canvas area below the toolbar
function path() {
  const pts = [];
  const x0 = 150, x1 = 950, yc = 380, amp = 80;
  let prev = null, acc = 0;
  for (let x = x0; x <= x1; x += 1) {
    const y = yc + amp * Math.sin((x - x0) / 90);
    if (!prev) { pts.push([x, y]); prev = [x, y]; continue; }
    acc += Math.hypot(x - prev[0], y - prev[1]); prev = [x, y];
    if (acc >= 6) { pts.push([x, y]); acc = 0; }
  }
  return pts;
}

// in-page: faithful Harmony port + ink of the composited stage, + style select
const PAGE_HELPERS = (_kindByStyle) => `
window.__mulberry = (seed) => { let s = seed>>>0; return () => { s=(s+0x6d2b79f5)>>>0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; };
window.__harmonyInk = (kind, pts, passes, W, H) => {
  const cv = document.createElement('canvas'); cv.width=W; cv.height=H; const ctx=cv.getContext('2d');
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H); ctx.lineWidth=1; ctx.lineCap='butt';
  const rng=window.__mulberry(1234); const points=[]; let count=0,px=0,py=0; const col='0,0,0';
  const run=()=>{ px=pts[0][0]; py=pts[0][1]; for(const [x,y] of pts){ points.push([x,y]); const cx=points[count][0], cy=points[count][1];
    if(kind==='sketchy'){ ctx.strokeStyle='rgba('+col+',0.05)'; ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(x,y); ctx.stroke();
      for(let i=0;i<points.length;i++){ const dx=points[i][0]-cx,dy=points[i][1]-cy,d=dx*dx+dy*dy; if(d<4000&&rng()>d/2000){ ctx.beginPath(); ctx.moveTo(cx+dx*0.3,cy+dy*0.3); ctx.lineTo(points[i][0]-dx*0.3,points[i][1]-dy*0.3); ctx.stroke(); } } }
    else if(kind==='web'){ ctx.strokeStyle='rgba('+col+',0.5)'; ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(x,y); ctx.stroke(); ctx.strokeStyle='rgba('+col+',0.1)';
      for(let i=0;i<points.length;i++){ const dx=points[i][0]-cx,dy=points[i][1]-cy,d=dx*dx+dy*dy; if(d<2500&&rng()>0.9){ ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(points[i][0],points[i][1]); ctx.stroke(); } } }
    else if(kind==='shaded'){ for(let i=0;i<points.length;i++){ const dx=points[i][0]-cx,dy=points[i][1]-cy,d=dx*dx+dy*dy; if(d<1000){ ctx.strokeStyle='rgba('+col+','+((1-d/1000)*0.1)+')'; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(points[i][0],points[i][1]); ctx.stroke(); } } }
    px=x; py=y; count++; } };
  for(let p=0;p<passes;p++) run();
  const d=ctx.getImageData(0,0,W,H).data; let m=0; for(let y=90;y<H;y++) for(let x=0;x<W;x++){ const i=(y*W+x)*4; m+=1-(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255; } return m;
};
// Measure darkness of a screenshot (the TRUE composite), skipping the toolbar
// band (y < yMin). Same method used for Harmony so the ratio is apples-to-apples.
window.__inkOfImage = (dataUrl, yMin) => new Promise((res) => {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
    const d = cx.getImageData(0, 0, im.width, im.height).data; let m = 0;
    for (let y = yMin; y < im.height; y++) for (let x = 0; x < im.width; x++) {
      const i = (y * im.width + x) * 4; m += 1 - (0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]) / 255;
    }
    res({ mass: m, W: im.width, H: im.height });
  };
  im.src = dataUrl;
});
window.__selectConnection = (label) => {
  const pill=document.querySelector('.connect-pill'); if(!pill) return 'no-pill';
  pill.click();
  const opt=[...pill.querySelectorAll('.brush-option')].find(o=>o.querySelector('.opt-label')?.textContent===label);
  if(!opt) return 'no-opt'; opt.click(); return 'ok';
};
window.__selectBrush = (label) => {
  const pill=document.querySelector('.brush-pill'); if(!pill) return 'no-pill';
  pill.click();
  const opt=[...pill.querySelectorAll('.brush-option')].find(o=>o.querySelector('.opt-label')?.textContent===label);
  if(!opt) return 'no-opt'; opt.click(); return 'ok';
};
window.__globalAlpha = () => { const c=document.querySelector('.stage canvas'); return c ? c.getContext('2d').globalAlpha : null; };
`;

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok))) throw new Error("vite did not start");
    let wsUrl;
    if (!(await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; }))) throw new Error("devtools did not start");
    ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    await S("Page.navigate", { url: PAGE_URL });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    if (!(await waitFor(() => E(`!!document.querySelector('.stage canvas')`), 30000))) throw new Error("app did not load");
    await E(PAGE_HELPERS());
    await sleep(300);

    const pts = path();
    const PASSES = 3;
    const drawPass = async () => {
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
      for (let i = 1; i < pts.length; i++) {
        await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
      }
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
      await sleep(150);
    };

    const STYLES = [{ label: "Airy", kind: "sketchy" }, { label: "Shading", kind: "shaded" }, { label: "String Art", kind: "web" }];
    mkdirSync(OUT, { recursive: true });

    for (const st of STYLES) {
      // fresh canvas: reload to clear, reselect style
      await S("Page.navigate", { url: PAGE_URL });
      await waitFor(() => E(`!!document.querySelector('.stage canvas')`), 20000);
      await E(PAGE_HELPERS());
      await sleep(300);
      const sel = await E(`window.__selectConnection(${JSON.stringify(st.label)})`);
      await sleep(150);
      const ga = await E(`window.__globalAlpha()`);
      console.log(`\n■ ${st.label} (conn: ${sel}, main-line alpha: ${ga})`);
      const rows = [];
      let lastShot = null;
      for (let p = 1; p <= PASSES; p++) {
        await drawPass();
        const shot = await S("Page.captureScreenshot", { format: "png" });
        lastShot = shot.data;
        const real = await E(`window.__inkOfImage(${JSON.stringify("data:image/png;base64," + shot.data)}, 90)`);
        const harm = await E(`window.__harmonyInk(${JSON.stringify(st.kind)}, ${JSON.stringify(pts)}, ${p}, ${real.W}, ${real.H})`);
        rows.push({ p, real: real.mass, harm, ratio: harm ? real.mass / harm : 0 });
      }
      for (const r of rows) console.log(`   pass ${r.p}: real-app ink ${r.real.toFixed(0)}  vs Harmony ${r.harm.toFixed(0)}  = ${r.ratio.toFixed(2)}x`);
      if (lastShot) writeFileSync(join(OUT, `realapp-${st.kind}.png`), Buffer.from(lastShot, "base64"));
    }
    console.log(`\nScreenshots → ${OUT}/realapp-*.png`);
    await send("Target.closeTarget", { targetId });
    return 0;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("realapp-compare failed:", e.message); process.exit(1); });
