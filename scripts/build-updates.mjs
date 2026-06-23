// Build the artist-facing "Updates" page (docs/updates.html) from the curated
// per-release Markdown in docs/updates/*.md. Each file is hand-written in a warm,
// benefit-led voice (NOT the technical CHANGELOG); the build just renders it.
//
//   node scripts/build-updates.mjs           # render docs/updates.html (default)
//   node scripts/build-updates.mjs --sync    # also draft-stub the latest release
//
// --sync (run by the release workflow) reads the newest version in CHANGELOG.md
// and, if there's no docs/updates/<version>.md yet, drops a hidden `draft: true`
// stub so a release is never silently missed - you then rewrite it and flip the
// draft flag. Rendering is a pure function of the committed .md files (no clock,
// stable order), so CI can rebuild it and check it byte-for-byte like the app.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "docs", "updates");
const OUT = join(ROOT, "docs", "updates.html");
const CHANGELOG = join(ROOT, "CHANGELOG.md");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// "YYYY-MM-DD" -> "June 23, 2026" (parsed by parts so it's timezone-stable).
function prettyDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) return String(iso);
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

// Newest-first semver compare for "X.Y.Z".
function cmpVerDesc(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
}

// Minimal, controlled-input Markdown: blank-line-separated blocks become <p> or,
// when every line starts with "- ", a <ul>. Inline: **bold**, *italic*, `code`,
// [text](url). Enough for our own copy without pulling in a dependency.
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
function renderMarkdown(body) {
  const blocks = body.trim().split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^[-*]\s+/.test(l))) {
      const items = lines.map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`).join("");
      return `<ul class="update-highlights">${items}</ul>`;
    }
    return `<p>${inline(lines.join(" "))}</p>`;
  }).join("\n");
}

// Parse a leading `---` YAML-ish frontmatter block (flat key: value pairs).
function parse(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim().replace(/^["']|["']$/g, "");
    if (v === "true") v = true;
    else if (v === "false") v = false;
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

function readEntries() {
  if (!existsSync(SRC_DIR)) return [];
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parse(readFileSync(join(SRC_DIR, f), "utf8")))
    .filter((e) => e.data.version)
    .sort((a, b) => cmpVerDesc(a.data.version, b.data.version));
}

// Newest released version + date (+ a cleaned summary) from the top of CHANGELOG.
function latestRelease() {
  if (!existsSync(CHANGELOG)) return null;
  const text = readFileSync(CHANGELOG, "utf8");
  const head = /##\s*\[(\d+\.\d+\.\d+)\]\([^)]*\)\s*\((\d{4}-\d{2}-\d{2})\)/.exec(text);
  if (!head) return null;
  const after = text.slice(head.index + head[0].length);
  const bullet = /\n\*\s+(.+)/.exec(after);
  const summary = bullet
    ? bullet[1].replace(/^\*\*[^*]+\*\*\s*/, "").replace(/\s*\(\[.*$/, "").trim()
    : "";
  return { version: head[1], date: head[2], summary };
}

// --sync: drop a hidden draft stub for the latest release if none exists yet.
function syncLatest() {
  const rel = latestRelease();
  if (!rel) return;
  if (!existsSync(SRC_DIR)) mkdirSync(SRC_DIR, { recursive: true });
  const file = join(SRC_DIR, `${rel.version}.md`);
  if (existsSync(file)) return;
  const stub = `---
version: ${rel.version}
date: ${rel.date}
title: ${rel.version} - give me a friendly title
image:
draft: true
---
<!-- Auto-drafted on release. Rewrite in an artist-friendly voice (lead with what
     it lets you do), add highlights, optionally set an image, then flip draft to
     false. Changelog hint: ${rel.summary || "(see CHANGELOG.md)"} -->

Describe what's new for artists here.

- Highlight one
- Highlight two
`;
  writeFileSync(file, stub);
  console.log(`drafted ${file} (hidden until draft: false)`);
}

function entryHtml(e) {
  const { version, date, title, image } = e.data;
  const shot = image
    ? `\n        <img class="update-shot" src="${esc(image)}" alt="${esc(title || version)}" loading="lazy" />`
    : "";
  return `      <article class="update">
        <p class="update-meta"><time datetime="${esc(date)}">${esc(prettyDate(date))}</time><span class="update-ver">v${esc(version)}</span></p>
        <h2 class="update-title">${esc(title || version)}</h2>
        <div class="update-body">
${renderMarkdown(e.body)}
        </div>${shot}
      </article>`;
}

function pageHtml(entries) {
  const list = entries.length
    ? entries.map(entryHtml).join("\n")
    : `      <p class="muted">Nothing here yet - check back after the next release.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Updates - Nekudot</title>
    <meta
      name="description"
      content="What's new in Nekudot - the latest brushes, tools and touches, told for the people who draw with it."
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,400..600,0..100,0..1;1,9..144,400..600,0..100,0..1&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/home.css" />
  </head>
  <body>
    <nav class="nav">
      <a class="brand" href="/">Neku<span class="dot">dot</span></a>
      <span class="nav-links">
        <a href="/updates.html" class="current">Updates</a>
        <a href="/about.html">About</a>
        <a href="/license.html">License &amp; credits</a>
        <a href="/book/">Book</a>
      </span>
      <span class="spacer"></span>
      <a class="cta" href="/app/">Open the canvas →</a>
    </nav>

    <main>
      <p class="section-label reveal d1">Updates</p>
      <h1
        class="reveal d2"
        style="font-family: var(--display); font-weight: 500; font-size: clamp(34px, 6vw, 60px); line-height: 1.05; letter-spacing: -0.025em; color: var(--paper); margin: 0 0 28px; font-variation-settings: 'SOFT' 50, 'WONK' 1, 'opsz' 90;"
      >
        What's <em>new</em>.
      </h1>
      <p class="lede-line reveal d3">
        The latest brushes, tools and touches - in plain language, for the people
        who draw with Nekudot. For the technical log, see the
        <a href="https://github.com/barakbl/nekudot/blob/main/CHANGELOG.md" target="_blank" rel="noopener">changelog</a>.
      </p>

      <div class="updates-list">
${list}
      </div>
    </main>

    <section class="closer">
      <h2>Enough reading. Make art.</h2>
      <p class="lead">Every update is one click away from your next drawing.</p>
      <a class="cta" href="/app/">Open the canvas →</a>
    </section>

    <footer>
      <a class="brand" href="/">Neku<span class="dot">dot</span></a>
      <span class="dot-row" aria-hidden="true"><i class="on"></i><i></i><i class="on"></i><i></i></span>
      <span class="spacer"></span>
      <a href="/">Home</a>
      <a href="/about.html">About</a>
      <a href="https://github.com/barakbl/nekudot" target="_blank" rel="noopener">GitHub</a>
    </footer>
  </body>
</html>
`;
}

if (process.argv.includes("--sync")) syncLatest();
const entries = readEntries().filter((e) => e.data.draft !== true);
writeFileSync(OUT, pageHtml(entries));
console.log(`updates: rendered ${entries.length} entr${entries.length === 1 ? "y" : "ies"} -> docs/updates.html`);
