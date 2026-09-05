# Audit check backlog — getting to 100

Goal: a battery large enough that the report reads as thorough, where the floor is
"bare HTML passes most of this" and the failures are the silly things real sites do.

Every check below carries a verdict from the greenability review:

|            |                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------- |
| **KEEP**   | Greenable as written. Defensible pass state, vast majority of healthy sites reach it.        |
| **REWORD** | Greenable, but the threshold or scope must be stated before it is built.                     |
| **COND**   | Conditional. Does not apply to every site — must drop out of the denominator, not auto-pass. |
| **MOVED**  | Not a check. A measurement or inventory with no pass state — belongs in the readout.         |
| **CUT**    | Duplicate of something already built, or cannot be made honest at reasonable cost.           |

---

## The four rules this battery runs on

**1. Every check must be greenable.** It can say "this is right". A check that only
ever accuses is a complaint, not a measurement.

**2. Trivial is fine, because trivial folds away.** Our standing rule says a check
everything passes is padding — but that is a rule about _report lines_, not about
_checks_. **What Passes** is one collapsed section. A trivial check costs one line
inside a fold and is invisible until the day it fails, at which point it is the
most useful line in the document.

**3. Three states, not two.** `met` / `missing` / `unmeasured`, exactly as
`RequirementStatus` already does it. Our failed request is never their defect.

**4. Not-applicable is a fourth state, and it is the one this review kept
catching.** A site with no RTL content, no `hreflang`, no cart, no search box and no
`LocalBusiness` schema must not silently _pass_ those checks — that inflates
"94 of 96" with checks that never ran. Conditional checks leave the denominator,
the same way `GoalFit.total` already excludes `unmeasured`. Everything marked
**COND** below needs this.

---

## Name their stack back to them

This is not a check and it should not try to be. It is the credibility opener, and
it costs almost nothing because the evidence is already in the crawl.

A prospect's first silent question is whether we know what we are talking about.
"You're on WordPress running the Astra theme with Elementor, your forms are Gravity
Forms, your DNS is at GoDaddy and your mail is Google Workspace" answers it in one
sentence, before a single finding. Nobody sending a cold audit does this.

**What we can name, and from what receipt — all of it already captured or one field away:**

| Layer                 | Named from                                                                                                                                                                                                 | Cost                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| CMS / builder         | `/wp-content/`, `/wp-includes/` in asset paths; `generator` meta; `static1.squarespace.com`; `static.wixstatic.com`; `cdn.shopify.com`; `cdn.prod.website-files.com` (Webflow); `hs-scripts.com` (HubSpot) | free (`imageSrcs` + a `scriptSrcs` field) |
| **WordPress theme**   | `/wp-content/themes/<name>/`                                                                                                                                                                               | free                                      |
| **WordPress plugins** | `/wp-content/plugins/<name>/` — names them individually                                                                                                                                                    | free                                      |
| Page builder          | Elementor / Divi / WPBakery class names and asset paths                                                                                                                                                    | free                                      |
| Frontend framework    | `__NEXT_DATA__`, `/_next/`, `__NUXT__`, Gatsby, SvelteKit, Angular markers                                                                                                                                 | free                                      |
| Hosting / CDN         | response headers already in `homeHeaders`: `cf-ray`, `x-nf-request-id`, `x-vercel-id`, `x-served-by`, `x-amz-cf-id`, `x-github-request-id`, `server`                                                       | free                                      |
| DNS host / registrar  | nameservers                                                                                                                                                                                                | free with T2-15..19                       |
| **Email provider**    | MX records — Google Workspace, Microsoft 365, Zoho                                                                                                                                                         | free with T2-17                           |
| Ecommerce             | WooCommerce, Shopify, BigCommerce markers                                                                                                                                                                  | free                                      |
| Forms                 | Gravity Forms, Contact Form 7, WPForms, HubSpot, Typeform, Formspree                                                                                                                                       | free                                      |
| Analytics / marketing | GA4, GTM, Meta Pixel, LinkedIn Insight, Hotjar, Intercom                                                                                                                                                   | free                                      |
| Fonts                 | Google Fonts, Adobe Typekit, self-hosted                                                                                                                                                                   | free                                      |
| Booking               | already have `BOOKING_HOSTS`                                                                                                                                                                               | already built                             |

