---
"@reddoorla/maintenance": patch
---

Pin four transitive advisories, two of them on the published runtime surface

`nanoid` and `devalue` are **not** dev-only, which is how they were previously
recorded. `eslint-plugin-svelte` and `prettier-plugin-svelte` are real
`dependencies` behind the `./configs` exports, so their trees install on every
fleet site.

- `nanoid` `<3.3.18`, high: predictable output from a non-cryptographic
  fallback path. Reaches us through `postcss`, itself through
  `eslint-plugin-svelte`.
- `devalue` `<5.9.2`, medium: prototype pollution while parsing. Through
  `@sveltejs/kit` and `svelte`.
- `ip-address` `<10.3.1`, high plus two overlapping medium advisories on the
  same 10.x line. Dev-only, through `@lhci/cli`.
- `js-yaml` both lines moved again: 4.x `4.3.0` → `4.3.2` and 3.x `3.15.0` →
  `3.15.2`. The chained merge-key DoS fix needed two further rounds on each.

Resolved versions after the pins, read from the installed tree rather than
assumed: `nanoid@3.3.18`, `devalue@5.9.4`, `ip-address@10.7.2`,
`js-yaml@3.15.2` and `js-yaml@4.3.2`.

`extract-zip` `<=2.0.1` is deliberately **not** pinned: no line has a patched
version. It is dev-only (`@lhci/cli` → `lighthouse` → `puppeteer-core` →
`@puppeteer/browsers`) and only ever unpacks browser archives puppeteer
downloads from Google's own CDN, never untrusted input — the same shape as the
mjml entry already in `auditConfig.ignoreGhsas`. It needs an accept-or-wait
decision rather than a pin, so it is left open and named in the overrides file.
