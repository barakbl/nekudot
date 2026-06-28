// Live smoke (manual, needs Chrome) for card #47: on a phone-width navbar a
// touch user can see + use Undo and reach Symmetry (neither is stranded after the
// auto-panel removal), and the toolbar wraps without clipping.
//   node tests/smoke/phone-navbar-live.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4423, DBG = 9353;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log("• No Chrome - skipping."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=420,900", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  const fails = [];
  const check = (n, c, d) => { console.log(`   ${c ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); if (!c) fails.push(n); };
  try {
    await waitFor(async () => (await fetch(PAGE)).ok);
    let u; await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); u = r?.webSocketDebuggerUrl; return !!u; });
    ws = await new Promise((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable");
    // Narrow viewport so the phone navbar CSS (@media max-width:640px, width-based)
    // applies; mobile:false keeps the desktop pointer-commit path so a mouse stroke
    // pushes an undo entry (the touch path defers commit and would skip it here).
    await S("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
    const E = async (e) => { const r = await S("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.toolbar')"));
    await E("localStorage.clear(); indexedDB.databases && indexedDB.databases().then(ds=>ds.forEach(d=>indexedDB.deleteDatabase(d.name)))");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(500);

    const vis = (s) => `(()=>{const e=document.querySelector(${JSON.stringify(s)}); return !!e && getComputedStyle(e).display!=='none';})()`;
    const activePaint = `(()=>{let n=0; for(const cv of document.querySelectorAll('.stage canvas')){ if(cv.style.zIndex!=='2') continue; const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; for(let i=3;i<d.length;i+=4) if(d[i]>12) n++; } return n;})()`;

    console.log("\n■ Phone navbar controls");
    check("Symmetry combo visible", await E(vis(".sym-combo-pill")));
    check("Undo button visible", await E(vis(".history-btn")));
    check("Delete-canvas stays hidden", !(await E(vis(".nav-action-delete"))));
    check("toolbar wraps without clipping", await E("(()=>{const t=document.querySelector('.toolbar'); return t.scrollWidth <= t.clientWidth + 1;})()"));

    console.log("\n■ Undo recovers a stroke");
    const before = await E(activePaint);
    const pts = []; for (let t = 0; t <= 1.0001; t += 0.05) pts.push([Math.round(195 - 90 + t * 180), Math.round(380 - 40 + Math.sin(t * Math.PI) * 80)]);
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
    for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
    await sleep(250);
    const afterStroke = await E(activePaint);
    check("stroke deposited on the active layer", afterStroke > before + 500, `painted ${before}->${afterStroke}`);
    // history.push is async (encodes the paint blob), so wait for the subscribed
    // navbar refresh to enable the button rather than checking immediately.
    const undoEnabled = await waitFor(() => E("!document.querySelector('.history-btn').disabled"), 6000);
    check("Undo button enabled after the stroke", undoEnabled);
    await E("document.querySelector('.history-btn').click()"); // tap Undo
    const reverted = await waitFor(async () => (await E(activePaint)) <= before + 50, 6000);
    check("Undo reverted the stroke", reverted, `painted now ${await E(activePaint)}`);

    console.log("\n■ Symmetry reachable by touch");
    await E("(()=>{const g=document.querySelector('.sym-combo-pill .brush-gear'); if(g) g.click();})()");
    await sleep(250);
    check("tapping the Symmetry gear opens the panel", await E(vis(".symmetry-box")));

    await send("Target.closeTarget", { targetId });
    if (fails.length) { console.log(`\n✗ ${fails.length} check(s) failed: ${fails.join(", ")}`); return 1; }
    console.log("\n✓ all checks passed");
    return 0;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("phone-navbar-live failed:", e.message); process.exit(1); });