**Discipline it inherits from the rest of the audit:** every line is an _observation
with a receipt_ — the URL or header we saw it in — never an inference we cannot
show. Absence of a marker means "we did not see one", never "they don't have one":
a WordPress site behind a caching plugin that rewrites asset paths is invisible to
this, and the readout must be able to say so. It sits **outside** the pass/fail
denominator entirely.

**Where it goes:** ahead of "Does it work?". _Here is what you are running_, then
_here is whether it works_. The three checks that survived review as pass/fail —
analytics present (T0-46), the header/version leak (T0-36), form provider
recognition (T1-26) — read off the same data.

---

## Tier 0 — free. Pure functions over data the crawl already stores.

**36 checks.** No new requests, no new extraction.

### From `anchors` — already captured, capped, with `anchorCount`

- **T0-01 REWORD** Links that go nowhere. `href=""` and `javascript:void(0)` are
  hard failures. `href="#"` is not — it is legitimate for a JS-driven disclosure,
  and we cannot see the handler. Count it separately as a note.
- **T0-02 KEEP** Links to `localhost` / `127.0.0.1` / `*.local` / a staging host.
- **T0-03 KEEP** `http://` links on an https site.
- **T0-04 CUT** (built, then removed 2026-09-04) `target="_blank"` without
  `rel="noopener"`. It was greenable — reddoorla.com passes it 5/5 — and it was
  already worded as tidiness rather than a vulnerability, so it failed neither of
  the tests this backlog applies. It was cut on the evidence instead: apple.com
  fails it 111 out of 111, on links whose `rel` is `nofollow`, and browsers have
  implied `noopener` since 2021. A check that flags a competently built site a
  hundred times over a five-year-old non-issue spends the reader's attention on
  nothing, and a reader who recognises it as nothing discounts the lines that
  matter. Being _correct_ is not sufficient grounds to occupy a row.
- **T0-05 CUT, and still cut.** Anchors with no accessible name. `PageAnchor`
  gained `aria-label` on 2026-09-05 (for T0-06, below) but still carries no inner
  `<img alt>`, so an icon link would still false-positive. axe's `link-name` does
  it correctly against the rendered DOM. Moved to T3-14.
- **T0-06 KEEP, corrected 2026-09-05** Non-descriptive link text — "click here",
  "read more", counted. It must read the `aria-label` where there is one: every
  "Learn more" on apple.com is written `aria-label="Learn more about
accessibility"` around a span reading "Learn more", and judging the visible
  text alone reported 60 well-labelled links as bare. A vague `aria-label` still
  counts — the point is the destination, not which attribute carries it.
- **T0-07 CUT** Same link text → different URLs. Fires on every blog index on
  earth ("Read more" ×12 is _normal_), which breaks the floor. T0-06 already
  catches the real defect.
- **T0-08 KEEP** `tel:` href is a dialable number, not `tel:call-us-today`.
- **T0-09 MOVED** `mailto:` present. Not a defect — a site with a form and a phone
  is fine without one. It is goal-battery evidence.
- **T0-10 MOVED** Social profile links present. Same: evidence for
  `consistency.ts` / `accuracy.ts`, not a pass/fail.
- **T0-11 KEEP** Unedited template social defaults — bare `facebook.com/`,
  `twitter.com/yourhandle`. Near-universal pass, mortifying when it fails.
- **T0-12 REWORD** Nav drift. Now cheap and well-defined:
  `consistency.sharedNavLinks` already derives the shared nav set. Scope it to a
  link _text in that set_ resolving to different URLs across pages.

### From `text` — already captured

- **T0-13 KEEP** Copyright year current. _Already built in `consistency.ts` — keep,
  demote into What Passes._
- **T0-14 KEEP** Lorem ipsum / "Your text here" / "Insert content here".
- **T0-15 REWORD** Template leakage. Require token forms — `{{ }}`, `%s`,
  `[object Object]` — not bare `null`/`undefined`, which appear in honest prose
  ("the null hypothesis").
- **T0-16 KEEP** Mojibake — `â€™`, `Â`, `ï»¿`. Trivial regex, extremely visible,
  and the kind of thing a prospect _feels_.
- **T0-17 KEEP** "Coming soon" / "Under construction" pages inside the crawl.
- **T0-18 CUT** Phone in text ≠ `tel:` link. **Already built** —
  `ContactVariant.linked` in `consistency.ts`.
