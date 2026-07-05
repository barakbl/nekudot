// Diagnostic: drive ONE real-app stroke and count exactly what happens —
// pointermove events, coalesced sub-samples, and ctx.stroke() calls (= lines
// drawn) — vs a Harmony port fed the identical points. Pinpoints whether the
// divergence is point count, connection count per point, or alpha.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4411, DBG = 9345;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = `http://localhost:${PORT}/`;
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 40000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

function path() {
  const pts = []; const x0 = 150, x1 = 950, yc = 380, amp = 80; let prev = null, acc = 0;
  for (let x = x0; x <= x1; x += 1) { const y = yc + amp * Math.sin((x - x0) / 90); if (!prev) { pts.push([x, y]); prev = [x, y]; continue; } acc += Math.hypot(x - prev[0], y - prev[1]); prev = [x, y]; if (acc >= 6) { pts.push([x, y]); acc = 0; } }
  return pts;
}

const HELPERS = `
window.__moves = 0; window.__coalesced = 0;
document.querySelector('.stage').addEventListener('pointermove', (e)=>{ window.__moves++; window.__coalesced += (e.getCoalescedEvents?e.getCoalescedEvents().length:1); }, true);
window.__strokeCount = 0;
const _st = CanvasRenderingContext2D.prototype.stroke;
CanvasRenderingContext2D.prototype.stroke = function(){ window.__strokeCount++; return _st.apply(this, arguments); };
window.__resetSC = ()=>{ window.__strokeCount = 0; };
window.__selectConnection = (label)=>{ const pill=document.querySelector('.connect-pill'); if(!pill) return 'no-pill'; pill.click(); const opt=[...pill.querySelectorAll('.brush-option')].find(o=>o.querySelector('.opt-label')?.textContent===label); if(!opt) return 'no-opt'; opt.click(); return 'ok'; };
window.__harmony = (kind, pts, passes) => {
  const cv=document.createElement('canvas'); cv.width=1096; cv.height=716; const ctx=cv.getContext('2d');
  let sc=0; const stroke=()=>{ sc++; ctx.stroke(); };
  const rng=(()=>{let s=1234>>>0;return()=>{s=(s+0x6d2b79f5)>>>0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();
  const points=[]; let count=0,px=0,py=0;
  const run=()=>{ px=pts[0][0]; py=pts[0][1]; for(const [x,y] of pts){ points.push([x,y]); const cx=points[count][0],cy=points[count][1];
    if(kind==='sketchy'){ ctx.strokeStyle='rgba(0,0,0,0.05)'; ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(x,y); stroke();
      for(let i=0;i<points.length;i++){const dx=points[i][0]-cx,dy=points[i][1]-cy,d=dx*dx+dy*dy; if(d<4000&&rng()>d/2000){ctx.beginPath();ctx.moveTo(cx+dx*0.3,cy+dy*0.3);ctx.lineTo(points[i][0]-dx*0.3,points[i][1]-dy*0.3);stroke();}} }
    px=x;py=y;count++; } };
  for(let p=0;p<(passes||1);p++) run();
  return { strokes: sc, points: points.length };
};
`;

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok))) throw new Error("vite did not start");
    let wsUrl; if (!(await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; }))) throw new Error("devtools did not start");
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
    await E(HELPERS);
    await E(`window.__selectConnection("Sketchy")`);
    await sleep(200);
    await E(`window.__resetSC()`);

    const pts = path();
    // one pass
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
    for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
    await sleep(200);

    // sample a vertical slice across the line at a flat extremum (x≈291, peak y≈300)
    const SAMPLE_X = 291, Y0 = 250, Y1 = 360;
    const shot = await S("Page.captureScreenshot", { format: "png" });
    const appCol = await E(`(async () => {
      const im = await new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=${JSON.stringify("data:image/png;base64," + shot.data)};});
      const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const cx=c.getContext('2d');cx.drawImage(im,0,0);
      const d=cx.getImageData(${SAMPLE_X},${Y0},1,${Y1 - Y0}).data; let min=255,dark=0;
      for(let i=0;i<d.length;i+=4){const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; if(l<min)min=l; if(l<200)dark++;}
      return {minLum:Math.round(min),darkPx:dark};
    })()`);
    const harmCol = await E(`(() => {
      const cv=document.createElement('canvas');cv.width=1096;cv.height=716;const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1096,716);
      ctx.lineWidth=1;ctx.lineCap='butt';const rng=(()=>{let s=1234>>>0;return()=>{s=(s+0x6d2b79f5)>>>0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();
      const P=${JSON.stringify(pts)};const points=[];let count=0,px=P[0][0],py=P[0][1];
      for(const [x,y] of P){points.push([x,y]);const cx=points[count][0],cy=points[count][1];ctx.strokeStyle='rgba(0,0,0,0.05)';ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();
        for(let i=0;i<points.length;i++){const dx=points[i][0]-cx,dy=points[i][1]-cy,d=dx*dx+dy*dy;if(d<4000&&rng()>d/2000){ctx.beginPath();ctx.moveTo(cx+dx*0.3,cy+dy*0.3);ctx.lineTo(points[i][0]-dx*0.3,points[i][1]-dy*0.3);ctx.stroke();}}
        px=x;py=y;count++;}
      const d=ctx.getImageData(${SAMPLE_X},${Y0},1,${Y1 - Y0}).data;let min=255,dark=0;
      for(let i=0;i<d.length;i+=4){const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];if(l<min)min=l;if(l<200)dark++;}
      return {minLum:Math.round(min),darkPx:dark};
    })()`);
    const moves = await E(`window.__moves`);
    const appStrokes = await E(`window.__strokeCount`);
    console.log(`1 pass, ${pts.length} pts. App moves=${moves}, app lines=${appStrokes}.`);
    console.log(`Vertical slice at x=${SAMPLE_X} (flat peak), y∈[${Y0},${Y1}]:`);
    console.log(`   App:     darkest lum ${appCol.minLum}/255, dark pixels (lum<200) ${appCol.darkPx}`);
    console.log(`   Harmony: darkest lum ${harmCol.minLum}/255, dark pixels (lum<200) ${harmCol.darkPx}`);
    console.log(`\n→ lower lum = darker; more dark pixels = thicker/built-up. App ${appCol.minLum < 60 ? "is SATURATED (near-black)" : "is faint"}.`);
    await send("Target.closeTarget", { targetId });
    return 0;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("realapp-diagnose failed:", e.message); process.exit(1); });
