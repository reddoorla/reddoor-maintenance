# Fleet analytics — one tag, one property per site, and a check that proves both

Status: approved in discussion 2026-09-22 (backfill the whole fleet, not just
new sites; Reddoor owns the GA4 properties; no consent banner). Written before
any code. Pilot: **beachfront-dentistry**, which already carries the closest
thing to the pattern and has a live production host to measure against.
`vida-legacy-foundation` turns it on at launch.

## The finding that reframes the work

The ask was "wire up analytics into our system." Half of it is already built,
and it is the half that would have been expensive.

**The read side is complete and generic.** `src/reports/ga/client.ts` and
`src/reports/search/client.ts` pull GA4 and Search Console through a service
account impersonating `GA_SUBJECT`; `draftDueReports` enriches each monthly
client report per site, gated on `gaConfigured && (ga4PropertyId || searchQuery)`;
`src/alerts/analytics-health.ts` distinguishes a fleet-wide subject outage from
a single site's blip and emails the operator; `docs/runbooks/ga-search-role-account-cutover.md`
says what to do about it. The site row already has the column
(`src/db/schema.ts:105`, `ga4_property_id`).

**The emit side is uneven, and the measurement below replaces a wrong first
reading.** An initial nine-repo sample suggested "three one-offs and nothing
else." Querying the fleet rows and then GA itself on 2026-09-22 showed
otherwise: 11 site rows carry a `ga4_property_id`, 9 repos carry a tag, and the
dominant pattern is not beachfront's component — it is the inline `app.html`
snippet, in seven repos.

Every maintained and launching site, cross-tabulated. "Users" is `activeUsers`
for 2026-08-23..2026-09-22, read from each property by hostname:

| State | Sites | What it means |
| --- | --- | --- |
| Property + tag + real traffic | `beachfront-dentistry` (1051), `erp-industrials` (998), `espada` (558), `vineyard-custom-homes` (519), `msot` (386), `caltex` (310), `reddoor` (92 real) | Working. 7 of 14 maintained. |
| Property, **no tag**, 0 users | `alamo-anatomy`, `hedloc` (both launching), `la-homelessness-youth` (maintained) | Row configured, nothing feeding it. |
| Property **and** tag, still 0 users | `sonder` | GTM behind a consent banner has collected nothing in 30 days. Its own defect (see below). |
| Tag, **no property** | `revogen` | Collecting into a property no report reads — its monthly analytics section is blank while the data exists. |
| Neither | `1836dig`, `29-navy`, `data-dynamiq`, `la-homelessness-initiative` | Nothing at either end. |

So: **7 of 14 maintained sites are actually collecting**, and each of the other
seven is broken in a different place — no tag, no property, a consent gate that
never opens, or a mismatch between the two. The seven `building` sites,
`vida-legacy-foundation` among them, have neither and will need both at launch.

Two corrections this measurement forces on assumptions made earlier in the same
session:

- **The fleet alert is not dormant.** With 11 configured properties,
  `assessAnalyticsAlert` can fire today. It has simply had nothing to fire
  about.
- **`reddoor`'s own property is 99% synthetic** — 13,312 of 13,417 users are
  `localhost`, the smoke suite tripping the tag's interaction gate. The
  hostname filter in `reports/ga/client.ts` already keeps that out of the
  report, but the property itself is polluted, and any new property will be too
  unless the tag stays inert off the production host (D3).

## Goal

Every maintained site emits a GA4 tag through one tested mechanism, every site
row names the property the reports read, and an audit fails when either half
stops being true.

## Non-goals

- No consent banner, no GTM, no server-side analytics, no dashboard beyond the
  monthly report that already exists.
- No custom events, conversions or funnels in this pass. Pageviews only. Events
  are a per-site conversation once there is a property to put them in.
- No migration of `gallerysonder` (D7).
- No backfill of history. A property created today starts today.
- **Search Console is a separate axis.** Report enrichment reads either a GA4
  property *or* a `searchQuery`, and the two are configured independently. This
  spec covers the GA4 half only; verifying each domain in Search Console and
  filling `searchQuery` is its own pass, on its own schedule.

## Decisions

