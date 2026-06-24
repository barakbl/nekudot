# Security notes for contributors

A short guide to keeping Nekudot safe as you work on it. If you spot a
vulnerability, please follow [SECURITY.md](SECURITY.md) (report it privately)
rather than opening a public issue.

## Threat model

Nekudot runs entirely in the browser. There is no server, no accounts, and no
data leaves the device. So the things worth defending are:

1. **The user's machine and saved work.** A malicious file or a crafted input
   should never be able to run code, read other sites' data, or corrupt someone's
   drawings.
2. **What we render.** The app builds a lot of DOM and SVG dynamically. Anything
   derived from user input, saved state, or an imported file is **untrusted**.
3. **What we import.** Opening a `.nekudot`, `.preset`, or `.gpl` file means
   parsing data we did not create.
4. **The supply chain.** npm dependencies and GitHub Actions we pull in.

## Rules of thumb

- **Never put untrusted strings in `innerHTML`.** `innerHTML` is reserved for
  trusted, constant markup (the built-in SVG icons defined in source). For
  anything that comes from the user, storage, or a file - names, labels, values -
  use `textContent` / `createTextNode`, or build elements with the DOM API.
- **Treat imported content as data, not markup.** Preset and palette names are
  rendered as text, never parsed as HTML. Untrusted fields that could carry
  markup (e.g. an icon on a custom preset) are stripped on import - keep it that
  way; don't reintroduce a path that renders imported markup.
- **Validate every imported file** with its schema (we use [zod](https://zod.dev))
  before using it, and fail safe on anything malformed. Don't trust shapes,
  lengths, ranges, or URLs from a file.
- **External links** open with `target="_blank"` **and** `rel="noopener"`.
- **No secrets in the repo.** It's a static client-side app; there is nothing
  server-side to hold credentials, and none should be added.
- **Keep dependencies lean.** Prefer the standard library; review what a new
  dependency pulls in. Dependabot opens weekly update PRs - keep them moving.

## Tooling

- **CodeQL** scans every push and PR to `main` for common JS/TS issues
  (see `.github/workflows/codeql.yml`).
- **Dependabot** keeps npm packages and Actions up to date
  (see `.github/dependabot.yml`).
- Run `npx tsc --noEmit` and `npm test` before opening a PR.

When in doubt about whether something is safe, ask in the PR - it's always fine
to flag "I'm not sure this input is trusted."
