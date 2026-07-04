// Real app: the navbar Maps cloud-of-dots icon (card #88) and the Maps subpanel it
// opens - a navbar-anchored popover (like the colour picker), NOT a draggable
// window. The icon opens/toggles the popover and lights up (.is-on) while "Live
// view" is on. The popover pins an explainer, then a Live-view toggle, then "+ New
// map" and the map list (live dot count, active bold, per-row flash, inline rename).
// Verifies: default name is "map-1"; drawing raises the active map's dots; the
// Live-view toggle lights the navbar icon + paints the active map's dots; "New
// map" creates an active map; per-map flash lights the overlay; clicking a name
// renames it inline; Select swaps the active map; delete goes through a confirm
// modal; the 'm' key toggles the popover.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4426, DBG = 9360;
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
    // Skip the first-run onboarding takeover (it covers the canvas) so the stroke
    // lands on the canvas and populates the active map. Runs before app JS on each
    // navigation, so it survives the localStorage.clear() + reload below.
    await S("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('app.onboarded','true')}catch(e){}" });
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await E("localStorage.clear()");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(400);
    mkdirSync(OUT, { recursive: true });

    // The cloud icon toggles the anchored popover (display driven). ensureOpen()
    // clicks it only when closed so callers don't accidentally toggle it shut.
    const boxOpen = () => E(`(() => { const b=document.querySelector('.maps-popover'); return !!b && b.style.display!=='none'; })()`);
    const iconClick = () => E(`document.querySelector('.toolbar .maps-pill-btn').click()`);
    const ensureOpen = async () => { if (!(await boxOpen())) { await iconClick(); await sleep(120); } };
    // The active map's name now lives in the popover list (and the icon tooltip);
    // read it from the active row so the assertions track what the user sees.
    const activeName = () => E(`document.querySelector('.maps-popover .maps-menu-row.active .maps-menu-name')?.textContent||''`);
    const iconLit = () => E(`!!document.querySelector('.toolbar .maps-pill-btn.is-on')`);
    const readRows = () => E(`[...document.querySelectorAll('.maps-popover .maps-menu-row')].map(r=>({ name:r.querySelector('.maps-menu-name')?.textContent||'', dots:(()=>{const n=parseInt(r.querySelector('.maps-menu-dots')?.textContent||'',10);return isNaN(n)?-1:n;})(), active:r.classList.contains('active'), tag:!!r.querySelector('.maps-menu-tag'), select:!!r.querySelector('.maps-menu-select'), del:!!r.querySelector('.maps-menu-delete') })) `);
    const clickSelect = (name) => E(`(() => { const r=[...document.querySelectorAll('.maps-popover .maps-menu-row')].find(x=>x.querySelector('.maps-menu-name')?.textContent===${JSON.stringify(name)}); const b=r&&r.querySelector('.maps-menu-select'); if(!b) return false; b.click(); return true; })()`);
    const clickDelete = (name) => E(`(() => { const r=[...document.querySelectorAll('.maps-popover .maps-menu-row')].find(x=>x.querySelector('.maps-menu-name')?.textContent===${JSON.stringify(name)}); const b=r&&r.querySelector('.maps-menu-delete'); if(!b) return false; b.click(); return true; })()`);
    const clickNewMap = () => E(`(() => { const b=document.querySelector('.maps-popover .layers-add-btn'); if(!b) return false; b.click(); return true; })()`);
    // "Live view" toggle at the top of the popover (the old navbar flash button's
    // job): turns the persistent hot-map highlight on/off + flashes once as it lights.
    const clickLiveView = () => E(`(() => { const t=document.querySelector('.maps-live-row .toggle-switch'); if(!t) return false; t.click(); return true; })()`);
    const flashIconCount = () => E(`document.querySelectorAll('.maps-popover .maps-menu-row .maps-menu-flash').length`);
    const clickMapFlash = (name) => E(`(() => { const r=[...document.querySelectorAll('.maps-popover .maps-menu-row')].find(x=>x.querySelector('.maps-menu-name')?.textContent===${JSON.stringify(name)}); const b=r&&r.querySelector('.maps-menu-flash'); if(!b) return false; b.click(); return true; })()`);
    const overlayLit = () => E(`(() => { const cs=[...document.querySelectorAll('.stage canvas')]; const ov=cs.reduce((a,b)=>(+getComputedStyle(b).zIndex||0)>(+getComputedStyle(a).zIndex||0)?b:a); const d=ov.getContext('2d').getImageData(0,0,ov.width,ov.height).data; let lit=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) lit++; return lit; })()`);
    const renameMap = (oldName, newName) => E(`(() => {
      const r=[...document.querySelectorAll('.maps-popover .maps-menu-row')].find(x=>x.querySelector('.maps-menu-name')?.textContent===${JSON.stringify(oldName)});
      if(!r) return 'no-row';
      r.querySelector('.maps-menu-name').click();
      const inp=r.querySelector('.maps-menu-name-input');
      if(!inp) return 'no-input';
      inp.value=${JSON.stringify(newName)};
      inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      return 'ok';
    })()`);

    // 1) icon present; open the popover; Live-view row sits at the top; default
    //    active map is "map-1" with 0 dots.
    const hasPill = await E(`!!document.querySelector('.toolbar .maps-pill-btn')`);
    await ensureOpen();
    const open1 = await boxOpen();
    const liveRowPresent = await E(`(() => { const r=document.querySelector('.maps-popover .maps-live-row'); return !!(r && r.querySelector('.toggle-switch')); })()`);
    const name1 = await activeName();
    const rows1 = await readRows();
    console.log(`Icon: ${hasPill ? "✓" : "✗"}  popover open: ${open1 ? "✓" : "✗"}  live-view row:${liveRowPresent ? "✓" : "✗"}  active:"${name1}"`);
    console.log(`Initial -> ${JSON.stringify(rows1)}`);

    // 2) draw a stroke into the active first map. Close the popover first so the
    //    stroke lands on bare canvas - an open anchored popover absorbs clicks on
    //    itself (like the colour picker) - then reopen to read the fresh count.
    if (await boxOpen()) { await iconClick(); await sleep(120); }
    const pts = []; for (let x = 200; x <= 900; x += 6) pts.push([x, 380 + 90 * Math.sin((x - 200) / 80)]);
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
    for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
    await sleep(300);
    await ensureOpen();
    const rows2 = await readRows();
    const active2 = rows2.find((r) => r.active);
    console.log(`After draw -> ${JSON.stringify(rows2)}`);

    // 3) Live view: the top toggle lights the navbar icon + paints/flashes the
    //    active map's dots; toggling off unlights the icon.
    await clickLiveView(); await sleep(150);
    const litActive = await overlayLit();
    const iconLitOn = await iconLit();
    await clickLiveView(); await sleep(150);
    const iconLitOff = await iconLit();
    console.log(`Live view on: lit:${litActive} iconLit:${iconLitOn ? "✓" : "✗"}  off -> iconLit:${iconLitOff ? "✗(still on)" : "✓(off)"}`);

    // 4) New map -> creates an active map; popover stays open
    const newClicked = await clickNewMap();
    await sleep(120);
    const afterNewOpen = await boxOpen();
    const rows3 = await readRows();
    const name3 = await activeName();
    console.log(`New map: ${newClicked ? "✓" : "✗"}  popover stays open:${afterNewOpen ? "✓" : "✗"}  active:"${name3}"  -> ${JSON.stringify(rows3)}`);

    // 5) per-map flash icons; flashing a row flashes that map (popover stays open)
    const icons = await flashIconCount();
    const perMapFlashed = await clickMapFlash("map-1");
    await sleep(120);
    const litPerMap = await overlayLit();
    const stillOpenAfterFlash = await boxOpen();
    console.log(`Flash icons:${icons}  flashed map-1:${perMapFlashed ? "✓" : "✗"}  lit:${litPerMap}  popover open:${stillOpenAfterFlash ? "✓" : "✗"}`);

    // 6) inline rename: click map-2's name, type "Faces", Enter
    const renamed = await renameMap("map-2", "Faces");
    await sleep(80);
    const rows4 = await readRows();
    const name4 = await activeName();
    console.log(`Rename map-2 -> Faces: ${renamed}  active:"${name4}"  -> ${JSON.stringify(rows4)}`);

    // 7) Select map-1 -> becomes active; popover stays open; chip + flash give
    //    feedback; the active row reflects the new active map.
    const selClicked = await clickSelect("map-1");
    await sleep(120);
    const selStillOpen = await boxOpen();
    const chipText = await E(`document.querySelector('.undo-chip')?.textContent || ''`);
    const selLit = await overlayLit();
    const name5 = await activeName();
    const rows5 = await readRows();
    await S("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(join(OUT, "maps-menu.png"), Buffer.from(s.data, "base64")));
    console.log(`Select map-1: ${selClicked ? "✓" : "✗"}  popover open:${selStillOpen ? "✓" : "✗"}  chip:"${chipText}"  flash lit:${selLit}  active:"${name5}"`);
    console.log(`After select -> ${JSON.stringify(rows5)}`);

    // 8) no draggable Maps window / standalone Neighbors box; the 'm' shortcut
    //    toggles the anchored popover (open after step 7).
    const noBox = await E(`!document.querySelector('.maps-box') && !document.querySelector('.neighbors-map-box')`);
    const pressM = async () => { for (const t of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type: t, key: "m", code: "KeyM", windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77 }); };
    await pressM(); await sleep(120);
    const closedByKey = !(await boxOpen());
    await pressM(); await sleep(120);
    const openedByKey = await boxOpen();
    console.log(`No draggable box: ${noBox ? "✓" : "✗"}  'm' toggles popover -> closed:${closedByKey ? "✓" : "✗"} reopened:${openedByKey ? "✓" : "✗"}`);

    // 9) delete a map via the list -> confirm modal -> removed. With 2 maps each
    //    row has a delete button; deleting Faces leaves only map-1 (no delete on
    //    the sole remaining map). Box is open from step 8's 'm' reopen.
    const delBtnsAt2 = rows5.length === 2 && rows5.every((r) => r.del);
    const delClicked = await clickDelete("Faces");
    await sleep(120);
    const modalShown = await E(`!!document.querySelector('.confirm-modal')`);
    // destructive confirm uses .confirm-btn-destructive (primary is for non-destructive)
    await E(`document.querySelector('.confirm-modal .confirm-btn-destructive')?.click()`);
    await sleep(220);
    const rowsFinal = await readRows();
    console.log(`Delete btns @2:${delBtnsAt2 ? "✓" : "✗"}  delete Faces:${delClicked ? "✓" : "✗"} modal:${modalShown ? "✓" : "✗"} -> ${JSON.stringify(rowsFinal)}`);

    const facesRow4 = rows4.find((r) => r.name === "Faces");
    const map1Row4 = rows4.find((r) => r.name === "map-1");
    const map1Row5 = rows5.find((r) => r.name === "map-1");
    const facesRow5 = rows5.find((r) => r.name === "Faces");
    const ok =
      hasPill && open1 && liveRowPresent && name1 === "map-1" &&
      rows1.length === 1 && rows1[0].name === "map-1" && rows1[0].active && rows1[0].dots === 0 &&
      active2 && active2.name === "map-1" && active2.dots > 0 &&
      // Live view: on lights the icon + overlay; off unlights it.
      litActive > 0 && iconLitOn && !iconLitOff &&
      newClicked && afterNewOpen && rows3.length === 2 && name3 === "map-2" &&
      rows3.some((r) => r.name === "map-2" && r.active && r.dots === 0) &&
      rows3.some((r) => r.name === "map-1" && !r.active && r.dots > 0) &&
      icons === 2 && perMapFlashed && litPerMap > 0 && stillOpenAfterFlash &&
      renamed === "ok" && name4 === "Faces" &&
      // after rename: Faces active (tag, no Select); map-1 inactive (Select, no tag)
      !!facesRow4 && facesRow4.active && facesRow4.tag && !facesRow4.select &&
      !!map1Row4 && !map1Row4.active && map1Row4.select && !map1Row4.tag &&
      // Select map-1: popover stays open, chips "Selected ...", flashes the map,
      // the active row updates, and the roles swap (map-1 active, Faces selectable).
      selClicked && selStillOpen && chipText.includes("map-1") && selLit > 0 && name5 === "map-1" &&
      !!map1Row5 && map1Row5.active && map1Row5.tag &&
      !!facesRow5 && !facesRow5.active && facesRow5.select &&
      // no draggable box; 'm' toggles the anchored popover
      noBox && closedByKey && openedByKey &&
      // delete via confirm modal: Faces removed, only map-1 left (no delete btn)
      delBtnsAt2 && delClicked && modalShown &&
      rowsFinal.length === 1 && rowsFinal[0].name === "map-1" && !rowsFinal[0].del;
    console.log(`\n✓ screenshot → ${join(OUT, "maps-menu.png")}`);
    console.log(ok ? "✓ PASS — cloud icon opens the anchored popover; Live-view toggle lights the icon; New map; per-map flash; rename; select; delete (confirm); 'm' toggles popover" : "✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("maps-menu-live failed:", e.message); process.exit(1); });
