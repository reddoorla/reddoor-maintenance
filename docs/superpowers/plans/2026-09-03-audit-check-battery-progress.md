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
- [x] ~~**T0-04 deferred to Tier 1.**~~ Built with Cluster D, then **cut on
      2026-09-04**. `PageAnchor.target` is still captured; nothing reads it.

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

## 4. Tier 1 — DONE (17 checks, not the 23 projected)

- [x] Cluster B — noindex, nofollow, charset, title/description length, og:image
      absolute, duplicate descriptions
- [x] Cluster A — favicon, canonical self-referencing, canonical on-origin,
      hreflang self-reference (a projection of `<link>`, not a new traversal)
- [x] Cluster D — field types, autocomplete, POST, action provider, required
- [x] T0-04 noopener, which is what it was waiting for — since CUT, see below
- [x] Fixture regenerated: 49 verdicts, 49 passes, 3 not-applicable

Landed: maintenance `7f6c975`; website `31fdcd7`.

**"Does it work" now reads 61 checks where it read 12 this morning. What passes
reads 78 where it read 29.**

**Departure from the plan, stated rather than buried.** Cluster C is dropped
entirely: axe owns `html-has-lang` and `html-lang-valid`, and a `dir` check would
be not-applicable on essentially every site we audit — a check that never reaches
a verdict is padding, whatever tier it sits in. Viewport-zoom (T1-11) and form
labels (T1-22) also go to axe. Asking one question under two headings reads as
two problems. So six of the projected 23 are OWNED ELSEWHERE rather than dropped,
and the honest count is 17.

**Judgement calls, each with its reasoning in the code.** Titles are flagged only
under 10 or over 70 characters, because 60 is where Google truncates by _pixel_
width and a tight band fails good sites. Canonical comparison ignores a trailing
slash and a `www.`, so the case that matters — every page pointing at the home
page — is not buried under noise. An unrecognised third-party form endpoint is
`unmeasured`, never a failure: our provider list will always be incomplete, and
calling a working in-house endpoint broken is the false alarm that costs trust in
every other line.

**`noopener` was cut on 2026-09-04** after apple.com failed it 111/111. It was
correct and greenable and already worded as tidiness — and still not worth a row.
See the backlog entry for T0-04.

## 5. Tier 3 instrumentation — DONE (5 checks); screenshots NEED A DECISION

- [x] T3-01 console errors, T3-02 failed requests (first- vs third-party),
      T3-03 unhandled rejections (same listener as T3-01)
- [x] T3-05 horizontal overflow at 375px
- [x] T3-07 text under 12px, T3-09 oversized images
- [x] Verified against a live page, not assumed
- [ ] **Screenshots — NOT DONE, and deliberately.** `prospect_audits.result_json`
      is one TEXT column the DB layer already flags as large. Two base64
      screenshots per audit is ~100-200KB per row, and quietly tripling every
      stored report is an infrastructure decision, not a code one. Options:
      thumbnail-only (~30KB each), a blob store, or skip. **Tucker's call.**
- [ ] T3-08 still blocked on a definition of "focus is visible"
- [ ] T3-11 CLS — not done. Needs a PerformanceObserver over a settle window,
      and Lighthouse already measures it; the value is surfacing the number the
      score hides, which is smaller than the other four here.

Landed: maintenance `89170f6`; website `31fdcd7`+.

**The overflow check was much cheaper than the spec assumed.** I had it down as
"not free — needs a second render pass". A viewport RESIZE reflows the page the
browser already holds: no navigation, no new bytes. It costs a reflow and 250ms.

**Judgement calls.** Console errors are deduped (one broken component in a loop
reports the same line a thousand times). Overflow under 4px is a scrollbar, not a
layout bug. An image is only oversized past 2.5x its drawn width, so an ordinary
retina asset is under the bar rather than in the report.

**Found a real bug on our own production site** — see the log below.

## 6. Tier 2 — DONE (17 checks: 5 DNS + 12 HTTP)

