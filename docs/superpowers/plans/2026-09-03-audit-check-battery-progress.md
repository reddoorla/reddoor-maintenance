# Audit check battery — build progress

Spec: `docs/superpowers/specs/2026-09-03-audit-check-backlog.md`
Branch: `feat/audit-check-battery`

Order agreed 2026-09-03. Tick as landed, with the commit. Anything that turns out
to be wrong on contact with the code gets written down here, not silently dropped.

---

## 1. Stack readout — "name their stack back to them"

- [ ] `scriptSrcs` field on `PageExtract`
- [ ] `metas` map on `PageExtract` *(pulled forward from Tier 1 Cluster B — the
      readout needs `<meta name="generator">` and doing the same field twice is
      silly; Cluster B then becomes pure logic)*
- [ ] `src/prospect/stack.ts` — CMS/builder, WP theme, WP plugins, page builder,
      framework, hosting/CDN, ecommerce, forms, analytics, fonts
- [ ] Receipts on every line; absence = "we did not see one", never "they lack it"
- [ ] Wired into the pipeline as its own stage, outside the pass/fail denominator
- [ ] Renderer section, ahead of "Does it work?"

## 2. Tier 0 — free over stored data (36 checks)

- [ ] A check-result shape with the **four** states (met / missing / unmeasured /
      not-applicable) and a denominator that excludes the last two
- [ ] T0-30..35 six security headers, split (start here)
- [ ] T0-16 mojibake (then here)
- [ ] T0-01..12 anchors — 01 REWORD, 04 REWORD why, 12 via `sharedNavLinks`
- [ ] T0-13..20 text
- [ ] T0-22..24 headings
- [ ] T0-25..29 JSON-LD (all COND)
- [ ] T0-36, 37, 39 headers
- [ ] T0-40..43 robots/sitemap
- [ ] T0-46 analytics present

## 3. axe-core (T3-14) — out of order

- [ ] Inject via `page.addScriptTag` in the existing crawl browser
- [ ] **Full** tag set, not just wcag2a/2aa/21a/21aa
- [ ] Report rule names + counts, never a verdict on the site
- [ ] Retire the items it absorbs: T0-05, T3-06, and decide owners for
      T1-11/19/20/22
- [ ] Say plainly in the report how this relates to the Lighthouse a11y score

## 4. Tier 1 Cluster B, then A / C / D (23 checks)

- [ ] Cluster B: T1-09 noindex, T1-10 nofollow, T1-11 zoom, T1-12 charset,
      T1-14/15 lengths, T1-16/17 og, T1-18 duplicate descriptions
- [ ] Cluster A: project the `<link>` set `extract.ts` already collects
- [ ] Cluster C: `<html lang>` / `dir`
- [ ] Cluster D: form field detail on `FormShape`

## 5. Tier 3 instrumentation (8 checks) — screenshots first

- [ ] Screenshots, mobile + desktop
- [ ] T3-01 console errors, T3-02 failed requests (first- vs third-party),
      T3-03 rejections
- [ ] T3-05 horizontal overflow at 375px *(needs a second context — not free)*
- [ ] T3-07 body text < 12px, T3-09 oversized images, T3-11 CLS vs CWV threshold
- [ ] T3-08 blocked on a definition of "focus is visible"

## 6. Tier 2 — DNS/RDAP first (17 checks)

- [ ] T2-15..19 SPF, DMARC, MX, mailto MX, domain expiry
- [ ] T2-01 favicon served, 03 trailing slash, 04 single-hop, 05/06 duplicates,
      07 chains, 08 sitemap 200s, 09 orphans, 10 external links, 11 og:image,
      12 logo, 14 flaky server

## 7. Tier 4 — interaction (10 checks)

- [ ] T4-01 nav navigates, 02/03 mobile menu, 04 skip link
- [ ] T4-05 empty submit, T4-06 invalid email
- [ ] T4-07..10 COND: cookie banner, search, booking slot, cart
- [ ] T4-15 blocked on a decision

---

## Before merge

- [ ] Re-run the audit on **reddoorla.com**. Every prior measurement change found
      an instrument bug in one pass, and all of them overstated the client's fault.
- [ ] Replay new checks over stored audits in `prospect_audits.result_json`
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` green

## Open decisions

- **T3-08** — what "focus is visible" means precisely enough to pass or fail.
- **T4-15** — whether we ever submit a real form on a prospect's site.

## Log

- 2026-09-03 — branch cut from `main`, spec + this checklist committed.
