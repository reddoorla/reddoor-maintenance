# Audit check battery — build progress

Spec: `docs/superpowers/specs/2026-09-03-audit-check-backlog.md`
Branch: `feat/audit-check-battery`

Order agreed 2026-09-03. Tick as landed, with the commit. Anything that turns out
to be wrong on contact with the code gets written down here, not silently dropped.

---

## 1. Stack readout — "name their stack back to them" — DONE

- [x] `scriptSrcs` field on `PageExtract` (capped, with `scriptCount`)
- [x] `metas` map on `PageExtract` — pulled forward from Tier 1 Cluster B,
      because the readout needs `<meta name="generator">` and building the same
      field twice is silly. Cluster B is now pure logic.
- [x] `src/prospect/stack.ts` — 50 signatures across 10 layers
- [x] Receipts on every line; absence = "we did not see one", never "they lack it"
- [x] Wired into the pipeline as its own stage, outside every denominator
- [x] Renderer section ahead of "Does it work?", plus the print template
      (names only — a page of URLs is a worse trade in a document nobody can expand)

Landed: maintenance `5a8d14b` on `feat/audit-check-battery`; website `7858759`
on `feat/report-stack-readout`.

**Found on the way.** `<meta charset="utf-8">` carries neither `name` nor
`content`, so it was invisible to `extract.ts` — T1-12 (charset declared) could
never have gone green. Both spellings are read now.

**Left open.** Google Fonts is a `<link>`, not a script, so it lights up only
once Cluster A projects the `<link>` set; its absence today is our gap, not
theirs. Screenshot verification of the section is blocked — headless capture
returns blank at non-zero scroll on this page, though the DOM confirms opacity
and visibility are fine throughout; verified from the served DOM instead.

## 2. Tier 0 — free over stored data — DONE (35 of 36)

- [x] `SiteCheck` with the four states, and `tally` excluding the last two
- [x] T0-30..35 six security headers, split
- [x] T0-16 mojibake
- [x] T0-01..12 anchors — 01 scoped to `javascript:` no-ops (a bare `#` is how
      good disclosures are written), 12 via link text shared across every page
- [x] T0-13..20 text
- [x] T0-22..24 headings
- [x] T0-25..29 JSON-LD (all conditional)
- [x] T0-36, 37, 39 headers
- [x] T0-40..43 robots/sitemap
- [x] T0-46 analytics present
- [x] Wired into the pipeline, and into `healthRows` so failures become findings
      and passes fold into What passes
- [ ] **T0-04 deferred to Tier 1.** `target="_blank"` without `rel="noopener"`
      needs a `target` on `PageAnchor`, so it is not free — and browsers have
      implied noopener since 2021, so the finding is tidiness. Do it with
      Cluster D.

Landed: maintenance `85d168b` + `d440043`; website `1cc3fd8`.

**The report now says "46 checks" where it said 12, and "63 came back clean"
where it said 29.**

**Found on the way.** Generating the fixture from the real checks instead of
hand-writing it caught `staging-links` firing on the site's OWN origin whenever
that origin looks like a dev host — it broke the fixture's `.test` domain and
would have broken any client running an internal tool at `.local`. Fixed, with a
regression test. That is the third instrument bug in two days, and the third one
that overstated the client's fault.

## 3. axe-core (T3-14) — DONE

- [x] Injected in the crawl's EXISTING browser pass — no second navigation
- [x] **Full** tag set, not just wcag2a/2aa/21a/21aa
- [x] Report rule names + counts, never a verdict on the site
- [x] Absorbs T0-05 (link names), T3-06 (tap targets); T1-11/19/20/22 owners
      decided in Cluster B/C/D — axe owns viewport-zoom, `lang` and form labels
- [x] Says plainly how this relates to the Lighthouse a11y score

Landed: maintenance `d9f74be`; website `a586b58`.

**Measured, not assumed.** Ran axe against our own report page to get real
numbers: the default set is **90 rules**, of which **14 best-practice rules
actually ran** — `landmark-one-main`, `heading-order`, `empty-heading`,
`landmark-no-duplicate-main` among them. Those are precisely the rules a
wcag-tags-only scan cannot see, so the premise holds.

**It also corrected the arithmetic.** `passes` came back 42, not 90: 47 rules had
nothing on the page to apply to and 1 was incomplete. Printing 90 as "we checked
90 things" would have been a number inflated on our own behalf, so
`inapplicable` is carried and the report says "of the 42 rules that had
something to check". My "~90 net-new checks" pitch was wrong twice over — the
Lighthouse a11y category already IS axe, and half the rules never run.

**A gotcha worth keeping.** `@axe-core/playwright` publishes both a named and a
default export; under Node's CJS interop the `default` binding resolves to the
whole module namespace, not the class. Use the NAMED export or it fails as "not
constructable".

`renderPages` widened to `string | RenderedPage` so the seventeen existing test
stubs stay correct — a bare string normalises to `axe: null`, which reads as
"no rules ran here" rather than silently asserting a clean scan.

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
- [ ] T3-05 horizontal overflow at 375px _(needs a second context — not free)_
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
