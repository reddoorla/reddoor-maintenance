# Fleet Submissions Page + Attention-First Reorder — Design

**Date:** 2026-06-22
**Status:** Approved shape (full build, attention-first reorder) — pending spec review

## Goal

Give the operator a dedicated, filterable, searchable **fleet-wide submissions page** at
`/submissions`, and reorder the cockpit (`/`) and per-site (`/s/:slug`) pages so
**needs-attention content comes first and submissions sink to the bottom**.

This is purely additive dashboard work on top of the now-live libSQL submissions store.
No new write paths, no schema changes, no Airtable changes.

## Context

Submissions live in libSQL (Turso), behind `src/db/submissions.ts`. Today they surface in
two read-only-ish spots:

- **Cockpit** (`src/dashboard/fleet-render.ts` → `submissionsStrip`): top-10 fleet-wide NEW
  submissions, capped, with a "+N more — triage on each site page" link.
- **Per-site** (`src/dashboard/render.ts` → `submissionsSection`): recent 25 for one site,
  full detail + per-row triage buttons (Read / Archive / Spam) posting to
  `/api/submissions/:id/status`.

There is no way to see ALL submissions across the fleet, filter them, or search them. And on
both pages the submissions block currently sits ABOVE the health/approve content the operator
most wants to triage first.

Statuses are `new` / `read` / `archived` / `spam` (per the per-row triage buttons + the
status endpoint). The submission row shape is `SubmissionRow` (id, submissionId, siteId,
formType, name, email, phone, message, extraFields, sourceUrl, utm, submittedAt, status,
notifyStatus, resendMessageId).

## Deliverables

### 1. New `/submissions` page (full build)

A new Basic-auth-gated Netlify function rendering a fleet-wide submissions table with
server-side filtering, search, and pagination, plus the same per-row triage already used on
the per-site page.

**Filters (all optional, combinable, driven by query params, server-side):**

| Param    | Filter              | Match                                                      |
| -------- | ------------------- | ---------------------------------------------------------- |
| `site`   | Site (slug)         | maps slug → `site_id` via Websites; exact `site_id` match  |
| `type`   | Form type           | exact `form_type`                                          |
| `status` | Status              | exact `status` (new/read/archived/spam)                    |
| `q`      | Search              | case-insensitive `LIKE` across name, email, message, phone |
| `from`   | Submitted on/after  | `submitted_at >= from` (ISO date)                          |
| `to`     | Submitted on/before | `submitted_at <= to` (end-of-day)                          |
| `page`   | Pagination          | 1-based; 50 rows/page; newest-first                        |

The filter form submits via **native GET** (no JS needed to filter). Pagination is
prev/next links that preserve the active query params. Per-row triage reuses the existing
JS + `/api/submissions/:id/status` endpoint — no new write endpoint.

**Why server-side:** the fleet-scale direction is ~200 sites; submission volume will grow
past what's sane to ship to the browser. libSQL makes filtered/paginated/counted queries
trivial, and keeps the page fast and the payload small.

### 2. Attention-first reorder

**Cockpit** (`renderCockpitHtml`, `fleet-render.ts`). Current emit order:
`summaryBar → spamRollup → allClearBanner → approveStrip → submissionsStrip → tier sections`.
**New order:** `summaryBar → allClearBanner → approveStrip → tier sections → spamRollup →
submissionsStrip`. Action items (approve queue + health tiers) first; informational rollups
(spam, submissions) last. The submissions strip heading gains a **"View all →"** link to
`/submissions`; its existing "+N more" link points to `/submissions` too.

**Per-site** (`renderSiteDashboardHtml`, `render.ts`). Current body order:
`home → h1 → meta → audited → setup → pending(approve) → submissions → Lighthouse → Health →
security → spamScreen → Reports → siteDetails`.
**New order:** `home → h1 → meta → audited → setup → pending(approve) → Lighthouse → Health →
security → Reports → siteDetails → spamScreen → submissions`. Both the form-related
informational blocks move to the very bottom — `spamScreenSection` (the screening summary)
then `submissionsSection` (the lead list) dead last, before the scripts. Everything else
keeps its order. The submissions section heading gains a **"View all for this site →"** link
to `/submissions?site=<slug>`.

### 3. Operational reset — DONE

Already executed this session: all 11 stale Reports rows wiped; fresh ERP Industrials
Maintenance + Testing drafts created to demonstrate `autoTickChecklist` (4 auto-ticks, 1
real fail left unticked, 1 unknown, the rest manual). Not part of the code change; recorded
here for completeness.

## Architecture

Rides the existing seam: handlers compose pure data-access functions and pure renderers.

```
netlify/functions/submissions-page.mts   (new handler: auth + parse query → filter → render)
  ├─ openBase(Airtable)  → listWebsites()      (site dropdown + site_id→name/slug mapping)
  └─ openDb(libSQL)      → listSubmissionsFiltered() + countSubmissionsFiltered()
                                   ↓
src/dashboard/submissions-page-render.ts  (new pure renderer: renderSubmissionsPageHtml(model))
  └─ src/dashboard/submission-view.ts     (new shared module — see "Shared extraction")
```

### Data access — new functions in `src/db/submissions.ts`

```ts
export type SubmissionFilter = {
  siteId?: string; // exact site_id
  formType?: FormType; // exact
  status?: SubmissionStatus;
  search?: string; // LIKE %q% over name/email/message/phone, lower()-folded
  from?: string; // submitted_at >= from
  to?: string; // submitted_at <= to
};

// Shared private WHERE builder so list + count never drift.
function applySubmissionFilter<Q>(qb: Q, f: SubmissionFilter): Q;

export async function listSubmissionsFiltered(
  db: Db,
  filter: SubmissionFilter,
  opts: { limit: number; offset: number },
): Promise<SubmissionRow[]>; // ORDER BY submitted_at DESC, LIMIT/OFFSET

export async function countSubmissionsFiltered(db: Db, filter: SubmissionFilter): Promise<number>; // COUNT(*) under the same WHERE
```

