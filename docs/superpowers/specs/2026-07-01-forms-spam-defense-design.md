# Forms spam defense — heuristic classifier + Cloudflare Turnstile

**Date:** 2026-07-01
**Status:** Design approved; ready for implementation plan
**Author:** Tucker + Claude (brainstorming)

## Problem

Since the fleet moved off Netlify Forms to the central token-gated ingest
(`./forms` → `netlify/functions/form-ingest.mts` → libSQL `Submissions`), more
spam reaches operators than before — a trickle, not a flood, but noticeably more
than Netlify Forms let through.

**Root cause:** Netlify Forms ran **Akismet** content/reputation spam filtering
server-side on every submission. The migration replaced it with only two
heuristics — a honeypot (`bot-field`) and a "too-fast" timing gate
(`MIN_FILL_MS = 800`, form-action path only; the JSON endpoint path is
honeypot-only). There is **no content-based scoring, no CAPTCHA, and no
effective rate limiting** anywhere in the pipeline (`form-ingest.mts`'s
`aggregateBy: ["ip"]` limit keys on the _fleet site's Netlify egress_, not the
visitor, so it does nothing against form spam). The spam getting through is
exactly what honeypot + timing can't catch and Akismet used to eat: bots that
parse the form, leave the honeypot empty, and post plausible content in the real
fields.

Akismet's free tier is **non-commercial only**, so it is not an option for a
fleet of client sites. The two free replacements we will build are complementary
and layered.

## Goals

- Restore Akismet-equivalent spam suppression using **free** tooling suitable
  for commercial use.
- Keep the pipeline's hard invariants intact: **never 502 an accepted lead**,
  **bots get no signal**, **false positives are recoverable**, **no PII leaks**.
- Ship the central layer **dark and immediately useful** — it must bite the
  current trickle with zero per-site changes.
- Make Turnstile the forward-going default by baking it into `reddoor-starter`.

## Non-goals

- Paid spam APIs (Akismet, CleanTalk, etc.).
- Replacing the existing honeypot/too-fast screen — it stays exactly as-is as a
  free, secretless, network-free site-side pre-filter (a distinct tier).
- Real per-visitor rate limiting (a possible later use of the transiently-seen
  IP; out of scope here).
- Editing `reddoor-starter` in this repo (separate repo; changes are specified
  but implemented there).

## Approved decisions

1. **Data model:** distinct auto-spam status **plus** `spam_score` + `spam_reason`
   columns now. Full auto-vs-manual separation, visible reasons, a tunable
   threshold, and the "Marked spam" metric stays honest (`#336`).
2. **Review surface:** auto-spam is **hidden from the per-site strip**; reviewed
   via the `/submissions` status filter + a cockpit "N auto-filtered this week —
   review" affordance + a "Not spam → new" recovery button.
3. **Turnstile policy:** a failed challenge is a **strong signal into the score**;
   an absent token is neutral; errors/unset-secret fail open. An **opt-in
   per-site `requireTurnstile`** hard-flags on an actual failure.
4. **IP/UA:** used **transiently** (Turnstile `remoteip` + scoring), never
   persisted. Turnstile token never persisted.

## Architecture

Two new tiers on top of the unchanged honeypot/timing screen:

- **Tier A — Cloudflare Turnstile (edge, per-site).** A widget in the site's
  form component; the site ships a _public_ sitekey and forwards the widget token
  (plus visitor IP/UA) to central ingest. Free, unlimited, commercial-OK.
- **Tier B — heuristic classifier (central).** A pure scoring function in the
  ingest path folds content signals **and** the Turnstile verdict into a
  `spam_score`; `score ≥ SPAM_THRESHOLD → spam_auto`.

Both fail open. Both feed **one** decision computed in `ingestSubmission`.

### Data flow