- **T0-19 CUT** Email in text not linked. **Already built** — same field.
- **T0-20 REWORD** Business name in the homepage `<title>`. Depends on the name
  `analyze.ts` infers, so it is `unmeasured` when that stage failed — not a pure
  function, despite living here.
- **T0-21 MOVED** Reading level / sentence length. A number with no defensible pass
  line. It is worth reporting in its own right — this is the "readability
  ingredients" item — but it stays out of the denominator.

### From `headings` — already captured; only "no h1" is checked today

- **T0-22 KEEP** Exactly one `<h1>` — not zero, not five.
- **T0-23 REWORD** `extract.ts` only pushes headings `if (text)`, so an empty h1 is
  _invisible_ to us and already reads as "no h1". The logo-alt half is not
  checkable either. Reduce to: the h1 is not the site name alone.
- **T0-24 KEEP** The h1 is not byte-identical on every page.

### From `jsonLd` — parsing exists; only type _presence_ is checked

All five are **COND**: on a site with no such block they are not-applicable, never
a pass.

- **T0-25 COND** `Organization` carries `name`, `url`, `logo`.
- **T0-26 COND** `LocalBusiness` carries `address`, `telephone`, `openingHours`.
- **T0-27 COND** Schema `url` matches this origin, not a predecessor domain.
- **T0-28 COND** Schema `telephone`/`email` matches the page — and
  `consistency.ts` already holds normalized phone data to compare against, so this
  is nearly free.
- **T0-29 COND + REWORD** Self-serving `Review`/`AggregateRating`. I called it "a
  known penalty pattern"; it is not. It makes the markup _ineligible for rich
  results_. Say that.

### From `homeHeaders` — already captured, one aggregate today

- **T0-30..35 KEEP** **Split the six security headers into six checks.** Six
  greenable lines, each naming its own one-line fix, for near-zero work. Best
  value-per-hour in the tier.
- **T0-36 KEEP** `x-powered-by` / `server` not leaking a version. Also feeds the
  stack readout.
- **T0-37 KEEP** HTML served compressed (`content-encoding: gzip|br`).
- **T0-38 CUT** `content-type` declares a charset — _merged into T1-12_. A
  header-only test fails a large majority of perfectly healthy sites, because
  `<meta charset>` is the normal place. Check "declared somewhere".
- **T0-39 COND** HSTS `max-age` is meaningful. Only applies when HSTS is present;
  its absence already belongs to T0-30..35. Do not double-count.

### From `robotsTxt` / `sitemap` — already fetched

- **T0-40 KEEP** robots.txt names its sitemap.
- **T0-41 KEEP** robots.txt does not `Disallow: /`. Its own loud named check.
- **T0-42 REWORD** Sitemap count vs. page count. Our crawl is **capped**, so our
  count is not authoritative and the naive version reports our own limit as their
  gap. Honest form: flag only when the sitemap lists fewer URLs than we
  _independently discovered internal links to_; otherwise `unmeasured`.
- **T0-43 KEEP** Every sitemap URL is same-origin and https.

### From markup

- **T0-44 MOVED** Platform detection → **the stack readout**.
- **T0-45 MOVED** Third-party script inventory → **the stack readout**.
- **T0-46 KEEP** Analytics present at all. Greenable, most sites have something,
  and absence is a genuine finding: _you cannot tell whether any of this is
  working._

---

## Tier 1 — one new `extract.ts` field each, unlocking a cluster.

**23 checks.** Cheaper than first estimated: `extract.ts` **already collects every
`<link>` element** and only projects the canonical one onto `PageExtract`. Cluster A
is a projection change, not a new traversal.

### Cluster A — project the `<link>` set already collected

- **T1-01 KEEP** Favicon declared.
- **T1-02 REWORD** Apple touch icon. Plenty of good sites skip it — note-only when
  missing, never a fix-list line.
- **T1-03 COND** Canonical is absolute, not relative. (Absence of a canonical is
  already `checks.meta.missingCanonical`.)
- **T1-04 KEEP** Canonical is **self-referencing** — not every page pointing at the
  homepage. Real, common, and it destroys traffic.
- **T1-05 KEEP** Canonical points at this origin, not a staging host or an old domain.
- **T1-06 CUT** RSS/Atom feed declared. Most business sites have no feed and do not
  need one; this would fail the majority and is not a defect.
- **T1-07 COND** `hreflang` alternates self-reference and use valid codes.
  Not-applicable on a monolingual site.
