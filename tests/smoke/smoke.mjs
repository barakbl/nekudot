// Browser smoke tests for undo/redo and download/upload of artwork.
// Builds the app, serves dist, drives it in headless Chrome over CDP.
//
//   npm run smoke
//
// Chrome is found via $CHROME or common install paths; the test skips (exit 0)
// with a message if no Chrome is available.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const PORT = 4399;
const ROOT = new URL("../..", import.meta.url).pathname;

function findChrome() {
  const cands = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return cands.find((p) => existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(step);
  }
  return false;
}

// ---- minimal CDP client (flat sessions) ------------------------------------
function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  return (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
};

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log("• No Chrome found (set $CHROME). Skipping smoke tests.");
    return 0;
  }

  console.log("▶ building…");
  execSync("npx vite build", { cwd: ROOT, stdio: "ignore" });

  const dlDir = mkdtempSync(join(tmpdir(), "doodi-smoke-dl-"));
  const profile = mkdtempSync(join(tmpdir(), "doodi-smoke-chrome-"));
  const preview = spawn("npx", ["vite", "preview", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  const browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", `--remote-debugging-port=9333`,
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdio: "ignore" });

  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok)))
      throw new Error("preview server did not start");
    let wsUrl;
    if (!(await waitFor(async () => {
      const r = await fetch("http://localhost:9333/json/version").then((x) => x.json()).catch(() => null);
      wsUrl = r?.webSocketDebuggerUrl;
      return !!wsUrl;
    }))) throw new Error("chrome devtools did not start");

    ws = await new Promise((res, rej) => {
      const w = new WebSocket(wsUrl);
      w.onopen = () => res(w);
      w.onerror = rej;
    });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable");
    await S("Runtime.enable");
    await S("DOM.enable");
    await S("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
    await S("Page.navigate", { url: `http://localhost:${PORT}/` });
    if (!(await waitFor(async () => {
      const r = await S("Runtime.evaluate", { expression: "!!document.querySelector('.toolbar')", returnByValue: true });
      return r.result.value === true;
    }))) throw new Error("app did not load");
    // Let the async startup settle (IDB restore + the "Initial state" undo push).
    await sleep(1800);

    const E = async (expr) => {
      const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const M = (type, x, y, btn) =>
      S("Input.dispatchMouseEvent", { type, x, y, button: btn || "none", buttons: btn === "left" ? 1 : 0, clickCount: btn ? 1 : 0 });
    // alpha sum of the largest layer canvas
    const painted = () => E(`(()=>{for(const c of document.querySelectorAll('canvas')){if(c.width<200)continue;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let s=0;for(let i=3;i<d.length;i+=4)s+=d[i];if(s>0)return s;}return 0;})()`);

    // ---- undo / redo --------------------------------------------------------
    await M("mousePressed", 360, 280, "left");
    for (let k = 0; k < 24; k++) await M("mouseMoved", 360 + k * 7, 280 + Math.sin(k / 3) * 40, "left");
    await M("mouseReleased", 360 + 168, 280, "left");
    await sleep(300);
    const afterDraw = await painted();
    check("draw produces pixels", afterDraw > 0, `alpha-sum ${afterDraw}`);

    // Wait until the stroke's (async) undo snapshot is committed → Undo enabled.
    const undoReady = await waitFor(
      () => E(`!document.querySelector('button[title="Undo"]').disabled`),
      4000,
    );
    check("undo becomes available after a stroke", undoReady);

    await E(`document.querySelector('button[title="Undo"]').click()`);
    await sleep(500);
    const afterUndo = await painted();
    check("undo reduces pixels", afterUndo < afterDraw, `${afterDraw} → ${afterUndo}`);

    await E(`document.querySelector('button[title="Redo"]').click()`);
    await sleep(400);
    const afterRedo = await painted();
    check("redo restores pixels", afterRedo > afterUndo, `${afterUndo} → ${afterRedo}`);

    // ---- download (Save artwork → .nekudot) --------------------------------
    await E(`document.querySelector('.canvas-menu-btn').click()`);
    await sleep(150);
    await E(`[...document.querySelectorAll('.canvas-menu-popover .brush-option')].find(o=>/Save artwork/i.test(o.textContent)).click()`);
    const gotFile = await waitFor(() => readdirSync(dlDir).some((f) => f.endsWith(".nekudot")), 8000);
    check("save downloads a .nekudot", gotFile);

    let savedPath;
    if (gotFile) {
      savedPath = join(dlDir, readdirSync(dlDir).find((f) => f.endsWith(".nekudot")));
      const files = unzipSync(new Uint8Array(readFileSync(savedPath)));
      const names = Object.keys(files);
      const hasManifest = names.includes("manifest.json");
      const hasLayer = names.some((n) => /^layers\/.*\.png$/.test(n));
      let version = null;
      try { version = JSON.parse(strFromU8(files["manifest.json"])).version; } catch {}
      check("archive has manifest + layer PNG", hasManifest && hasLayer, names.join(", "));
      check("manifest is version 2", version === 2, `version ${version}`);
    }

    // ---- upload (load the archive we just saved) ---------------------------
    if (savedPath) {
      const { result } = await S("Runtime.evaluate", { expression: "document.querySelector('input[type=file]')", returnByValue: false });
      await S("DOM.setFileInputFiles", { files: [savedPath], objectId: result.objectId });
      await sleep(800);
      const state = await E(`(()=>{const m=document.querySelector('.confirm-modal');const c=document.querySelector('canvas');return JSON.stringify({err:m?m.querySelector('p')?.textContent:null, w:c?c.style.width:null});})()`);
      const st = JSON.parse(state);
      check("upload loads without error", st.err === null, st.err || "");
      check("upload restores a canvas", !!st.w, `canvas ${st.w}`);
    }

    await send("Target.closeTarget", { targetId });
  } finally {
    try { ws?.close(); } catch {}
    browser.kill("SIGKILL");
    preview.kill("SIGKILL");
    rmSync(dlDir, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error("smoke run failed:", e.message);
  process.exit(1);
});
