# Morning brief — 2026-05-29

> Written evening of 2026-05-28 via the new `evening-review` skill. Companion to [MORNING_REPORT_2026-05-28.md](MORNING_REPORT_2026-05-28.md). Repo at `08eba85` on `main`, package at `0.16.0` (release PR #83 pending merge will bump to `0.17.0`).

## Executive summary

Today shipped 4 PRs (Phase 2c fleet card metrics, CLI spinners, credentials autoload, per-site dashboard health tiles). All review items from last night's report were either addressed or graded — **both HIGH/MEDIUM open items from MORNING_REPORT_2026-05-28.md turn out to have already been fixed in earlier 0.10.x patches** (legacy-reactive comment-aware brace counter at `src/recipes/svelte-5/codemods/legacy-reactive.ts:36-50`, self-version walk-up at `src/util/self-version.ts:23-46`).

Tonight's review surfaces **one HIGH that will bite the fleet-onboarding push if not fixed first**, plus 4 MEDIUMs and 3 suspected items. No CRITICAL findings. The reports pipeline is structurally sound — the BLOCKER tier from MORNING_REPORT_2026-05-27-bug-hunt.md is fully closed (B1/B2/B3/B4/B5 all verified fixed in current `main`).

## Top of stack (do these first, in order)

1. **Refuse `--write-airtable` when `--fleet` is set** (~15 min including test). H1 below. Cheapest correct fix is an explicit error message pointing the operator at single-site mode; the per-site write loop can come later. **Do this before any fleet write-attempt this week.**
2. **Bump `@lhci/cli` to clear the `tmp` advisory** (~5 min). High-severity path-traversal CVE, patched at `tmp>=0.2.6`, currently pulled in via `@lhci/cli`. Easy `pnpm up @lhci/cli`; run audit + tests to confirm.
3. **Start the real May monthly cycle dogfooding** (~1-3 hours). The explicit 1.0 ship criterion is "full monthly cycle without critical bugs." All BLOCKER-tier bugs from the bug-hunt addendum are now fixed; the orchestrator-test pattern + idempotency-key + UTC date math + formula escaping + stamp-before-send race fix are all in. The only blocker to a real run is operator-side data (recipients populated, header images uploaded). Suggest: pick one site (caltex or one of yours), populate the prerequisites, run `audit --write-airtable` from its checkout (works), then `report --site <slug> --preview`, review in Airtable, approve, `report --send-ready`. Single-site full loop. Multi-site `--due` flag should wait until H1 is fixed.

## Findings — CRITICAL

None.

## Findings — HIGH

### H1 — `audit --fleet ... --write-airtable` silently corrupts one site's data with another site's results

- **What:** Fleet mode + write-airtable combo writes the FIRST site's lighthouse result to the Airtable row matching the cwd-derived slug; the other 29 sites' results are discarded.
- **Where:** [src/cli/commands/audit.ts:181-211](src/cli/commands/audit.ts#L181-L211) calls `writeAuditsToAirtable` once with the cwd's slug; [src/audits/write-audits-to-airtable.ts:37-80](src/audits/write-audits-to-airtable.ts#L37-L80) does `results.find(r => r.audit === "lighthouse")` against a flat `AuditResult[]` pooled across all sites by `runAuditsAcross`.
- **Why it matters:** Not crash-loud; dashboard-wrong. Operator runs `--fleet airtable --write-airtable` thinking it batches; instead they overwrite one site's dashboard with another site's scores. Surfaces only by visual inspection on the fleet page. With the fleet-onboarding push planned for this week, this is a ship-blocker for any multi-site write attempt.
- **Fix sketch:** Cheapest correct fix — in `runAuditCommand`, throw an `exitCode: 2` error when `opts.fleet && opts.writeAirtable !== undefined`, with a message pointing to single-site `cd <site> && reddoor-maint audit --write-airtable`. Defer the per-site-write refactor (group `results` by `site`, look up slug from each result, batch the writes) until there's actual demand.

## Findings — MEDIUM

### M1 — `daysAgo` in `src/reports/draft.ts:39-43` uses non-UTC date accessors

- **Where:** [src/reports/draft.ts:39-43](src/reports/draft.ts#L39-L43)
- **Why:** Only fires on the FIRST-ever report for a (site, type) pair where no prior `periodEnd` exists. `due.ts:38-44` already uses UTC accessors correctly — this is an isolated inconsistency. Late-night TZ-edge runs near a month boundary could land Airtable's `Period start` on a different calendar day than the operator expects.
- **Fix:** Mirror `addMonths` from `due.ts` — `out.setUTCDate(out.getUTCDate() - n)`. Two-line change, no functional risk. Combine with H1 in the same PR.

### M2 — Resend webhook 500-retries indefinitely on truly-orphan events

- **Where:** [netlify/functions/resend-webhook.mts:89-96](netlify/functions/resend-webhook.mts#L89-L96)
- **Why:** Returns 500 when a Resend message ID has no matching Reports row, which makes svix retry. Correct for the orchestrator stamp-race window (minutes), but at fleet scale a legitimately-orphaned message (old test send, deleted row) becomes ~24h of retry churn against Netlify function invocations.
- **Fix:** Gate the 500-vs-200 on event age: return 500 within the first ~5 min of `event.data.created_at`, 200 ("orphan acknowledged") after that.

### M3 — Per-audit `--write-airtable` issues sequential single-record updates; at N=30 you'll hit Airtable rate caps

- **Where:** [src/audits/write-audits-to-airtable.ts:62-85](src/audits/write-audits-to-airtable.ts#L62-L85) (four separate `await update…` calls per site) + [src/reports/airtable/websites.ts:128-181](src/reports/airtable/websites.ts#L128-L181) (each updates a single record).
- **Why:** Fine today (N=1). Airtable per-base limit is 5 req/sec; at N=30 sites × 4 sequential updates = 120 API calls minimum, and the SDK does not retry 429s by default. Plus four round-trips per site where one would do.
- **Fix:** Add `updateAllAuditCounts(base, recordId, {scores, a11y?, deps?, security?})` that merges into a single `update()` call per site. Optionally `p-limit` concurrency at the fleet-write layer. This naturally falls out of the per-site fleet-write refactor (the deferred half of H1's fix).

### M4 — `STATUS_MAP` doesn't include `email.delivery_delayed`

- **Where:** [src/reports/webhook-events.ts:8-12](src/reports/webhook-events.ts#L8-L12)
- **Why:** Resend emits `email.delivery_delayed` for transient deferrals (greylisting, full mailbox retry). Currently silently dropped; operator doesn't see the delay when triaging a missing delivery.
- **Fix:** Add `"delayed"` literal to the `DeliveryStatus` union in `src/reports/airtable/reports.ts`, map `email.delivery_delayed → "delayed"` in `STATUS_MAP`, and add the option to the Airtable `Delivery status` single-select. Defer if scope creeps.

### M5 — Commentary / siteName / siteUrl interpolate into MJML markup without XML-escape

- **Where:** [src/reports/maintenance-email/template.ts:100-127](src/reports/maintenance-email/template.ts#L100-L127) (commentarySection, preview-text, and the `<mj-button href=…>` for siteUrl)
- **Why:** Operator-typed `<` in a commentary, or a stray `"` in a Websites URL, crashes the MJML render with `validationLevel: "strict"`. XSS not in scope (operator-trusted, email clients sanitize) — this is purely about the send blowing up at template-evaluation time on a single malformed character.
- **Fix:** ~5-line `escapeXmlText(s)` helper applied to the three interpolation points.

## Open loops carried forward

**Graded from MORNING_REPORT_2026-05-28.md:**

- ✅ `legacy-reactive.ts` comment-aware brace counter — DONE (verified at `src/recipes/svelte-5/codemods/legacy-reactive.ts:36-50`; doc comment cites the regression).
- ✅ `self-version.ts` walk-up resolution — DONE (verified at `src/util/self-version.ts:23-46`).
- ✅ Pre-publish smoke gate — DONE (`scripts/smoke-dist.mjs`, PR #57).
- ✅ README polish pass — DONE (PR #56).
- ⏳ Stale remote branches — STILL OPEN. `origin/chore/bump-node24-actions`, `origin/feat/0.7.0-reports`, `origin/feat/0.8.0-workflow-closure`, `origin/feat/0.9.0-lighthouse-url`, `origin/feat/0.9.x-init`, `origin/feat/0.9.x-webhook-deploy` all merged but never deleted. Mostly housekeeping; `git push origin --delete <branch>` for each. ~5 min.
- ⏳ Real monthly dogfooding cycle — STILL OPEN. Now genuinely unblocked. See Top of stack #3.

**From fleet-onboarding-push memory:**

- Fleet at 1 site (CalTex). The push has not started in earnest yet. H1 blocks fleet-mode writes, so the path forward this week is per-site sequential onboarding (`cd <new-site> && reddoor-maint init && audit --write-airtable`) which is exactly what the credentials autoload was built to enable. **Net effect: today's credentials work + per-site dashboard tiles + Site Health on /s/<slug>?t=<token> mean the per-site onboarding loop is fully ready; only the fleet-multi-site convenience is gated on H1.**

**Background (no change):**

- GA Data API blocked on Workspace admin perms.
- Phase 2b click-to-trigger audit deferred post-1.0.

## Decisions deferred

These came up during the review and I made provisional calls rather than block:

1. **mjml dep advisory (S2 in reviewer output):** mjml ≤4.18.0 has CVE-2020-12827 (moderate, no patch). The exploit (mj-include directory traversal) requires attacker-controlled MJML input; we render trusted templates server-side, so the practical risk is minimal. Same for html-minifier REDoS via mjml-cli. **Provisional call:** add a `pnpm audit` ignore for these two advisories with a comment pointing at this brief, OR add a SECURITY.md note. Real fix is to either fork mjml or wait for upstream patch. Skip the `tmp` advisory (different chain, easy bump — see Top of stack #2).
2. **Audit-airtable abstraction (S1):** four near-copies of the `hasXCounts` + `xCountsFromResult` + `updateXCounts` pattern now exist. **Provisional call:** wait until M3's per-site-merge refactor lands; both refactors collapse into one registry-shaped abstraction at that point. Premature to do solo.
3. **Per-site fleet write-airtable (the deferred half of H1):** group results by site, look up each site's slug, batch. **Provisional call:** defer until you actually need a multi-site fleet write. Right now sequential `cd <site>` onboarding is fine and the credentials autoload + per-site dashboards are sufficient for the push.

## What I did NOT do tonight

Read-only review per the skill. No commits, no PRs, no pushes, no Airtable writes, no Netlify deploys. The repo state is identical to what you left at `08eba85`. Local-only side effects: `pnpm test --run`, `pnpm audit --prod`, `pnpm lint` were executed (~3 min cumulative); no source files modified.

## Notes for next session

- The evening-review skill hit one rough edge tonight: I gave an "all clear to walk away" message and then the next `Bash` call (a non-allowlisted `sed`) triggered a permission prompt that pinged you. Skill updated post-brief to require permission pre-clearance as part of Phase 1's Q&A batch, before any "all clear" signal. See [~/.claude/skills/evening-review/SKILL.md](../../.claude/skills/evening-review/SKILL.md).
- Of the 5 active findings (1 HIGH + 4 MEDIUM), only H1 has a "do this first" urgency tied to a specific upcoming workflow (fleet-onboarding). The MEDIUMs are real but accumulate-able — bundle into a single 0.17.x cleanup PR alongside H1, or land H1 standalone and batch the rest later.
