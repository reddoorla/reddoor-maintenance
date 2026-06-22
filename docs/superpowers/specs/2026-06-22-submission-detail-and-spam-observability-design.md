# Submission detail + spam catch-rate observability — design

**Date:** 2026-06-22
**Status:** approved (pending spec review)

## Problem

The operator wants to "keep a tab on what's happening" with form submissions without reading every
one, and specifically to answer: **"are we getting more spam because we switched forms, or is the
honeypot/timing screen letting more through?"** Two gaps today:

1. **No submission detail.** The per-site dashboard lists submissions but only renders type / name /
   email / status / when + a message snippet and triage buttons. The richer fields already stored on
   `SubmissionRow` (phone, full message, source URL, UTM, per-site extra fields, notify status,
   Resend message ID, submission #) are invisible — you can only triage, not inspect.

2. **Spam catch-rate is unknowable.** The honeypot + timing screen (`screenSubmission`,
   `src/forms/client.ts`) runs **server-side on each fleet site** inside `createIngestAction`
   (`action.ts:65`) and `createIngestEndpoint` (`endpoint.ts:68`). A screened submission is **dropped
   silently at the site** — it never reaches the central ingest or Airtable. So the central system
   records only submissions that (a) passed the screen and (b) were manually marked "spam". The
   _caught_ count — the denominator needed to judge the screen — is lost. "Switching forms" moved the
   fleet off Netlify Forms' filtering onto our honeypot+timing, so a rise in inbox spam could be a
   weaker screen, more exposure, or spammers finding the endpoints — indistinguishable today.

## Decision (user-chosen)

Record screen-outs centrally (full catch-rate), surfaced both per-site and as a cockpit roll-up.
Submission detail expands to **all stored fields**.

---

## Component 1 — Submission detail view

**Scope:** per-site page (`renderSiteDashboardHtml` → `submissionRow`), pure render. No new endpoint.

Each submission becomes an expandable `<details>`:

- **Summary** (always visible): the current one-liner — `formType · name · email · status pill · relative-time`.
- **Body** (on expand): phone; full message (`white-space: pre-wrap`); source URL (linked via
  `safeUrl`); UTM; **extra fields** rendered as a key/value list (parse the stored JSON defensively —
  on parse failure show the raw string); notify status; Resend message ID; submission #.

All values HTML-escaped via the existing `escapeHtml`; URLs via `safeUrl`. The triage buttons
(Read / Archive / Spam) stay where they are. Empty fields are omitted from the body (no blank rows).

**Tests:** expanded body shows each present field; omits absent ones; malformed `extraFields` JSON
falls back to the raw string without throwing; XSS — script/`javascript:` in any field is neutralized.

---

## Component 2 — Spam catch-rate observability

### Data flow

```text
site form submit
  └─ screenSubmission() server-side (action.ts / endpoint.ts)
       ├─ ok    → submitToIngest()  → /api/forms/:slug  → createSubmission (unchanged)
       └─ !ok   → submitScreenOut() → /api/forms/:slug  → recordScreenOut (NEW)
                  (best-effort, no PII; visitor still sees instant success)

operator clicks "Spam" → setSubmissionStatus(→spam) → recordMarkedSpam (NEW)
                          (the *through* signal, bucketed by mark date)
```

### Beacon (site side, ships in the npm package)

- **`src/forms/client.ts`** gains `submitScreenOut({ url, token, reason, fetch })`: a token-authed
  POST to the **same ingest URL** the site already uses, body `{ screenOut: "honeypot" | "too-fast" }`
  and **nothing else** (no name/email/message — it's a bot, and we never beacon PII). Never throws;
  uses an `AbortController` with a short timeout (~1500ms) so it can't hang the response.
- **`src/forms/action.ts`** and **`src/forms/endpoint.ts`**: in the existing `if (!screen.ok)` branch,
  read the ingest config and — when present — `await submitScreenOut(...)` (awaited, not fire-and-
  forget, so it completes before the serverless function returns; all failures swallowed), then
  return success exactly as today. Config missing → just succeed (can't beacon). The bot still gets
  no signal; a borderline-fast human still silently succeeds, now with a sub-1.5s best-effort beacon.
- Propagation: this is a package change, so the fleet picks it up through the normal Renovate
  self-update flow — no manual redeploy sweep. Catch-rate data accrues per site as each updates.

### Central counter (Airtable)

- **New table `Spam Screenouts`** (created field-first), one **compact daily bucket** per (site, day).
  It's the per-site/per-day spam-activity tally — caught at ingest AND marked-through later:
  - `Site` — link to Websites
  - `Date` — `YYYY-MM-DD` (the bucket key)
  - `Honeypot` — number (count caught by the honeypot)
  - `Too-fast` — number (count caught by the timing gate)
  - `Marked spam` — number (count the operator marked "spam" that day; the _through_ signal)
- **`src/reports/airtable/screenouts.ts`** (new):
  - `recordScreenOut(base, siteId, reason, date)` — upsert-increment `Honeypot`/`Too-fast`, mirroring
    `digest-state`'s get-or-create: find the (Site, Date) bucket via `filterByFormula`, increment the
    reason's count, or create the row.
  - `recordMarkedSpam(base, siteId, date)` — upsert-increment `Marked spam` the same way. Called from
    the submission-status flow only on a real transition **to** "spam" (the flow already returns a
    no-op when the status is unchanged, so re-marking the same row doesn't double-count; an operator
    un-marking later doesn't decrement — acceptable for a trend, noted in code).
  - Counts are **approximate under high concurrency** (read-modify-write race) and a create-race can
    produce two same-day buckets — both acceptable because the read side **sums all buckets** for a
    site+date. (If volume ever demands exactness, swap the write path to append-raw + nightly rollup
    without changing the read model.)
  - `listScreenOutsSince(base, sinceDateISO)` — read buckets with `Date >= since`, summed per site →
    `Map<siteId, { honeypot, tooFast, markedSpam }>`. Bounded (~12 rows/day → ~360 rows for 30d), so
    the read is cheap on the dashboard hot path.
  - `mapScreenOutRow` + types; field-name strings live in this one module.
- **Routing the beacon** (`src/forms/ingest.ts`): add `parseScreenOut(payload)` →
  `"honeypot" | "too-fast" | null`, and `ingestScreenOut(deps, slug, payload)` that resolves the site
  and calls `deps.recordScreenOut`. The Netlify handler (`form-ingest.mts`) checks for a `screenOut`
  body **first** and routes to `ingestScreenOut`; otherwise the normal `ingestSubmission` path runs
  unchanged (a screen-out body never reaches `normalizeSubmission`). Token + per-IP rate limit (already
  on the function) gate it.

### The view

- **Per-site panel** (`/s/:slug`, `spamScreenSection`): a "Spam screen (30d)" block showing
  **caught honeypot**, **caught too-fast**, **marked spam** (all from the buckets for this site), and
  **delivered** (counted from the submissions already loaded for the page, within the 30d window; if a
  site exceeds the 200-row fetch in 30d the delivered count undercounts, noted in code). This answers
  the honeypot question per site: rising _caught_ with steady _through_ = screen working harder;
  rising _through_ = screen leaking.
- **Cockpit roll-up** (`/`, one line): fleet **caught** (honeypot + too-fast) and **through**
  (marked spam) totals over 30d, both summed from the buckets only — cheap, no extra submissions scan.
  At-a-glance fleet signal; drill into a site for the per-site breakdown.

### Data sources on each page (read cost)

- `site-dashboard.mts` already loads the site + its submissions; add one `listScreenOutsSince` read.
- `fleet-homepage.mts` already loads websites/reports/new-submissions; add one `listScreenOutsSince`
  read, defensive (a failure leaves the roll-up absent, never blanks the cockpit — same pattern as
  the existing `try`-wrapped reports/submissions reads).

---

## Error handling

- Beacon: never throws; timeout-bounded; failure swallowed (lead/visitor unaffected, bot gets nothing).
- `recordScreenOut`: a write failure in the handler is caught and returns `{ ok: true }` anyway — a
  missed count must never turn a screened bot into an error or a retry storm.
- `listScreenOutsSince`: a read failure on a dashboard page is caught; the spam panel/roll-up is simply
  absent (degrade, don't crash) — mirrors the existing defensive reads.
- All Airtable access goes through the throttled `openBase` (the per-base rate-limit guard already in
  place), so the added beacon writes and window reads stay under the cap.

## Testing

- `submitScreenOut`: posts the right body/headers; returns `{ok:false}` (never throws) on network
  error / timeout / non-2xx.
- `action.ts` / `endpoint.ts`: on screen-out, the beacon is invoked with the right reason and success
  is still returned; config-missing → no beacon, still succeeds; on screen-OK the beacon is not called.
- `parseScreenOut` / `ingestScreenOut`: valid reasons routed; bad/absent reason → not a screen-out;
  unknown site handled.
- `recordScreenOut` / `recordMarkedSpam`: create a bucket when none; increment the right field when one
  exists; the read `listScreenOutsSince` sums duplicate same-day buckets and windows by date.
- Submission-status flow: marking new→spam calls `recordMarkedSpam`; an unchanged (already-spam) mark
  is a no-op and does NOT increment.
- Render: per-site panel shows caught honeypot / too-fast / marked-spam / delivered; cockpit roll-up
  shows fleet caught + through totals; both absent when there's no data; numbers escaped.

## Phasing (for the plan)

1. **Submission detail view** — independent, immediate value, no infra.
2. **Screen-out counter + beacon + views** — new table (field-first), `screenouts.ts`, beacon in the
   helpers, handler routing, per-site panel + cockpit roll-up.

## Non-goals (YAGNI)

- No per-event raw screen-out log / nightly rollup (daily-bucket upsert is enough for a trend; revisit
  only if volume demands exact counts).
- No change to the screen thresholds or the silent-drop UX (the visitor still sees success).
- No charts/sparklines — plain numbers over a 30d window.
- No manual screen-out entry or backfill (data starts accruing when sites update to the new helper).