- **T1-08 MOVED** Render-blocking stylesheet count. No defensible threshold;
  Lighthouse's performance score owns it.

### Cluster B — capture every `<meta name|property>`

- **T1-09 KEEP** **`<meta name="robots">` does not say `noindex`.** Highest-value
  check in the whole backlog. Sites ship it from staging and lose everything.
- **T1-10 KEEP** …does not say `nofollow`.
- **T1-11 KEEP** Viewport does not disable zoom. _Overlaps axe's `meta-viewport` —
  pick one owner, do not report it twice._
- **T1-12 KEEP** Charset declared, header or early meta. _(absorbs T0-38)_
- **T1-13 CUT** `theme-color`. The majority of sites lack it and the value is
  near-zero — this is precisely the "inflate a triviality" failure that
  `basics.ts`'s own header comment was written against.
- **T1-14 REWORD** Title length. Flag only `< 10` or `> 70` characters. A tight
  band fails good sites; 60 is a _pixel_ limit, not a character one.
- **T1-15 COND + REWORD** Description length, same generous band, conditional on
  one existing.
- **T1-16 COND** `og:image` is absolute — a relative one renders no card anywhere.
- **T1-17 COND** `og:url` agrees with the canonical.
- **T1-18 KEEP** **Duplicate meta descriptions across pages.** Same shape as the
  existing `duplicateTitles`; roughly a copy.

### Cluster C — capture `<html lang>` / `dir`

- **T1-19 KEEP** `lang` present. _Overlaps axe `html-has-lang` — one owner._
- **T1-20 KEEP** `lang` is valid BCP-47. _Overlaps axe `html-lang-valid`._
- **T1-21 COND** `dir` correct where content is RTL. Not-applicable on an LTR site
  — must not vacuously pass.

### Cluster D — form field detail on the existing `FormShape`

Feeds **both** bands: these are "does it work" failures and goal-battery evidence.

- **T1-22 KEEP** Every enquiry-form field has a `<label>`. _axe's `label` does this
  better against the rendered DOM — consider letting axe own it._
- **T1-23 KEEP** Email/phone fields use `type="email"`/`type="tel"` so the mobile
  keyboard switches. Not covered by axe. Cheapest completion-rate fix on the web.
- **T1-24 KEEP** Fields carry `autocomplete`. axe's `autocomplete-valid` tests
  _validity_, not presence — different check, keep ours.
- **T1-25 KEEP** An enquiry form posts with `method="post"`. A GET enquiry form puts
  the visitor's message in the URL bar and the server log.
- **T1-26 REWORD** Form action is same-origin or a recognised provider. Our provider
  list will always be incomplete, so an **unrecognised** third-party action is
  `unmeasured`, never a failure. Also feeds the stack readout.
- **T1-27 REWORD** Required fields marked. Only the `required` attribute is
  checkable; a visual asterisk is not. Narrow it to the attribute and say so.

---

## Tier 2 — new requests. Bounded and paced, reusing the existing prober.

**17 checks.** Each needs a ceiling and an honest `checked / found` denominator,
exactly as `assets.ts` does today.

- **T2-01 KEEP** `/favicon.ico` actually returns an image. _Declared_ and _served_
  are different claims — this is the pair that makes T1-01 honest.
- **T2-02 —** `sitemap_index.xml` fallback. Not a check; an improvement to the
  existing sitemap fetch. Fold in.
- **T2-03 KEEP** Trailing-slash consistency, one canonicalising to the other.
- **T2-04 KEEP** `http://` → `https://` in a single hop, not a four-redirect chain.
- **T2-05 REWORD** `/index.html` duplicates. Only a finding when both answer 200
  **and** their canonicals disagree — some frameworks serve the alias legitimately.
- **T2-06 REWORD** Path case sensitivity. A 404 on `/About` is _correct_, not a
  defect. The real failure is both casings answering 200 with no canonical.
- **T2-07 KEEP** Redirect chains on internal links.
- **T2-08 KEEP** Sampled sitemap URLs return 200 — a sitemap advertising dead pages.
- **T2-09 REWORD** Orphans. Our crawl is capped, so "linked from nowhere" is only
  true _within our sample_ — the sentence must carry the sample size, exactly as
  the `reachability` requirement already does.
