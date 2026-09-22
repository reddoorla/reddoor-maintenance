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

**The emit side is three one-offs and a lot of nothing.** Measured across nine
checkouts on 2026-09-22:

| Repo | What emits |
| --- | --- |
| `medical-solutions-of-texas` | raw `gtag` snippet inline in `src/app.html`, `G-BZ0WQMEE8L` hard-coded |
| `beachfront-dentistry` | `src/lib/components/Analytics.svelte` + a test; loader built in JS; inert off the production hostname |
| `gallerysonder` | GTM (`gtm.js`) behind `CookieConsent.svelte` |
| `reddoor-starter`, `la-homelessness-initiative`, `alamo-anatomy`, `29-navy`, `the-pointe-burbank`, `data-dynamiq`, `vida-legacy-foundation` | nothing |

So the fleet runs a reporting pipeline pointed at properties that mostly do not
exist. A blank analytics section in a client's monthly report is not the
pipeline failing; it is the pipeline working correctly against no data. That is
also why the existing fleet alert has been quiet: with fewer than two configured
sites, `assessAnalyticsAlert` cannot fire by construction.

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
The starter's CSP grants script nonces *without* `'unsafe-inline'`, so msot's
inline snippet is not portable: dropped silently on any site with the starter's
CSP, with no console error that names the cause. An injected `<script>` element
needs only the origins in `script-src`. `app.html` is also the file carrying the
`%sveltekit.head%` substitution trap, which is a second reason nothing new goes
there.

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

**D7 — `gallerysonder` is out of scope.** GTM behind a consent banner is
client-visible behavior. Replacing it is a decision with that client, not a
line in a sweep.

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
- **The analytics alert changes character.** `assessAnalyticsAlert` needs ≥2
  configured sites and a failing majority. Today it effectively cannot fire.
  After the sweep it can — which is the point, and also means a botched sweep
  will look exactly like a `GA_SUBJECT` outage. Watch the first `report --due`
  run after each batch.
- **Perf budget**, mitigated by step 4 rather than assumed away.
- **The ownership answer.** D4 means a client asking "do we own our analytics"
  hears no by default. VLF asked a version of that question on 2026-09-22, which
  is how this came up.

## Open questions

- Which Google account holds the GA account, and is `GA_SUBJECT` already a user
  on it with read access to properties created there? Everything downstream is
  blank if not.
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
