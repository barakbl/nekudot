// Drive the REAL app: open Layers, toggle the new Transparent background option,
// and confirm the stage + swatch show a checkerboard. Screenshots each step.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4408, DBG = 9342;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE_URL = `http://localhost:${PORT}/`;
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

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
    mkdirSync(OUT, { recursive: true });
    const shot = async (n) => { const s = await S("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, n), Buffer.from(s.data, "base64")); };
    const realClick = async (selector) => {
      const box = await E(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
      if (!box) throw new Error(`no element: ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"])
        await S("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1, buttons: 1 });
      await sleep(120);
    };

    if (!(await waitFor(() => E(`!!document.querySelector('.canvas-menu-btn')`), 30000))) throw new Error("app did not load");
    await sleep(300);

    // Open Layers via the 'l' shortcut.
    for (const type of ["keyDown", "keyUp"])
      await S("Input.dispatchKeyEvent", { type, key: "l", code: "KeyL", windowsVirtualKeyCode: 76, nativeVirtualKeyCode: 76 });
    const layersOpen = await waitFor(() => E(`(() => { const b = document.querySelector('.layers-popover'); return !!b && getComputedStyle(b).display !== 'none'; })()`), 5000);
    console.log(`Layers panel opened: ${layersOpen ? "✓" : "✗"}`);
    await shot("bg-01-layers-open.png");

    const hasToggle = await E(`!!document.querySelector('.bg-transparent-toggle input')`);
    console.log(`Transparent toggle present: ${hasToggle ? "✓" : "✗"}`);

    await realClick(".bg-transparent-toggle input");
    const after = await E(`(() => {
      const cb = document.querySelector('.bg-transparent-toggle input');
      const stage = document.querySelector('.stage');
      const sw = document.querySelector('.bg-swatch');
      return {
        checked: !!cb && cb.checked,
        stageChecker: stage ? /conic-gradient/.test(getComputedStyle(stage).backgroundImage) : false,
        swatchChecker: sw ? /conic-gradient/.test(getComputedStyle(sw).backgroundImage) : false,
      };
    })()`);
    console.log(`After toggling Transparent: ${JSON.stringify(after)}`);
    await shot("bg-02-transparent-on.png");

    const ok = layersOpen && hasToggle && after.checked && after.stageChecker && after.swatchChecker;
    console.log(`\nScreenshots → ${OUT}/bg-0*.png`);
    console.log(ok ? "✓ PASS — toggle present, stage + swatch show checkerboard" : "✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("bg-live failed:", e.message); process.exit(1); });
