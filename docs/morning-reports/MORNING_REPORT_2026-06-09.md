# Morning brief — 2026-06-09

**Scope:** reports + email (0.7.0) — the maintenance-report pipeline, Airtable design, Resend send path, GA/Search-Console enrichment, the absorbed reddoor-mailer. **Severity:** MEDIUM+ and LOW/nits. **Mode:** read-only review (no commits/PRs/live writes during the review phase).

**One-line verdict:** This is a **mature, carefully-reasoned feature area** — secret handling is clean and tested, the idempotency design is genuinely well-thought-out, date math is deliberately UTC-everywhere. Nothing critical. The two things actually worth doing before the next fleet-scale push are **webhook hardening** (untested public endpoint + an indefinite-retry bug, same file) and a **subtle GA period off-by-one** that inflates the one client-facing number nobody catches by eye.

---

## Top of stack (do this first)

1. **Harden the Resend webhook (~40 min, one file).** [netlify/functions/resend-webhook.mts](netlify/functions/resend-webhook.mts) is a publicly-reachable, signature-gated endpoint that mutates client-facing delivery state — and its POST path has **zero test coverage** (HIGH-2), while its orphan-event branch **retries forever** (HIGH-1). Fix both together: bound the 500 to a freshness window, then add signed-POST tests. Highest leverage in the area.
2. **Fix the GA period boundary (~30 min).** [src/reports/ga/client.ts:46](src/reports/ga/client.ts#L46) + [src/reports/draft.ts:193](src/reports/draft.ts#L193): make report periods half-open so consecutive monthly reports stop double-counting the boundary day, and pin a test on the exact `startDate`/`endDate` strings. Corrects the headline "Users" number (MEDIUM-1).
3. **Decide the MJML supply-chain posture (~15 min, decision not code).** `pnpm audit` flags 2 **unpatched** vulns in the email-render toolchain (see HIGH/MEDIUM split below). No fix exists upstream. Decide: accept-with-rationale (recommended — our templates are trusted input) or plan a renderer swap. Write the decision down so it stops re-surfacing.

---

## Findings — CRITICAL

**None.** No data-loss, no secret leak. Credentials load only from `~/.config/reddoor-maint/credentials.env` ([src/cli/bin.ts:24](src/cli/bin.ts#L24)), env wins over file, no repo `.env` is read anywhere, and error messages interpolate `messageId`/record IDs/URLs but never API keys. The webhook health check is presence-only with a test asserting values never leak.

## Findings — HIGH

**HIGH-1 — Orphan webhook events retry indefinitely.** [netlify/functions/resend-webhook.mts:89-95](netlify/functions/resend-webhook.mts#L89). Every unmatched `messageId` returns 500 so svix retries. That's correct for the common race (delivery beats the orchestrator's `stampSent` Airtable write), but the code can't distinguish "stamp hasn't run yet → retry" from "genuinely orphan event → retry is futile" (an email sent outside this pipeline from the same Resend domain, or a deleted Reports row). svix then retries for hours/days, polluting function logs/invocations. _Fix:_ bound it by event age — if `svix-timestamp`/`event.created_at` is older than ~10 min, the race has long resolved, so return 200 ("orphan, not retrying"); keep the 500 only inside the freshness window. _(Verified against source tonight.)_

**HIGH-2 — The webhook POST path is effectively untested.** `tests/webhook/resend-webhook.test.ts` covers only the static `STATUS_MAP` and the GET health check. The entire signed-POST path — svix verify, `STATUS_MAP` dispatch, `findReportByMessageId`, the no-match-500 branch, `setDeliveryStatus`, the error branches — has **no** coverage. This is the riskiest untested path in the area: public, signature-gated, mutates client-facing state, and the one surprising behavior (HIGH-1's retry semantics) is exactly what's untested. _Fix:_ construct a valid svix signature (svix ships a signing helper) and assert: mapped→update called, unmatched→500 (or the new bounded behavior), unmapped type→200, missing `email_id`→200.

**HIGH (rated) / MEDIUM (real) — MJML email-render toolchain carries 2 unpatched vulns.** `pnpm audit`: a **high** ReDoS in `html-minifier` (via `mjml > mjml-cli > html-minifier`, [advisory GHSA-pfq8-rq6v-vf5m](https://github.com/advisories/GHSA-pfq8-rq6v-vf5m)) and a **moderate** `mj-include` directory-traversal in `mjml` ([GHSA-45h5-66jx-r2wf](https://github.com/advisories/GHSA-45h5-66jx-r2wf)). Both report "Patched versions: <0.0.0" — **no upstream fix exists**. _Real-world exploitability here is low:_ MJML renders **our own operator/CMS-controlled templates** at draft-time, not attacker-supplied HTML, and `mj-include` paths are static. So the nominal "high" overstates risk in our usage. _Action:_ a decision, not a patch — accept with a written rationale (recommended), or scope a move off MJML. Track it so `pnpm audit` noise doesn't keep re-flagging an accepted risk. This is the only finding the local gate surfaced that isn't already understood.

## Findings — MEDIUM

**MEDIUM-1 — GA period is off-by-one and double-counts the month boundary.** [src/reports/ga/client.ts:46-48](src/reports/ga/client.ts#L46), [src/reports/draft.ts:193](src/reports/draft.ts#L193). GA `runReport` `dateRanges` are **inclusive on both ends**, so a May 1→Jun 1 period counts 32 days, not 31. Worse: `derivePeriodStart` returns the prior report's `periodEnd` as the next `periodStart`, so Jun 1 is counted in **both** the May report (its inclusive `endDate`) and the June report (its inclusive `startDate`). _Why it matters:_ the headline "Users" number is slightly inflated and one boundary day is published twice across consecutive reports — invisible to the eye, indefensible if a client ever reconciles against their own GA. _Note:_ the **% trend stays fair** (current and previous windows are both 32-day inclusive, equal length), so only the absolute count is affected. _Fix:_ half-open periods — `derivePeriodStart` returns `priorPeriodEnd + 1 day`, and compute `lengthDays` as the inclusive count you actually intend; pin a test on the exact `ymd(start)/ymd(end)` strings for a known period. _(Verified against source tonight.)_

**MEDIUM-2 — GA/Search soft-fail is too quiet at fleet scale.** [src/reports/draft.ts:146](src/reports/draft.ts#L146),[177](src/reports/draft.ts#L177). When GA or Search Console errors, draft.ts catches → `console.warn` → null, and the report still drafts with blank numbers. One warn-per-site is invisible in a 200-site `--due` batch where stdout is the `✓ drafted` lines, so a DWD/auth outage silently degrades every report and the operator approves analytics-less reports. _Fix:_ count soft-failures and surface them in the command summary ([src/cli/commands/report.ts](src/cli/commands/report.ts) ~L51-60): e.g. a trailing "⚠ 3 sites had GA/Search skipped" so a fleet-wide outage is obvious at a glance.

**MEDIUM-3 — Sequential single-record Airtable writes risk the 5/sec cap.** [src/audits/write-audits-to-airtable.ts:63-85](src/audits/write-audits-to-airtable.ts#L63), [src/cli/commands/report.ts:43-46](src/cli/commands/report.ts#L43). Up to 4 sequential `update()` calls per site, plus per-site `listReportsForSite` loops. The SDK auto-retries 429 so it's correctness-safe, just slow/fragile as the fleet grows. _Fix (when it bites):_ the 4 per-audit writes all target the same `target.id` → collapse to one multi-field `update`; Airtable `update()` also takes up to 10 records/call. Low urgency below a few dozen sites.

**MEDIUM-4 — A `0` search position would render "#0" in the sent email.** [src/reports/search/client.ts:118](src/reports/search/client.ts#L118) does `Math.round(pos)`; if Search Console ever returns a sub-1 averaged position, it rounds to 0 and the template renders "Page 1 Google Result (#0)" ([src/reports/maintenance-email/template.ts:69](src/reports/maintenance-email/template.ts#L69)). Cosmetic but client-facing. _Fix:_ `Math.max(1, Math.round(pos))`.

**MEDIUM-5 (test hygiene) — one test takes 124 seconds and owns the whole suite.** `tests/audits/run-audits.test.ts > "runs all audits when which is undefined"` ran **124,036 ms** — the full 624-test suite is 125 s, so this single test _is_ the suite. It's almost certainly executing real audits (playwright/dev-server spawn) instead of stubbing `which`. _Fix:_ mock the spawn/`which` resolution so it asserts orchestration without booting real audits; reclaims ~2 min per `pnpm test`. (All 624 tests pass; typecheck clean.)

## Findings — LOW / nits

- **LOW-1 — `delivery_delayed` is intentionally dropped, but unmarked.** [src/reports/webhook-events.ts:8-12](src/reports/webhook-events.ts#L8) `STATUS_MAP` omits Resend's `email.delivery_delayed` and the `DeliveryStatus` union has no `"delayed"`. This is _correct by design_ (delayed is non-terminal; a delivered/bounced follows) and a test asserts it's unmapped — but it's been re-flagged by three prior passes. Add a one-line comment "delayed intentionally omitted (non-terminal)" so it stops re-surfacing.
- **LOW-2 — `findReportByMessageId` has no uniqueness guarantee.** [src/reports/airtable/reports.ts:222](src/reports/airtable/reports.ts#L222) uses `maxRecords: 1` with no ordering; if two rows ever shared a Resend message ID the webhook updates an arbitrary one. Unlikely (idempotency key makes dup IDs improbable), hence LOW.
- **LOW-3 — Airtable column names are load-bearing magic strings.** [src/reports/airtable/websites.ts:84](src/reports/airtable/websites.ts#L84) reads `"maintenence freq"` (sic) and mixed-case `"GA4 property ID"` vs lowercase `"url"`. They match the (inconsistent) live schema so they work, but any column rename silently returns null → GA skipped / recipients empty, with no error. A schema-contract test or a documented column-name block would catch it.
- **LOW-4 — Inline-attachment shape repeats 3×.** [src/reports/send/orchestrate.ts:147-168](src/reports/send/orchestrate.ts#L147): header + two bundled images each repeat the `{filename, content: base64, contentType, inlineContentId}` block. Extract `toInlineAttachment({bytes, filename, contentType, cid})`.
- **LOW-5 — Opaque "no Lighthouse scores" error.** [src/reports/send/orchestrate.ts:80](src/reports/send/orchestrate.ts#L80): one non-numeric Lighthouse cell nulls all four and throws a generic error. Name the offending cell to save debugging.
- **LOW-6 — Copyright year uses local TZ.** [src/reports/maintenance-email/template.ts:253](src/reports/maintenance-email/template.ts#L253) `new Date().getFullYear()` is local while the whole file is UTC-everywhere; wrong only in the Dec 31/Jan 1 boundary hours. Use `getUTCFullYear()` for consistency.
- **LOW-7 — Malformed-recipient error doesn't name the cause.** [src/reports/send/orchestrate.ts:125](src/reports/send/orchestrate.ts#L125): the guard correctly rejects `Display Name <email>` syntax, but the "recipient is malformed" message won't tell the operator _why_. Mention "bare address only — no `Name <...>`".
- **LOW-8 — No dead code / abandoned-approach references.** Searched the surface for CloudFront, Gmail, nodemailer, SendGrid, Custom Search — **none remain**. Header image is correctly CID-inlined, no external CDN. Comments are unusually accurate and cite the brief history. Clean.

---

## Open loops carried forward

These are **known and currently acceptable** — listed so the next review can grade itself, not because they need action tonight.

- **GA/Search single-subject SPOF.** [src/reports/ga/client.ts:42](src/reports/ga/client.ts#L42) + [src/reports/search/client.ts](src/reports/search/client.ts) impersonate one Workspace user (`GA_SUBJECT`, currently a personal account) via domain-wide delegation. If that account is offboarded or loses access, **every** site's analytics + search numbers soft-fail to blank. Fine at ~9–12 sites; rising risk as the fleet grows. → see Decisions deferred.
- **Airtable write batching (MEDIUM-3).** A scaling concern, not a bug; revisit past a few dozen sites.
- **Stale unmerged branches (housekeeping, no action needed).** Git archaeology found **no orphaned work** — all 9 unmerged remote branches (`chore/land-0.7-0.8-paper-trail`, `chore/ga-spike-followup`, `chore/baseline-bump-202605`, `chore/bump-node24-actions`, `chore/relocate-housekeeping`, `chore/release-0.27.2`, the 3 `docs/*`) already landed via squash or are superseded release-bot branches (content byte-identical on main). Safe to prune at leisure; `chore/release-0.27.2` is a dead Changesets branch (main is now 0.29.0).

## Decisions deferred

_(Things I'd have asked you mid-review but didn't, per the read-only contract. Each has my provisional call.)_

1. **Move GA/Search impersonation off the personal account to a role account (e.g. `reports@reddoorla.com`)?** _Provisional: yes, before the fleet passes ~25 sites_ — a personal account being the single point of failure for all analytics is the kind of thing that breaks silently months later. ~5 min decision + a re-grant. Not urgent today.
2. **MJML supply-chain (HIGH/MEDIUM above): accept-with-rationale, or plan a renderer swap?** _Provisional: accept and document_ — no patch exists, and exploitability is low because we render trusted templates. Revisit only if a patched MJML ships or template authorship ever opens up.
3. **Is reports/email "done enough" to stay parked while fleet-scale M2–M6 proceeds?** _Provisional: yes._ The area is mature; only the webhook hardening (Top of stack #1) is worth doing opportunistically before scale. The memory grader's pass agrees — every 0.7.0 design-doc open question except these scaling items is DONE (Resend chosen; GA via DWD wired and live-verified; Search Console replaced the dead Custom Search; Airtable mobile-review flow built; webhook delivery-status deployed; CID images; XML-escape hardening). The "GA must work before 1.0" framing is **superseded** by the fleet-scale vision.

## What I did NOT do tonight

- **No code changes, commits, PRs, pushes, or live-service writes** during this review — read-only as contracted. No Airtable/Resend/GA/Search state was mutated.
- Ran local gates only (don't mutate shared state): `pnpm test` (624 pass), `pnpm exec tsc --noEmit` (clean), `pnpm audit` (the 2 MJML findings above).
- _(For the record: the la-homelessness `@reddoorla/maintenance` bump PR and the fleet `homepage`-field updates earlier in the session were separate, explicitly-approved actions taken **before** this review phase — not part of tonight's read-only review.)_
- Did not extend beyond the reports/email scope (no dashboard/audit-pipeline/CLI-recipe review) — that's a separate evening's pass.
