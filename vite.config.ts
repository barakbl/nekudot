import { defineConfig } from "vite";

// docs/ is the hand-maintained static site (landing pages, book, docs.css, and
// the single-file app at nekudot.html produced by build.sh) — also the folder
// GitHub Pages serves from. Point Vite's static-assets dir at it (default is
// ./public) so `vite dev`/`preview` serve the book, and `vite build` copies it
// into dist/. The landing docs/index.html collides with the app's built
// dist/index.html, but Vite keeps the build output; build.sh guards against
// that ever flipping.
export default defineConfig({
  publicDir: "docs",
});
