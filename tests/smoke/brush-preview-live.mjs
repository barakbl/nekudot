// Live smoke for the brush-preview window: open Brush settings, click the Preview
// button, nudge a real slider, and assert the Preview tab animates a web; then
// draw on the Playground tab; then close with the ×. Manual (needs Chrome).
//   node tests/smoke/brush-preview-live.mjs
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4418, DBG = 9351;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

// Count drawn (non-transparent) px of a .brush-preview-canvas by index. The
// canvas is transparent with a CSS paper colour, so drawn ink = alpha > 0.
const NONBG = (idx) => `(() => {
  const cv = document.querySelectorAll('.brush-preview-canvas')[${idx}];
  if (!cv) return -1;
  const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let n = 0; for (let i=3;i<d.length;i+=4) if (d[i]>10) n++;
  return n;
})()`;

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

    // Open Brush settings (shortcut "b"), then click the Preview button.
    await S("Input.dispatchKeyEvent", { type: "keyDown", key: "b", code: "KeyB", windowsVirtualKeyCode: 66, text: "b" });
    await S("Input.dispatchKeyEvent", { type: "keyUp", key: "b", code: "KeyB", windowsVirtualKeyCode: 66 });
    if (!await waitFor(() => E("(() => { const p=document.querySelector('.settings-panel'); return !!p && p.style.display!=='none'; })()"), 4000)) throw new Error("settings panel did not open");
    if (!await E("(() => { const b=document.querySelector('.panel-preview-btn'); if(!b) return false; b.click(); return true; })()")) throw new Error("no Preview button in the settings panel");
    if (!await waitFor(() => E("!!document.querySelector('.brush-preview-window')"), 4000)) throw new Error("preview window did not open");
    const isModal = await E(`document.querySelector('.brush-preview-window').classList.contains('app-modal')`);
    console.log(`window is modal (shortcuts off): ${isModal}`);

    const tabLabels = await E(`[...document.querySelectorAll('.brush-preview-tab')].map(t=>t.textContent)`);
    console.log(`tabs: ${JSON.stringify(tabLabels)}`);

    // Nudge the first settings slider; the active scene tab animates (~1.5s).
    await E(`(() => { const i=document.querySelector('.settings-panel input[type=range]'); i.value = i.value===i.max?i.min:i.max; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(2000);
    const previewInk = await E(NONBG(0));
    const infoText = await E(`document.querySelector('.brush-preview-info')?.textContent || ''`);
    console.log(`Scene tab non-background px: ${previewInk}, info box: "${infoText}"`);

    // Switch to the Circles scene and let it replay.
    await E(`(() => { [...document.querySelectorAll('.brush-preview-tab')].find(t=>t.textContent==='Circles').click(); })()`);
    // Re-nudge a slider so the info box shows a change on this scene.
    await E(`(() => { const i=document.querySelector('.settings-panel input[type=range]'); i.value = i.value===i.max?i.min:i.max; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(5200); // let the full quincunx finish drawing
    const circlesInk = await E(NONBG(0));
    console.log(`Circles scene non-background px: ${circlesInk}`);
    const sceneShot = await S("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(HERE, "brush-preview-live.png"), Buffer.from(sceneShot.data, "base64"));

    // Footer tips: prev/next cycles the text; the first tip links into the book.
    const tip0 = await E(`document.querySelector('.brush-preview-tip-text')?.textContent || ''`);
    const tipLink = await E(`document.querySelector('.brush-preview-tip-link')?.getAttribute('href') || ''`);
    await E(`(() => { document.querySelectorAll('.brush-preview-tip-nav')[1].click(); })()`);
    const tip1 = await E(`document.querySelector('.brush-preview-tip-text')?.textContent || ''`);
    await E(`(() => { document.querySelectorAll('.brush-preview-tip-nav')[0].click(); })()`);
    console.log(`tips: "${tip0.slice(0, 28)}…" → "${tip1.slice(0, 28)}…", tip-1 link: ${tipLink}`);
    const tipsOk = tip0 !== tip1 && /connections\.html#custom/.test(tipLink);

    // Web tab → click a Web-weight pill; the info box should name the selection.
    await E(`(() => { [...document.querySelectorAll('.settings-tab')].find(t=>/web/i.test(t.textContent))?.click(); })()`);
    await sleep(150);
    const pickedWeight = await E(`(() => {
      const b = [...document.querySelectorAll('.settings-group-webweight .settings-preset-btn')].find(x=>x.textContent==='Heavy');
      if (!b) return false; b.click(); return true;
    })()`);
    await sleep(300);
    const weightInfo = await E(`document.querySelector('.brush-preview-info')?.textContent || ''`);
    console.log(`after Web-weight Heavy → info box: "${weightInfo}" (picked=${pickedWeight})`);

    // Background selector has 3 options (Canvas / Light / Dark); switch to dark.
    const bgCount = await E(`document.querySelectorAll('.brush-preview-bgbtn').length`);
    await E(`(() => { document.querySelectorAll('.brush-preview-bgbtn')[2].click(); })()`);
    await sleep(100);
    const bgDark = await E(`document.querySelectorAll('.brush-preview-canvas')[0].style.backgroundColor`);
    const hasSpeed = await E(`!!document.querySelector('.brush-preview-speed input[type=range]')`);
    console.log(`bg options: ${bgCount}, preview bg after dark: ${bgDark}, speed slider: ${hasSpeed}`);

    // Reset in the settings panel → the info box reports the reset.
    await E(`(() => { document.querySelector('.settings-panel .panel-reset-btn')?.click(); })()`);
    await sleep(400);
    const infoAfterReset = await E(`document.querySelector('.brush-preview-info')?.textContent || ''`);
    console.log(`info after reset: "${infoAfterReset}"`);
    await sleep(1600);

    // Switch to Playground; a setting change there should update the info line
    // (so the hint is readable while drawing).
    await E(`(() => { [...document.querySelectorAll('.brush-preview-tab')].find(t=>t.textContent==='Playground').click(); })()`);
    await sleep(100);
    await E(`(() => { [...document.querySelectorAll('.settings-tab')].find(t=>/brush/i.test(t.textContent))?.click(); })()`);
    await sleep(100);
    await E(`(() => { const i=document.querySelector('.settings-panel input[type=range]'); i.value = i.value===i.max?i.min:i.max; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(150);
    const playgroundInfo = await E(`document.querySelector('.brush-preview-info')?.textContent || ''`);
    console.log(`playground info line after a change: "${playgroundInfo}"`);
    // The speed slider lives in the bottom bar on scenes; Clear shows on Playground.
    const barState = await E(`(() => {
      const sp = document.querySelector('.brush-preview-speed');
      const cl = document.querySelector('.brush-preview-clear');
      return { speedShown: sp && sp.style.display !== 'none', clearShown: cl && cl.style.display !== 'none' };
    })()`);
    console.log(`playground bar → speed:${barState.speedShown} clear:${barState.clearShown}`);
    const rect = await E(`(() => { const cv=document.querySelectorAll('.brush-preview-canvas')[1]; const r=cv.getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; })()`);
    const cx = Math.round(rect.x + rect.w * 0.3), cy = Math.round(rect.y + rect.h * 0.5);
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1, buttons: 1 });
    for (let k = 1; k <= 30; k++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + k * 6, y: cy + Math.round(Math.sin(k / 3) * 30), button: "left", buttons: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx + 180, y: cy, button: "left", clickCount: 1, buttons: 1 });
    await sleep(150);
    const playInk = await E(NONBG(1));
    console.log(`Playground tab non-background px: ${playInk}`);
    console.log(`screenshot → ${join(HERE, "brush-preview-live.png")} (Circles scene)`);

    // Close with the × and confirm it hides.
    await E(`(() => { document.querySelector('.brush-preview-window .panel-close-btn').click(); })()`);
    await sleep(100);
    const hidden = await E(`(() => { const w=document.querySelector('.brush-preview-window'); return !w || w.style.display==='none'; })()`);

    const PASS = previewInk > 300 && circlesInk > 300 && playInk > 300 && hidden && isModal &&
      bgCount === 3 && hasSpeed && tipsOk && /size/i.test(playgroundInfo) &&
      barState.clearShown && !barState.speedShown &&
      /web weight/i.test(weightInfo) && /22,\s*22,\s*26|#16161a/.test(bgDark) && /reset/i.test(infoAfterReset) &&
      JSON.stringify(tabLabels) === JSON.stringify(["Wave", "Circles", "Spiral", "Scribble", "Playground"]);
    console.log(PASS ? "✓ modal, scenes, speed-in-bar, web-weight, bg×3, reset, playground info+draw, × closes" : "✗ preview window did not behave as expected");
    await send("Target.closeTarget", { targetId });
    return PASS ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("brush-preview-live failed:", e.message); process.exit(1); });
