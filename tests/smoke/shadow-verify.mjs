// Shadow-mode verifier smoke (tile-undo PR9). Drives the REAL app (which runs
// tile shadow capture + reconstruction verify by default) through hard-tool
// strokes and undo/redo, then asserts the verifier reported ZERO mismatches - i.e.
// base + captured deltas reconstructs the live state exactly on real usage. Real
// Chrome WITH GPU (never --disable-gpu): the capture reads GPU-rendered pixels, so
// the verify must run on the shipping raster path. Manual, like the other smokes.
//
//   node tests/smoke/shadow-verify.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4421, DBG = 9356;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = `http://localhost:${PORT}/`;
const findChrome = () =>
  [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true; } catch {}
    await sleep(step);
  }
  return false;
}
function cdp(ws, events) {
  let id = 0;
  const p = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) {
      const { res, rej } = p.get(m.id);
      p.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method === "Runtime.consoleAPICalled") {
      events.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
  };
  return (method, params = {}, sid) =>
    new Promise((res, rej) => {
      const mid = ++id;
      p.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) }));
    });
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log("• No Chrome found (set $CHROME). Skipping."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, [
    "--headless=new", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1",
    "--window-size=1100,760", "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdio: "ignore" });

  let ws;
  const console_ = [];
  const checks = [];
  const ok = (name, pass, detail = "") => { checks.push(pass); console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` - ${detail}` : ""}`); };
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok))) throw new Error("vite did not start");
    let wsUrl;
    if (!(await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; }))) throw new Error("devtools did not start");
    ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws, console_);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable"); await S("DOM.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
    await S("Page.navigate", { url: PAGE_URL });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const mouse = (type, x, y, buttons) => S("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: buttons ?? 0, clickCount: 1 });
    const key = async (k, code) => { for (const type of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: k.charCodeAt(0) }); await sleep(150); };
    const reload = async () => { await S("Page.reload"); await waitFor(() => E(`!!document.querySelector('.stage')`), 20000); await sleep(900); };
    const drawStroke = async (cx, cy, spin) => {
      const r = await E(`(()=>{const b=document.querySelector('.stage').getBoundingClientRect();return{l:b.left,t:b.top,w:b.width,h:b.height}})()`);
      const ox = r.l + r.w / 2 + cx, oy = r.t + r.h / 2 + cy;
      const px = (i) => ox + Math.round(45 * Math.cos(spin + i * 0.5));
      const py = (i) => oy + Math.round(45 * Math.sin(spin + i * 0.5));
      await mouse("mouseMoved", px(0), py(0), 0);
      await mouse("mousePressed", px(0), py(0), 1);
      for (let i = 1; i <= 14; i++) { await mouse("mouseMoved", px(i), py(i), 1); await sleep(12); }
      await mouse("mouseReleased", px(14), py(14), 0);
      await sleep(180);
    };
    const clickUndo = () => E(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(e=>/undo/i.test(e.getAttribute('aria-label')||e.title||''));if(b){b.click();return true}return false})()`);
    const clickRedo = () => E(`(()=>{const b=[...document.querySelectorAll('button,[role=button]')].find(e=>/redo/i.test(e.getAttribute('aria-label')||e.title||''));if(b){b.click();return true}return false})()`);

    if (!(await waitFor(() => E(`!!document.querySelector('.stage')`), 30000))) throw new Error("app did not boot");
    await sleep(400);
    await E(`localStorage.setItem('nekudot.undoStats','on');localStorage.setItem('nekudot.undoTiles','shadow');localStorage.setItem('app.eventLog','true');localStorage.setItem('app.onboarded','true');localStorage.setItem('app.opacity','1');localStorage.setItem('app.size','8');true`);
    await reload();
    ok("app booted with shadow mode", !!(await E(`!!(window.__replay&&window.__replay.layerManager)`)));

    // Hard tools: web + radial symmetry (default), then Spray (4), then Wisp (3),
    // with undo/redo interleaved so both the push and step verifiers run.
    await drawStroke(-120, -20, 0);
    await drawStroke(-30, 40, 1.2);
    await drawStroke(70, -30, 2.4);
    await clickUndo(); await sleep(120); await clickUndo(); await sleep(120); await clickRedo(); await sleep(120);
    await key("4", "Digit4"); // Spray
    await drawStroke(150, 10, 3.6);
    await drawStroke(-150, 60, 4.8);
    await clickUndo(); await sleep(120); await clickRedo(); await sleep(120);
    await key("3", "Digit3"); // Wisp
    await drawStroke(0, -120, 1.0);
    await clickUndo(); await sleep(120);
    await sleep(1200); // let async verifiers settle

    const mismatches = console_.filter((l) => /\[undoTiles\] shadow verify mismatch/.test(l));
    const captures = console_.filter((l) => /\[undoStats\] capture/.test(l));
    const errors = console_.filter((l) => /error|exception|is not a function/i.test(l) && !/mismatch/.test(l));
    const painted = await E(`(()=>{const c=window.__replay.layerManager.all[1].canvas;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>4)n++;return n})()`);

    console.log(`  captures logged: ${captures.length}; sample: ${captures.slice(-3).join(" | ") || "(none)"}`);
    ok("artwork is non-empty", painted > 0, `${painted}px`);
    ok("no runtime errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    ok("shadow verifier reported ZERO mismatches", mismatches.length === 0, mismatches.slice(0, 3).join(" | "));

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed === checks.length ? "✓ PASS" : "✗ FAIL"} - ${passed}/${checks.length} shadow-verify checks`);
    await send("Target.closeTarget", { targetId });
    return passed === checks.length ? 0 : 1;
  } finally {
    try { ws?.close(); } catch {}
    browser.kill("SIGKILL");
    dev.kill("SIGKILL");
  }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("shadow-verify failed:", e.message); process.exit(1); });