- **T2-10 KEEP** External outbound links checked for death — with the same
  403/429/5xx `UnverifiedReason` discipline `assets.ts` already enforces.
- **T2-11 COND** The `og:image` URL loads and is ≥200×200.
- **T2-12 REWORD** The logo image loads. Needs a definition of "the logo" — first
  image in the header, or one with `logo` in `src`/`alt`. Fuzzy but workable; say
  which rule we used.
- **T2-13 MOVED** TTFB. No threshold of our own, and Lighthouse's performance score
  already covers it. Report the number, keep it out of the denominator.
- **T2-14 REWORD** Homepage answers twice. Must require **two disagreeing samples**
  before it means anything — otherwise our network becomes their outage. Same
  discipline `crawlerReachability.measured` already uses.
- **T2-15 KEEP** SPF record present.
- **T2-16 KEEP** DMARC record present — _"anyone can send email as you."_
- **T2-17 KEEP** MX records exist. Also names their email provider for the readout.
- **T2-18 COND** The `mailto:` domain has MX — a contact address that bounces.
- **T2-19 KEEP** Domain expiry via RDAP, pass at > 30 days. _"Your domain renews in
  41 days"_ is acted on the same afternoon.
- **T2-20 MOVED** Nameserver / host identification → **the stack readout**.
- **T2-21 CUT — agreed.** Admin-path probing reads as reconnaissance against a
  stranger's site, and the stack readout gets us platform identification from
  markup with no probe at all.

T2-15..19 are DNS/RDAP, not HTTP — one query each, essentially free, in a band no
competing audit covers. Note `basics.ts` deliberately excludes _TLS_ expiry;
_domain_ expiry is a different thing and worth having.

---

## Tier 3 — inside the Playwright page we already open.

**8 checks + axe.** `crawl.ts` already launches chromium, does `page.goto` + settle

- `page.content()`. Most of this is instrumentation on that existing callback.

* **T3-01 KEEP** **Console errors, per page.** The most demonstrable "your site is
  broken" finding there is.
* **T3-02 REWORD** Failed network requests. Split first-party from third-party: our
  network blocking someone's analytics call is not their broken asset.
* **T3-03 KEEP** Uncaught promise rejections.
* **T3-04 CUT** Rendered `<title>` set — duplicate of `checks.meta.missingTitle`
  read against the rendered view.
* **T3-05 KEEP — cost correction.** Horizontal overflow at 375px is **not free**: it
  needs a 375px context, so it is a second render pass or a resize per page. Still
  worth it — it is the most common mobile bug on the web and it screenshots.
* **T3-06 MOVED** Tap targets under 44×44 → axe's `target-size` (WCAG 2.2 AA).
* **T3-07 KEEP** Body text under 12px. No axe rule covers it.
* **T3-08 NEEDS A DEFINITION** Focus visible. "The primary CTA" is not identifiable
  from markup. Nearest greenable form: _no focusable element in the header sets
  `outline: none` without a replacement indicator._ Settle the definition before
  building — as written it cannot pass or fail cleanly.
* **T3-09 KEEP** Images whose intrinsic size dwarfs their rendered size, named per
  image. Pairs with the existing `heaviestImages`.
* **T3-10 MOVED** The LCP element. Not a check — it is _evidence_ that names the
  hero image the performance score blames.
* **T3-11 REWORD** CLS, against the published Core Web Vitals threshold (≤ 0.1).
  With that threshold it is greenable; without one it is a number.
* **T3-12 CUT** Primary action above the fold. "Primary action" and "the fold" are
  both judgments — this cannot be made greenable honestly.
* **T3-13 MOVED — and still the best item in the tier.** Screenshots, mobile +
  desktop. Not a check. It is the thing that makes every other finding believable,
  and it is two lines.

### T3-14 — inject `axe-core`

One `page.addScriptTag`, and the whole rule set runs against the **rendered** DOM.

**Correcting my earlier pitch:** this is not ~90 net-new checks. The Lighthouse
stage we already run _is_ axe — a ~45-rule subset, reported as a single opaque
number. What injecting it ourselves actually buys:

- the ~45 rules Lighthouse already runs become **named findings with named fixes**
  instead of "accessibility: 82";
- the rules Lighthouse **omits** — every `best-practice` landmark and heading rule —
  become visible for the first time;
- it absorbs T0-05, T3-06, and arguably T1-11/19/20/22 into one dependency.

Still the highest ratio in the backlog, but say it accurately.