- [x] T2-15..19 SPF, DMARC, MX, mailto MX, domain expiry
- [x] T2-01 favicon served, 03 trailing slash, 04 single-hop, 05 /index.html,
      06 case, 07 chains, 08 sitemap 200s, 10 external links, 11 og:image
      (served AND ≥200px), 12 logo, 14 flaky server
- [x] Verified live against reddoorla.com, stripe.com and basecamp.com
- [ ] **T2-09 orphans — NOT IMPLEMENTABLE AS WRITTEN.** See below.

Landed: maintenance `c6cf907` (DNS), `fded02d` (expiry honesty), `4269411` (HTTP).

**The DNS half found a live problem on our own domain and a false one.**
reddoorla.com has no SPF record — real, still open. It also read as "expires in
2 days", and auto-renew is on. The registry publishes an expiry; it does not
publish whether the registrar will renew, and most well-run domains renew inside
the last thirty days. So the check now reports the date and names the gap. The
first thing a client checks is the line about their own domain, and being wrong
there costs every other line on the page.

**The instrument was broken and only the live run showed it.** The first RDAP
version went through rdap.org, which sits behind Cloudflare and answers a plain
fetch with a 403 challenge. Every expiry came back unmeasured INCLUDING `.com`.
The unit tests passed the whole time, because they stub the fetch. A check that
is unmeasured everywhere is a broken check, not a fact about the world.

**Three bugs in the HTTP half, all found by tests, all mine.** `0x89 << 24` is
negative in JavaScript, so the PNG signature never matched and every share image
was unmeasured. `new URL("https://x").toString()` appends a slash, so
`${origin}/index.html` built `//index.html` and every site read "no duplicate
homepage" for the wrong reason. And the trailing-slash check compared the two
forms through a helper that deliberately ignores a trailing slash.

**T2-09 is cut, and the reasoning matters.** "Sitemap URLs nothing links to" is
unanswerable with a capped crawl: against a 400-URL sitemap every entry we did
not visit looks orphaned, so the check fails every site large enough to have a
sitemap worth having — our budget printed as their fault. The reverse direction
IS answerable, and Tier 0's `sitemap-coverage` already asks it; that check now
NAMES the page a complete sitemap omits rather than only comparing counts, and
falls back to the count when the sitemap was longer than the sample we carried.

**Found on our own site.** `reddoorla.com/index.html` answers 200 with the
homepage's content and declares no canonical — the homepage lives at two
addresses. Netlify serving the prerendered file directly. Not fixed here; it is
deploy configuration.

**Cost.** About 35 requests per audit, paced 150ms apart, and `requests` is
carried in the findings so the number is reportable rather than hidden.

## 7. Tier 4 — the form pair only (2 checks). Tucker's call, 09-03.

- [x] The abort harness — nothing this tier does reaches their server
- [x] T4-05 empty submit, T4-06 invalid email
- [x] Verified against a REAL browser and a local server that logs every
      request: five form shapes, correct verdict on each, **zero non-GET
      requests received**
- [ ] **T4-01 nav navigates — DROPPED.** Tier 0 `dead-links` and Tier 2 already
      answer it for anything with an `href`.
- [ ] **T4-04 skip link — DROPPED.** axe runs `bypass` AND `skip-link` in our
      default set. Asking it again under our own heading reads as two problems.
- [ ] T4-02/03 mobile menu — not built. Fragile heuristic, lots of
      not-applicable; the viewport window in `measureVitals` is already there
      for it whenever we want it.
- [ ] T4-07..10 COND: cookie banner, search, booking slot, cart — not built.
- [ ] T4-15 still blocked on a decision, and now largely moot: 05/06 get the
      value without ever sending anything.

**The safety argument, because this is the only tier that acts.** A contact form
with no client-side validation, submitted empty, POSTs to whoever reads that
inbox — a junk enquiry from an audit nobody asked for, indistinguishable from a
real lead. So the route interceptor is armed BEFORE the first click, aborts every
navigation and every same-origin non-GET, and the count of what it stopped rides
back in `blocked` so "we submitted nothing" is checkable rather than asserted.
The evidence line says so too: "we stopped the request before it left the
browser".

