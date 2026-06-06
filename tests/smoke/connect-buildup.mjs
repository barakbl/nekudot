// Empirical comparison of connecting-line build-up: Nekudot's real engine vs a
// faithful port of mrdoob's Harmony brushes, driven by an identical gesture in
// headless Chrome. Reuses the all-render.mjs CDP plumbing.
//
//   node tests/smoke/connect-buildup.mjs
//
// Prints build-up tables + ratios and writes sample PNGs to tests/smoke/buildup-out/.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4402;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE_URL = `http://localhost:${PORT}/tests/smoke/connect-buildup.html`;

function findChrome() {
  return [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean).find((p) => existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 25000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true; } catch {}
    await sleep(step);
  }
  return false;
}

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

const f1 = (n) => n.toFixed(1);
const ratio = (a, b) => (b > 0 ? (a / b).toFixed(2) + "x" : "—");

function report(R) {
  for (const [id, p] of Object.entries(R.pairs)) {
    console.log(`\n■ ${p.label}  (${id})   base gesture = ${p.baseN} pts`);
    console.log("  repeated passes — total ink mass (and Nekudot/Harmony ratio):");
    console.log("    pass │  Nek total   Harm total  ratio │  Nek web     Harm web    ratio");
    for (const r of p.rows) {
      console.log(
        `    ${String(r.pass).padStart(4)} │ ${f1(r.nekTotal).padStart(10)} ${f1(r.harmTotal).padStart(11)} ${ratio(r.nekTotal, r.harmTotal).padStart(6)} │ ` +
        `${f1(r.nekWeb).padStart(9)} ${f1(r.harmWeb).padStart(11)} ${ratio(r.nekWeb, r.harmWeb).padStart(6)}`,
      );
    }
    console.log("  sampling amplifier — pass-1 web ink vs point density (Harmony fixed at 1x):");
    console.log(`    Harmony 1x web = ${f1(p.harmWeb1)} (${p.baseN} pts)`);
    for (const s of p.sampling)
      console.log(`    Nekudot ${s.mult}x web = ${f1(s.web).padStart(8)} (${s.n} pts)   ${ratio(s.web, p.harmWeb1)} vs Harmony`);
  }
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log("• No Chrome found (set $CHROME). Skipping."); return 0; }

  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: join(HERE, "..", ".."), stdio: "ignore",
  });
  const browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--remote-debugging-port=9336",
    "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok)))
      throw new Error("vite dev server did not start");
    let wsUrl;
    if (!(await waitFor(async () => {
      const r = await fetch("http://localhost:9336/json/version").then((x) => x.json()).catch(() => null);
      wsUrl = r?.webSocketDebuggerUrl;
      return !!wsUrl;
    }))) throw new Error("chrome devtools did not start");

    ws = await new Promise((res, rej) => {
      const w = new WebSocket(wsUrl);
      w.onopen = () => res(w); w.onerror = rej;
    });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, pr) => send(m, pr, sessionId);
    await S("Page.enable");
    await S("Runtime.enable");
    await S("Page.navigate", { url: PAGE_URL });

    const E = async (expr) => {
      const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };

    if (!(await waitFor(() => E("window.__done === true"), 40000)))
      throw new Error("harness did not finish");

    const R = await E("window.__results");
    report(R);

    const images = await E("window.__images");
    mkdirSync(OUT, { recursive: true });
    let n = 0;
    for (const [name, url] of Object.entries(images)) {
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
      n++;
    }
    console.log(`\n✓ wrote ${n} sample PNGs → ${OUT}`);
    await send("Target.closeTarget", { targetId });
    return 0;
  } finally {
    try { ws?.close(); } catch {}
    browser.kill("SIGKILL");
    dev.kill("SIGKILL");
  }
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("connect-buildup failed:", e.message);
  process.exit(1);
});
