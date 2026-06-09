// Real app: the Symmetry (Tile / Radial / Mirror) modes in their own box. Since "mirror
// everything" deposits a copy of each point at every transform, the active
// map's dot count is the cleanest signal: a tile/radial stroke seeds many more
// points than the same stroke with symmetry off. Also checks the guide overlay
// shows/hides and screenshots a radial.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4434, DBG = 9368;
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
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,760", "--no-first-run", "about:blank"], { stdio: "ignore" });
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
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await E("localStorage.clear()");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(400);
    mkdirSync(OUT, { recursive: true });

    const closePopovers = () => E(`document.querySelectorAll('.brush-popover.open').forEach(p=>p.classList.remove('open'))`);
    const pressKey = async (key, code, vk) => { for (const t of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type: t, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
    const boxOpen = () => E(`(()=>{const b=document.querySelector('.symmetry-box');return !!b&&getComputedStyle(b).display!=='none';})()`);
    const ensureBoxOpen = async () => { if (!(await boxOpen())) { await pressKey("y", "KeyY", 89); await sleep(80); } };
    const pickMode = async (label) => {
      await ensureBoxOpen();
      return E(`(()=>{const b=[...document.querySelectorAll('.symmetry-box .sym-seg-btn')].find(x=>x.textContent===${JSON.stringify(label)});if(!b)return false;b.click();return true;})()`);
    };
    const windowsHasSymmetry = async () => {
      await E(`document.querySelector('.toolbar button[title="Windows"]').click()`); await sleep(80);
      const has = await E(`[...document.querySelectorAll('.brush-popover .opt-label')].some(x=>x.textContent==='Symmetry')`);
      await closePopovers(); await sleep(40);
      return has;
    };
    const overlayShown = () => E(`(()=>{const ov=[...document.querySelectorAll('.stage canvas')].find(x=>x.style.zIndex==='9998');return !!ov&&getComputedStyle(ov).display!=='none';})()`);
    // The Maps box is a display-toggled panel opened from the navbar pill; keep
    // it closed between checks so it doesn't sit over the canvas while drawing.
    const mapsBoxOpen = () => E(`(()=>{const b=document.querySelector('.maps-box');return !!b&&b.style.display!=='none';})()`);
    const openMaps = async () => { if (!(await mapsBoxOpen())) { await E(`document.querySelector('.toolbar .maps-pill-open').click()`); await sleep(80); } };
    const closeMaps = async () => { if (await mapsBoxOpen()) { await E(`document.querySelector('.toolbar .maps-pill-open').click()`); await sleep(60); } };
    const newMap = async () => {
      await openMaps();
      await E(`document.querySelector('.maps-box .layers-add-btn')?.click()`); await sleep(60);
      await closeMaps();
    };
    const activeDots = async () => {
      await openMaps();
      const d = await E(`(()=>{const r=[...document.querySelectorAll('.maps-box .maps-menu-row')].find(x=>x.querySelector('.maps-menu-tag'));const n=parseInt(r?.querySelector('.maps-menu-dots')?.textContent||'',10);return isNaN(n)?-1:n;})()`);
      await closeMaps();
      return d;
    };
    const draw = async (cx, cy) => {
      const pts = []; for (let x = cx - 50; x <= cx + 50; x += 5) pts.push([x, cy + 18 * Math.sin((x - cx) / 16)]);
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
      for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
      await sleep(180);
    };

    // Symmetry lives in its own box (toggled from Windows menu + 'y'); open it.
    const winHasSym = await windowsHasSymmetry();
    await ensureBoxOpen();
    const hasSection = await E(`!!document.querySelector('.symmetry-box .sym-section')`);

    // 1) baseline: symmetry off (default None). Draw clear of the box (top-left).
    const offHidden = !(await overlayShown());
    await draw(430, 360);
    const dotsNone = await activeDots();

    // 2) Tile: overlay shows; the same stroke seeds many more points (mirrored)
    await newMap();
    const tileOk = await pickMode("Tile");
    const tileOverlay = await overlayShown();
    await draw(430, 360);
    const dotsTile = await activeDots();

    // 3) Radial (8 segments, mirror -> 16 copies): radial symmetry, many points
    await newMap();
    const radialOk = await pickMode("Radial");
    const radialOverlay = await overlayShown();
    await draw(430, 360);
    const dotsRadial = await activeDots();
    await S("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(join(OUT, "symmetry-radial.png"), Buffer.from(s.data, "base64")));

    // 4) Mirror (one axis): master + one reflection -> ~2x points. Axis selector.
    await newMap();
    const mirOk = await pickMode("Mirror");
    const mirOverlay = await overlayShown();
    await E(`(()=>{const b=[...document.querySelectorAll('.symmetry-box .sym-seg-btn')].find(x=>x.textContent==='Horizontal');b&&b.click();})()`); await sleep(60);
    const axisActive = await E(`[...document.querySelectorAll('.symmetry-box .sym-seg-btn.active')].some(x=>x.textContent==='Horizontal')`);
    await draw(430, 300);
    const dotsMirror = await activeDots();

    // 5) back to None hides the overlay
    const noneOk = await pickMode("None");
    const noneHidden = !(await overlayShown());

    console.log(`windows menu has Symmetry:${winHasSym}  box section:${hasSection}  off overlay hidden:${offHidden}`);
    console.log(`dots — none:${dotsNone}  tile:${dotsTile}  radial:${dotsRadial}  mirror:${dotsMirror}`);
    console.log(`tile:${tileOk}/${tileOverlay}  radial:${radialOk}/${radialOverlay}  mirror:${mirOk}/${mirOverlay} axis(H) active:${axisActive}  none hides:${noneHidden}`);

    const ok =
      winHasSym && hasSection && offHidden &&
      dotsNone > 0 &&
      tileOk && tileOverlay && dotsTile > dotsNone * 2 &&
      radialOk && radialOverlay && dotsRadial > dotsNone * 4 &&
      mirOk && mirOverlay && axisActive && dotsMirror > dotsNone && dotsMirror < dotsRadial &&
      noneOk && noneHidden;
    console.log(`\n✓ screenshot → ${join(OUT, "symmetry-radial.png")}`);
    console.log(ok ? "✓ PASS — Symmetry section; Tile + Radial mirror marks & memory; guides show/hide" : "✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("symmetry-live failed:", e.message); process.exit(1); });