```
visitor submits
  → site form action/endpoint: honeypot + timing screen  (UNCHANGED, site-side)
  → build payload; auto-thread { turnstileToken, clientIp, userAgent } into _meta
  → POST (token-gated) to central /api/forms/:slug
  → form-ingest.mts: verify Turnstile (fail-open) → "pass" | "fail" | "unverifiable"
  → classifySpam(content fields, turnstileOutcome) → { score, reasons }
  → ingestSubmission: compute { status, spamScore, spamReason }
       (requireTurnstile site + "fail" → force spam_auto)
  → createSubmission: store row (status = 'new' | 'spam_auto', + score + reason)
  → if spam: notify suppressed (both emails), newsletter fan-out suppressed
  → always return { ok: true }   (no signal to bot; lead persisted)
  → operator reviews auto-spam in /submissions; "Not spam → new" recovers it
```

## Components

### `src/forms/turnstile.ts` (NEW — central-only, NOT exported from `index.ts`)

```ts
export type TurnstileOutcome = "pass" | "fail" | "unverifiable";
export async function verifyTurnstile(opts: {
  secret: string | undefined;
  token: string | null | undefined;
  remoteip?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number; // default ~2000
}): Promise<TurnstileOutcome>;
```

- Calls `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- **Never throws.** Network error / timeout / unset secret / malformed response
  → `"unverifiable"` (distinct from `"fail"`), so the caller fails open.
- Absent/blank token → `"unverifiable"` (an old cached page or JS-off visitor is
  not penalized).
- A definite negative verdict from Cloudflare → `"fail"`.

### `src/forms/spam-classifier.ts` (NEW — pure leaf module, no server SDK imports)

```ts
export const SPAM_THRESHOLD = 100;
export type SpamVerdict = { score: number; reasons: string[] };
export function classifySpam(input: {
  name: string;
  email: string;
  message?: string;
  formType: FormType;
  extraFields: Record<string, unknown>;
  turnstile: TurnstileOutcome;
}): SpamVerdict;
```

Starting signal table (integer points; **tunable** from the `spam_score` /
`spam_reason` data we now collect — these are a defensible v1, not final):

| Signal                                                      | Points     | Reason string      |
| ----------------------------------------------------------- | ---------- | ------------------ |
| Turnstile `"fail"`                                          | 70         | `turnstile-fail`   |
| Each URL in message (`http(s)://`, `www.`)                  | 30, cap 90 | `links:N`          |
| HTML/BBCode link markup (`<a href`, `[url=`)                | 40         | `link-markup`      |
| Each spam keyword hit (maintained list)                     | 25, cap 75 | `keywords:N`       |
| Non-Latin script > 30% of message or name                   | 50         | `non-latin`        |
| Disposable-email domain (maintained list)                   | 45         | `disposable-email` |
| URL present in the name field                               | 45         | `url-in-name`      |
| Degenerate content (message == name, or body is just a URL) | 40         | `degenerate`       |
| All-caps shout (len > 20 and > 70% uppercase)               | 15         | `all-caps`         |

- Turnstile `"pass"` / `"unverifiable"` / absent contribute **0**.
- `score ≥ SPAM_THRESHOLD (100)` → classified spam. So Turnstile-fail alone
  (70) is not decisive but tips borderline content over (e.g. `fail` + one link
  = 100 → spam); two links + one keyword (60 + 25 = 85) stays under; two links +
  link-markup (60 + 40 = 100) or three links (90) + any second signal crosses
  it. Three bare links alone (90) deliberately does **not** trip on its own — a
  legitimate message can carry a couple of links.
- **`non-latin` is the most false-positive-prone signal** (a client may get
  legitimate non-English inquiries). It is weight-50 = advisory-only (never
  decisive alone) by design, and can be made per-site-disable-able later.
- Keyword and disposable-domain lists live as maintained constants in the module.

### Ingest decision (`src/forms/ingest.ts`, `src/forms/notify.ts`)

- `ingestSubmission` gains an optional injected dep so the classifier stays
  testable and the module stays transport-agnostic:
  ```ts
  classifySpam?: (n: NormalizedSubmission, turnstile: TurnstileOutcome) => SpamVerdict;
  ```
  (Defaulted in the composition root; defaulted to a "not spam" stub in tests.)
