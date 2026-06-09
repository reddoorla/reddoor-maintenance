# Accepted risk: two unpatched MJML advisories

**Date:** 2026-06-09
**Status:** Accepted (will revisit if a patched MJML ships, or if template authorship ever opens to untrusted input)
**Scope:** the email-render toolchain (`mjml`), used only by [`src/reports/render.ts`](../../src/reports/render.ts)

## The advisories

`pnpm audit` reports two findings in the MJML dependency tree, **both with no
upstream fix** (`Patched versions: <0.0.0`):

| Severity | Package         | Path                              | Advisory                                                                                                                                        |
| -------- | --------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| high     | `html-minifier` | `mjml > mjml-cli > html-minifier` | [GHSA-pfq8-rq6v-vf5m](https://github.com/advisories/GHSA-pfq8-rq6v-vf5m) — ReDoS                                                                |
| moderate | `mjml`          | `mjml`                            | [GHSA-45h5-66jx-r2wf](https://github.com/advisories/GHSA-45h5-66jx-r2wf) — `mj-include` directory traversal (incomplete fix for CVE-2020-12827) |

## Why we accept them

Both are **unreachable in how this project uses MJML**, on top of the input
being trusted:

1. **`mj-include` traversal (moderate) — syntax we never use.** The
   vulnerability requires an `<mj-include path="…"/>` directive with an
   attacker-influenced path. Our single template
   ([`src/reports/maintenance-email/template.ts`](../../src/reports/maintenance-email/template.ts))
   contains **no `mj-include`** anywhere, and `grep -rn mj-include src/` is empty.
   There is no code path that reaches the vulnerable behavior.

2. **`html-minifier` ReDoS (high) — code we never execute.** The vulnerable
   package is a transitive dependency of **`mjml-cli`** (the command-line tool).
   We import the **`mjml` library** and call `mjml2html(...)` programmatically in
   [`render.ts`](../../src/reports/render.ts); we never invoke `mjml-cli`, and we
   call `mjml2html` without `minify` (default off), so `html-minifier` is not on
   our runtime path.

3. **Input is operator-controlled, not external.** Even setting reachability
   aside, the only data flowing into the template is report data from Airtable
   (operator-entered) plus our own audit results — not arbitrary third-party
   HTML. A ReDoS would, at worst, slow a draft-time render in our own CLI/
   function; it is not on any user-facing request path.

No patched `mjml`/`html-minifier` exists, so there is nothing to upgrade to. A
renderer swap (e.g. `react-email`, hand-rolled responsive HTML) was considered
and rejected as disproportionate to two non-exploitable advisories — MJML does
real work (responsive email HTML) and a swap would mean re-deriving and
re-golden-testing the template for no security gain.

## What we did instead

Suppressed both GHSAs via `pnpm.auditConfig.ignoreGhsas` in
[`package.json`](../../package.json) so `pnpm audit` exits clean and these stop
re-surfacing in every manual audit / evening review. `pnpm audit` does **not**
gate CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs
typecheck/lint/build/test only), so this is purely to silence recurring noise on
a risk we've reasoned about — not to unblock a pipeline.

## Revisit if

- a patched `mjml` (or `html-minifier`) is published → drop the ignore and upgrade;
- the template ever starts including `mj-include`, or template authorship opens
  to untrusted input → re-evaluate the traversal finding;
- we move to invoking `mjml-cli` or enable minification → re-evaluate the ReDoS.
