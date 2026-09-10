# Operator Edits on a Prospect Report — Design

**Date:** 2026-09-09 · **Status:** designed, not built · **Repos:** reddoor-maintenance + reddoor-website

## What and why

Tucker asked, 2026-09-09: "if we want to edit your generated copy before we send
to someone, can we do that?" Today the answer is no. `result_json` is written
once by the CLI and never updated, `src/db/prospect-audits.ts` exports no update
function, and `netlify/functions/audit-report-json.mts` hands the stored string
back byte for byte.

This adds a scoped override layer: the generated report stays the source, and any
line of it can be replaced by an operator before the link goes out.

The trigger case is real and worth recording. On the 2026-09-09 reddoor audit the
report said "A man named Tim leads Reddoor Creative" under a heading implying it
was not sourced from the site. Both Tim and Erik are on the site. The claim was
not false so much as overblown for that prospect, and there was no way to soften
or drop it without re-running the audit.

## Four decisions, all Tucker's

Asked and answered during the 2026-09-09 brainstorm:

1. **Scope: any rendered line.** Not just the model-written prose. I recommended
   limiting edits to model prose plus a hide action, on the grounds that the
   report's value rests on its claims following from its measurements, and that a
   freely editable report can say things the audit never found. Tucker chose the
   broad option knowing that. It is his call and this design implements it in
   full. The honesty is preserved through provenance instead of restriction: see
   "Every override stores its original" below.
2. **Surface: in place on the real report.** Not a form in the cockpit. With 227
   editable strings in the check battery alone, before fixes, claims, goal
   requirements and health rows, a field list is unusable and puts you editing
   text far from where it appears.
3. **Locking: none.** No freeze on send. The cockpit shows when a report was last
   edited and when it was last opened, so the operator can see whether they are
   changing something already read.
4. **Edit auth: a separate path, a key once, then a cookie.**

## The two facts that shape everything

### A stored audit never changes, so positional keys are safe

`result_json` is write-once. `createProspectAudit` is the only write path, every
run mints a fresh token, and re-auditing a site produces a new row rather than
mutating the old one. So for a given token the payload an override addresses is
frozen for the life of that report.

That removes the usual objection to addressing content by position.
`analyze.data.fixes[2].why` is normally a fragile key because a regeneration
reorders the list. Here there is
no regeneration to survive: a new audit is a new token with no overrides at all.

This is worth stating plainly because the instinct is to build content-hashed or
semantically-keyed addressing to survive drift that cannot happen. We do not need
it. We do keep a cheap guard against the assumption being wrong, below.

### Some rendered sentences never exist in the stored report

Merging overrides into the payload in maintenance cannot reach every line,
because the website composes some sentences itself from data:

| Composed in the website                | Where                         |
| -------------------------------------- | ----------------------------- |
| `openingSummary()`                     | `src/lib/report/model.ts`     |
| `goalVerdict()`                        | `src/lib/report/model.ts`     |
| `headlineFinding()`                    | `src/lib/report/narrative.ts` |
| `passes()`                             | `src/lib/report/narrative.ts` |
| `collisionFix()`                       | `src/lib/report/narrative.ts` |
| `HEALTH_FIXES` table                   | `src/lib/report/narrative.ts` |
| `healthRows()` labels, values, details | `src/lib/report/health.ts`    |

So "any rendered line" necessarily means the website changes too. The clean
"one merge point, no website change" property from the earlier sketch does not
survive decision 1.

## Where overrides are applied

**In `toReportView()` and the narrative functions beside it, not in the
components.**

`toReportView` has exactly three call sites, all `$derived`:

- `src/routes/audit/[token]/+page.svelte`
- `src/routes/audit/[token]/print/+page.svelte`
- `src/routes/dev/audit-report/+page.svelte`

Applying overrides there means every component renders what it always rendered.
The print page inherits every edit with no second implementation, and because
`renderReportPdf()` is a headless capture of `reportPrintUrl(token)`, the PDF
leave-behind follows automatically. The prospect email is not a re-render at all;
it carries the link and attaches that PDF, so it follows too.