That interception is also the measurement. A form that refuses an empty submit
never asks the network for anything; a form that accepts one tries, and we catch
it trying. The thing that keeps us honest and the thing that produces the finding
are the same mechanism.

**Two bugs the live run found that the unit tests could not.** `page.evaluate`
given a STRING evaluates it as an expression and never calls it — every snippet
returned `undefined`, so `probeForms` found no form on any page and reported
"no form pressed" five times out of five. The fakes could not catch this: they
stub `evaluate` itself.

And aborting a form navigation leaves Chromium on `chrome-error://chromewebdata/`
— the form is gone, so the second question could not be asked on exactly the
forms most likely to be broken. Fixed by reloading between the two passes, which
also removes the subtler bug: a JS form that painted "please enter a valid email"
during the empty pass still has that text on screen, and reading it after the
second click would credit the form with catching something it never saw.

**Cost.** One extra page load per crawl, on the one page with an enquiry form.

---

## Validating against reddoorla.com — 09-04

Full battery, no model calls: `pnpm tsx scripts/validate-checks.mts "https://reddoorla.com|Reddoor Creative"`.

**76 checks — 55 pass, 14 fail, 7 not-applicable, 0 unmeasured.** The seven
sitting out have nothing to look at (no rating markup, no canonicals anywhere,
no language alternates, no new-tab links, published addresses on our own
domain, and /index.html + a cased path both behaving). Only pass and fail enter
the denominator, so the ratio is 55/69.

**One instrument bug, and it was the predicted shape.** The battery told our own
site it has no analytics. It runs GA4, and injects gtag.js only after the first
pointer or scroll — deliberately, for privacy — so there is no analytics `src`
in the DOM at crawl time. Fixed by recording hosts NAMED inside inline scripts,
which is a different claim and says so in the field name. It would have landed on
every consent-gated site, i.e. on exactly the clients who did the careful thing.

**One reliability bug that only a live crawl could find, and it was mine.** The
form probe's route handler was `async`, and `unroute`/`unrouteAll` WAIT for
every handler promise still in flight. The second probe against a given page
hung in `release`; the third hung in `route` itself. Two runs in four died that
way, each losing a completed twenty-page crawl. No unit test could see it — the
fakes have no router.

Three changes, and the second matters more than the first:

1. The handler is synchronous and resolves its route fire-and-forget, so there
   is nothing for an unroute to await.
2. `release` DISARMS the handler before it tries to unroute. If the unroute
   never finishes, an armed handler stays registered and aborts every navigation
   for the rest of the crawl — silently emptying the remaining pages. That is a
   far worse failure than the hang it replaced, and it was one timeout away.
3. `probeForms` runs under a budget in `crawl.ts`. A stall now costs two checks
   that read "not measured", never the crawl.
4. And so do `page.content`, `runAxe` and `measureVitals` — the same unbounded
   shape sitting right beside it, one slow page from the same outcome.

**Evidence, because one clean run proves nothing about an intermittent bug.**
Before: 2 hangs in 4 full crawls, and the isolated reproduction hung on round 2
of 3. After: **5 full crawls and 14 probe rounds, zero hangs**, probe median
279ms, max 405ms, and nothing reaching the teardown timeout at all. All five
runs produced identical results (55/69) — a measurement that drifted run to run
would be as useless as one that hung.

**Also corrected: two checks were never being exercised.** `name-in-title` and
`h1-not-name` read a business name, and the validation script hardcoded null
because it skips the model stage that supplies one. They reported "not measured"
and looked like a finding. The script takes `url|Business Name` now.

**What it found on the site, all verified real:** no SPF record; the CSP
preconnect refusal, confirmed from the browser console rather than by reading
netlify config; /about and /contact with no `<h1>` at all while the homepage has
five; /index.html serving the homepage at a second address; no canonical on any
page; a portfolio page linked internally but absent from the sitemap; a stale
`http://` link; no llms.txt. Plus axe: `image-alt` on 47 elements across three
pages, `color-contrast` on 196 across sixteen.