Two cautions from our own history, both already written down: scan the **full** tag
set (restricting to `wcag2a/2aa/21a/21aa` hides every landmark and heading rule,
which are `best-practice`), and report **counts and rule names**, never "your site
is inaccessible".

---

## Tier 4 — real interaction. New Playwright work, per-site fragility.

**10 checks.** Everything above is observation; this is acting on the page. Most of
it is **COND** by nature, which makes the fourth state mandatory here.

- **T4-01 KEEP** Every primary nav item navigates somewhere that is not a 404.
- **T4-02/03 REWORD** **The mobile menu opens, and closes.** A hamburger that does
  nothing is a site with no navigation for most of its visitors, and no static check
  can see it. Needs a stated heuristic for finding it — `aria-expanded` /
  `aria-controls`, or a header button that toggles visibility.
- **T4-04 SPLIT** "A skip link exists" is cheap and **KEEP**. "No focus trap" is
  fuzzy — **CUT** for now.
- **T4-05 KEEP** Submit the enquiry form **empty** → inline errors, or does the
  button silently do nothing? Best check in the tier.
- **T4-06 KEEP** Submit an **invalid email** → caught client-side?
- **T4-07 COND** The cookie banner dismisses and the site works afterwards.
- **T4-08 COND** The site's own search, given a word from its own text, returns
  results.
- **T4-09 COND** The booking widget loads and shows at least one slot. The goal
  battery currently credits `book` on _the presence of a link to a booking host_;
  this is the check that says whether a visitor could actually finish.
- **T4-10 COND** Add-to-cart updates the cart.
- **T4-11 CUT** Tappable phone at mobile width — duplicate of the goal battery's
  `tappable-phone`.
- **T4-12 CUT** Hero video plays. Conditional _and_ fuzzy — no clean pass state.
- **T4-13 CUT** Sticky header behaviour. Fuzzy.
- **T4-14 CUT** Back button after a filter change. Fuzzy.

**GATE — T4-15, actually submitting a valid enquiry.** The only way to prove the
form reaches a human, and it sends a real message to someone we have not met.
Options: (a) never, on prospects; (b) only on our own sites and existing clients, as
a regression check; (c) a clearly-marked test payload behind an explicit operator
flag. T4-05/06 get most of the value with none of the problem.

---

## Totals after review

| Tier                            | Proposed | Survived     | Cost                                     |
| ------------------------------- | -------- | ------------ | ---------------------------------------- |
| 0 — free over stored data       | 46       | **36**       | a day, mostly fixtures                   |
| 1 — four extract fields         | 27       | **23**       | a day (Cluster A is a projection change) |
| 2 — new bounded requests        | 21       | **17**       | a day, plus DNS/RDAP plumbing            |
| 3 — inside the existing browser | 14       | **8** + axe  | a day; axe is an afternoon               |
| 4 — real interaction            | 15       | **10**       | days, ongoing fragility                  |
|                                 |          | **94 + axe** |                                          |

Cut or moved: 25 — 6 duplicates of things already built, 8 observations with no pass
state (now the stack readout), 11 that could not be made greenable at a price worth
paying.

The current battery is roughly 35 checks. This is a **2.7×** on our own checks
before axe, and the conditional ones drop out per site, so a typical report will
show somewhere around 110–130 measured.

---

## Ordering

1. **The stack readout.** Nearly free, no denominator to get wrong, and it changes
   how everything after it is read. Ship it first.
2. **Tier 0** in one pass — nothing new is fetched, so nothing can regress a run.
   Start with T0-30..35 (six headers) and T0-16 (mojibake).
3. **axe-core (T3-14)** out of order — one afternoon, and it absorbs six other items.
4. **Tier 1**, cluster by cluster. Cluster B first: `noindex` and self-referencing
   canonicals have the highest hit rate on real sites.
5. **Tier 3** instrumentation, screenshots leading.
6. **Tier 2**, DNS/RDAP first — cheap, and nobody else checks it.
7. **Tier 4** last, and only after a decision on T4-15.

## Before any of it ships

Re-run the audit on reddoorla.com. Every previous measurement change found an
instrument bug in one pass, and every one of them overstated the client's fault.

## Two open definitions

- **T3-08** — what "focus is visible" means, precisely enough to pass or fail.
- **T4-15** — whether we ever submit a real form on a prospect's site.
