// Real app: the Custom group header carries Import (always) + Export (disabled
// when empty). Import reads a .preset file (driven via CDP file-chooser); Export
// opens a checklist modal and downloads the chosen presets. We round-trip both.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const PORT = 4421, DBG = 9355;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE = `http://localhost:${PORT}/`;
const PRESET_PATH = join(tmpdir(), "nekudot-test.preset");
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) {
  let id = 0; const pending = new Map(); const handlers = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params || {});
  };
  const send = (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  send.on = (method, fn) => handlers.set(method, fn);
  return send;
}

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome."); return 0; }
  // a .preset file to import
  writeFileSync(PRESET_PATH, JSON.stringify({ version: 1, presets: [
    { name: "Imported One", label: "Imported One", file: "classic.ts", strokeAlpha: 0.2, defaults: { alpha: 0.08, density: 30, radius: 40, grainCross: false } },
  ] }));

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
    await S("Page.enable"); await S("Runtime.enable"); await S("DOM.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const load = async () => { await S("Page.navigate", { url: PAGE }); await waitFor(() => E(`!!document.querySelector('.connect-pill')`)); await sleep(400); };
    // file-chooser interception → feed our .preset to whichever file input opens
    await S("Page.setInterceptFileChooserDialog", { enabled: true });
    let fcFired = 0;
    send.on("Page.fileChooserOpened", (p) => { fcFired++; void S("DOM.setFileInputFiles", { files: [PRESET_PATH], backendNodeId: p.backendNodeId }); });

    mkdirSync(OUT, { recursive: true });
    await load();
    await E(`localStorage.clear(); indexedDB.deleteDatabase('nekudot-connections');`);
    await load();

    // Drive the popover via its .open class (toggling by click is ambiguous, and
    // it closes on mousedown not click).
    const openCombo = () => E(`document.querySelector('.connect-pill .brush-popover').classList.add('open')`);
    const closeCombo = () => E(`document.querySelector('.connect-pill .brush-popover').classList.remove('open')`);
    // Real mouse click (gives user activation — required for a file-input dialog).
    const realClickNth = async (selector, n) => {
      const box = await E(`(() => { const el=[...document.querySelectorAll(${JSON.stringify(selector)})][${n}]; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; })()`);
      if (!box) throw new Error(`no element ${selector}[${n}]`);
      for (const type of ["mousePressed", "mouseReleased"])
        await S("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1, buttons: 1 });
      await sleep(120);
    };
    const actionState = () => E(`(() => {
      const acts=[...document.querySelectorAll('.connect-pill .brush-group-header.with-actions .group-action')];
      return { count: acts.length, importDisabled: acts[0]?.disabled, exportDisabled: acts[1]?.disabled };
    })()`);

    // 1) empty state: import enabled, export disabled
    await openCombo(); await sleep(120);
    const s0 = await actionState();
    await closeCombo(); await sleep(80);
    console.log(`Custom header actions: ${s0.count} (import disabled=${s0.importDisabled}, export disabled=${s0.exportDisabled})  [expect import enabled, export disabled]`);

    // 2) import the .preset via the import icon
    await openCombo(); await sleep(120);
    await realClickNth(".connect-pill .group-action", 0); // import (real click → activation)
    await sleep(700); // file chooser → setFileInputFiles → change → parse → merge
    await openCombo(); await sleep(150);
    const importedShown = await E(`[...document.querySelectorAll('.connect-pill .opt-label')].some(e=>e.textContent==='Imported One')`);
    const s1 = await actionState();
    await closeCombo(); await sleep(80);
    console.log(`fileChooser fired: ${fcFired}x`);
    console.log(`After import: "Imported One" in combo: ${importedShown ? "✓" : "✗"}, export now enabled: ${s1.exportDisabled === false ? "✓" : "✗"}`);

    // 3) persistence across reload
    await load();
    await openCombo(); await sleep(150);
    const persisted = await E(`[...document.querySelectorAll('.connect-pill .opt-label')].some(e=>e.textContent==='Imported One')`);
    await closeCombo(); await sleep(80);
    console.log(`After reload: imported preset persists: ${persisted ? "✓" : "✗"}`);

    // 4) export → checklist modal → download (capture the blob)
    await E(`window.__blobText=null; const _c=URL.createObjectURL; URL.createObjectURL=(b)=>{ b.text().then(t=>window.__blobText=t); return _c(b); };`);
    await openCombo(); await sleep(120);
    await realClickNth(".connect-pill .group-action", 1); // export
    await sleep(200);
    const modalShown = await E(`!!document.querySelector('.confirm-checklist')`);
    const modalItem = await E(`[...document.querySelectorAll('.confirm-checklist .confirm-check span')].map(e=>e.textContent)`);
    await S("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(join(OUT, "export-modal.png"), Buffer.from(s.data, "base64")));
    await E(`document.querySelector('.confirm-modal .confirm-btn-primary').click()`);
    await waitFor(() => E(`window.__blobText !== null`), 4000);
    const blobText = await E(`window.__blobText`);
    let parsed = null; try { parsed = JSON.parse(blobText); } catch {}
    const exportOk = !!parsed && parsed.version === 1 && Array.isArray(parsed.presets) && parsed.presets.some((p) => p.name === "Imported One");
    console.log(`Export modal shown: ${modalShown ? "✓" : "✗"}, items=[${modalItem.join(", ")}]`);
    console.log(`Exported file round-trips: ${exportOk ? "✓" : "✗"}`);

    const ok = s0.importDisabled === false && s0.exportDisabled === true && importedShown && s1.exportDisabled === false && persisted && modalShown && exportOk;
    console.log(`\n✓ screenshot → ${join(OUT, "export-modal.png")}`);
    console.log(ok ? "✓ PASS — Custom header import/export, import round-trip + persist, export download round-trip" : "✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("import-export-live failed:", e.message); process.exit(1); });
