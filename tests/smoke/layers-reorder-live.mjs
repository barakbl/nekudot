// Live smoke for smooth layer drag-reorder: open the Layers panel, add layers,
// drag the top row down by its grip, and assert the order changed. Captures a
// mid-drag screenshot to eyeball the lift + the gap the other rows open.
// Manual (needs Chrome).  node tests/smoke/layers-reorder-live.mjs
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4421, DBG = 9354;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome - skipping."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,820", "--no-first-run", "about:blank"], { stdio: "ignore" });
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
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => S("Runtime.evaluate", { expression: "!!document.querySelector('.stage canvas')", returnByValue: true }).then((r) => r.result.value));
    await S("Runtime.evaluate", { expression: "localStorage.clear(); indexedDB.databases && indexedDB.databases().then(ds=>ds.forEach(d=>indexedDB.deleteDatabase(d.name)))" });
    await S("Page.navigate", { url: PAGE });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(400);

    // Open Layers (shortcut "l"), then add two more layers (3 total).
    await S("Input.dispatchKeyEvent", { type: "keyDown", key: "l", code: "KeyL", windowsVirtualKeyCode: 76, text: "l" });
    await S("Input.dispatchKeyEvent", { type: "keyUp", key: "l", code: "KeyL", windowsVirtualKeyCode: 76 });
    if (!await waitFor(() => E("(() => { const p=document.querySelector('.layers-popover'); return !!p && p.style.display!=='none'; })()"), 4000)) throw new Error("layers panel did not open");
    for (let i = 0; i < 2; i++) { await E("document.querySelector('.layers-popover .layers-add-btn').click()"); await sleep(150); }

    const orderBefore = await E("[...document.querySelectorAll('.layers-list .layer-block')].map(b=>b.dataset.layerId)");
    console.log(`layers: ${orderBefore.length}, order: ${JSON.stringify(orderBefore)}`);
    if (orderBefore.length < 3) throw new Error("expected 3 layer rows");

    // Drag the TOP row down by its grip, past the others.
    const geo = await E(`(() => {
      const b = document.querySelector('.layers-list .layer-block');
      const g = b.querySelector('.layer-grip').getBoundingClientRect();
      return { gx: g.left + g.width/2, gy: g.top + g.height/2, h: b.getBoundingClientRect().height };
    })()`);
    const gx = Math.round(geo.gx), gy = Math.round(geo.gy);
    const down = Math.round(geo.h * 2.3);
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: gx, y: gy, button: "left", clickCount: 1, buttons: 1 });
    const STEPS = 18;
    for (let k = 1; k <= STEPS; k++) {
      await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: gx, y: gy + Math.round((down * k) / STEPS), button: "left", buttons: 1 });
      if (k === 11) { // mid-drag screenshot (row lifted, gap open)
        const shot = await S("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(HERE, "layers-reorder-live.png"), Buffer.from(shot.data, "base64"));
      }
      await sleep(20);
    }
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: gx, y: gy + down, button: "left", clickCount: 1, buttons: 1 });
    await sleep(250);

    const orderAfter = await E("[...document.querySelectorAll('.layers-list .layer-block')].map(b=>b.dataset.layerId)");
    console.log(`order after: ${JSON.stringify(orderAfter)}`);
    const movedTopDown = orderBefore[0] !== orderAfter[0] && orderAfter.includes(orderBefore[0]) && orderAfter.length === orderBefore.length;
    console.log(`screenshot → ${join(HERE, "layers-reorder-live.png")}`);
    const PASS = movedTopDown;
    console.log(PASS ? "✓ top layer dragged to a new position; reorder committed" : "✗ reorder did not behave as expected");
    await send("Target.closeTarget", { targetId });
    return PASS ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("layers-reorder-live failed:", e.message); process.exit(1); });
