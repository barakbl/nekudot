// Real app: draw a stroke (populates the selected neighbors map), open the Maps
// box, click the new "Flash" button, and screenshot mid-flash to confirm the
// map's pixels are highlighted (thicker glowing cyan dots) over the canvas.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4414, DBG = 9348;
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
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => S("Runtime.evaluate", { expression: "!!document.querySelector('.stage canvas')", returnByValue: true }).then((r) => r.result.value));
    await S("Runtime.evaluate", { expression: "localStorage.clear()" });
    await S("Page.navigate", { url: PAGE });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(400);
    mkdirSync(OUT, { recursive: true });

    // draw a stroke to populate the selected neighbors map
    const pts = []; for (let x = 200; x <= 900; x += 6) pts.push([x, 380 + 90 * Math.sin((x - 200) / 80)]);
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
    for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
    await sleep(200);

    // open Maps box (shortcut 'm')
    for (const type of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type, key: "m", code: "KeyM", windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77 });
    const mapsOpen = await waitFor(() => E(`(() => { const b=document.querySelector('.neighbors-map-box'); return !!b && getComputedStyle(b).display !== 'none'; })()`), 5000);
    const hasBtn = await E(`!!document.querySelector('.nm-flash-btn')`);
    console.log(`Maps box open: ${mapsOpen ? "✓" : "✗"}, flash button present: ${hasBtn ? "✓" : "✗"}`);

    // click Flash, then sample the highlight overlay shortly after
    await E(`document.querySelector('.nm-flash-btn').click()`);
    await sleep(120);
    const probe = await E(`(() => {
      const c = document.querySelector('.stage canvas:last-of-type'); // the top overlay
      // find the highlight overlay = the canvas with the highest z-index
      const cs=[...document.querySelectorAll('.stage canvas')];
      const ov = cs.reduce((a,b)=> (+getComputedStyle(b).zIndex||0) > (+getComputedStyle(a).zIndex||0) ? b : a);
      const cx = ov.getContext('2d'); const d = cx.getImageData(0,0,ov.width,ov.height).data;
      let lit=0, maxA=0; for(let i=3;i<d.length;i+=4){ if(d[i]>0){lit++; if(d[i]>maxA)maxA=d[i];} }
      return { w:ov.width, h:ov.height, z:getComputedStyle(ov).zIndex, litPx:lit, maxAlpha:maxA };
    })()`);
    console.log(`Highlight overlay (z=${probe.z}, ${probe.w}x${probe.h}): lit pixels=${probe.litPx}, max alpha=${probe.maxAlpha}`);

    // screenshot near a flicker peak
    await sleep(500);
    const shot = await S("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "map-flash.png"), Buffer.from(shot.data, "base64"));
    console.log(`\n✓ screenshot → ${join(OUT, "map-flash.png")}`);

    const ok = mapsOpen && hasBtn && probe.litPx > 0;
    console.log(ok ? "✓ PASS — flash button highlights the map's pixels on the canvas" : "✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("map-flash-live failed:", e.message); process.exit(1); });
