// CLEAN real-app test: clear storage, load once, draw exactly ONE pass with the
// default brush/connection (Round + Sketchy), screenshot + sample line darkness.
// No reselect clicks, no reloads → no persisted-paint pollution. Compares to a
// Harmony sketchy port fed the identical points.
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4413, DBG = 9347;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }
function path() { const pts = []; const x0 = 150, x1 = 950, yc = 380, amp = 80; let prev = null, acc = 0; for (let x = x0; x <= x1; x += 1) { const y = yc + amp * Math.sin((x - x0) / 90); if (!prev) { pts.push([x, y]); prev = [x, y]; continue; } acc += Math.hypot(x - prev[0], y - prev[1]); prev = [x, y]; if (acc >= 6) { pts.push([x, y]); acc = 0; } } return pts; }

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
    // clear any persisted paint/state for a truly fresh canvas
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => S("Runtime.evaluate", { expression: "!!document.querySelector('.stage canvas')", returnByValue: true }).then((r) => r.result.value));
    await S("Runtime.evaluate", { expression: "localStorage.clear(); indexedDB.databases && indexedDB.databases().then(ds=>ds.forEach(d=>indexedDB.deleteDatabase(d.name)))" });
    await S("Page.navigate", { url: PAGE });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(400);

    // Record every ctx.stroke(): its globalAlpha + lineWidth, so we see exactly
    // what the connection/main lines are drawn at.
    await E(`window.__rec=[]; const _s=CanvasRenderingContext2D.prototype.stroke; CanvasRenderingContext2D.prototype.stroke=function(){ window.__rec.push([Math.round(this.globalAlpha*1000)/1000, this.lineWidth]); return _s.apply(this,arguments); };`);

    // select a connection style if requested (clean canvas, so no pollution)
    const STYLE = process.env.STYLE || "Sketchy";
    const KIND = { "Sketchy": "airy", "Shaded": "shading", "Web": "stringart" }[STYLE] || "airy";
    if (STYLE !== "Sketchy") {
      await E(`(() => { const pill=document.querySelector('.connect-pill'); pill.click(); const opt=[...pill.querySelectorAll('.brush-option')].find(o=>o.querySelector('.opt-label')?.textContent===${JSON.stringify(STYLE)}); opt&&opt.click(); })()`);
      await sleep(200);
      // close the popover so it doesn't pollute the screenshot
      await E(`document.body.click()`);
      await sleep(100);
    }
    const conn = await E(`document.querySelector('.connect-pill .brush-label')?.textContent`);
    const ga = await E(`document.querySelector('.stage canvas').getContext('2d').globalAlpha`);

    const pts = path();
    const PASSES = 3; // overlapping strokes — the build-up case
    for (let p = 0; p < PASSES; p++) {
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
      for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
      await sleep(150);
    }

    const recSummary = await E(`(() => {
      const r=window.__rec||[]; const hist={};
      for(const [a,w] of r){ const k=a+'@'+w; hist[k]=(hist[k]||0)+1; }
      return { total:r.length, hist };
    })()`);
    console.log(`ctx.stroke() calls this pass: ${recSummary.total}`);
    console.log(`  alpha@width histogram:`, JSON.stringify(recSummary.hist));

    const shot = await S("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "realapp-clean-" + KIND + ".png"), Buffer.from(shot.data, "base64"));
    // darkness of the drawing region (y>90), app vs Harmony
    const measure = (dataUrl) => `(async () => {
      const im = await new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=${JSON.stringify(dataUrl)};});
      const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const cx=c.getContext('2d');cx.drawImage(im,0,0);
      const d=cx.getImageData(0,90,im.width,im.height-90).data; let mass=0,dark=0,min=255;
      for(let i=0;i<d.length;i+=4){const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; mass+=1-l/255; if(l<128)dark++; if(l<min)min=l;}
      return {mass:Math.round(mass),darkPx:dark,minLum:Math.round(min)};
    })()`;
    const appM = await E(measure("data:image/png;base64," + shot.data));
    const harmM = await E(`(() => {
      const cv=document.createElement('canvas');cv.width=1096;cv.height=716;const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1096,716);ctx.lineWidth=1;ctx.lineCap='butt';
      const rng=(()=>{let s=1234>>>0;return()=>{s=(s+0x6d2b79f5)>>>0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();
      const P=${JSON.stringify(pts)};const points=[];let count=0,px=P[0][0],py=P[0][1];
      for(const [x,y] of P){points.push([x,y]);const cx=points[count][0],cy=points[count][1];ctx.strokeStyle='rgba(0,0,0,0.05)';ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();
        for(let i=0;i<points.length;i++){const dx=points[i][0]-cx,dy=points[i][1]-cy,d=dx*dx+dy*dy;if(d<4000&&rng()>d/2000){ctx.beginPath();ctx.moveTo(cx+dx*0.3,cy+dy*0.3);ctx.lineTo(points[i][0]-dx*0.3,points[i][1]-dy*0.3);ctx.stroke();}}
        px=x;py=y;count++;}
      const d=ctx.getImageData(0,90,1096,716-90).data;let mass=0,dark=0,min=255;
      for(let i=0;i<d.length;i+=4){const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];mass+=1-l/255;if(l<128)dark++;if(l<min)min=l;}
      return {mass:Math.round(mass),darkPx:dark,minLum:Math.round(min)};
    })()`);

    console.log(`Fresh load. Connection: ${conn}, main-line globalAlpha: ${ga}. One pass, ${pts.length} pts.`);
    console.log(`   App:     ink ${appM.mass}, dark px(lum<128) ${appM.darkPx}, darkest lum ${appM.minLum}`);
    console.log(`   Harmony: ink ${harmM.mass}, dark px(lum<128) ${harmM.darkPx}, darkest lum ${harmM.minLum}`);
    console.log(`   ratio ink ${(appM.mass / harmM.mass).toFixed(2)}x, darkpx ${(appM.darkPx / Math.max(1, harmM.darkPx)).toFixed(2)}x`);
    console.log(`\n✓ screenshot → ${join(OUT, "realapp-clean-" + KIND + ".png")}`);
    await send("Target.closeTarget", { targetId });
    return 0;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("realapp-clean failed:", e.message); process.exit(1); });
