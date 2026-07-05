# Contributing to Nekudot

Thanks for your interest in Nekudot. Contributions from **developers and
artists** are equally welcome - code, bug reports, ideas, docs, and feedback on
how the tool feels to draw with.

## Code of Conduct

By taking part in this project you agree to follow our
[Code of Conduct](CODE_OF_CONDUCT.md). Please read it - in short: be respectful
to everyone whatever their background, and only share work that is yours to give.

## Ways to contribute

- **Report a bug** or **suggest an idea** by opening an issue.
- **Improve the docs** (the usage book under [`docs/book/`](docs/book/)).
- **Send a code change** as a pull request (see below).

## Development setup

Requires [Node.js](https://nodejs.org/) 18+ and npm.

```bash
git clone https://github.com/barakbl/nekudot.git
cd nekudot
npm install
npm run dev      # start the Vite dev server (prints a local URL)
```

## Before you open a pull request

Please run the checks locally:

```bash
npx tsc --noEmit   # typecheck
npm test           # unit tests (Vitest)
```

If you changed app source, rebuild the single self-contained app file and
**commit the rebuilt file** - CI fails if it is stale:

```bash
npm run build:app  # rebuilds docs/app/index.html
```

## Branches and pull requests

- **Branch names** use a Conventional-Commit type prefix: `feat/`, `fix/`,
  `chore/`, `docs/`, `refactor/`, `perf/`, `ci/`, `test/`, `build/`, `revert/`.
  (CI rejects anything else.)
- **`main` is PR-only** and **squash-merged** - please don't push to it directly.
- **PR titles are [Conventional Commits](https://www.conventionalcommits.org)** -
  the squash commit and the changelog line are generated from them. Use a
  lowercase subject with no trailing period, e.g. `feat: add fill tool` or
  `fix(camera): re-frame a new canvas`.
- **Don't hand-edit `package.json` version or `CHANGELOG.md`** -
  [release-please](https://github.com/googleapis/release-please) owns the version
  and changelog and updates them from merged PR titles.

## Style

- In prose (comments, docs, the book), use a plain hyphen `-`, never the U+2014
  em dash.
- Match the surrounding code's idiom and comment density.

## Developer docs

- [Architecture](https://nekudot.app/book/dev/architecture.html)
- [Writing a brush](https://nekudot.app/book/dev/brushes.html)

## License

Nekudot is released under the **GNU GPL v3**. By contributing, you agree that
your contributions are licensed under the same terms. See
[LICENSE](LICENSE) and [AUTHORS](AUTHORS).
