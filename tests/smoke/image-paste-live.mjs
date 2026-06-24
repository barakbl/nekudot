// Real app: paste-an-image-onto-the-canvas (src/app/image-paste.ts). Simulates a
// clipboard image paste, then checks the placement flow: a preview + action bar
// appear, an over-large image is scaled to fit, drag moves it, a corner resizes
// it, "Place" bakes it onto the active layer (and is undoable), and "Cancel"
// drops it with no change.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4432, DBG = 9366;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome — skipping."); return 0; }
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
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await E("localStorage.clear()"); await E("indexedDB.deleteDatabase('nekudot')");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(500);

    // ---- page-side helpers --------------------------------------------------
    await E(`(${() => {
      const opaque = (c) => { const ctx = c.getContext("2d", { willReadFrequently: true }); const d = ctx.getImageData(0, 0, c.width, c.height).data; let n = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 20) { const px = (i / 4) % c.width, py = Math.floor((i / 4) / c.width); n++; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; } } return { n, minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }; };
      window.__paste = {
        preview() { return document.querySelector(".paste-preview"); },
        hasBar() { return !!document.querySelector(".paste-bar"); },
        previewBox() { const c = document.querySelector(".paste-preview"); return c ? opaque(c) : null; },
        // Painted pixels on the real layers (not the floating preview).
        layerBox() {
          let acc = null;
          for (const c of document.querySelectorAll(".stage canvas")) {
            if (c.classList.contains("paste-preview")) continue;
            const b = opaque(c);
            if (b.n === 0) continue;
            acc = acc ? { n: acc.n + b.n, minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY), maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY) } : b;
          }
          return acc ? { ...acc, w: acc.maxX - acc.minX, h: acc.maxY - acc.minY } : { n: 0 };
        },
        // Dispatch a real clipboard paste of an opaque w×h PNG.
        async paste(w, h) {
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          const cx = c.getContext("2d"); cx.fillStyle = "#c0392b"; cx.fillRect(0, 0, w, h);
          const blob = await new Promise((r) => c.toBlob(r, "image/png"));
          const file = new File([blob], "x.png", { type: "image/png" });
          const dt = new DataTransfer(); dt.items.add(file);
          document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
          return true;
        },
      };
    }})()`);

    const previewBox = () => E(`window.__paste.previewBox()`);
    const layerBox = () => E(`window.__paste.layerBox()`);
    const hasPreview = () => E(`!!window.__paste.preview()`);
    const hasBar = () => E(`window.__paste.hasBar()`);
    // Real mouse click on a bar button, asserting it's the topmost hit at that
    // point (never a synthetic .click() that would pass even if covered).
    const clickBar = async (label) => {
      const r = await E(`(()=>{const b=[...document.querySelectorAll('.paste-bar button')].find(x=>x.textContent===${JSON.stringify(label)}); if(!b) return null; const q=b.getBoundingClientRect(); return {x:q.left+q.width/2, y:q.top+q.height/2};})()`);
      if (!r) return false;
      const hit = await E(`(()=>{const el=document.elementFromPoint(${r.x}, ${r.y}); return !!el && !!el.closest('.paste-bar button');})()`);
      if (!hit) return false;
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1, buttons: 1 });
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1, buttons: 1 });
      return true;
    };
    const paste = (w, h) => E(`window.__paste.paste(${w}, ${h})`);
    const drag = async (x0, y0, x1, y1) => {
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", clickCount: 1, buttons: 1 });
      const steps = 8;
      for (let i = 1; i <= steps; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, button: "left", buttons: 1 });
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", clickCount: 1, buttons: 1 });
      await sleep(80);
    };
    const results = [];

    // A) Paste a very wide image (4000×500, bigger than the canvas) -> a preview
    //    + action bar appear; baking scales it to FIT (not native/clipped size).
    await paste(4000, 500);
    await waitFor(() => hasPreview());
    const aPreview = await hasPreview(), aBar = await hasBar(), aBox = await previewBox();
    await clickBar("Place"); await sleep(150);
    const goneAfterPlace = !(await hasPreview()) && !(await hasBar());
    const baked = await layerBox();
    // 4000×500 fit into ~1096×716 -> scale ~0.274 -> ~1096×137. Native/clipped
    // would be 500px tall, so a baked height well under that proves the fit.
    const fitOk = baked.n > 0 && baked.h > 60 && baked.h < 260 && baked.w > 700;
    results.push(["paste shows preview + bar", aPreview && aBar && aBox.n > 0, `preview n=${aBox.n} bar=${aBar}`]);
    results.push(["Place bakes scaled-to-fit + clears UI", goneAfterPlace && fitOk, `baked ${baked.w}×${baked.h} n=${baked.n} cleared=${goneAfterPlace}`]);

    // B) Undo removes the baked image.
    for (const t of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type: t, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 4 });
    await sleep(250);
    const afterUndo = await layerBox();
    results.push(["Cmd+Z undoes the bake", afterUndo.n < baked.n * 0.1, `painted ${baked.n}->${afterUndo.n}`]);

    // C) Paste a medium image, drag the body to MOVE it, drag a corner to RESIZE.
    await paste(400, 300);
    await waitFor(() => hasPreview());
    const c0 = await previewBox();
    await drag(c0.cx, c0.cy, c0.cx + 120, c0.cy + 60); // move (start at centre = move mode)
    const c1 = await previewBox();
    const moved = Math.abs(c1.cx - (c0.cx + 120)) < 18 && Math.abs(c1.cy - (c0.cy + 60)) < 18;
    results.push(["drag body moves the image", moved, `centre ${c0.cx.toFixed(0)},${c0.cy.toFixed(0)} -> ${c1.cx.toFixed(0)},${c1.cy.toFixed(0)}`]);
    // resize from the bottom-right corner outward (aspect-locked grow).
    const brx = c1.maxX, bry = c1.maxY;
    await drag(brx, bry, brx + 140, bry + 105);
    const c2 = await previewBox();
    const grew = c2.w > c1.w + 60;
    results.push(["drag corner resizes the image", grew, `width ${c1.w.toFixed(0)} -> ${c2.w.toFixed(0)}`]);

    // D) Cancel drops the placement with no change to the layers.
    const beforeCancel = await layerBox();
    await clickBar("Cancel"); await sleep(120);
    const afterCancel = await layerBox();
    const cancelOk = !(await hasPreview()) && !(await hasBar()) && afterCancel.n === beforeCancel.n;
    results.push(["Cancel drops it, no bake", cancelOk, `painted ${beforeCancel.n}->${afterCancel.n} cleared=${!(await hasPreview())}`]);

    // E) The Shortcuts panel lists the paste shortcut (Edit group, "V" cap).
    for (const t of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type: t, key: "/", code: "Slash", windowsVirtualKeyCode: 191, nativeVirtualKeyCode: 191 });
    await sleep(150);
    const pasteRow = await E(`(()=>{const r=[...document.querySelectorAll('.shortcuts-row')].find(x=>x.querySelector('.shortcuts-desc')?.textContent==='Paste image'); if(!r) return null; return {caps:[...r.querySelectorAll('.shortcuts-bind kbd')].map(k=>k.textContent)};})()`);
    const rowOk = !!pasteRow && pasteRow.caps.includes("V");
    results.push(["Shortcuts panel lists Paste image", rowOk, pasteRow ? `caps=[${pasteRow.caps.join(" ")}]` : "row missing"]);

    let ok = true;
    for (const [name, pass, detail] of results) { console.log(`${pass ? "✓" : "✗"} ${name} — ${detail}`); ok = ok && pass; }
    console.log(ok ? "\n✓ PASS — paste → fit → move/resize → Place (undoable) / Cancel" : "\n✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("image-paste-live failed:", e.message); process.exit(1); });