**D1 — The tag mechanism is a package export, not a component and not a copy.**
`@reddoorla/maintenance/analytics` exports `initAnalytics({ measurementId,
productionHost })`. Framework-free; the site's root layout calls it. A Svelte
component shipped from the package would couple ~20 repos to one Svelte version
for nine lines of DOM work. A per-repo copy is exactly what produced three
divergent patterns, and the newest of them (beachfront's) is the only one with
a test.

**D2 — The loader is injected from JS and never written into `app.html`.**
The seven sites using the inline snippet today get away with it because they
have **no CSP at all** — `espada`, `revogen` and `caltex-landing` have no `csp`
block in `svelte.config.js`. Starter-class sites do (`mode: "auto"`, nonces and
hashes, `'unsafe-inline'` present for styles only), and SvelteKit issues those
nonces to the scripts *it* injects, not to a raw `<script>` typed into the
template. So the fleet's most common pattern is expected to be blocked on
exactly the sites this work targets.

*Expected*, not verified — no site today has both a CSP and an inline snippet,
so nothing in the fleet demonstrates it either way. **The implementation plan
proves this with a diff before relying on it**: add the snippet to a
starter-class site, build, and read the emitted HTML and the CSP header. If it
turns out SvelteKit does cover template scripts, D2 loses its main argument and
falls back to the weaker ones — one mechanism instead of two, and `app.html`
being the file that carries the `%sveltekit.head%` substitution trap.

**D3 — No consent banner; load on the production hostname only.**
Beachfront's rule, promoted to the fleet: inert unless
`location.hostname === productionHost`, so deploy previews, `localhost` and
Playwright runs never pollute a property. No cookie banner — this is a US
small-business and nonprofit fleet. `initAnalytics` takes an optional gate
predicate so a site whose counsel asks for consent can supply one without a
second mechanism.

**D4 — Reddoor owns the properties.** One Google Analytics account, one
property and one web data stream per site. Cheapest to operate and it needs
nothing from the client to start collecting. The cost is stated plainly: a
departing client's history does not travel with them, so "do we own our
analytics" is answered *no* by default, and a client-owned property is a
per-client exception. This reverses a line drafted in a VLF client email earlier
the same day, which promised a property under a VLF account; that draft was
corrected before sending.

**D5 — Two IDs, two homes, not interchangeable.** `G-XXXXXXXXXX` (the
measurement ID) lives in `src/lib/site-config.json` and ships in the page —
it is public by design. The numeric property ID lives in the Turso site row's
`ga4_property_id` and is what the Data API reads. Swapping them fails
asymmetrically: a wrong measurement ID collects into nothing and looks fine, a
wrong property ID errors loudly. The audit checks both ends so the silent
direction cannot hide.

**D6 — The audit lands before the sweep.** `src/audits/analytics.ts` is written
and shown to PASS on a known-good input and FAIL on a known-bad one before any
site is swept. This repo's first rule: until an instrument has passed once, the
instrument is the suspect.

**D7 — `gallerysonder` is out of scope here, and is its own bug.** GTM behind a
consent banner is client-visible behavior; replacing it is a decision with that
client, not a line in a sweep. But its property returned **zero users in 30
days** while the site is live and maintained, so something in that chain —
consent never accepted, the banner's loader, or an empty GTM container — has
been failing silently. That is a defect to file and diagnose separately, not to
fold into this rollout.

## Architecture

### The package export

`initAnalytics(opts)`:

- no-ops when `measurementId` is absent or empty — an unset site is off, not broken;
- no-ops when `location.hostname !== productionHost` (or the optional gate returns false);
- is idempotent — a layout effect can re-run, and a second call must not append
  a second loader;
- creates `window.dataLayer` and the `gtag` shim (which needs the live
  `arguments` object, the one non-obvious line in beachfront's version), appends
  `<script async src="https://www.googletagmanager.com/gtag/js?id=…">`, then
  `gtag("js", new Date())` and `gtag("config", id)`.

Tested once, in the package, under jsdom: inert off host; inert with no ID;
exactly one loader after two calls; `config` called with the ID it was given.

### What the recipe writes into a site

1. `src/lib/site-config.json` gains `"analytics": { "measurementId": "G-…" }`.
   Absent means off, which is the starter's shipped state.
2. The root layout calls `initAnalytics` in a client-side effect, reading the
   measurement ID from site config and the production host from the same config
   the rest of the chrome uses.
3. `svelte.config.js` CSP: `script-src` += `https://www.googletagmanager.com`;
   `connect-src` += `https://www.google-analytics.com`,
   `https://*.google-analytics.com`, `https://*.analytics.google.com`;
   `img-src` += `https://www.google-analytics.com` for the beacon fallback.
4. Prettier, via the recipe's existing `_prettier.ts` helper.

A site's own test suite asserts the *inert* case only — under Vitest and
Playwright the hostname is never the production host, so asserting the tag
loads there would be asserting a lie. The live case belongs to the audit.

### Fleet side

Each site gets a property and a web data stream in the Reddoor GA account; the
numeric property ID goes on the site row (`ga4_property_id`, column exists);
`GA_SUBJECT` must be able to read every new property or the report enrichment
stays blank — that is the single point of failure `analytics-health.ts` was
built to catch, and it becomes load-bearing for the first time when the
denominator goes from ~1 to ~20.

### The audit

`src/audits/analytics.ts`, with the `-airtable` mirror file its siblings have.
Two checks per maintained site:

- **Tag present.** Drive the live production URL with the existing browser
  harness (the same Actions-runner path `form-e2e` uses) and assert a request to
  `googletagmanager.com/gtag/js?id=<the site's measurement ID>`. Asserting the
  request rather than the markup is what makes it true of an injected loader.
- **Property answers.** `runReport` for the last 7 days. Error → FAIL. Zero
  sessions for 7 days on a launched site → WARN, because that is the shape of a
  tag that quietly stopped firing.

Without this, "analytics is wired up" is unfalsifiable until a client notices a
blank section in a monthly report, which is months of silence.

## Rollout

1. **Package.** `initAnalytics` + tests, released.
2. **Audit.** Proven PASS against `medical-solutions-of-texas` (a live tag
   exists there today) and FAIL against a site with none, before it is trusted.
3. **Pilot: beachfront-dentistry.** Replace the local component with the package
   call. It is the only site where the diff is a straight swap, and it has a live
   host to measure.
4. **Perf gate, measured on the pilot.** gtag is ~50–70KB plus a third-party
   connection, and `lighthouserc.json` extends the central
   `@reddoorla/maintenance/configs/lighthouse` — every site's budget moves
   together. Lighthouse before and after on the pilot; record the delta in the
   journal. Only then sweep. If the delta eats the margin, that is a threshold
   decision made once, in the package, with a number attached.
5. **Sweep.** One PR per site via the recipe, iterating
   `scripts/fleet-repos.sh --pushable`. Three checkouts cannot receive a push
   and are reported, not discovered at push time: `reddoor-mailer` and
   `the-pointe` (ARCHIVED), `rfp-analyze` (NO-REMOTE). `reddoorla/the-tower` is
   archived with no local checkout, so the script cannot see it at all.
   `medical-solutions-of-texas` is part of the sweep — its inline snippet is
   removed in the same PR that adds the call, so the CSP claim in D2 is never
   half-true on a live site.
6. **`vida-legacy-foundation` at launch.** Its production hostname does not
   resolve to the new site yet, so by D3 the tag would be inert anyway. The
   measurement ID goes in with the launch PR, and the property ID onto the row
   as part of the DNS cutover checklist, next to the Turnstile hostname step
   that is already there.
7. **Starter.** Ship the wiring with no measurement ID, so a new site inherits
   the mechanism and turns it on at launch. `docs/NEW-SITE.md` gains the step.

## Testing

- Package: jsdom unit tests for all four behaviors in the export, plus the
  package's own mutation gate — a tag loader whose host check can be deleted
  without a test failing is exactly the bug that pollutes a client's property
  with preview traffic.
- Sites: assert the inert case; no per-site duplication of the package's tests.
- Audit: proven on known-good and known-bad before it is believed (D6).
- First nightly after the sweep is watched deliberately, for the two
  interactions named under Risks.

## Risks

- **`form-e2e` beacon interference, now universal.** `isSameSitePost` already
  exists because on 2026-08-31 Google Analytics' collect beacon ("POST 204") and
  Turnstile telemetry ("POST 200") were named in failure lines while the real
  story was that the submission never left the page. That defense was written
  when GA was incidental on a couple of sites; the backfill makes it load-bearing
  on all of them.
- **The analytics alert's denominator roughly doubles.** `assessAnalyticsAlert`
  needs ≥2 configured sites and a failing majority; with 11 configured today it
  can already fire, and the sweep takes it to ~20. A botched batch will look
  exactly like a `GA_SUBJECT` outage, so watch the first `report --due` run
  after each one.
- **Perf budget**, mitigated by step 4 rather than assumed away.
- **The ownership answer.** D4 means a client asking "do we own our analytics"
  hears no by default. VLF asked a version of that question on 2026-09-22, which
  is how this came up.

## Open questions

- ~~Which Google account holds the GA account, and can `GA_SUBJECT` read
  properties created there?~~ **Answered 2026-09-22.** Reddoor's own Google
  account, as for most existing sites, and the delegation works: impersonating
  `tucker@reddoorla.com`, the service account read all 11 configured properties
  with no auth failure. New properties created in that account inherit the same
  access.
- Four maintained sites are broken at one end rather than un-started, and each
  needs a decision the sweep does not make for it: `revogen` (collecting, no row
  — a one-line fix, and its next monthly report stops being blank),
  `la-homelessness-youth` (row, no tag), `sonder` (D7), and `reddoor`'s own
  localhost-polluted property.
- GA4 data retention defaults to 2 months; 14 is a per-property checkbox worth
  setting at creation, because it cannot be applied retroactively.
- Does any signed maintenance agreement promise analytics ownership or data
  portability that D4 contradicts?

## Success criteria

- `reddoor-maint audit analytics` is green across maintained sites.
- One month on, every maintained site's monthly report carries a non-blank
  analytics section.
- A grep for `googletagmanager` across the site repos finds the package call and
  no snippets, `gallerysonder` excepted.
