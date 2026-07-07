// Vector-replay roadmap P0.1, headless-Chrome half. Renders every brush x
// connection style TWICE through the real engine (replay-twice.html) and checks
// the two canvases are byte-identical - real-engine pixel determinism under
// pinned inputs. Manual (needs Chrome), like the other smokes.
//
//   node tests/smoke/replay-twice.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4402, DBG = 9352;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PAGE = `http://localhost:${PORT}/tests/smoke/replay-twice.html`;
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: REPO, stdio: "ignore" });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--no-first-run", "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok))) throw new Error("vite did not start");
    let u; await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); u = r?.webSocketDebuggerUrl; return !!u; });
    ws = await new Promise((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable");
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await S("Page.navigate", { url: PAGE });
    if (!(await waitFor(() => E("window.__done === true"), 40000))) throw new Error("render page never finished (check console)");
    const results = await E("window.__results");

    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad("case", 20)} ${pad("identical", 10)} ${pad("painted px", 11)} hash`);
    let fails = 0;
    for (const r of results) {
      if (r.error) { console.log(`✗ ${pad(r.id, 18)} ERROR: ${r.error}`); fails++; continue; }
      const ok = r.identical === true;
      if (!ok) fails++;
      console.log(`${ok ? "✓" : "✗"} ${pad(r.id, 18)} ${pad(ok ? "yes" : "NO", 10)} ${pad(r.painted, 11)} ${r.hash}`);
    }
    // Sanity: the drawing brushes must actually paint (Invisible is legitimately
    // blank - its mark lives on a transient overlay we don't render here).
    const blankDrawers = results.filter((r) => !r.error && r.painted === 0 && r.id !== "Invisible");
    for (const r of blankDrawers) { console.log(`✗ ${r.id} painted nothing (unexpected)`); fails++; }

    console.log(`\n${fails === 0 ? "✓ PASS" : "✗ FAIL"} — ${results.length - fails}/${results.length} cases byte-identical across two real-engine runs`);
    await send("Target.closeTarget", { targetId });
    return fails === 0 ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("replay-twice failed:", e.message); process.exit(1); });
