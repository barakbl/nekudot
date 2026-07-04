// Live smoke (manual, needs Chrome) for the layers simplification (card #71):
// the connecting web bakes onto the ACTIVE layer (not a separate connection
// layer), the Layers panel has no connection-marker button, and the Maps panel's
// WEB ROUTING no longer shows "Memory Map From"/"Memory Map trail".
//   node tests/smoke/layers-simplified-live.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4422, DBG = 9352;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }
const key = (S, k, code, vk) => Promise.all([]).then(async () => { await S("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk }); await S("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); });

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log("• No Chrome - skipping."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  const fails = [];
  const check = (name, cond, detail) => { console.log(`   ${cond ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`); if (!cond) fails.push(name); };
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

    // fresh load -> first run opens the mandala automatically
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await E("localStorage.clear(); indexedDB.databases && indexedDB.databases().then(ds=>ds.forEach(d=>indexedDB.deleteDatabase(d.name)))");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(500);

    // Painted-pixel count per LAYER canvas (z-index 1 = bottom, 2 = active/top).
    const layerPaint = `(() => {
      const out = {};
      for (const cv of document.querySelectorAll('.stage canvas')) {
        const z = cv.style.zIndex; if (z !== '1' && z !== '2') continue;
        const ctx = cv.getContext('2d'); if (!ctx) continue;
        const d = ctx.getImageData(0,0,cv.width,cv.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 12) n++;
        out['z' + z] = n;
      }
      return out;
    })()`;

    // Draw a connecting stroke near the centre.
    const pts = []; for (let t = 0; t <= 1.0001; t += 0.04) pts.push([Math.round(550 - 150 + t * 300), Math.round(360 - 50 + Math.sin(t * Math.PI) * 110)]);
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
    for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
    await sleep(250);

    console.log("\n■ Web bakes onto the active layer");
    const paint = await E(layerPaint);
    check("active (top) layer holds the web + dots", (paint.z2 ?? 0) > 5000, JSON.stringify(paint));
    check("bottom layer stays empty (no separate connection layer)", (paint.z1 ?? 0) === 0, JSON.stringify(paint));

    console.log("\n■ Layers panel has no connection-marker button");
    await key(S, "l", "KeyL", 76);
    await waitFor(() => E("getComputedStyle(document.querySelector('.layers-popover')).display !== 'none'"));
    await sleep(150);
    check("no .layer-conn-btn rendered", (await E("document.querySelectorAll('.layer-conn-btn').length")) === 0);
    check("layer rows still render", (await E("document.querySelectorAll('.layer-block').length")) >= 2);

    console.log("\n■ Maps panel WEB ROUTING is trimmed");
    await key(S, "m", "KeyM", 77);
    await waitFor(() => E("getComputedStyle(document.querySelector('.maps-popover')).display !== 'none'"));
    await sleep(150);
    const mapsText = await E("document.querySelector('.maps-popover').textContent");
    check("no 'Memory Map From'", !mapsText.includes("Memory Map From"));
    check("no 'Memory Map trail'", !mapsText.includes("Memory Map trail"));
    check("no Classic/No-connect preset buttons", !mapsText.includes("No connect"));
    check("keeps the 'Connect to' control", mapsText.includes("Connect to"));
    check("default is 'Both map and stroke'", mapsText.includes("Both map and stroke"));

    await send("Target.closeTarget", { targetId });
    if (fails.length) { console.log(`\n✗ ${fails.length} check(s) failed: ${fails.join(", ")}`); return 1; }
    console.log("\n✓ all checks passed");
    return 0;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("layers-simplified-live failed:", e.message); process.exit(1); });