`SubmissionStatus` already exists (`SUBMISSION_STATUSES`); `FormType` already exists. The
handler validates/narrows raw query strings to these enums (ignore unknown values rather than 500) before building the filter.

### Shared extraction (DRY)

`submissionRow()` and the `subm-status` client script currently live privately in
`render.ts`. Extract both — unchanged in behavior — into a new `src/dashboard/submission-view.ts`:

```ts
export function renderSubmissionRow(s: SubmissionRow): string; // moved verbatim
export const SUBMISSION_STATUS_SCRIPT: string; // the subm-status fetch JS
export const SUBMISSION_STYLES: string; // .subm-* CSS (shared)
```

`render.ts` imports these instead of defining them; the new page imports the same. This
guarantees the two pages render rows + handle triage identically and prevents drift. The
extraction is behavior-preserving — existing per-site rendering tests must still pass.

### Handler (`submissions-page.mts`)

Mirrors `site-dashboard.mts`:

- `config.path = ["/submissions", "/.netlify/functions/submissions-page"]`,
  `rateLimit` 60/min per IP.
- Basic auth via `verifyBasicAuth` against `DASHBOARD_PASSWORD`, same `Basic realm="Reddoor fleet"`.
- Requires `AIRTABLE_PAT` + `AIRTABLE_BASE_ID` (site list) and `TURSO_DATABASE_URL` (submissions).
- Parse `URL` search params → `SubmissionFilter` + `page`. Resolve `site` slug → `site_id`
  by matching `siteSlug(w.name)` against the fetched Websites (ignore an unmatched slug).
- Fetch `listWebsites(base)`, then `listSubmissionsFiltered` + `countSubmissionsFiltered`.
  Build `site_id → {name, slug}` map; enrich each row for display.
- Render `renderSubmissionsPageHtml(model)`; wrap the body in `try/catch → handlerError`.

Unlike the cockpit, submissions ARE the page here, so the DB is a hard dependency: if
`openDb` throws, fall through to `handlerError` (retryable 502) rather than rendering an
empty page that misleadingly implies "no submissions."

### Renderer (`submissions-page-render.ts`)

`renderSubmissionsPageHtml(model)` → full HTML document matching existing page chrome
(FAVICON_LINK, shared styles, `← Fleet home` link). Model:

```ts
type SubmissionsPageModel = {
  rows: Array<SubmissionRow & { siteName: string; slug: string }>;
  sites: Array<{ slug: string; name: string }>; // for the site <select>, sorted by name
  filter: { site: string; type: string; status: string; q: string; from: string; to: string };
  page: number;
  pageSize: number;
  total: number; // pagination state
};
```

Renders: a sticky filter form (site `<select>`, type `<select>`, status `<select>`, search
`<input>`, from/to `<input type=date>`, Apply + Clear), a result count + active-filter
summary, the rows (via shared `renderSubmissionRow`, each prefixed with its site name +
`/s/:slug` link since this is cross-site), prev/next pagination preserving params, and an
empty state when `total === 0`. Includes `SUBMISSION_STATUS_SCRIPT` so triage works.

## Navigation

- Cockpit submissions strip: "View all →" + the "+N more" link → `/submissions`.
- Per-site submissions section: "View all for this site →" → `/submissions?site=<slug>`.
- Submissions page: each row links to its site's `/s/:slug`; `← Fleet home` to `/`.

## Error handling / resilience

- Unknown/invalid filter values (bad `type`, `status`, malformed `page`) are ignored and
  fall back to defaults — never 500.
- DB open failure → `handlerError` 502 (retryable), consistent with other handlers.
- All user-visible strings escaped via `escapeHtml`; source URLs via `safeUrl`. (Shared row
  renderer already does this.)

## Testing

- **Unit (`src/db/submissions.ts`)** against in-memory libSQL (`openDb` on `:memory:`,
  seeded via `createSubmission`/`backfillSubmission`): each filter in isolation (site, type,
  status, search hit/miss across all four searched fields, from/to boundaries), combined
  filters, pagination (limit/offset windows, page beyond end → empty), newest-first ordering,
  and `countSubmissionsFiltered` agreeing with `listSubmissionsFiltered` under the same filter.
- **Renderer (`submissions-page-render.ts`)**, pure-function: rows render with site name +
  link; active filters reflected as selected/value in the form; pagination links present/
  correct and param-preserving; empty state; HTML escaping of a hostile name/message.
- **Shared extraction**: existing `render.ts` per-site submission tests still pass unchanged
  (behavior-preserving move).
- **Reorder**: update/extend the cockpit + per-site renderer tests to assert the new section
  order (submissions after tiers/site-details).
- **Handler smoke**: query-param → filter parsing; auth required (401 without creds);
  `TURSO_DATABASE_URL` missing → 500. Add `submissions-page` where the smoke harness enumerates
  functions if applicable.

## Out of scope (YAGNI)

- Bulk triage / multi-select actions, CSV/export, saved filters, server-side full-text index
  (LIKE is fine at current + near-term volume), real-time updates, and any new write endpoint
  (triage reuses the existing one).

## Risks

- **Slug collision in the `site` filter** — `siteSlug(name)` is fleet-unique today; an
  unmatched slug simply yields no `siteId` filter (all sites). Acceptable.
- **`LIKE` performance** — negligible at current scale; the existing `submitted_at` index
  covers the dominant ORDER BY. If volume ever forces it, an FTS table is a later, isolated
  add (out of scope now).