The alternative, wrapping every rendered string in an editable component, was
rejected: several hundred mechanical edits across fourteen components, repeated
in the print template, with no way to prove full coverage.

## The key space

Two families, one flat map of `key -> { original, text }`.

**Payload-resident strings** use a JSON path into the stored report. Note the
`.data` segment: every stage is a `StageResult<T>`, so the payload nests one
level deeper than the view the components see.

```text
analyze.data.fixes[2].title
analyze.data.fixes[2].why
accuracy.data.assertions[0].claim
siteChecks.data[12].label
siteChecks.data[12].why
siteChecks.data[12].evidence
goalFit.data.requirements[3].why
```

**Website-composed strings** use a `composed:` prefix and the function that
produces them:

```text
composed:openingSummary
composed:headlineFinding
composed:goalVerdict
composed:passes[0].title
composed:passes[0].items[2]
composed:health[contact-consistency].value
composed:health[contact-consistency].detail
composed:healthFix[broken-links].what
composed:collisionFix.title
```

Keys are opaque strings to the storage layer. Only the website interprets them.

## Every override stores its original

Each entry keeps the text it replaced:

```json
{
  "siteChecks.data[12].why": {
    "original": "A link that goes nowhere reads as a broken site to the person who clicks it.",
    "text": "A dead link tells a visitor the site is not maintained."
  }
}
```

This buys two things.

**Provenance.** The cockpit can show exactly what was changed on a report without
diffing against a regeneration. Given decision 1, that record is the thing that
keeps an edited report honest: nothing is hidden, and the generated text is always
recoverable.

**A guard.** An override whose `original` no longer matches the payload is
withheld and reported rather than applied. Because a stored audit never changes,
this should never fire in production. **A guard that has only ever passed is not
evidence**, so the test suite constructs the mismatch deliberately and proves the
override is withheld, and mutation-tests the guard by removing the comparison and
confirming the test reds.

## Pieces

### 1. Storage — migration `0015_prospect_audit_edits`

Three columns on `prospect_audits`, following the `0013` precedent:

```sql
ALTER TABLE prospect_audits ADD COLUMN overrides_json TEXT;
ALTER TABLE prospect_audits ADD COLUMN edited_at TEXT;
ALTER TABLE prospect_audits ADD COLUMN opened_at TEXT;
```

SQLite has no `IF NOT EXISTS` for `ADD COLUMN`; the runner already treats
"duplicate column name" as applied. A JSON column rather than a side table,
matching `result_json`'s existing precedent: the map is always read and written
whole, and there is no query that wants one override in isolation.

`src/db/prospect-audits.ts` gains `setProspectAuditOverrides` and
`touchProspectAuditOpened`. It keeps having no way to write `result_json`.

### 2. Serving — the JSON route grows a wrapper, without parsing

`audit-report-json.mts` currently returns `row.result_json` raw, and its comment
is explicit that parsing and re-serialising "would add a failure mode between the
database and the consumer for no gain". That reasoning still holds, so the wrapper
is built by string concatenation and the stored JSON is never parsed:

```ts
const body =
  `{"report":${row.result_json},"overrides":${row.overrides_json ?? "null"},` +
  `"editedAt":${JSON.stringify(row.edited_at)},"openedAt":${JSON.stringify(row.opened_at)}}`;
```

**Deploy order: website first.** `fetchReport` must tolerate both shapes during
the transition. A body carrying a `report` key is the wrapped form; anything else
is a bare report with no overrides. That ordering means neither repo can break the
other on the way through.

The five minute `cache-control: private, max-age=300` on this route is shortened
to `no-store`, so an edit is visible on the next load rather than up to five
minutes later. The `private` stays: the document names one business and
enumerates its weaknesses, and a CDN or corporate proxy must not retain a copy.