## Instrumentation closed out — 09-04

Four more found by looking at what the run produced rather than at its verdicts.

**The stack readout named two things.** SvelteKit and Netlify, for a site that
also runs Prismic, GA4, Adobe Typekit and Google Fonts. Two causes: every
signature keys on a PATH (`googletagmanager.com/gtag/js` is what separates GA4
from Tag Manager) while the inline-script capture kept only hostnames; and
`<link>` hrefs were never fed in, which is where a stylesheet-delivered font
lives. The table also had no headless CMS at all — a modern agency-built site is
far likelier to be Prismic or Sanity than WordPress, and naming only the
framework back to such a client says we did not look hard. **Two items → six.**

**We were breaking Cloudflare Turnstile, and it could have cost a false
accusation.** `isNavigationRequest()` is true for an iframe loading its own
document, so the form probe aborted the captcha challenge on the contact page —
and counted it. The verdict reads "something was stopped after the click" as
"the form submitted with every field empty", so a third-party iframe appearing
in that second would have accused a working form of sending an empty enquiry, on
exactly the page most likely to have a captcha. Navigation blocking is main-frame
only now; a form submitting into an iframe is still caught by the same-origin
non-GET rule. `blocked` on our contact page went 1 → 0.

**And the verdict order was wrong.** `attempted` was checked before `complained`,
so any same-origin beacon firing on the same click outranked the form's own
"please fill this in". A complaint now wins: a form showing an error has not
sent anything, and the false accusation is far more expensive than a missed
detection.

**A claim verified rather than read.** `canonical-self` sits out as
not-applicable saying the absence "is reported separately". It is — 20 of 20
pages, via `measuredFixes` — but I had only read that in the source. Running it
also surfaced the tappable-phone and top-heading fixes.

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
- 2026-09-03 — **reddoorla.com ships a blocked preconnect.** `src/app.html`
  preconnects to `fonts.googleapis.com`, but preconnect is governed by
  `connect-src`, and netlify.toml's CSP lists that host under `style-src` and
  `font-src` only. So the preconnect is refused on every page view: the fonts
  still load (style-src allows the stylesheet) but the optimisation does nothing
  and every visitor's console carries a CSP error. One-line fix — add
  `https://fonts.googleapis.com` and `https://fonts.gstatic.com` to
  `connect-src` — but it is production security config, so NOT changed
  unilaterally. Found by the T3-01 console-error check on its first live run.
- 2026-09-04 — **apple.com found five faults our own site could not**, all of
  them ours: `favicon-declared` contradicting `favicon-served` in one report,
  `net::ERR_ABORTED` media counted as failed requests, two-hop shop redirectors
  read as redirect chains, an all-first-party bundle read as no analytics, and
  JSON-LD `@id`/`sameAs` links counted as code the page loads. 17 fails → 13.
- 2026-09-04 — **`noopener` CUT.** Correct, greenable, already worded as
  tidiness — and it failed apple.com 111 out of 111. See the T0-04 entry in the
  backlog. Being right is not sufficient grounds to occupy a row.
