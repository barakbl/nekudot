# Working in this repo

Nekudot is a TypeScript drawing app (Vite, no framework). The deployed app is a
single self-contained file, `docs/app/index.html`, served by GitHub Pages and
**committed** to the repo.

## Contribution flow

- **Branches** use a Conventional-Commit type prefix: `feat/…`, `fix/…`,
  `chore/…`, `docs/…`, `refactor/…`, `perf/…`, `ci/…`, `test/…`, `build/…`,
  `revert/…`. (CI's branch-name check rejects anything else.)
- **`main` is PR-only** and **squash-merged**. Never push to `main` directly.
- **PR titles are Conventional Commits** — the squash commit and the changelog
  line are generated from them. Lowercase subject, no trailing period, e.g.
  `feat: add fill tool`, `fix(camera): re-frame a new canvas`. CI lints this.

## Versioning + changelog (do NOT edit by hand)

- [release-please](https://github.com/googleapis/release-please) owns the
  version and `CHANGELOG.md`. It opens a "release PR" that bumps
  `package.json`, updates `CHANGELOG.md` from the merged PR titles, and on merge
  tags `vX.Y.Z` + cuts a GitHub Release.
- Never manually change `package.json` `version` or `CHANGELOG.md`.
- The in-app version (App settings → About → Version) is compiled from
  `package.json` via Vite `define` (`__APP_VERSION__`); the release workflow
  rebuilds `docs/app/index.html` on the release PR so the shipped app matches.

## Build + checks (run before committing)

- `npx tsc --noEmit` — typecheck.
- `npm test` / `npx vitest run` — unit tests (`tests/*.test.ts`).
- `npm run build:app` (`build.sh`) — rebuild `docs/app/index.html`. **Commit the
  rebuilt file whenever source changes**; CI fails if it's stale.
- Live browser smokes live in `tests/smoke/*` (`npm run smoke:*`); they need
  Chrome and are manual (not in CI).

## Style

- Prose (code comments, docs, the book under `docs/`): use a plain hyphen `-`,
  never the U+2014 em dash.
- Match the surrounding code's comment density and idiom.