### 3. Applying — one helper, two call sites

A small module in the website, `src/lib/report/overrides.ts`:

```ts
export function applyOverrides(raw: AuditReport, map: OverrideMap): AuditReport;
export function composed(map: OverrideMap, key: string, generated: string): string;
```

`toReportView` calls the first before it builds anything. The narrative and health
functions call the second at each composed sentence. Both are pure, both are
tested the way `model.ts` and `narrative.ts` already are.

### 4. Editing — a separate path, a key once, then a cookie

`GET /audit/<token>/edit?k=<key>` verifies the key, sets an HttpOnly,
`SameSite=Strict` cookie scoped to `/audit` with a short expiry, then redirects to
`/audit/<token>/edit` with the key gone from the URL.

The share address `/audit/<token>` is a genuinely different string from the edit
address, so a careless paste hands a prospect the read-only report. This is the
whole reason the path is separate rather than a query flag on the report URL.

Guards match `/meeting-outcome`, the site's existing internal page: `noindex,
nofollow`, `no-referrer`, never prerendered, and the endpoint refuses everything
when its key is unset. **It fails closed.**

The edit affordance runs only when the cookie is present. A client pass walks the
rendered regions, matches each against the values the view knows are overridable,
and wires up the ones it resolves uniquely. Anything ambiguous is left alone and
surfaced as a count, so a gap is visible rather than silent. None of this code
path executes for a prospect.

### 5. Saving — the website proxies, maintenance verifies

`POST /api/audit-edit` on the website, following the pattern `/api/inquiry`
already uses for the forms ingest: the route holds a shared token and forwards.
It refuses without the edit cookie, and refuses when its token is unset.

Maintenance exposes `POST /api/audit-report/:token/overrides`, path-routed on the
function with a rate limit, verifying the shared token. It writes
`overrides_json` and stamps `edited_at`.

### 6. Recording when a report was opened

The JSON route stamps `opened_at` best effort, and a failure there never fails the
response. The website's server-side fetch sends a header marking the request as an
edit session when the edit cookie is present, and maintenance skips the stamp for
those. Otherwise the operator's own previews drown the signal the timestamp exists
to give.

The cockpit's audits list shows both timestamps and an edited marker.

## What the tests must prove

Beyond the happy path, and each written before the code that satisfies it:

- **A stale original is withheld**, not applied silently. Mutation-tested by
  removing the comparison and confirming the test reds.
- **Edit mode is inert without the cookie**, on the report page and the print
  page. Asserted against rendered markup with `<script>` blocks stripped, because
  SvelteKit embeds the load data in the hydration payload and a naive substring
  check passes on data that is never displayed.
- **The save endpoint fails closed** when its token is unset, and refuses without
  the edit cookie.
- **Report and print render identical edited text**, so the PDF cannot drift from
  the page.
- **`fetchReport` accepts both response shapes**, so the two repos can deploy
  independently.

## Non-goals

- **Versioning.** No history of edits, no ability to serve a prior version. If it
  turns out to matter, `original` is already stored and the column can grow.
- **Editing the fixed copy shared by every report.** Check labels and reasons,
  buyer questions and health-row copy are the same on every report and live in
  source across both repos. Rewording those is a code change, and consolidating
  them is a separate and cheaper piece of work.
- **Prismic.** Investigated 2026-09-09 and ruled out for the reports themselves.
  The `reddoor-la` repository's content API answers anonymous callers: I listed
  all 80 documents with no credential, and five other fleet repositories behave
  the same. The audit's entire privacy model is that the 128-bit token in the URL
  is the credential, backed by three independent noindex guards and a no-referrer
  policy. A prospect report is a critical assessment of a stranger's business,
  often naming their competitors. Publishing those into an enumerable content API
  would undo all of it.

## Open question for later

Whether an edited report should carry any visible mark that it was edited. Not
built in this pass. The record exists in the override map either way, so the
decision can be made after the feature has been used a few times.
