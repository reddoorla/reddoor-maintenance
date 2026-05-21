---
"@reddoorla/maintenance": patch
---

Fix security audit silently reporting `pass` for npm-using sites (no pnpm-lock.yaml).

When pnpm was installed but the project had no pnpm-lock.yaml, pnpm audit emitted an error envelope (`{ "error": { "code": "ERR_PNPM_AUDIT_NO_LOCKFILE", ... } }`) and exit code 1. The audit treated that as valid output, read `metadata.vulnerabilities` as undefined → defaulted every count to 0 → returned `pass`. Every npm-using site in a fleet was reported as security-clean.

Discovered while piloting against an npm-using reddoor site (espada): the site has 9 real CVEs (3 high, 5 moderate, 1 low) including `@sveltejs/kit` and `devalue` advisories. The previous version reported `0 vulnerabilities`.

The audit now:

- Falls through to `npm audit` not just when pnpm is missing, but whenever pnpm returns an error envelope, non-zero/non-one exit code, unparseable JSON, or output without `metadata.vulnerabilities`.
- Skips with a clear `cannot run audit — pnpm: <reason>; npm: <reason>` summary when both tools fail.

Tests cover the error-envelope, missing-metadata, and both-tools-failed paths.