- 2026-09-05 — **nine of the remaining twelve apple.com fails were ours too.**
  Each was verified against the live site or in a browser before it was
  believed, and each fix carries the evidence in a comment beside it.

  | check                    | what was wrong                                       | how it was verified                                                                                              |
  | ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
  | `mobile-overflow`        | measured 250ms after a resize, mid-reflow            | reproduced: 303px at 250ms, 26px at 500ms, 0 from 1000ms; loaded natively at 375 it never overflows              |
  | `nav-consistency`        | unioned a mega-menu's targets and called it drift    | "Mac" reaches the same four destinations on all 20 pages; union rule flagged 18 items, intersection rule flags 0 |
  | `link-text`              | judged visible text, ignoring `aria-label`           | every "Learn more" on apple.com carries one; 60 flagged → 16, and the 16 genuinely have none                     |
  | `link-text` denominator  | printed our 6000 anchor cap as their link count      | true count was 14,153                                                                                            |
  | `canonical-self`         | failed a duplicate for correctly naming its original | `/airpods-4/compare/` and `/airpods/compare/` serve the same page and share a headline                           |
  | `hreflang-self`          | asked a page that canonicalises away to name itself  | its one alternate is its canonical, which is right                                                               |
  | `h1-distinct`            | compared query-string deep-links as separate pages   | folding by declared address, apple.com has zero duplicate headlines                                              |
  | `duplicate-descriptions` | same                                                 | folding, zero duplicate descriptions                                                                             |
  | `description-length`     | 50–170 band                                          | apple.com missed it twice by two characters; truncation is by pixel width                                        |
  | crawl frontier           | spent 6 of 20 slots on 2 pages                       | distinct paths now come first; the same crawl reaches 20 distinct pages and four it never saw                    |

- 2026-09-05 — **`llms-txt` no longer fails.** `checks.ts` had already removed it
  from the Findability score because no answer engine has published that it
  reads one. A red row IS a grade-down, so the battery was contradicting a
  decision already made. Present → pass, absent → not-applicable.
- 2026-09-05 — **the security-header block was measuring configuration effort,
  not protection.** Both headers with a false `why` were tested in a browser:
  - `permissions-policy` — a cross-origin iframe is refused camera and
    geolocation with NO header set, and granted them the moment the site writes
    `allow=` on the iframe. The gate is the attribute the author types, so
    nothing happens "quietly". And `geolocation=*` behaves identically to
    sending nothing, yet passed. Now needs one directive that is not `*`.
  - `referrer-policy` — from `/some/deep/path?secret=token123`, no header sends
    `Referer: http://host/`; `unsafe-url` and `no-referrer-when-downgrade` send
    the whole address. So the old `why` described the pre-2020 default and the
    old check failed every site that left the header alone while passing the two
    that actually spill. Now: those two fail, everything else passes, absence is
    not-applicable.

  `content-security-policy: default-src *` and `x-frame-options: ALLOWALL` are
  the same shape and still presence-only. Each needs its own browser check —
  writing one from the specification is how the `permissions-policy` wording
  went wrong in the first place.

- 2026-09-05 — **the Tier 4 abort harness had never fired, and when tested it
  leaked.** Every unit test supplies a fake `intercept`, so none could see
  whether anything was intercepted; and the one live run, reddoorla.com, marks
  its fields required, so the browser refused the submit before a request was
  made and the probe returned `blocked: 0`. The claim that we can press submit
  on a stranger's form without delivering anything rested on reading the code.

  `tests/prospect/interaction-harness.test.ts` now runs the real probe against a
  real Chromium and a real server that records every request it receives. The
  assertion that matters is that it receives nothing. It found two escapes:

  - **A form with `target=`** submits into a NEW page, and `page.route` does not
    cover one. The receiving server got `POST /subscribe email=not-an-email`.
    This is not hypothetical — it is exactly how clearleft.com's only form is
    written, and it was the site chosen for the next calibration run.
  - **`request.frame()` THROWS** for a popup's opening navigation, because that
    request is what creates the frame. The handler's outer `catch` swallowed it
    and fell through to `stop = false`, so a `window.open` submit went out too.
    The old comment — "a request we cannot even read is one we do not block,
    because the only thing that could make it dangerous is being a submission,
    and we would have been able to read that" — was exactly backwards.

  Fixed three ways: `CHOOSE_FORM` strips `target` from the form it claims, the
  route is registered on the CONTEXT rather than the page, and a navigation
  whose frame is unavailable is stopped. An `<iframe src>` resolves its frame
  and is untouched, which is measured too — the Turnstile case is a regression
  test now, and `blocked` staying 0 is part of it.

  **Order matters here.** Proving the harness first is the only reason we did
  not deliver a junk signup to a real Mailchimp list.
