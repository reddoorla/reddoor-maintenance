# Morning brief — 2026-06-02

> Written evening of 2026-06-01 via the `evening-review` skill. Repo at `0da6913` on `main`, published `0.18.1`. Scope: whole repo, threshold LOW+, plus a requested strategic pass on the report email as a client-facing product. Read-only run.

## Executive summary

Big day on the pipeline: GA Data API unblocked via domain-wide delegation, the header image fixed twice (resize/placeholder, then a squish regression), and GA auto-population shipped and verified live (ERP → 679/549). All three merged; `0.18.1` is published and a `0.19.0` version-PR is pending (the GA changeset).

The review is **anti-recency on purpose**: the highest-value finding tonight is **not** in today's diff — it's a pre-existing XML-escaping gap (was M5 on 2026-05-29, never fixed) that **today's header `alt`/`href` work quietly widened**, and which the fleet-onboarding push makes newly likely to fire. No CRITICAL findings; secrets hygiene is clean (`secrets/`, `.env`, `.claude/` all gitignored; nothing credential-bearing is tracked).

Separately: the report email is structurally healthy but is **under-using the data the maintenance pipeline already collects**. The single biggest "better serve clients" lever — now that GA is real — is turning two raw numbers into a trend, and surfacing actual audit results instead of static checkmarks. See the strategic section.

## Top of stack (do these first)

1. **Escape user/site strings before MJML render (H1, ~20 min).** A client named with an `&` (e.g. "Brown & Co"), or a `"`/`<` in a URL or commentary, will malform or break the strict MJML render — i.e. a send that fails on a single character. Today's `alt="${siteName} …"` addition made this hotter. Add one `escapeXml` helper, apply at the 4 interpolation points, add a test with `&`/`<`/`"`. Do this before onboarding more sites.
2. **Add the GA "vs last period" trend to the email (~30 min, high client value).** You already fetch current + previous (679 / 549). Showing just two numbers undersells it; a `▲ 24% vs last period` is the cheapest, highest-impact upgrade to the client experience and it's pure presentation of data you already have. Strategic #1 below.
3. **Decide the GA impersonation identity before fleet reliance (~5 min decision).** Live config now impersonates `tucker@reddoorla.com`. That's fine for ERP today, but the whole fleet's analytics will ride one personal identity — if your GA access changes, every report's analytics silently soft-fails to blank. Consider a role account (e.g. `reports@`) with GA access. Decision, not code.

## Strategic — the report email as a client-facing product

You asked me to think about the email in the context of the broader maintenance pipeline. The throughline: **the pipeline already collects far more than the email shows.** The `Websites` row carries a11y violations, deps drift, and security vuln counts (written by `audit --write-airtable`), and now real GA numbers — yet the email shows static checkmarks and two bare figures. Ranked by value-to-effort:

1. **GA trend, not just two numbers** _(highest leverage, ~30 min)._ [template.ts:160-167](src/reports/maintenance-email/template.ts#L160-L167) renders "679 Users / Last Period: 549". Compute the delta and show direction + percentage (`▲ 24%`, green up / muted down). Zero new data. This is the payoff moment for today's GA work — make it land.
2. **Surface real audit findings instead of static checkmarks** _(biggest product win, ~half day)._ The 6 "Maintenance Checks" ([template.ts:24-48](src/reports/maintenance-email/template.ts#L24-L48)) are always all-green regardless of what ran — reassurance theater. Meanwhile `WebsiteRow` has `securityVulnsCritical/High/...`, `depsDrifted`, `a11yViolations` ([websites.ts:40-49](src/reports/airtable/websites.ts#L40-L49)). Turn one checkmark row into evidence: "Security — 0 critical vulnerabilities, 2 dependency updates applied." This is exactly the "tie the email to the broader pipeline" idea, and it's the difference between a client feeling reassured vs. _informed_.
3. **Link to the live per-site dashboard** _(~1 hr, strong funnel)._ You built `/s/<slug>?t=<token>` (dashboardToken is on the row). The email is a monthly snapshot; the dashboard is live. A "View your live dashboard →" button gives clients self-serve access between reports and showcases the dashboard investment. Connects two things you've already built.
4. **Lighthouse trend + warmer framing** _(~30 min, nice-to-have)._ Same trend treatment as GA, using the prior Reports row's scores (already fetched in `derivePeriodStart`). And the clinical "Acceptable 50–89 // Ideal 90–100" captions ([template.ts:144](src/reports/maintenance-email/template.ts#L144)) could be reframed around what you did, not just the rubric.
5. **Subject line with the period** _(~5 min)._ `"{site} Maintenance Report"` → `"{site} — May 2026 Maintenance Report"` for inbox scannability and archival ([orchestrate.ts:81](src/reports/send/orchestrate.ts#L81)).

If you do only one: #1. If you do two: #1 + #2 — together they convert the email from "we did stuff" to "here's measurable proof, trending."

## Findings — CRITICAL

None. (Secret hygiene verified clean; no tracked credentials.)

## Findings — HIGH

### H1 — Unescaped site/user strings break the strict MJML render (pre-existing M5, widened today)

- **What:** `siteName`, `siteUrl`, and `commentary` interpolate into MJML markup without XML-escaping. A stray `&`, `<`, or `"` (e.g. a client named "Brown & Co", or a quote in a URL/commentary) malforms or fails the `validationLevel: "strict"` render at send time.
- **Where:** [template.ts:118](src/reports/maintenance-email/template.ts#L118) (`alt="${siteName}…"` — **added today**), [template.ts:127/129](src/reports/maintenance-email/template.ts#L127-L129) (`href="${siteUrl}"`), [template.ts:142](src/reports/maintenance-email/template.ts#L142) (preview text), [template.ts:105](src/reports/maintenance-email/template.ts#L105) (commentary).
- **Why it matters:** It's a send-blocker triggered by data you don't control (client names/URLs). Was flagged MEDIUM on 2026-05-29 and never fixed; today's `alt` addition added a 4th interpolation point, and the fleet-onboarding push multiplies the odds a real client name contains a special char.
- **Fix sketch:** A ~6-line `escapeXml(s)` (`& < > " '` → entities) applied at the four points; test with a name containing `&` and `<`. Note `headerBgColor` (hex from sharp) and the numeric `aspect-ratio` are safe — only the string fields need it.

## Findings — MEDIUM

### M2 — Resend webhook 500-retries indefinitely on truly-orphan events _(carried from 2026-05-29, still open)_

- **Where:** [netlify/functions/resend-webhook.mts](netlify/functions/resend-webhook.mts) (orphan-event 500 path).
- **Why:** Returning 500 when a message ID has no matching row is correct for the stamp-race window (minutes) but turns a legitimately-orphaned event (old test send, deleted row) into ~24h of svix retry churn. Tonight's two extra ERP test sends are exactly the kind of rows that, if deleted, would orphan.
- **Fix:** Gate 500-vs-200 on `event.data.created_at` age — 500 within ~5 min, 200 ("orphan acknowledged") after.

### M3 — Per-audit `--write-airtable` does sequential single-record updates; rate-caps at fleet scale _(carried, still open)_

- **Where:** [src/audits/write-audits-to-airtable.ts](src/audits/write-audits-to-airtable.ts), [src/reports/airtable/websites.ts](src/reports/airtable/websites.ts).
- **Why:** Fine at N=1. At N=30 × 4 sequential updates = 120+ calls against Airtable's 5 req/sec cap, no 429 retry. Becomes real as the fleet-onboarding push adds sites.
- **Fix:** Merge to one `update()` per site; optional `p-limit`. Falls out of the deferred per-site fleet-write refactor.

### M4 — `STATUS_MAP` still omits `email.delivery_delayed` _(carried, still open)_

- **Where:** [src/reports/webhook-events.ts:8-12](src/reports/webhook-events.ts#L8-L12) (confirmed: only delivered/bounced/complained).
- **Why:** Resend emits `email.delivery_delayed` for transient deferrals; currently dropped, so the operator can't see a delayed delivery when triaging. Deliverability visibility matters more as volume grows.
- **Fix:** Add `"delayed"` to the `DeliveryStatus` union + `STATUS_MAP` + the Airtable single-select.

## Findings — LOW

### L1 — GA soft-fail shows "0 Users" in the review HTML while the Airtable field is blank

- **Where:** [src/reports/draft.ts](src/reports/draft.ts) — `gaUsers?.current ?? 0` renders 0 in the uploaded review HTML, but on a GA error the Airtable field is left unwritten (blank).
- **Why:** Reviewing the HTML attachment, the operator can't tell "GA reported 0" from "GA failed — fill me in." No regression (pre-GA always showed 0), but now that GA usually works, a silent 0 is misleading. Consider rendering "—" / "n/a" when GA was skipped, distinct from a real 0.

### L2 — 23 stale remote branches _(carried, grown)_

- All merged-via-squash (verified `ga-spike-followup`'s lone commit is the pre-squash of #45, already in main — no orphaned work). Today's three (`feat/header-image-resize-placeholder`, `fix/header-image-squish`, `feat/ga-auto-populate-draft`) are now merged too. `git push origin --delete <branch>` sweep, ~10 min.

### L3 — `pnpm audit` exits 1 on the accepted mjml-chain advisories

- 2 advisories remain (html-minifier REDoS high, mjml mj-include moderate), both in the `mjml` chain, no upstream patch, trusted server-side input. The 2026-05-29 decision to add a `pnpm audit` ignore or `SECURITY.md` note was never acted on, so `audit` still exits 1 (noise; would fail if audit ever enters CI).

## Open loops carried forward (graded vs 2026-05-29)

- ✅ **H1 (fleet + `--write-airtable` refuse)** — DONE, #84.
- ✅ **M1 (`daysAgo` UTC)** — DONE, #84.
- ✅ **`tmp` advisory bump** — DONE via deps overrides, #84 (audit confirms `tmp` gone).
- ⏳ **M5 → now H1 (XML escape)** — STILL OPEN, promoted to HIGH (widened by today's header work).
- ⏳ **M2 / M3 / M4** — all STILL OPEN (no webhook/audit-write work since 05-29).
- ⏳ **Real monthly cycle dogfooding** — PROGRESSED: live ERP sends today (header + real GA), GA now unblocked and wired. Full fleet monthly cycle still pending — but a major 1.0 criterion ("GA before 1.0") just landed.
- ⏳ **Stale remote branches** — STILL OPEN, grown 6 → 23.
- ⏳ **mjml advisory ignore / SECURITY.md note** — STILL not acted on (see L3).

## Decisions deferred (made provisional calls, didn't block)

1. **Promoting M5 to HIGH:** I raised it from its 2026-05-29 MEDIUM because today's `alt` addition put it in the freshly-shipped hot path and fleet onboarding raises the odds. If you disagree it can drop back to MEDIUM — but I'd fix it regardless before more sites land.
2. **GA impersonation identity:** live box uses `tucker@reddoorla.com`. Provisional: acceptable for now; switch to a role account before the fleet depends on it (Top of stack #3). Noted in the GA spike memory.
3. **mjml advisory handling:** provisional — add a `pnpm audit` ignore + `SECURITY.md` rationale so `audit` exits 0, OR keep accepting and document. Real fix needs upstream/fork. Unchanged from 05-29.
4. **Audit-airtable abstraction + per-site fleet write:** still deferred (no new demand); collapse together when a multi-site fleet write is actually needed.

## What I did NOT do tonight

Read-only review per the skill. **No commits, PRs, pushes, Airtable writes, Netlify deploys, or sends.** Repo state unchanged at `0da6913`. Local-only, non-mutating: `pnpm test` (549 pass), `pnpm typecheck` (clean), `pnpm lint` (clean), `pnpm audit` (2 accepted advisories), git archaeology. Setup writes done _before_ the all-clear (while you were present): `.claude/settings.local.json` (read-only allowlist), the permission-gate memory, and a skill update — no source files touched.

## Note on the all-clear incident (and the fix)

Tonight I repeated the exact failure the 2026-05-29 brief warned about: I gave an all-clear, then a `Bash` call prompted you. Root cause beyond last time's: my commands were compound (`cd … && …`), which don't match prefix allowlists at all. Hardened: the permission-set approval is now the **mandatory final gate** of the skill's Phase 1 (written into [SKILL.md](../../.claude/skills/evening-review/SKILL.md) and a [memory](../.claude/...)), the approved allowlist is written to `.claude/settings.local.json`, and Phase 2 uses single bare commands + the `Read` tool. This run completed prompt-free after that fix.
