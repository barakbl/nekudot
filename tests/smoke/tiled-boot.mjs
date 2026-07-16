// Tiled boot / migration / rollback smoke (tile-undo PR10 Half B). Drives the
// on-mode boot ladder end to end on real GPU Chrome: shadow mode writes a v1 stack,
// flipping to on MIGRATES it into a v2 base, a reload BOOTS FROM v2, the v1 keys
// shrink to a 1-deep rollback keyframe, and a dpr switch stretch-restores the paint.
// Manual, like the other smokes:  node tests/smoke/tiled-boot.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4423, DBG = 9358;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = `http://localhost:${PORT}/`;
const findChrome = () =>
  [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws, events) {
  let id = 0; const p = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === "Runtime.consoleAPICalled") events.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")); };
  return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); });
}

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,760", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws; const logs = []; const checks = [];
  const ok = (name, pass, detail = "") => { checks.push(pass); console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` - ${detail}` : ""}`); };
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok))) throw new Error("vite did not start");
    let wsUrl;
    if (!(await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; }))) throw new Error("devtools did not start");
    ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws, logs);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable"); await S("DOM.enable");
    const setDpr = (d) => S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: d, mobile: false });
    await setDpr(1);
    await S("Page.navigate", { url: PAGE_URL });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const mouse = (type, x, y, buttons) => S("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: buttons ?? 0, clickCount: 1 });
    const reload = async () => { await S("Page.reload"); await waitFor(() => E(`!!document.querySelector('.stage')`), 20000); await sleep(1000); };
    // Force the debounced v1 shadow keyframe to flush (durability's pagehide hook).
    const forceHide = () => E(`window.dispatchEvent(new Event('pagehide'));true`);
    const count = () => E(`(()=>{const c=window.__replay.layerManager.all[1].canvas;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>10)n++;return n})()`);
    // Read a value out of the nekudot-undo store.
    const idbGet = (key) => E(`(async()=>{try{const db=await new Promise((res,rej)=>{const r=indexedDB.open('nekudot-undo');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});const v=await new Promise((res,rej)=>{const req=db.transaction('stacks','readonly').objectStore('stacks').get('${key}');req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)});db.close();return v??null}catch(e){return null}})()`);
    const clearDbs = () => E(`(async()=>{for(const n of ['nekudot-undo','nekudot-paint'])await new Promise((res)=>{const r=indexedDB.deleteDatabase(n);r.onsuccess=r.onerror=r.onblocked=()=>res()});return true})()`);
    const drawStroke = async (cx, cy, spin) => {
      const r = await E(`(()=>{const b=document.querySelector('.stage').getBoundingClientRect();return{l:b.left,t:b.top,w:b.width,h:b.height}})()`);
      const ox = r.l + r.w / 2 + cx, oy = r.t + r.h / 2 + cy;
      const px = (i) => ox + Math.round(45 * Math.cos(spin + i * 0.5)); const py = (i) => oy + Math.round(45 * Math.sin(spin + i * 0.5));
      await mouse("mouseMoved", px(0), py(0), 0); await mouse("mousePressed", px(0), py(0), 1);
      for (let i = 1; i <= 14; i++) { await mouse("mouseMoved", px(i), py(i), 1); await sleep(12); }
      await mouse("mouseReleased", px(14), py(14), 0); await sleep(220);
    };

    if (!(await waitFor(() => E(`!!document.querySelector('.stage')`), 30000))) throw new Error("app did not boot");
    await sleep(400);

    // ---- Phase A: shadow mode writes the v1 full stack (pre-migration) ----------
    await E(`localStorage.setItem('nekudot.undoTiles','shadow');localStorage.setItem('app.eventLog','true');localStorage.setItem('app.onboarded','true');localStorage.setItem('app.opacity','1');localStorage.setItem('app.size','8');true`);
    await clearDbs();
    await reload();
    await drawStroke(-90, -10, 0);
    const cShadow = await count();
    await forceHide();
    await sleep(200);
    const v1MetaPre = await idbGet("meta");
    const meta2Pre = await idbGet("meta2");
    ok("shadow mode wrote a v1 stack, no v2 yet", cShadow > 0 && v1MetaPre?.version === 1 && meta2Pre === null,
      `paint=${cShadow} v1=${JSON.stringify(v1MetaPre)} meta2=${meta2Pre}`);

    // ---- Phase B: flip to on -> first boot MIGRATES v1 -> v2 --------------------
    await E(`localStorage.setItem('nekudot.undoTiles','on');true`);
    await reload();
    const cMigrated = await count();
    const meta2Post = await idbGet("meta2");
    ok("migration preserved paint and seeded a v2 base", cMigrated > 0 && meta2Post?.version === 2,
      `paint=${cMigrated} (was ${cShadow}) meta2=${JSON.stringify(meta2Post?.version)}`);

    // ---- Phase C: v2 delta chain + boot-from-v2 --------------------------------
    await drawStroke(60, 30, 1.5);
    const cTwo = await count();
    await forceHide();
    await sleep(200);
    await reload();
    const cBootV2 = await count();
    const v1MetaOn = await idbGet("meta");
    ok("reload boots from the v2 chain (paint preserved)", cBootV2 > cShadow, `paint=${cBootV2} (2-stroke=${cTwo})`);
    ok("v1 keys shrank to a 1-deep shadow keyframe (rollback artifact)",
      v1MetaOn?.version === 1 && Array.isArray(v1MetaOn?.rowIds) && v1MetaOn.rowIds.length === 1,
      `v1=${JSON.stringify(v1MetaOn)}`);

    // ---- Phase D: dpr switch (epoch boundary) stretch-restores -----------------
    await setDpr(2);
    await reload();
    const cDpr = await count();
    ok("dpr switch (1x->2x) reload stretch-restored the paint", cDpr > 0, `paint=${cDpr} @dpr2`);
    // and the app keeps working after the reseed: a new stroke + reload survives.
    await drawStroke(-20, 60, 3.0);
    await forceHide(); await sleep(200);
    await reload();
    ok("post-dpr-reseed session persists a new stroke", (await count()) > 0);

    // ---- Phase E: eviction - folded rows persist + reload reconstructs ---------
    // MAX_UNDO is 10; >10 strokes pushes the oldest into `folded`. The reload must
    // reconstruct base + folded + active, proving folded rows round-trip through IDB.
    for (let i = 0; i < 13; i++) await drawStroke(-140 + i * 18, -80 + (i % 3) * 20, i * 0.4);
    const cManyLive = await count();
    await forceHide(); await sleep(200);
    const meta2Folded = await idbGet("meta2");
    ok("eviction moved entries into folded (meta2.foldedIds populated)",
      Array.isArray(meta2Folded?.foldedIds) && meta2Folded.foldedIds.length > 0,
      `foldedIds=${JSON.stringify(meta2Folded?.foldedIds)}`);
    await reload();
    const cManyBoot = await count();
    ok("reload reconstructs base + folded + active (paint preserved)",
      cManyBoot > 0 && Math.abs(cManyBoot - cManyLive) < cManyLive * 0.1,
      `boot=${cManyBoot} live=${cManyLive}`);

    const mismatches = logs.filter((l) => /shadow verify mismatch/.test(l));
    const errors = logs.filter((l) => /error|exception|is not a function/i.test(l) && !/mismatch|persist failed|migration persist|boot failed|boot error/.test(l));
    ok("no shadow verify mismatches", mismatches.length === 0, mismatches.slice(0, 2).join(" | "));
    ok("no runtime errors", errors.length === 0, errors.slice(0, 2).join(" | "));

    const passed = checks.filter(Boolean).length;
    console.log(`\n${passed === checks.length ? "✓ PASS" : "✗ FAIL"} - ${passed}/${checks.length} tiled-boot checks`);
    await send("Target.closeTarget", { targetId });
    return passed === checks.length ? 0 : 1;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("tiled-boot failed:", e.message); process.exit(1); });