- After site resolution: compute `verdict`; derive
  `status = verdict.score >= SPAM_THRESHOLD ? 'spam_auto' : 'new'`. If the site
  has `requireTurnstile` **and** `turnstile === 'fail'`, force
  `status = 'spam_auto'` and append reason `turnstile-required-failed`
  regardless of score.
- Thread `status`, `spamScore` (the numeric score), `spamReason`
  (`reasons.join(',')` or null) into `createSubmission`.
- **Notify suppression** lives in `notify.ts`: `buildPocNotification` **and**
  `buildAutoresponder` return `null` when `submission.status === 'spam_auto'`
  (or `'spam'`). This reuses the existing "no recipients → `notifyStatus =
'skipped'`" path — no new `NotifyStatus`, no new branch in ingest — and
  suppresses **both** the operator email and the submitter auto-responder at
  once. Ingest still calls `stampNotified(id, 'skipped', null)` so the row
  honestly records that no email was sent.
- **Newsletter fan-out** (`ingest.ts` webhook + Mailchimp block) gets a
  `row.status !== 'spam_auto' && row.status !== 'spam'` guard so a spam signup is
  never forwarded to a site webhook or added to a Mailchimp audience.
- Response is always `{ ok: true }` for an accepted (even spam) submission — no
  signal to the sender.

### DB layer

- **Migrations** (append-only; each `ALTER ADD COLUMN` is its **own** single-
  statement migration because SQLite `ADD COLUMN` has no `IF NOT EXISTS` and the
  runner's `executeMultiple` is non-transactional — a single statement has no
  mid-script failure window):
  - `0003_add_spam_score`: `ALTER TABLE submissions ADD COLUMN spam_score REAL;`
  - `0004_add_spam_reason`: `ALTER TABLE submissions ADD COLUMN spam_reason TEXT;`
- New status value `spam_auto` added to `SUBMISSION_STATUSES` and handled by
  `toStatus`. The `status` column is unconstrained `TEXT`, so no constraint
  migration is needed.
- `schema.ts` `SubmissionsTable` gains `spam_score: number | null` and
  `spam_reason: string | null` in lockstep.
- `submission-row.ts`: `SubmissionRow` gains `spamScore?: number | null` and
  `spamReason?: string | null`; `SubmissionInput` gains optional `status?`,
  `spamScore?`, `spamReason?`. Read-side coercion for `spam_score` mirrors the
  existing enum/number defensive validators.
- `db/submissions.ts`: `createSubmission` stops hard-coding `status: 'new'` →
  `input.status ?? 'new'`, and writes `spam_score` / `spam_reason`. `rowFromDb`,
  `backfillSubmission`, and the `makeSubmissionRow` test factory updated.
- `tests/db/migrate.test.ts` hard-coded id list becomes
  `['0001_init','0002_fleet_events','0003_add_spam_score','0004_add_spam_reason']`.
- **No screen-out counter change.** The dashboard "Marked spam" total is a
  derived `COUNT(*) WHERE status = 'spam'` (per `#336`); `spam_auto` is a
  **separate** status, so operator-marked spam metrics are untouched. Auto-spam
  is counted separately where surfaced (see Dashboard).

### Wire format (`src/forms/payload.ts`, `src/forms/client.ts`)

- The site forwards a reserved envelope:
  ```ts
  payload._meta = { turnstileToken?: string; clientIp?: string; userAgent?: string };
  ```
- `normalizeSubmission` **strips `_meta` wholesale** before the "unknown keys →
  `extraFields`" merge, so the token/IP/UA can never leak into stored lead data
  or the operator email fields table. A test asserts `_meta` and its contents
  never appear in `extraFields`.
- IP/UA are read from `_meta` transiently at the handler (for `remoteip` +
  scoring) and **never persisted**. Turnstile token never persisted.
