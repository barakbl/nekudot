#!/usr/bin/env bash
# Build the app into ONE self-contained, minified HTML file (JS + CSS inlined).
# Output is <output_dir>/app/index.html (default dir: ./docs, the GitHub-Pages
# site folder), so the app is served at /app/ next to the landing pages
# (index/about/license) and book/. The site root index.html is the landing page.
#
# Usage: ./build.sh [output_dir]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$ROOT/docs}"
cd "$ROOT"

echo "▶ vite build…"
npx vite build >/dev/null

echo "▶ inlining JS + CSS into a single HTML…"
mkdir -p "$OUT_DIR/app"

DIST="$ROOT/dist" OUT="$OUT_DIR/app/index.html" node <<'NODE'
const fs = require("fs");
const path = require("path");
const dist = process.env.DIST;
const out = process.env.OUT;

// Vite emits a single entry chunk + one stylesheet for this app. Bail loudly
// if that assumption breaks (e.g. code-splitting), since the simple inliner
// below only inlines the referenced entry files.
const assets = fs.readdirSync(path.join(dist, "assets"));
const jsCount = assets.filter((f) => f.endsWith(".js")).length;
if (jsCount > 1) {
  console.error(`Expected 1 JS chunk, found ${jsCount}. Inliner needs updating.`);
  process.exit(1);
}

let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");

// Guard: dist/index.html must be the app entry (references the built JS), not
// the landing page. Vite keeps the build output when docs/index.html (the
// landing) collides, but bail loudly if that ever flips — otherwise we'd
// silently inline the landing page as the app.
if (!/<script\b[^>]*\bsrc="[^"]*\/assets\/[^"]*\.js"/.test(html)) {
  console.error("dist/index.html is not the app entry (no /assets/*.js). Aborting.");
  process.exit(1);
}

const read = (url) => fs.readFileSync(path.join(dist, url.replace(/^\//, "")), "utf8");

// <script ... src="/assets/x.js"></script>  ->  inline module script
html = html.replace(
  /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
  (_m, src) => `<script type="module">${read(src).replace(/<\/script>/gi, "<\\/script>")}</script>`,
);

// <link rel="stylesheet" href="/assets/x.css">  ->  inline <style>
html = html.replace(
  /<link\b[^>]*\bhref="([^"]+\.css)"[^>]*>/g,
  (_m, href) => `<style>${read(href)}</style>`,
);

// Collapse the blank lines left where the tags were.
html = html.replace(/^\s*\n/gm, "");

fs.writeFileSync(out, html);
console.log(`  ${out}  (${(html.length / 1024).toFixed(1)} KB)`);
NODE

echo "✔ done"
ls -lh "$OUT_DIR/app/index.html" | awk '{printf "  %-6s %s\n", $5, $NF}'
