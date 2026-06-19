import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// docs/ is the hand-maintained static site (landing pages, book, docs.css, and
// the single-file app at nekudot.html produced by build.sh) — also the folder
// GitHub Pages serves from. Point Vite's static-assets dir at it (default is
// ./public) so `vite dev`/`preview` serve the book, and `vite build` copies it
// into dist/. The landing docs/index.html collides with the app's built
// dist/index.html, but Vite keeps the build output; build.sh guards against
// that ever flipping.

// The app's version, surfaced in App settings. Compiled in (not fetched) so it
// works identically in dev, preview and the inlined single-file build, with no
// runtime path/base concerns. release-please bumps package.json on release.
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  publicDir: "docs",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
