# Security Policy

Nekudot is a **browser-only** drawing app: it runs entirely in your browser, has
no server and no accounts, and stores your work locally (IndexedDB /
localStorage). There is no backend to attack and no personal data is collected
or sent anywhere (the only network calls load the static site and fonts, plus
privacy-friendly, cookieless analytics). That keeps the attack surface small -
but the app still parses files you open and renders dynamic content, so we take
security reports seriously.

## Supported versions

Nekudot is a single, always-current web app - the version deployed at
<https://nekudot.app> is the one that receives security fixes. There are no older
release branches to patch; a fix simply ships by updating the deployed app.

| Version | Supported |
| ------- | --------- |
| Latest deployed (nekudot.app) | ✅ |
| Older tags / self-hosted copies | Please update to the latest |

## Reporting a vulnerability

**Please report security issues privately - do not open a public issue.**

- Preferred: open a private report through GitHub's
  [**Report a vulnerability**](https://github.com/barakbl/nekudot/security/advisories/new)
  (the repo's Security tab → Advisories).
- Or email **barak.bloch@gmail.com**.

Please include, as best you can:

- what the issue is and where (file, page, or steps),
- how to reproduce it (a small proof of concept helps a lot),
- and the impact you think it could have.

## What to expect

- We aim to **acknowledge your report within a few days**. This is a small,
  volunteer-run project, so thank you for your patience.
- We'll confirm the issue, work on a fix, and keep you posted.
- Once a fix is out, we're glad to **credit you** if you'd like.
- Please give us a reasonable chance to fix it before disclosing publicly
  (coordinated disclosure).

## Scope

In scope:

- Cross-site scripting (XSS) or HTML/script injection in the app or site.
- Flaws in how Nekudot parses opened files (`.nekudot`, `.preset`, `.gpl`).
- Anything that could run code, read or exfiltrate a user's local data, or
  corrupt their saved work.

Usually out of scope:

- Findings that require an already-compromised device or a malicious browser
  extension.
- Self-XSS that only affects the reporter and can't be triggered for others.
- Pure best-practice reports with no real-world impact (e.g. a missing header on
  the static site) - still welcome, just lower priority.

## Safe harbor

We will not pursue or support legal action against anyone who reports a
vulnerability in **good faith**, follows this policy, avoids privacy violations
and disruption to others, and gives us a reasonable time to respond before
disclosing publicly. Thank you for helping keep Nekudot and its users safe.

---

For contributors: see [SECURITY-NOTES.md](SECURITY-NOTES.md) for the project's
threat model and secure-coding guidelines.