- `SubmissionPayload` (both copies — `client.ts` and `payload.ts` — kept in
  sync) documents the optional `_meta` field.

### Site factories (`src/forms/action.ts`, `src/forms/endpoint.ts`, `index.ts`)

- `CreateIngestActionOptions` / `CreateIngestEndpointOptions` gain a single new
  option: `turnstileFieldName?: string` (default `cf-turnstile-response` —
  Cloudflare's widget default).
- `requireTurnstile` is **not** a factory option — it is an authoritative
  per-site Airtable flag read by the central handler (see Per-site config). The
  site only ever forwards the raw token; the escalation decision is made once,
  centrally.
- Both factories auto-thread `_meta` = `{ turnstileToken: <field>, clientIp:
event.getClientAddress(), userAgent: <request UA header> }` into the forwarded
  payload, so per-site `buildPayload` implementations need no change.
- The honeypot/timing `screenSubmission` call is **unchanged** and stays a
  separate tier (a filled honeypot is still silently dropped site-side and never
  reaches central).

### Central handler (`netlify/functions/form-ingest.mts`)

- Reads `TURNSTILE_SECRET_KEY` from env (shared across the free-plan widget
  group — see Config).
- Pulls the forwarded `_meta`; calls `verifyTurnstile({ secret, token, remoteip
})`; passes the outcome into the `classifySpam` dep and the `requireTurnstile`
  decision (per-site flag from the resolved `WebsiteRow`).
- Everything fails open: unset secret → log once + `"unverifiable"` → proceed.

### Per-site config (`src/reports/airtable/websites.ts`)

- New Airtable **Websites** column `Require Turnstile` (boolean) → `WebsiteRow.requireTurnstile`,
  mapped with the `typeof === "boolean"` guard (like `crossbrowserOk`). **Ships
  dark**: mapping tolerates absence (`?? false`), so nothing breaks until the
  column exists.
- **Secret lives in ENV**, not Airtable — free-plan grouping shares one secret
  across ~10 sites, so it does not vary per site (unlike Mailchimp keys). Sourced
  via `process.env.TURNSTILE_SECRET_KEY`, mirroring `FORMS_INGEST_TOKEN` /
  `RESEND_API_KEY`. Add to the CLI `credentials.env` only if a local path needs
  to verify.
- Public sitekey lives in each **site's** env (`PUBLIC_TURNSTILE_SITE_KEY`),
  rendered into the widget HTML.

### Dashboard (`src/dashboard/*`)

- `spam_auto` **excluded** from the per-site `submissionsSection` strip (so it
  never crowds the 25-row real-lead window), but **included** in the
  `/submissions` status filter (`SUBMISSION_STATUSES` drives `filterForm`;
  `isStatus`/`asStatus`/`applySubmissionFilter` all read the same array).
- New `.pill.subm-spam_auto` CSS in `submission-view.ts` (a new status renders
  unstyled without it).
- `renderSubmissionRow` (shared by the strip and `/submissions`) shows a
  provenance badge from `spamScore`/`spamReason` (mirroring the existing "auto ✓"
  checklist badge), and a **"Not spam → new"** button that reuses the idempotent
  `setSubmissionStatus` endpoint. Un-marking drops the row out of any auto-spam
  count with no counter to fix.
- Cockpit gains a low-severity **"N auto-filtered this week — review"** affordance
  (a `COUNT(*) WHERE status = 'spam_auto' AND submitted_at >= since`, windowed
  like the other spam totals) linking to `/submissions` filtered to `spam_auto`.
  The Needs-you feed is already insulated (submissions never enter it;
  `listNewSubmissions` is `status = 'new'`), so no suppression work is needed
  there.

### Starter (`reddoor-starter` — SEPARATE repo, specified here, implemented there)

- Add the Cloudflare Turnstile widget markup + `api.js` script to the form
  component; add `PUBLIC_TURNSTILE_SITE_KEY` to env / `.env.example`.
- For the JSON/endpoint path, client JS reads the widget token and includes it in
  the POST body under the agreed field name.
- Allowlist `challenges.cloudflare.com` in the site CSP.
- Bump `@reddoorla/maintenance` to the version exposing the new factory options;
  optionally pass `turnstileFieldName`.
- **No secret needed** — central verification is the payoff.

## Invariants (must all hold)

- **Never 502 an accepted lead.** Turnstile/classifier failures fail open to
  `status = 'new'`. The verify call has a timeout and never throws.
- **Bots get no signal.** Spam still returns `{ ok: true }`.
- **False positives recoverable.** Auto-spam is a stored, reviewable row; "Not
  spam → new" restores it; derived counts self-correct.
- **No PII leak.** IP/UA transient; token never stored; `_meta` stripped from
  `extraFields` (asserted by test).
- **`requireTurnstile` only escalates an actual `"fail"`**, never an absent
  token or an `"unverifiable"` error.
- **Operator-marked spam metric unchanged** — `spam_auto` is a distinct status.

## Rollout

1. Ship the **central classifier** first — it works with zero site changes and
   bites the current trickle immediately (Turnstile outcome is simply
   `"unverifiable"` until sites carry a token).
2. Add `TURNSTILE_SECRET_KEY` to the dashboard's Netlify env; create the free
   Turnstile widget (one widget covers 10 hostnames — enough for the first ~10
   sites).
3. Add the `Require Turnstile` Airtable column (dark-tolerant).
4. Roll Turnstile into `reddoor-starter`; migrate sites incrementally, each
   adding `PUBLIC_TURNSTILE_SITE_KEY`. Add more widgets / a group-pointer column
   as the fleet approaches the 20-widget × 10-hostname (200-hostname) free
   ceiling; note apex+`www` counts as two hostnames.

## Testing (TDD)

- **`spam-classifier.ts`** — pure unit tests: each signal fires its reason at the
  right weight; caps hold; boundary cases straddling `SPAM_THRESHOLD`;
  `expect(SPAM_THRESHOLD).toBe(100)`; Turnstile `pass`/`unverifiable`/absent
  contribute 0.
- **`turnstile.ts`** — injected `fetch`: `pass` / `fail` / network-error /
  timeout / unset-secret / absent-token / malformed-body → correct outcome and
  **never throws**; `"unverifiable"` distinct from `"fail"`.
- **`ingest.ts`** — via the `deps(over)` factory: a spam verdict →
  `createSubmission` called with `status: 'spam_auto'` + score + reason,
  `notify` **not** called, `stampNotified(id, 'skipped', null)`, newsletter
  fan-out **not** called; a clean verdict → normal path; a `requireTurnstile`
  site with `turnstile: 'fail'` → forced `spam_auto` even at score 0.
- **`notify.ts`** — `status: 'spam_auto'` → both builders return `null` →
  `notifyStatus 'skipped'`.
- **Wire** — `_meta` (and token/IP/UA) never appear in `extraFields` or the
  operator email fields.
- **DB** — in-memory libSQL (`openDb({ url: ':memory:' })`): migration round-trips
  `spam_score`/`spam_reason`; `createSubmission` honors `input.status`; updated
  `migrate.test.ts` id list.
- **Factories** — fake-event + `vi.fn()` harness: `_meta` auto-threaded with
  token/IP/UA; existing honeypot screen-out behavior unchanged.
- **Coverage floor** (S78 / B67 / F76 / L80): new modules are small and pure —
  keep them well covered; raise the floor if coverage climbs.

## Operator prerequisites (before activation)

- Create Turnstile widget(s) in a Cloudflare account; set `TURNSTILE_SECRET_KEY`
  (dashboard env) and `PUBLIC_TURNSTILE_SITE_KEY` (per site).
- Add the `Require Turnstile` boolean column to the Airtable **Websites** table
  (exact casing) — code degrades to `false` silently until then.

```

```
