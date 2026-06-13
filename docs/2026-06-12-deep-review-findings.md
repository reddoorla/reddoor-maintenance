# Deep codebase review — findings registry

**Date:** 2026-06-12  
**Method:** 12 review lenses (8 area + 4 cross-cutting) over the whole codebase, each finding independently re-verified by a skeptic agent (refute-by-default). Severities below are the **verifier-corrected** levels.  
**Result:** 62 confirmed findings (8 high / 26 medium / 28 low after dedup → 62 distinct), 12 refuted as false positives. No blockers.

> Every item is `- [ ]` so this doubles as the fix checklist.

## Resolution (2026-06-12) — RESOLVED

All confirmed findings were addressed across 11 PRs (#193 registry, #194–#203 fixes), each merged head-SHA-gated with the full gate (lint · typecheck · test · build · test:dist). Test count rose 922 → 1074, and `pnpm typecheck` now also covers the `netlify/functions/*.mts` handlers (the gap that let #180 through).

| PR   | Batch                      | Covered                                                                                                                                           |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| #194 | dashboard/webhook security | basic-auth byte-compare crash, rate-limit auth endpoints, monotonic webhook status, CSRF origin fallback, generic webhook errors                  |
| #195 | cockpit signal key-space   | renovate/ci NEW-forever badges (unify digest+cockpit keys; −430 dead lines)                                                                       |
| #196 | send idempotency           | sendOne Resend-409 handling, launch flip self-heal                                                                                                |
| #197 | M3 ledger                  | `--due` wedge (complete half-made drafts), pending pile-up dedup, frequency warning                                                               |
| #198 | input validation / SSRF    | deployed-Lighthouse url allowlist, clone origin-check, repo validation before token writes, gh path guards                                        |
| #199 | recipe safety              | restore-on-failure, restore-to-original-branch, branch-protection context merge                                                                   |
| #200 | CLI robustness             | stdout-truncation, unknown-command exit, HOME-unset workdir, exit codes, `export=` creds                                                          |
| #201 | tech debt + email          | shared html-escape util, makeWebsiteRow factory, AttentionItem contract module, escape email labels, footerOrg, predicate dedup                   |
| #202 | test coverage              | typecheck the `.mts` handlers, expand smoke-dist, Resend client test, Lighthouse guard, spawn UTF-8                                               |
| #203 | cleanup tail               | stale GitHub-signal clearing, atomic audit write-back, fresh launch scores, header href scheme, attachment content-type, recipient-validate-first |

**Deliberately NOT changed (with rationale):**

- _"init stacks each recipe's branch off the previous"_ — **intended design**: the onboarding pipeline composes by stacking each step on the prior's committed files (pinned by `pipeline-composition.test.ts`); restoring there would break onboarding. (#199 preserves it.)
- _"`digest.ts` too large"_ — **largely mitigated**: #195 removed ~430 lines (renovate live-sweep) and #201 moved the attention contract out; a further split is deferred as low-value.
- _"all audits for a site run concurrently on the same checkout"_ — the **fleet path is already serial** (M2 design); only single-site operator-run audits overlap. A concurrency-model change is deferred pending a real conflict.
- A handful of truly-trivial/edge lows left as-is with reasons: `findReportByPeriod` first-match (a duplicate period is already a data error), `writeDigestState` get-or-create race (single-writer in practice), `openPullRequests` `first:100` (no fleet repo has >100 open Renovate PRs), `github-signals` byRepo collision (sites don't share repos), CC-identical-to-To, and the basic-auth length "leak" (password length is non-secret + fixed per deploy — the crash was the real bug, fixed in #194).

## HIGH (8)

### R01 · verifyBasicAuth throws (uncaught 500) on a same-JS-length but different-UTF-8-byte-length password — unauthenticated DoS + operator lockout

- **Where:** `src/dashboard/basic-auth.ts:38-39`
- **Lens:** dashboard-web
- **Why:** The length guard compares JS string `.length` (UTF-16 code units): `if (provided.length !== expectedPassword.length) return false;`. timingSafeEqual then compares `Buffer.from(provided,'utf-8')` vs `Buffer.from(expectedPassword,'utf-8')`, which compares UTF-8 BYTE lengths. A string can match in code-unit length but differ in byte length, so timingSafeEqual throws 'Input buffers must have the same byte length'. Verified at runtime: provided='é' (1 char, 2 bytes) vs expected='x' (1 char, 1 byte) passes the guard and throws. The try/catch in this function only wraps the base64 decode (lines 28-32), so the throw propagates; none of approve-report.mts:69, fleet-homepage.mts:55, or…
- **Fix:** Compare byte buffers, not string lengths. Build the buffers first (`const a = Buffer.from(provided,'utf-8'); const b = Buffer.from(expectedPassword,'utf-8');`), `if (a.length !== b.length) return false;`, then `timingSafeEqual(a, b)`. Add a test with a multibyte password (e.g. expected='passwörd', a same-code-unit-length ASCII guess) asserting `false`, not a throw. Optionally also wrap verifyBasicAuth call sites in try/catch returning 401 as defense-in-depth.
- [ ] fixed

### R02 · Cockpit diffs a different key-space than the email writes, so `ci:` and persisted-`renovate:` items badge NEW forever

- **Where:** `src/dashboard/fleet-cockpit.ts:133-141 vs src/reports/digest.ts:275-281, 334-335, 393-397`
- **Lens:** alerts-github
- **Why:** The email digest's collectAttention (digest.ts:275-281) emits renovate items via renovateFindingsToAttention with keys `renovate:<owner/repo>#<num>` and emits NO `ci:` items at all. The snapshot persisted by writeDigestState (digest.ts:393-397) therefore contains only those keys. The cockpit's buildCockpitModel (fleet-cockpit.ts:133-141) instead emits `collectRenovateAlerts` (key `renovate:<siteId>`, digest-collectors.ts:129) and `collectCiAlerts` (key `ci:<siteId>`, digest-collectors.ts:151), then calls diffAttention against that same email-written snapshot. Because `renovate:<siteId>` and `ci:<siteId>` never appear in what the email wrote, `prior[it.key]` is always undefined → status…
- **Fix:** Make the two paths share a key space, or give the cockpit its own persisted snapshot. Either (a) have collectAttention also run collectCiAlerts/collectRenovateAlerts (persisted) so the written snapshot covers `ci:<id>` and `renovate:<id>`, or (b) accept that the cockpit is a pure read and stop diffing on the dashboard (render no NEW/WORSE there), or (c) key both renovate paths identically. At minimum, document that cockpit NEW/WORSE is non-functional for ci/renovate today.
- [ ] fixed

### R03 · Failed pnpm install in onboard/convert-to-pnpm leaves a half-mutated, dirty checkout on a fresh branch that can't be retried

- **Where:** `src/recipes/onboard.ts:137-153 (and src/recipes/convert-to-pnpm.ts:59-98)`
- **Lens:** recipes
- **Why:** withRecipe creates the branch (git checkout -b) BEFORE calling apply. onboard's apply then writes package.json (line 143) and runs `pnpm install` (147). If install exits non-zero it returns {kind:"failed"} (149-152) WITHOUT committing. Net state of the operator's real checkout (launch/init resolve via localPath, so this is their working tree, not a throwaway clone): now sitting on a brand-new `maint/onboard-*` branch with a modified package.json (new deps) and a partially-updated/leftover lockfile + node_modules, all uncommitted, with status "failed" / commits:[]. The operator is not on their original branch and the tree is dirty. Re-running init/onboard then hits withRecipe's clean-tree…
- **Fix:** On a failed apply, restore the checkout: in withRecipe, when result.kind==="failed", `git checkout -- .` / `git reset --hard` the original HEAD and `git checkout <originalBranch>` then delete the just-created branch, so a failed recipe is a true no-op on the tree. Capture the pre-run branch in withRecipe (currentBranch) before createBranch. At minimum, document that a failed convert/onboard leaves a dirty branch and add a test asserting the recovery.
- [ ] fixed

### R04 · runOrExit's process.exit() after console.log() truncates large piped stdout — corrupts --json output

- **Where:** `src/cli/bin.ts:62-64`
- **Lens:** cli-glue
- **Why:** runOrExit does `console.log(output); process.exit(code);`. When stdout is a pipe/file (not a TTY), console.log is asynchronous and process.exit() tears the process down before the write buffer drains. Reproduced on this environment's Node v24.14.1: `node -e 'console.log("x".repeat(500000)); process.exit(0)' | wc -c` prints 65536, not 500000 — the tail is lost. The `audit --json` flag is explicitly documented as 'Machine-readable JSON output' for piping to jq/tee, and `audit --fleet airtable --json` across ~12 sites easily exceeds one pipe buffer. The consumer receives a truncated, syntactically-invalid JSON document and either crashes or silently reads partial fleet data. Every command…
- **Fix:** Don't process.exit() right after a console.log of arbitrary-size output. Either write synchronously to fd 1 (process.stdout.write with a drain wait), or set process.exitCode = code and return so Node flushes stdout and exits naturally, or wait for the 'drain'/write-callback before exiting. The pattern `process.stdout.write(output + '\n', () => process.exit(code))` is the minimal fix.
- [ ] fixed

### R05 · cloneIfNeeded trusts any non-empty dir as the correct checkout; lossy siteSlug collapses distinct sites onto one path → operates on the wrong repo

- **Where:** `src/cli/fleet/clone-if-needed.ts:85-86 and 101-103; interacts with siteSlug in src/reports/airtable/websites.ts:81`
- **Lens:** cli-glue
- **Why:** cloneIfNeeded returns the site untouched the instant `isNonEmptyDir(site.path)` is true (line 86) — and similarly returns the existing `target` if `{workdir}/{name}` is non-empty (line 101) — with NO check that the on-disk repo's `origin` matches the site's `gitRepo`/`repoUrl`. siteSlug() is lossy (`name.toLowerCase().replace(/[^a-z0-9]+/g,'-')...`), so two different Airtable rows like 'Acme, Inc.' and 'Acme Inc' both produce slug `acme-inc`, hence the same `path` (`{workdir}/acme-inc`) and same `name`. The first site clones acme-inc's repo; the second site (a DIFFERENT GitHub repo) sees the dir already populated and is audited / sync-configs'd / bump-deps'd against the FIRST repo. Same…
- **Fix:** Before reusing an existing checkout, verify `git -C <path> remote get-url origin` resolves to the same owner/repo as the site's gitRepo/repoUrl (parseOwnerRepo already exists in util/git.ts); throw on mismatch. Separately, dedupe slugs in fromAirtableBase (or include gitRepo in the path) so two rows can't collide on one workdir.
- [ ] fixed

### R06 · Deployed-Lighthouse audit hands an unvalidated Airtable URL to Chrome with no scheme allowlist (local-file read / SSRF)

- **Where:** `src/audits/lighthouse.ts:219`
- **Lens:** dim-security
- **Why:** fromAirtableBase copies the Airtable url field directly to site.deployedUrl with zero validation (airtable.ts:39,45 only checks length greater than 0). deployedLighthouse writes it raw into the generated lighthouserc.json collect.url (lighthouse.ts:219) and runs npx lhci autorun, which launches headless Chrome to navigate there. Unlike the checkout path, deployed mode never calls withFreePort or new URL, so there is no scheme filtering. Scenario: poison a site url cell to a file URL like file:///Users/runner/.config/reddoor-maint/credentials.env or an internal metadata IP; the nightly fleet audit runs Chrome against it on the central runner that holds every fleet credential. The CLI --url…
- **Fix:** Add an http/https scheme allowlist wherever deployedUrl is accepted: fromAirtableBase, inventory/json.ts, and applyDeployedUrl (parse with new URL then reject when protocol is not http or https). Reject anything else before it reaches lhci/Chrome.
- [ ] fixed

### R07 · `--due` idempotency guard ignores draftReady, so a crash between createDraft and setDraftReady permanently wedges the period (row never becomes sendable, never re-drafts)

- **Where:** `src/cli/commands/report.ts:77-84 (guard) and src/reports/draft.ts:135-154 (3-write sequence)`
- **Lens:** dim-data-integrity
- **Why:** draftReportForSite does three separate Airtable writes with no transaction: createDraft (draft.ts:135), uploadAttachment (153), then setDraftReady(true) (154). The row only enters the approve queue when Draft ready is TRUE (listSendableReports/listPendingApproval all require draftReady). If the cron is killed or uploadAttachment/setDraftReady throws after createDraft succeeded, the row exists with `Draft ready` = false. The next `--due` run's idempotency guard at report.ts:77-79 checks ONLY `r.siteId && r.reportType && r.period === period` — it does NOT check draftReady — so it sees the half-created row, logs `skipped (already drafted)`, and never retries. The row is now permanently stuck:…
- **Fix:** Either (a) make the guard treat a not-draft-ready existing row as 'needs completion' rather than 'already done' — re-run setDraftReady (and re-upload) on the existing row instead of skipping, mirroring launch.ts's reuse-then-finish pattern; or (b) reorder so setDraftReady is the last write AND have the guard re-drive incomplete rows. Skipping purely on period presence is too coarse when draftReady is the field that actually gates sendability.
- [ ] fixed

### R08 · site-dashboard.mts and fleet-homepage.mts are typechecked by nothing and tested by nothing

- **Where:** `tsconfig.json:21`
- **Lens:** dim-tests
- **Why:** include is src and tests only, so a mts handler typechecks only if a test imports it. site-dashboard.mts and fleet-homepage.mts are imported by no test (tsc count 0), yet own the live root and per-site routes and import deep-path fns like listReportsForSite and buildCockpitModel. A rename leaves the gate green while the deployed dashboard throws at import.
- **Fix:** tsc-cover netlify mts and add tests for both handlers.
- [ ] fixed

## MEDIUM (26)

### R09 · sendOne has no 409 (changed-body) idempotency-conflict handling — a report whose body changed after a failed stamp is stuck for 24h, then double-sends

- **Where:** `src/reports/send/orchestrate.ts:210-212`
- **Lens:** send-path
- **Why:** The pipeline is at-least-once by design: if client.send succeeds but stampSent (line 211) throws (an Airtable blip), `Sent at` stays null so the row is still returned by listSendableReports next run (reports.ts:166). The comment at orchestrate.ts:204-206 only reasons about the SAME-body replay (Resend returns the original id, no dup). But between the failed stamp and the retry, the report body very commonly changes: the operator fixes a typo in Commentary, `report --due`/audit re-writes Lighthouse or GA numbers, or the header image is swapped. On the retry the payload differs but the key is still `report:<id>`, so Resend returns a 409 `invalid_idempotent_request` ("This idempotency key has…
- **Fix:** Mirror runDigest: wrap client.send in sendOne with a catch for isIdempotencyConflict (lift it out of digest.ts into a shared module). On a 409 for report:<id>, treat it as 'already sent under this key' — look up the prior Resend message id (or accept the conflict) and stampSent so the row stops replaying. Also retry/persist stampSent more aggressively (it is the single point that closes the loop).
- [ ] fixed

### R10 · Launch flip-on-send: Status→maintenance is committed while `Sent at` may still be null, so a stamp failure replays a launched-but-unstamped report

- **Where:** `src/reports/send/orchestrate.ts:80-89 (flip) vs 211 (stampSent) and 142-207 (re-send)`
- **Lens:** send-path
- **Why:** Ordering inside sendOne is send (210) → stampSent (211); the Launch flip happens back in sendApprovedReports AFTER sendOne returns (82-89). If stampSent (211) throws, sendOne throws, the catch at 90-93 marks anyFailed and the Launch flip block (82-89) never runs — good for Status, but `Sent at` is now null on a report that DID send, so it is sendable again next run (reports.ts:166). On that next run sendOne re-renders and re-sends. Because the report body for a Launch is derived from the audited scores on the row (unchanged), Resend's idempotency MAY dedupe it — but only if still inside 24h AND the body is byte-identical; the header image is re-fetched and re-encoded by sharp each run…
- **Fix:** Make `Sent at` the first durable write after a successful send and gate everything (including the Launch flip) on it. Consider stamping Sent at + message id, then doing the Launch flip, so a row can never be in 'sent but unstamped'. At minimum, treat a stampSent failure as fatal-but-no-retry (record the message id somewhere durable before re-attempting send) so a confirmed send is never replayed.
- [ ] fixed

### R11 · An unapproved site accrues one stale pending draft every recurrence forever (period key follows the _due month_, not the draft's existence)

- **Where:** `src/cli/commands/report.ts:76-84 + src/reports/due.ts:91-101`
- **Lens:** airtable-data
- **Why:** For a site with no `Sent at` and no maintenance/testing-day fallback, lastSentForType→null and the fallback is null, so findDueReports pushes dueDate=todayStart on EVERY run (due.ts:95-97). The idempotency key is reportPeriodKey(todayStart) = the current YYYY-MM. So in May the guard looks for Period='2026-05'; April's still-unapproved draft (Period='2026-04') does not match → a _second_ unsent draft is created. June makes a third. Each lands in 'Ready for your yes'. An operator who simply hasn't clicked yes is punished with a growing pile of near-identical pending drafts (and, once approved, a burst of back-dated emails). The test at tests/cli/report-command.test.ts:137 pins this as…
- **Fix:** When deciding due-ness / the period key for a never-sent site, also treat an existing _unsent_ draft for an earlier period as 'already pending' (skip re-drafting until the prior draft is sent or explicitly discarded), or key the dedupe on 'has any open/unsent draft for this (site,type)' rather than strictly on the rolling current-month key.
- [ ] fixed

### R12 · mapRow casts `maintenence freq`/`testing freq` to the Frequency union with no validation — a casing/typo value silently drops the site from the due loop with no error

- **Where:** `src/reports/airtable/websites.ts:113-114 + src/reports/due.ts:88-101`
- **Lens:** airtable-data
- **Why:** maintenanceFreq is `(f["maintenence freq"] as string ?? "None") as Frequency`. The single-select could legitimately hold a value outside the union (e.g. a renamed option, 'monthly' lower-case, a trailing space). due.ts then: `freq==="None"`? no → `MONTHS[freq]` = undefined → addMonths(date, undefined) → setUTCMonth(month+undefined)=NaN → Invalid Date → `todayStart >= NaN` is false → the (site,type) is never pushed to `due`. The site silently stops getting reports forever, with zero log/error — exactly the quiet-degradation the file's own mapRow comment warns about, but here it skips a delivery rather than just a column. Same shape for testingFreq.
- **Fix:** Validate against a known set in mapRow (coerce unknown → 'None' AND warn), or guard in findDueReports: if freq is non-'None' but not in MONTHS, log a loud per-site warning rather than silently producing an Invalid Date that evaluates to not-due.
- [ ] fixed

### R13 · maintenanceChecks / testingChecklist / Google-rank labels are interpolated into MJML WITHOUT escapeXml

- **Where:** `src/reports/maintenance-email/template.ts:81 (and :74 googleLabel, :100 testing label)`
- **Lens:** templates-copy
- **Why:** Every other copy string in these templates is wrapped in escapeXml, but copy.maintenanceChecks[i] (line 81), the searchPosition-derived googleLabel (lines 72-74), and copy.testingChecklist[i] (line 100) are interpolated raw into mj-text content. I confirmed against the bundled mjml@4.18.0 that strict mode does NOT auto-escape markup in mj-text — a label of `Page 1 <img src=x onerror="...">` renders straight into the output HTML with 0 errors (verified: `contains-raw-img-onerror: true`). Today these arrays come only from DEFAULT_COPY constants and searchPosition is a number, so it is not yet operator-reachable — hence medium not high. But it is an inconsistency trap: the instant someone adds…
- **Fix:** Escape the label at each sink: `${escapeXml(label)}` in maintenanceChecksSection/testingChecklistSection rows, and `escapeXml(googleLabel)` (the static prefix is safe but escape the whole composed string for uniformity). Add a render test feeding a copy override with `<` / `&` into maintenanceChecks and asserting it is entity-encoded.
- [ ] fixed

### R14 · Maintenance email hardcodes "Reddoor Creative, LLC" in the copyright line, ignoring a per-site footerOrg override

- **Where:** `src/reports/maintenance-email/template.ts:248`
- **Lens:** templates-copy
- **Why:** Line 248 emits a literal `Copyright {year} Reddoor Creative, LLC. All rights reserved.` regardless of copy.footerOrg, while the mailing-address block right below it (lines 250-255) DOES honor the override via copy.footerOrg. So a site that sets `Copy — Footer` to e.g. `Beta LLC\n1 Main St\nAustin TX` sends a maintenance email whose address block says "Beta LLC" but whose copyright line still says "Reddoor Creative, LLC" — internally contradictory branding. The launch template gets this right (launch-email/template.ts:68 uses `escapeXml(copy.footerOrg)`), so the two report types for the SAME site disagree. For any white-label/agency-resold site this is a visible correctness defect.…
- **Fix:** Replace the hardcoded org in line 248 with `${escapeXml(copy.footerOrg)}` to match the launch template and the address block below it.
- [ ] fixed

### R15 · The documented escaping rationale ("raw &/</>/\" throws under strict MJML") is wrong for mjml@4.18.0 — only \" throws; &/</> silently pass through

- **Where:** `src/reports/maintenance-email/template.ts:26-38 (escapeXml doc) and launch-email/template.ts:19-21`
- **Lens:** templates-copy
- **Why:** The comments justify escaping by claiming strict MJML throws on a raw `&`, `<`, `>`, or `"`. I tested the installed mjml@4.18.0: raw `&`, `<`, `>` in mj-text content and in attributes render with 0 errors (no throw), and `<...>` markup leaks verbatim into the output HTML; only a raw double-quote INSIDE an attribute value actually throws. This matters because the real reason escaping is needed is HTML/markup-injection safety (the body is rendered to HTML and the raw markup leaks), not strict-validation crashes. A future maintainer who reads this comment, tests that `Brown & Co` renders fine without escaping, and concludes the escaping is belt-and-suspenders could weaken or drop it —…
- **Fix:** Correct the rationale to: escapeXml prevents (a) HTML/markup injection because MJML passes raw `<...>` in text/attrs through to the output, and (b) the attribute-quote parse error that a raw `"` triggers under strict validation. Keep escaping mandatory on all operator/site text regardless of MJML version.
- [ ] fixed

### R16 · Approve POST, per-site dashboard, and webhook have no rate limit — unthrottled online password brute-force against the only gate

- **Where:** `netlify/functions/approve-report.mts:14-16 (and site-dashboard.mts:13-15, resend-webhook.mts)`
- **Lens:** dashboard-web
- **Why:** Only fleet-homepage.mts:16-20 declares a `rateLimit` config (60/min/ip). The state-changing approve endpoint at /api/reports/:id/approve and the per-site dashboard at /s/:slug declare only a `path` and no rate limit, and netlify.toml has none either (grep confirms rateLimit appears once, in fleet-homepage.mts). DASHBOARD_PASSWORD is the single gate to both the entire fleet view and a state-changing approve. The constant-time compare prevents timing leaks but does nothing against online guessing: an attacker can fire unlimited `Authorization: Basic` guesses at /api/reports/<any>/approve or /s/<any-slug> with no throttle. A weak operator password is brute-forceable, after which the attacker…
- **Fix:** Add the same `rateLimit` block (or a stricter one, e.g. 10/min/ip on failed-auth) to approve-report.mts and site-dashboard.mts. Since these are auth endpoints, rate-limit by IP regardless of auth outcome so the 401 path is throttled, not just the success path.
- [ ] fixed

### R17 · Resend webhook blindly overwrites delivery status — a retried/out-of-order 'delivered' can clobber a 'bounced'/'complained' the cockpit relies on

- **Where:** `netlify/functions/resend-webhook.mts:120 → src/reports/airtable/reports.ts:222-228 (setDeliveryStatus)`
- **Lens:** dashboard-web
- **Why:** setDeliveryStatus is an unconditional write of whatever the current event maps to. Resend webhook events are not strictly ordered and svix retries failed deliveries (the function itself 500s 'orphan' events for up to 10 minutes so they WILL be retried). A spam complaint always arrives AFTER delivery, so the normal sequence is email.delivered then email.complained. If the email.delivered event's first attempt 500s on the orphan race (lines 98-117) and svix retries it minutes later — after email.complained has already been written — the retried 'delivered' overwrites the 'complained' status back to 'delivered'. That silently erases exactly the bounced/complained signal that…
- **Fix:** Make the write monotonic toward terminal/worse states: never overwrite a terminal failure ('bounced'/'complained') with 'delivered'. Read the current row's deliveryStatus (already fetched as `report`) and skip the write when current is a failure and the incoming event is 'delivered' (or rank statuses and only escalate).
- [ ] fixed

### R18 · A permanently-unreachable repo keeps its last `Default Branch CI = failing` forever → an un-clearable phantom alert

- **Where:** `src/cli/commands/github-signals.ts:40-74, src/audits/github-signals.ts:35-47, src/reports/airtable/websites.ts:272-280`
- **Lens:** alerts-github
- **Why:** collectGitHubSignals swallows a probe throw via onSkip and produces NO row for that repo (github-signals.ts:45-47); the CLI then only records it under result.failed (commands/github-signals.ts:74) and never calls updateGitHubSignals for it. So the row's previously-written `Default Branch CI` value is left untouched. If a repo's last good sweep wrote 'failing' and the repo then becomes permanently unreachable (token loses access after an org change — see the reddoorla org-move memory where transfers wiped secrets; or the repo is archived/renamed), every subsequent nightly throws and skips it, and the Airtable field stays 'failing' indefinitely. The cockpit's collectCiAlerts…
- **Fix:** Stamp staleness: when a probe is skipped, either clear the signal fields to null (so collectCiAlerts/collectRenovateAlerts skip them) or have the cockpit treat a `GitHub Signals At` older than ~Nx the sweep interval as 'unknown' rather than trusting a stale 'failing'. The githubSignalsAt timestamp is already persisted (websites.ts:150) but nothing consumes it.
- [ ] fixed

### R19 · Deployed-Lighthouse runs the Airtable `url` field completely unvalidated; only the --url CLI flag is checked

- **Where:** `src/inventory/airtable.ts:45 (`deployedUrl: w.url`) → src/audits/lighthouse.ts:219 (`url: [deployedUrl]`); contrast src/cli/commands/audit.ts:228-232 which does `new URL(url)` for --url`
- **Lens:** audits
- **Why:** fromAirtableBase filters only on `w.url.length > 0` and passes the raw string straight into the lhci config's `collect.url`. mapRow does `url: String(f["url"] ?? "")` with no scheme/format check. A common data-entry value like `caltexmedical.com` or `www.caltexmedical.com` (no scheme) — or a trailing-space / accidental `mailto:`/relative value — flows into lighthouserc.json. lhci then fails to load a non-absolute URL, writes no lhr-_.json, and the audit returns status:fail 'no lhr-_.json written', which (per AUD-1) marks the site failed in the fleet summary with a generic message and no hint that the real cause is a malformed URL in Airtable. The single-site `--url` path guards against…
- **Fix:** Validate `w.url` in fromAirtableBase (try `new URL(w.url)` and require http/https) — drop or skip+warn sites whose url isn't an absolute http(s) URL, rather than silently feeding it to lhci. Surface the bad value in the skip reason so the operator can fix the Airtable cell.
- [ ] fixed

### R20 · Per-site Airtable write-back is non-atomic across up to 4 update() calls; a mid-write failure leaves a partially-updated row reported as fully failed

- **Where:** `src/audits/write-audits-to-airtable.ts:69-94 (four separate `await update...` calls) within writeFleetAuditsToAirtable's per-site try/catch (162-168)`
- **Lens:** audits
- **Why:** writeAuditsToAirtable issues independent base.update() calls for lighthouse, a11y, deps, and security. If a transient Airtable error (429/5xx/network) hits the 2nd call after the 1st succeeded, the function throws and the site is recorded in `failed[]`. But the Lighthouse scores + a fresh `Last lighthouse audit at` timestamp were already committed. Result: the dashboard row shows updated Lighthouse numbers with a current timestamp for a site the run reports as 'not written,' and re-running mixes fields from two different runs (e.g. new LH scores, stale a11y count). The 429-avoidance design (serial sites) reduces but does not eliminate this — the comment at :158-161 acknowledges 429s are the…
- **Fix:** Coalesce the per-site writes into a single base.update() with all fields merged into one FieldSet (the row id is the same for all four), making the per-site write atomic. That also cuts request volume ~4x, easing the 429 pressure the serial loop is working around.
- [ ] fixed

### R21 · init's step chain branches each recipe off the PREVIOUS recipe's branch (never returns to base), stacking commits instead of producing independent branches

- **Where:** `src/recipes/init.ts:46-89; src/util/git.ts:27-29 (createBranch only ever `checkout -b`, no checkout-back anywhere in the recipe layer)`
- **Lens:** recipes
- **Why:** Each recipe in DEFAULT_INIT_STEPS calls withRecipe → createBranch → `git checkout -b maint/<recipe>-<ts>`, and nothing ever checks the tree back to the default branch between steps. So convert-to-pnpm branches off main, then onboard does `checkout -b` off convert-to-pnpm's branch (carrying its commits), sync-configs branches off onboard's branch, etc. The init docstring (lines 58-67) says "the operator ends up with one stack of branches per mutated step" — implying independent branches — but in reality branch N contains the commits of branches 1..N. If the operator opens a PR from the final branch it includes every prior step's commits (maybe fine), but if they open a PR from an…
- **Fix:** Decide and enforce one model: either (a) init runs each recipe from the same base branch — return to the original branch in withRecipe after each recipe (checkout base before the next step), so branches are siblings; or (b) intentionally stack and document/PR only the final branch. Whichever you pick, restore the operator to their starting branch when init completes, and add a real-git integration test that asserts branch parentage.
- [ ] fixed

### R22 · launch re-run reuses an existing Reports row but never updates its Lighthouse scores; the sent email carries stale scores while the preview attachment carries fresh ones

- **Where:** `src/recipes/launch.ts:119-160`
- **Lens:** recipes
- **Why:** On a re-launch within the same month, findReportByPeriod returns the existing Launch row and `report = existing` (line 120). The code then renders the preview HTML with the FRESH `scores` (132-142) and uploads it, and calls setDraftReady(true) (160) — but it never writes the fresh `scores` back to the existing row's Lighthouse fields. The send loop renders the email it actually sends from the ROW's stored scores (the row's `lighthouse`), so after a re-audit-and-relaunch the delivered go-live email shows the OLD scores (or none, if the first attempt's row predates scores), while the "Rendered HTML" preview attachment the operator reviews shows the NEW scores. The two disagree, and the…
- **Fix:** On the existing-row path, update the row's Lighthouse fields (and completedOn) with the freshly-audited `scores` before setDraftReady — e.g. an updateReportScores call, or route both paths through a single upsert that always writes scores. Add a test asserting the reused row's Lighthouse columns equal the just-audited scores.
- [ ] fixed

### R23 · self-updating / every recipe leaves the operator's local checkout parked on a maint/\* branch (and self-updating pushes it) — no restore to default branch

- **Where:** `src/recipes/self-updating/index.ts:84-103; src/recipes/_with-recipe.ts:82-114`
- **Lens:** recipes
- **Why:** launch resolves the site from the operator's real local checkout (cli/commands/launch.ts:41-48 → localPath). selfUpdating, when CI files are missing, does createBranch (checkout -b), writes templates, commits, and `git push -u origin <branch>` (96). It never checks the tree back to `base`. So after `launch` (or any recipe), the operator's working directory is sitting on `maint/self-updating-<ts>`, not main/their feature branch. A subsequent unrelated `git commit`/`git push` by the operator lands on the maint branch by surprise; and because withRecipe's clean-tree guard plus the lingering branch persist, the operator must manually `git checkout main` after every CLI run. This is a silent…
- **Fix:** Capture currentBranch before createBranch and restore it (git checkout <original>) in a finally-style step after the recipe's mutations/push, for both withRecipe and selfUpdating. Or operate against a dedicated clone/worktree rather than the operator's primary checkout.
- [ ] fixed

### R24 · parseEnvFile silently drops `export KEY=value` lines — a common hand-edit mistake → confusing downstream 'missing credential' error

- **Where:** `src/util/credentials.ts:23-24`
- **Lens:** cli-glue
- **Why:** The key validator `/^[A-Za-z_][A-Za-z0-9_]*$/` is applied to everything left of the first `=`. For a line `export AIRTABLE_PAT=patXXX` the key becomes `export AIRTABLE_PAT` (contains a space), fails the regex, and the line is skipped with no warning. Reproduced: parseEnvFile('export AIRTABLE_PAT=patABC\nRESEND_API_KEY=re_123') returns only RESEND_API_KEY. Per the team's own memory note, the operator repeatedly mis-edits this credentials file; `export FOO=` is the single most common shell-env idiom to paste in. The result is loadCredentialsIntoEnv applies nothing for that key, and the command fails far downstream with an opaque 'AIRTABLE_PAT missing' error that points nowhere near the actual…
- **Fix:** Strip a leading `export ` token before parsing the key (dotenv does this), or at minimum, when a non-blank non-comment line is skipped, emit a one-line stderr warning naming the offending line so the misformat is self-evident.
- [ ] fixed

### R25 · self-updating writes the broad GitHub token as a repo secret to an unvalidated Airtable-controlled owner/repo

- **Where:** `src/recipes/self-updating/index.ts:41`
- **Lens:** dim-security
- **Why:** resolveRepo returns site.gitRepo verbatim from the Airtable Git repo field (mapped at websites.ts:120) with no validation; the owner/repo guard exists only on the clone path (clone-if-needed.ts:65,79). That repo flows into github.setRepoSecret(repo, RENOVATE_TOKEN, renovateToken), which runs gh secret set RENOVATE_TOKEN --repo repo --body value (gh.ts:103-104), and renovateToken falls back to the broad GITHUB_TOKEN (config.ts:16). Scenario: set a site Git repo cell to attacker/evil; the nightly fleet self-update uses the org PAT to push the org RENOVATE_TOKEN/GITHUB_TOKEN secret into attacker/evil, where it is read from a workflow, exfiltrating the fleet token via one data-poisoning edit.…
- **Fix:** Validate repo against the existing strict owner/repo regex in resolveRepo before any gh call, ideally pinned to a known-org allowlist. Make setRepoSecret/protectBranch/enableRepoAutoMerge reject a non-strict owner/repo, mirroring the GraphQL readers.
- [ ] fixed

### R26 · Send orchestrator doesn't handle Resend's same-key/different-body 409 → a delivered-but-unstamped report wedges permanently

- **Where:** `src/reports/send/orchestrate.ts:210-212`
- **Lens:** dim-data-integrity
- **Why:** sendOne uses idempotencyKey `report:${report.id}` (stable across retries) and only stamps `Sent at` AFTER client.send returns (line 211). The at-least-once design (daily-reports.yml:59-68) relies on: if stampSent fails after a successful send, tomorrow's run replays the SAME key and Resend returns the original id (no dup). That only holds if the request BODY is byte-identical on the retry. It is not guaranteed to be: the header image is re-fetched from Airtable's signed URL and re-encoded through sharp/libjpeg every send (header-image.ts:63-67, the base64 bytes go into the request body), and the subject falls back to `new Date()` when `report.completedOn` is null (orchestrate.ts:142). Any…
- **Fix:** Wrap client.send in sendOne with the same isIdempotencyConflict handling the digest uses: on a 409 conflict, treat the send as already-done and proceed to stampSent (stamp `Sent at`; ideally also persist the original messageId). Reuse the existing isIdempotencyConflict helper (export it from digest.ts or move it to a shared module). Independently, make the send body deterministic for a given row (don't fall back to `new Date()` for the subject when completedOn is null — derive it from…
- [ ] fixed

### R27 · Launch flip-on-send is a separate write after stampSent — a failure there leaves a sent Launch report with the site stuck in 'launch period'

- **Where:** `src/reports/send/orchestrate.ts:82-89 and src/reports/airtable/websites.ts:285-292`
- **Lens:** dim-data-integrity
- **Why:** For a Launch report, sendOne first stamps `Sent at` (orchestrate.ts:211, inside sendOne), and only AFTER it returns does sendApprovedReports call updateLaunched to flip Status→maintenance + stamp `Launched at` (82-89). These are two independent Airtable writes with no atomicity. If updateLaunched fails (429/outage/network), the report IS marked sent (so it will never re-send — the Sent-at guard excludes it), but the site stays `Status = launch period` with `Launched at = null` forever. The failure is only a console-logged warning (line 87) and `anyFailed` is NOT set, so the run still exits 0 — the tracking-issue alerting never fires. There is no reconciler that retries the flip on the next…
- **Fix:** Make the launch transition self-healing independent of the send event: e.g. on each send/cron, reconcile any site that has a sent Launch report but Status still 'launch period' → flip it. At minimum, count the flip failure into anyFailed (return code 1) so the M5 tracking issue surfaces it, rather than swallowing it as a warning on a green run.
- [ ] fixed

### R28 · AttentionItem contract is owned by a leaf renderer (reports/digest.ts), creating an import cycle with the alerts/ collectors that produce it

- **Where:** `src/reports/digest.ts:43-57 (type def) + 14-16 (imports from ../alerts); src/alerts/digest-collectors.ts:2 and src/alerts/digest-state.ts:4 (import AttentionItem back)`
- **Lens:** dim-architecture
- **Why:** reports/digest.ts imports VALUES from alerts/digest-collectors.ts, alerts/renovate.ts, and alerts/digest-state.ts (lines 14-16), while alerts/digest-collectors.ts:2 and alerts/digest-state.ts:4 import the AttentionItem TYPE back from reports/digest.ts. That's a genuine module cycle. It survives at runtime today only because the back-edge is type-only (erased by tsup), but it means the shared data contract for the entire M5 attention subsystem lives in a 434-line file whose primary job is HTML rendering. Anyone refactoring digest.ts (e.g. splitting the renderer out) risks turning the type-only edge into a value edge and getting a real TDZ/circular-init failure. It also makes the dependency…
- **Fix:** Move AttentionItem, AttentionSeverity, AttentionStatus, ReadyItem, and DigestSections into a small contract module (e.g. src/alerts/attention.ts or src/alerts/types.ts) that has no dependencies. Have digest.ts, digest-collectors.ts, digest-state.ts, and fleet-cockpit.ts all import the type from there. This breaks the cycle and puts the alerts contract under alerts/, where its producers live.
- [ ] fixed

### R29 · Digest and cockpit use two different Renovate collectors with incompatible diff keys against one shared snapshot, so cockpit renovate badges never diff correctly

- **Where:** `src/reports/digest.ts:271-272 (live sweep → renovateFindingsToAttention) vs src/dashboard/fleet-cockpit.ts:137 (collectRenovateAlerts); keys defined in src/alerts/digest-collectors.ts:177 (renovate:<repo>#<number>) vs :128 (renovate:<siteId>)`
- **Lens:** dim-architecture
- **Why:** The daily digest computes Renovate-failing-CI from a LIVE GitHub sweep and emits items keyed `renovate:<repo>#<number>` (+ `renovate:skipped`). The digest then writes those keys into the single shared 'Digest State' snapshot via writeDigestState (digest.ts:394). The fleet cockpit reads that SAME snapshot (netlify/functions/fleet-homepage.mts:72 → buildCockpitModel → diffAttention) but produces renovate items keyed `renovate:<siteId>` from the persisted nightly field. Because the key namespaces never overlap, every renovate item the cockpit shows is diffed against a prior entry that doesn't exist, so it is ALWAYS tagged NEW and can never read as WORSE/standing — the NEW/WORSE feature is…
- **Fix:** Pick one source of truth for the renovate signal and one key scheme. Easiest: have the cockpit's collectRenovateAlerts emit the same `renovate:<repo>#<number>` key shape the digest writes (or vice-versa), or stop diffing renovate on the cockpit explicitly. Add a test asserting that the digest's renovate keys and the cockpit's renovate keys for the same fleet state are equal.
- [ ] fixed

### R30 · Five byte-identical HTML/XML escape functions with no shared util

- **Where:** `src/reports/digest.ts:69 (esc); src/dashboard/render.ts:7 (escapeHtml); src/dashboard/fleet-render.ts:7 (escapeHtml); src/reports/maintenance-email/template.ts:31 (escapeXml, re-exported into launch-email/template.ts:4)`
- **Lens:** dim-architecture
- **Why:** esc/escapeHtml/escapeXml all have the identical body (& < > " ' replacements). They are security-load-bearing: every one of them is the XSS/injection guard for operator- and site-controlled strings (site names like 'Brown & Co', commentary, URLs) interpolated into HTML/strict-MJML. Today they happen to agree, but with 5 copies and no single source, a future fix to one (e.g. the recurring need to also handle a stray char, or a decision to NOT escape ' in an HTML-only context) will diverge silently — and a divergence in an escape function is a security regression, not a cosmetic one. The safeUrl() helper is ALSO duplicated byte-for-byte between render.ts:17 and fleet-render.ts:16. src/util/…
- **Fix:** Add src/util/html.ts exporting escapeHtml (and safeUrl). Have digest.ts, both dashboard renderers, and the maintenance-email template import it. The MJML strict-XML case is satisfied by the identical body, so one function covers all five call sites; a single doc comment can note the strict-MJML constraint.
- [ ] fixed

### R31 · 38-field WebsiteRow fixture hand-rolled in 7+ test files with no shared factory

- **Where:** `tests/dashboard/fleet-cockpit.test.ts:10, tests/dashboard/render.test.ts:6, tests/dashboard/fleet-render.test.ts:17, tests/alerts/digest-collectors.test.ts:16, tests/reports/draft.test.ts:36, tests/reports/due.test.ts:6, tests/cli/report-command.test.ts:~59 (each defines its own site()/siteRow()/siteFixture())`
- **Lens:** dim-architecture
- **Why:** WebsiteRow (src/reports/airtable/websites.ts:17) has 38 required, non-optional fields. Because none are optional, every test that needs a row must enumerate all 38 — verified two of them (fleet-cockpit.test.ts and digest-collectors.test.ts) are near-identical literals. A shared fake-airtable-base.ts helper exists in tests/reports/\_helpers/ but there is no shared WebsiteRow factory, so the literal is copied at least 7 times. Adding ANY field to WebsiteRow (the schema grows steadily — renovateFailingCis, defaultBranchCi, copyIntro, launchedAt were all recent additions) forces a TypeScript error and a manual edit in every one of these files. That is a recurring multi-file tax on every…
- **Fix:** Add tests/\_helpers/website-row.ts exporting `makeWebsiteRow(over: Partial<WebsiteRow> = {}): WebsiteRow` with sensible nulled defaults, and have the 7 test files import it. New WebsiteRow fields then default in one place; tests only override what they assert on.
- [ ] fixed

### R32 · smoke-dist checks dist index exports, not the handlers deep-path imports

- **Where:** `scripts/smoke-dist.mjs:96`
- **Lens:** dim-tests
- **Why:** It asserts the 3 renderers but not getWebsiteBySlug/listReportsForSite/listAllReports/readDigestState/buildCockpitModel, which the handlers import directly, so the dist gate misses a rename too.
- **Fix:** Add those names to required-exports or import each handler dep in smoke-dist.
- [ ] fixed

### R33 · Full WebsiteRow fixture hand-copied across 8 test files, no shared factory

- **Where:** `tests/dashboard/fleet-render.test.ts:17`
- **Lens:** dim-tests
- **Why:** Eight files declare the full WebsiteRow shape inline; exactOptionalPropertyTypes makes one new column force edits in all eight or the suite fails typecheck.
- **Fix:** Add a makeWebsiteRow factory to tests/reports/\_helpers.
- [ ] fixed

### R34 · Real Resend client defaultResendClient is never executed

- **Where:** `src/reports/send/resend.ts:35`
- **Lens:** dim-tests
- **Why:** All send/digest tests inject a fake, so the SDK payload mapping and the error-wrap prefix the digest idempotency-skip greps for are unasserted; a field rename passes tests while real sends fail.
- **Fix:** Unit-test it with the SDK mocked: field forwarding, messageId, error-wrap prefix.
- [ ] fixed

## LOW (28)

### R35 · Recipient and CC validation runs only AFTER the header fetch + sharp downscale + full MJML render — wasted work and a wider signed-URL-expiry window before the cheap guard fails

- **Where:** `src/reports/send/orchestrate.ts:115-119 (fetch+sharp) and 123-140 (render) precede 145-172 (recipient/CC validation)`
- **Lens:** send-path
- **Why:** sendOne fetches the (often multi-MB) Airtable header (115), runs two sharp passes (header-image.ts:63-69), loads bundled images (119), and renders the whole MJML email (123-140) BEFORE it ever checks that the site has a valid recipient (150) or that addresses are well-formed (155-172). For a site with an empty/malformed recipient — exactly the common operator mistake the validation exists to catch — every send-ready run burns a header download + two image transcodes + a render only to throw 'no recipients'. Beyond wasted work, the Airtable header URL is a short-lived signed URL (websites.ts:40 'fetch before expiry'); doing the fetch early and validation late narrows nothing but widens the…
- **Fix:** Move the recipient/CC parse + isProbablyEmail validation (and the lighthouse/header presence guards) to the TOP of sendOne, before fetchAttachmentBytes/prepareHeaderImage/renderReportHtml. Fail fast on bad config; only spend the fetch/transcode/render budget on rows that will actually send.
- [ ] fixed

### R36 · CC is validated for shape but a CC array that survives parsing as identical to To can silently CC the same address; and CC failures abort an otherwise-deliverable report

- **Where:** `src/reports/send/orchestrate.ts:163-172, 208`
- **Lens:** send-path
- **Why:** parseAddresses dedupes WITHIN a field but To and CC are parsed independently (145, 163), so an operator who puts the same address in both Report recipients (To) and (CC) sends the client a visibly self-CC'd email (minor, cosmetic). More substantively, a malformed CC throws and aborts the whole send (167-169) even though the To recipients are valid — a stray character in the optional CC field blocks a report the client should have received. CC is a secondary/optional field; letting it harden-fail the primary delivery is a footgun on the money path.
- **Fix:** Cross-dedupe CC against To (drop any CC already in To). Consider degrading a malformed CC to a warning + drop-the-CC rather than aborting the send, since To is the contract; or at least surface it distinctly so the operator knows the report did/didn't go out.
- [ ] fixed

### R37 · fetchAttachmentBytes accepts any 200 response as image bytes; a 200 HTML error/login page would flow into sharp and produce a confusing failure or a broken inline image

- **Where:** `src/reports/airtable/attachments.ts:1-13 and src/reports/send/orchestrate.ts:115-118`
- **Lens:** send-path
- **Why:** fetchAttachmentBytes only checks res.ok (attachments.ts:5) and returns whatever bytes came back, ignoring content-type. Airtable signed URLs normally 403 on expiry (caught), but a CDN/proxy interstitial or an HTML error body served with HTTP 200 would pass the ok check and be handed to sharp(input).metadata() (header-image.ts:49). sharp then throws a generic 'unsupported image format'-style error attributed to prepareHeaderImage, which surfaces to the operator as an opaque send failure for that site rather than 'header URL returned non-image'. Low likelihood but it degrades to a misleading error on a path that already has a fragile external dependency.
- **Fix:** Validate the response content-type starts with image/ (or sniff the magic bytes) in fetchAttachmentBytes / before prepareHeaderImage, and throw a clear 'header image URL returned <type>, not an image' so the operator can re-set the Header image field.
- [ ] fixed

### R38 · findReportByPeriod returns the first page-order siteId match, which is non-deterministic when duplicates exist — launch/dedupe can re-flip an arbitrary row

- **Where:** `src/reports/airtable/reports.ts:318-335 + src/recipes/launch.ts:119-160`
- **Lens:** airtable-data
- **Why:** findReportByPeriod selects `{Report type}=… AND {Period}=…` with pageSize:100 (no maxRecords, no sort) and returns `rows.find(r => r.siteId === siteId)` — i.e. whichever matching row Airtable happens to return first. If the dup-draft-race (or any double-create) ever produces two Launch/Maintenance rows for the same (site,type,period), launch.ts reuses an _arbitrary_ one and setDraftReady(true)s it (launch.ts:120,160), while the other stays orphaned. For Launch specifically, findReportByPeriod also does not exclude already-_sent_ rows, so a re-run after a successful launch re-flips Draft ready on the sent row; it's harmless today only because the pending gate also requires sentAt===null, but…
- **Fix:** Add a deterministic `sort` (e.g. by Created time or Report ID) so the chosen row is stable, and for the launch/idempotency path prefer the most-recent _unsent_ row (filter sentAt===null) so a re-run after send doesn't touch the delivered row.
- [ ] fixed

### R39 · No snapshot/golden test pins the static template body or asserts checklist-label escaping; the "byte-identical" contract is only fragment-checked

- **Where:** `tests/reports/render.test.ts:242-263 (and absence of any __snapshots__)`
- **Lens:** templates-copy
- **Why:** There is no toMatchSnapshot/golden file anywhere under tests/reports (verified). render.test.ts asserts only small fragments, and the comment at line 242 even names a "Byte-identical" intent but only checks that a maintenanceIntro override swaps one string — it does not pin the rest of the large static MJML (section structure, paddings, dividers, Lighthouse band labels/ranges). A refactor that drops or reorders a non-asserted section would ship green. Crucially, no test feeds a special character into maintenanceChecks/testingChecklist, so TC-1's missing escape is invisible to CI. This is the test gap that makes TC-1 and TC-3 dangerous over time.
- **Fix:** Add an inline-snapshot (or golden HTML) test of one full Maintenance render and one full Launch render with fixed data, plus a focused test feeding `<`/`&`/`"` into a maintenanceChecks override and asserting entity-encoding. The snapshot makes any unintended byte drift explicit and reviewable.
- [ ] fixed

### R40 · siteUrl flows into the header href with no scheme/shape validation (escapeXml does not sanitize URLs)

- **Where:** `src/reports/maintenance-email/template.ts:154-165 (headerImageTag href)`
- **Lens:** templates-copy
- **Why:** headerImageTag puts escapeXml(data.siteUrl) into `href="..."`. escapeXml only entity-encodes &<>"' — it does not validate the URL. I confirmed a siteUrl of `javascript:alert(1)` or `https://x.com/ onmouseover=alert(1)` passes through into the rendered href unchanged (the space/scheme are not neutralized). Risk is genuinely low: siteUrl is operator-controlled (the operator owns the Airtable base, so this is self-inflicted, not an external-attacker vector) and email clients generally neutralize javascript: hrefs and don't run inline handlers. But the header link is the most prominent CTA in the email, and a malformed/garbage siteUrl (stray newline, missing scheme) silently produces a broken…
- **Fix:** Validate siteUrl is http(s) and well-formed at the boundary (e.g. when mapping the Websites row or in headerImageTag), falling back to omitting href or to a known-good value, rather than trusting whatever string is in the `url` cell.
- [ ] fixed

### R41 · CSRF guard relies solely on Sec-Fetch-Site with no Origin fallback for the header-absent path it deliberately allows

- **Where:** `netlify/functions/approve-report.mts:57-60`
- **Lens:** dashboard-web
- **Why:** The guard rejects only when Sec-Fetch-Site is present AND not same-origin/none; when the header is ABSENT it proceeds and 'falls back to Basic auth' (comment lines 50-56). But Basic auth is not CSRF protection here: a browser with cached Basic creds for the realm auto-replays the Authorization header on a cross-site request, and the approve POST needs no body or custom header a forged form/fetch couldn't produce. So for any client that omits Sec-Fetch-Site there is effectively zero CSRF defense. The comment claims an 'Origin fallback' but the code checks only sec-fetch-site — no Origin/Referer check exists. Modern browsers all send Sec-Fetch-Site so real-world exposure is small, which is…
- **Fix:** When sec-fetch-site is absent, fall back to an Origin/Referer host check against the request host (reject when Origin is present and cross-host), so the 'older/non-browser client' path isn't left with no cross-site defense. Or drop the absent-header allowance and require Sec-Fetch-Site for this state-changing POST.
- [ ] fixed

### R42 · openPullRequests caps at first:100 open PRs with no pagination — failing Renovate PRs beyond the cap are silently missed

- **Where:** `src/github/gh.ts:175-214`
- **Lens:** alerts-github
- **Why:** The GraphQL query requests pullRequests(states:OPEN, first:100, orderBy:CREATED_AT DESC) and never follows pageInfo/endCursor. A repo with >100 open PRs returns only the 100 newest; an older failing-Renovate PR pushed past position 100 by a pile of newer human PRs is invisible to the sweep, so the alerting tool — whose whole stated bias (renovate.ts:8-11) is to prefer over-matching to silently missing a broken update — silently misses it and the cockpit/email under-report. Low because the current fleet (~12 sites) rarely approaches 100 open PRs, but it's a correctness gap that scales poorly with the 200-site vision and fails silently (no skip, no error).
- **Fix:** Either paginate via pageInfo.hasNextPage/endCursor, or narrow the query to Renovate branches with search (`is:pr is:open head:renovate/`), or at least flag when nodes.length === 100 so an over-cap repo isn't mistaken for fully-swept.
- [ ] fixed

### R43 · writeDigestState get-or-create can create duplicate 'Digest State' rows, and read/write pick an arbitrary 'first' row

- **Where:** `src/alerts/digest-state.ts:62-79, 88-110`
- **Lens:** alerts-github
- **Why:** Both readDigestState and writeDigestState assume the table holds exactly one row but enforce nothing: they select maxRecords:1 and act on rows[0]. writeDigestState re-selects then create()s when no row is found (digest-state.ts:104-108) — a check-then-act with no uniqueness constraint (Airtable has none). The daily cron is single-flighted (concurrency group m3-daily) so two scheduled digests can't race, which mostly protects this; but a manual run path or any future second writer (the memory shows the cockpit was deliberately kept read-only precisely to avoid this) plus a first-ever-run race could leave two rows. From then on, readDigestState reads whichever row Airtable returns first while…
- **Fix:** Make the singleton self-healing: on read, if >1 row exists, pick deterministically (e.g. newest Updated At) and delete the rest; or store under a fixed known record id; or assert maxRecords and log when more than one row is seen.
- [ ] fixed

### R44 · messageForAssertion calls a.actual.toFixed(2) on external lhci JSON without a type guard; a malformed assertion entry discards otherwise-valid Lighthouse scores

- **Where:** `src/audits/lighthouse.ts:102 (`a.actual.toFixed(2)`), reached from parseLhciResults:128-133`
- **Lens:** audits
- **Why:** assertion-results.json is parsed straight into AssertionResult[] (lighthouse.ts:125-126) with no shape validation, then every failed assertion is mapped through messageForAssertion which assumes `actual` is a number. If lhci (or a future version) ever emits an assertion whose `actual` is null/undefined/string (e.g. an assertion that couldn't compute against a null category score), `.toFixed` throws a TypeError. That throw propagates out of lighthouseAudit and is caught by runOneAudit (index.ts:39-46), which converts it to status:'fail' with NO details. hasRealScores then returns false because details.summary is gone — so a run where the lhr-\*.json files contained perfectly good scores gets…
- **Fix:** Guard the cast: `const actual = typeof a.actual === 'number' ? a.actual.toFixed(2) : String(a.actual)`, and similarly defend categoryFromAssertion against a non-string `name`. The score path (lhr scanning) is already null-tolerant; the assertion path should be too so a malformed assertion can't discard good scores.
- [ ] fixed

### R45 · All audits for a site run concurrently and mutate the same checkout (pnpm install writing node_modules, rm -rf .lighthouseci/.reddoor-a11y, two vite dev servers)

- **Where:** `src/cli/commands/audit.ts:116 (single-site `concurrent: true`) and :129-137 (fleet per-site `Promise.all(which.map…)`); deps-outdated.ts:52-58 (`pnpm install --frozen-lockfile`); lighthouse.ts:178-179 & a11y.ts:194 (rm inside site.path); both boot `npm run vite:dev``
- **Lens:** audits
- **Why:** Within one site every audit runs in parallel. On a freshly-cloned fleet site (cloneIfNeeded does NOT install — clone-if-needed.ts:107 is a bare `git clone`), node_modules is absent, so simultaneously: deps' scanOutdated fires a cold `pnpm install --frozen-lockfile` (writing node_modules), a11y and lighthouse each spawn `npm run vite:dev` (which need node_modules and may trigger their own installs or fail because the vite binary isn't there yet), and security runs `pnpm audit`. Two concurrent installs/dev-server boots against the same node_modules and a shared pnpm store is a real race that produces nondeterministic first-run failures (and, per AUD-1, those failures cascade into the fleet…
- **Fix:** Either run the install-bearing/checkout-mutating audits (deps, a11y, lighthouse-checkout) sequentially per site, or ensure node_modules is materialized once (single `pnpm install`) before fanning out the audits, so no audit triggers an install while another reads node_modules.
- [ ] fixed

### R46 · Stdout is decoded per-chunk with String(chunk), splitting multi-byte UTF-8 across chunk boundaries before JSON.parse

- **Where:** `src/audits/util/spawn.ts:74-75 (`String(chunk)` per data event); consumed as JSON in security.ts:157 and deps-outdated.ts:66`
- **Lens:** audits
- **Why:** child.stdout emits Buffers; `String(chunk)` decodes each Buffer independently. A UTF-8 character whose bytes straddle two chunks is decoded as two replacement chars (U+FFFD…). For lighthouse/a11y this is harmless (JSON is read from files), but security.ts and deps-outdated.ts JSON.parse stdout directly. pnpm/npm advisory titles routinely contain non-ASCII; if such a byte sequence is split at a chunk boundary the parsed title is mangled (replacement chars). JSON.parse itself still succeeds (U+FFFD is a valid string char), so this is cosmetic corruption of advisory titles rather than a hard failure — hence low — but it's a latent decoding bug.
- **Fix:** Use a StringDecoder (node:string_decoder) to carry partial multibyte sequences across chunks, or set child.stdout.setEncoding('utf8') and accumulate, so chunk boundaries never bisect a character.
- [ ] fixed

### R47 · self-updating's protectBranch PUT replaces ALL required-status-check contexts, silently dropping any a repo already required

- **Where:** `src/recipes/self-updating/index.ts:112-118; src/github/gh.ts:83-102`
- **Lens:** recipes
- **Why:** When the base branch's protection doesn't already include "ci / ci", selfUpdating calls protectBranch(repo, base, [REQUIRED_CHECK]), which issues a full PUT to /branches/{branch}/protection setting required_status_checks[contexts][] to ONLY ["ci / ci"] (gh.ts:93) and also forces enforce_admins=true, required_pull_request_reviews=null, restrictions=null (96-99). On a repo that already had other required checks (e.g. "netlify/deploy", "build", a CodeQL gate) or required reviews, this PUT wipes them — the branchProtectionContexts check (line 112) only tests for the PRESENCE of "ci / ci", so any repo missing exactly that context gets its entire protection config overwritten. The code comment…
- **Fix:** Read the existing protection (it's already fetched for contexts) and merge: PUT the union of existing contexts + REQUIRED_CHECK, and preserve existing required_pull_request_reviews/enforce_admins/restrictions rather than nulling them. Only overwrite fields you intend to manage.
- [ ] fixed

### R48 · launch re-run unconditionally flips draftReady=true on the existing row, silently re-arming a draft an operator may have intentionally un-readied

- **Where:** `src/recipes/launch.ts:119-120,160`
- **Lens:** recipes
- **Why:** findReportByPeriod matches on (siteId, reportType, period) regardless of the row's draftReady/approvedToSend/sentAt state. If an operator reviewed the first Launch draft and deliberately set Draft ready=false (or edited it pending changes), a second `launch <site>` run re-renders and force-sets draftReady=true (160) with no check on current state, re-arming it into the approve queue behind the operator's back. (A fully-sent row is protected because listSendableReports filters Sent at = BLANK, so this won't double-send — but it does resurrect an intentionally-held draft and overwrite the operator's review state.)
- **Fix:** Before re-flipping, branch on the existing row: skip setDraftReady when the row is already sent or has been explicitly un-readied/approved, or surface a noop/warning rather than silently re-arming. Only auto-ready freshly created drafts.
- [ ] fixed

### R49 · A failed multi-commit recipe reports status "failed" with the partial commits but no rollback, conflating "nothing happened" with "half-applied and committed"

- **Where:** `src/recipes/_with-recipe.ts:96-104; src/recipes/convert-to-pnpm.ts:59-98`
- **Lens:** recipes
- **Why:** convert-to-pnpm commits step 1 (remove lockfile) and step 2 (pin packageManager + rewrite scripts) before step 4's pnpm install, which can fail and return {kind:"failed"}. withRecipe then returns status:"failed" with commits:[sha1, sha2] (lines 96-104) and leaves the branch with those two commits in place. A caller that treats "failed" as "safe to retry from clean state" is wrong — the branch now permanently lacks a lockfile and has a half-pnpm package.json. Combined with the clean-tree guard, the operator must manually reset. The result shape gives no signal that commits were left on a now-broken branch.
- **Fix:** Either make multi-commit recipes transactional (reset --hard back to the branch point and delete the branch on failure) or have withRecipe annotate failed-with-commits results so callers/operators know a partial, committed branch was left behind and needs cleanup.
- [ ] fixed

### R50 · Unknown/mistyped subcommand exits 0 with no output — typos in cron/CI silently 'succeed'

- **Where:** `src/cli/bin.ts:332 (cli.parse) — no default/catch-all command`
- **Lens:** cli-glue
- **Why:** cac is configured with named commands only and no `cli.command('[...]')` catch-all or post-parse matchedCommand check. Reproduced: `reddoor-maint bogus-cmd` runs no action, cli.parse() returns normally, and the process exits 0 (cli.matchedCommand is undefined). This tool drives crons/CI (daily-reports, fleet-lighthouse) where a single mistyped invocation — e.g. `reddoor-maint reprot --due` or `report --send-redy` — would produce no error, no output, and a green exit. The operator believes reports drafted/sent when nothing ran. Given the whole product is an unattended approve-only automation loop, a silent no-op masquerading as success is a real reliability hole.
- **Fix:** After cli.parse(), if `!cli.matchedCommand` and args[0] is present (and not a help/version short-circuit), print 'unknown command: <x>' to stderr and process.exit(2). cac exposes `cli.matchedCommand`; gate on it explicitly rather than trusting parse() to fail.
- [ ] fixed

### R51 · smoke-dist gate omits launch, self-updating, github-signals — the heaviest-dynamic-import commands ship unverified against dist

- **Where:** `scripts/smoke-dist.mjs:60-72 (expectedSubcommands)`
- **Lens:** cli-glue
- **Why:** The gate's stated purpose includes 'CLI subcommand dynamic-import paths broken by bundling', and it exercises `<cmd> --help` for each listed command to prove the bundled action loads. But expectedSubcommands lists only 11 of the 14 registered commands — it's missing `self-updating`, `launch`, and `github-signals`, all added after the list was written. These three pull in the most dynamic imports at runtime (report/airtable client, github/gh, recipes/launch, recipes/self-updating). A tsup/bundling change that breaks a dynamic-import path in any of them passes the entire post-build smoke gate and ships. The contract the lens asked about (requiredExports) is enforced, but the subcommand half…
- **Fix:** Derive expectedSubcommands from a single source of truth shared with bin.ts (or assert the help output lists every registered command), and add the three missing commands. github-signals takes no positional so its `--help` is safe to exercise like the others.
- [ ] fixed

### R52 · First-time clone ignores a JSON/mjs inventory's explicit absolute `path`, cloning to {workdir}/{name} instead

- **Where:** `src/cli/fleet/clone-if-needed.ts:98 (target = join(opts.workdir, name)); fleet commands default workdir to ${HOME}/.reddoor-maint/sites`
- **Lens:** cli-glue
- **Why:** fromJsonFile requires and validates that each entry's `path` is absolute, telling the inventory author 'this is where the checkout lives.' But when that path doesn't yet exist, cloneIfNeeded clones to `join(opts.workdir, name)` — NOT to `site.path` — and returns a site with the new target path. So a JSON inventory entry `{path:'/Users/me/projects/foo', gitRepo:'org/foo'}` on a fresh machine gets cloned to `~/.reddoor-maint/sites/foo`, silently disregarding the operator's stated location. The returned site is internally consistent, so nothing errors; the author just finds their repo checked out somewhere they didn't ask for, and a second run against the real /Users/me/projects/foo (once they…
- **Fix:** When site.path is an explicit absolute path (JSON/mjs inventory) and is missing, clone TO site.path (creating its parent) rather than to {workdir}/{name}. Reserve the {workdir}/{name} target for the Airtable provider where path is synthetic. Or document loudly that --fleet <file> ignores `path` for cloning.
- [ ] fixed

### R53 · Fleet workdir default becomes filesystem-root path when HOME is unset (cron/minimal CI)

- **Where:** `src/cli/commands/audit.ts:274 and identical lines in sync-configs.ts:89, bump-deps.ts:42, convert-to-pnpm.ts:32, svelte-codemods.ts:32, onboard.ts:50, init.ts:59, upgrade.ts:43, self-updating.ts:33`
- **Lens:** cli-glue
- **Why:** Every fleet command computes `const workdir = opts.workdir ?? `${process.env.HOME ?? ''}/.reddoor-maint/sites``. In a context where HOME is unset (some systemd/cron units, stripped container CI), this evaluates to `/.reddoor-maint/sites`— an absolute path at the root of the filesystem. cloneIfNeeded then`mkdir`s it recursively; on most hosts this fails with EACCES at the root, but the error surfaces as a generic mkdir failure rather than a clear 'HOME unset' message, and on a permissive host it scatters clones at `/`. The default is also duplicated verbatim across nine files, so any fix must be applied nine times.
- **Fix:** Factor the default into one helper (e.g. defaultFleetWorkdir()) that uses os.homedir() (which has its own fallbacks) and throws a clear error if no home can be resolved, rather than producing a root-anchored path. Reuse it across all fleet commands.
- [ ] fixed

### R54 · github-signals returns exit 0 when only one site writes but the rest of the fleet's probes fail

- **Where:** `src/cli/commands/github-signals.ts:78`
- **Lens:** cli-glue
- **Why:** Exit code is `result.failed.length > 0 && result.written.length === 0 ? 1 : 0`. If a GitHub-wide outage makes 11 of 12 sites' probes fail but one stale-cached write succeeds, written.length===1 so the command exits 0 despite a fleet-wide signal collection failure. In the nightly workflow this is currently masked by `continue-on-error: true`, so it's latent, but any future direct/manual invocation (or removal of continue-on-error) would treat a near-total failure as success. The skipped-probe entries are pushed to result.failed yet never influence the code unless ZERO writes happened.
- **Fix:** Make the exit code reflect a partial-failure threshold (e.g. non-zero if failed > 0 at all, or if failed exceeds some fraction), and document the chosen semantics so the workflow's continue-on-error is a deliberate override rather than the only thing preventing a false-green.
- [ ] fixed

### R55 · gh API path interpolation of unvalidated repo/branch/path can target unintended endpoints

- **Where:** `src/github/gh.ts:121`
- **Lens:** dim-security
- **Why:** Many gh methods build the REST path by interpolating repo, branch, and path into the gh api argument: repos/repo (gh.ts:81,107,111,154,158), repos/repo/branches/branch/protection (gh.ts:88,131), and repos/repo/contents/p with a ref=branch query (gh.ts:121). branch comes from defaultBranch (a GitHub API response) and repo from Airtable (see SEC-1). These are single argv tokens with no shell, so not classic RCE, but a value containing a slash, question mark, hash, or dot-dot rewrites which API resource the privileged token operates on. filesOnBranch injects an unencoded ref query (gh.ts:121), so a branch with ampersand or hash mangles the query. Combined with SEC-1 this widens the blast…
- **Fix:** Add a shared assertRepo (strict owner/repo) and assertBranch (no leading dash, no dot-dot, no control chars) used by every method, and encodeURIComponent the path segments and ref query value in filesOnBranch.
- [ ] fixed

### R56 · Netlify error responses echo raw upstream/Airtable error messages to the client

- **Where:** `netlify/functions/resend-webhook.mts:95`
- **Lens:** dim-security
- **Why:** The webhook returns raw exception text in the HTTP body: a signature-verification message (line 70), an Airtable-lookup-failed message (line 95), and an Airtable-update-failed message (line 128). The endpoint is publicly reachable; these catch blocks fire on the Airtable lookup/update and on signature parsing. Airtable SDK and svix error strings can carry request context, record ids, table/field hints, and status detail. An attacker probing the public webhook URL uses these reflected messages to fingerprint the backend (which field/table failed, rate-limit vs auth vs outage), which is information disclosure aiding further targeting. The pattern recurs and should be treated as a class.
- **Fix:** Return a generic status string to the wire (internal error, lookup failed) and keep the detailed message in the server-side console.error only; the function already logs richly.
- [ ] fixed

### R57 · Basic-auth comparison leaks password length via an early return before the constant-time compare

- **Where:** `src/dashboard/basic-auth.ts:38`
- **Lens:** dim-security
- **Why:** The length check returns before timingSafeEqual, so the response-time difference between a wrong-length and a right-length-wrong-password guess reveals the exact password length to a remote attacker measuring timing. The comment argues the length does not leak because it is fixed per deploy, which is exactly why leaking it is undesirable: it gives an attacker the search-space dimension for the single shared password gating the whole cockpit and the approve endpoint. Exploitability is modest (network jitter, one operator), hence low, but it is a real deviation from constant-time intent.
- **Fix:** Compare fixed-width digests instead: timingSafeEqual over sha256 of each side, removing the length-dependent early return.
- [ ] fixed

### R58 · credentials.env is loaded with no file-permission check and is redirectable via XDG_CONFIG_HOME

- **Where:** `src/util/credentials.ts:42`
- **Lens:** dim-security
- **Why:** loadCredentialsIntoEnv reads the credentials file (AIRTABLE_PAT, RESEND_API_KEY, GITHUB_TOKEN, GA key path) into process.env with no check on the file mode or ownership: a world-readable or group-writable credentials file is loaded silently, and a co-tenant who can write that path can inject env such as a malicious GA_SA_KEY_PATH pointing at an attacker file. The path derives from XDG_CONFIG_HOME (credentials.ts:8), so an attacker who can set that env for the process redirects credential loading to a path they control. Requires local access, hence low, but for a tool wielding fleet-wide secrets the file deserves the mode/owner guard ssh and gpg apply to key files.
- **Fix:** Stat the credentials file and refuse or warn loudly if it is group/other-readable or writable; document that XDG_CONFIG_HOME affects credential resolution.
- [ ] fixed

### R59 · github-signals write-back keys its target map by gitRepo, so two sites sharing a repo collapse to one write target (lost update)

- **Where:** `src/cli/commands/github-signals.ts:51-73`
- **Lens:** dim-data-integrity
- **Why:** The sweep collects one GitHubSignalsRow per repo-backed site (github-signals.ts:30-49, iterating sites), but the write-back resolves the target Websites row via `byRepo = new Map(websites.filter(w => w.gitRepo).map(w => [w.gitRepo, w]))` (github-signals.ts:51) and `byRepo.get(row.repo)` (line 54). A JS Map keyed on gitRepo silently keeps only the LAST website for any duplicated repo. If two Websites rows point at the same owner/repo (e.g. a monorepo backing two site entries, or a copy/launch flow that cloned a repo reference), the signals for BOTH sites are written to whichever row the Map happened to retain, and the other site's `Renovate Failing CIs`/`Default Branch CI`/`Last Commit…
- **Fix:** Key the write-back by the same identity the sweep row carries (site name/slug), or carry the resolved Websites record id on GitHubSignalsRow at collection time so the write targets the exact row that produced the signal. If a repo legitimately backs multiple sites, write each site's row explicitly instead of deduping by repo.
- [ ] fixed

### R60 · Pending-approval predicate copy-pasted in four places despite a documented reuse helper

- **Where:** `src/reports/digest.ts:201 (listPendingApproval) and :308 (re-inlined); src/dashboard/render.ts:65 (isPendingApproval); src/dashboard/fleet-cockpit.ts:179`
- **Lens:** dim-architecture
- **Why:** The exact business rule `r.draftReady && !r.approvedToSend && r.sentAt === null` is written out four times. listPendingApproval (digest.ts:199) even carries a doc comment saying it is 'Exported: the fleet homepage reuses it' — but the fleet homepage path (fleet-cockpit.ts:179) re-inlines the predicate instead, and digest.ts:308 re-inlines it AGAIN ten lines above its own exported helper. This is the gate that decides whether the operator's one-click approval surfaces at all. If the rule ever changes (e.g. add a `!archived` clause, or treat a bounced report differently), three of the four sites will be missed and the digest count, the cockpit count, and the per-site dashboard will disagree…
- **Fix:** Export a single `isPendingApproval(r: ReportRow): boolean` from the reports/airtable/reports.ts layer (next to the type) and call it from all four sites, including digest.ts:308 and :201.
- [ ] fixed

### R61 · digest.ts (434 lines) mixes the attention contract types, HTML rendering, IO orchestration, and Resend error classification

- **Where:** `src/reports/digest.ts:22-64 (5 exported contract types), :84-159 + :412-434 (HTML rendering), :179-186 (isIdempotencyConflict error parsing), :256-408 (collectAttention + runDigest IO orchestration)`
- **Lens:** dim-architecture
- **Why:** This one file is simultaneously: (1) the owner of the shared AttentionItem/ReadyItem/DigestSections contract (which forces ARCH-1's cycle), (2) the HTML renderer (readySection/attentionSection/renderDigestHtml — which duplicates ARCH-3's esc and ARCH-4's predicate), (3) the IO orchestrator (runDigest reads Airtable, runs collectors, diffs state, sends, writes state), and (4) a Resend-409-message-string parser (isIdempotencyConflict, brittle by its own admission since it string-matches 'idempotency key has been used'). Each concern changes for a different reason; bundling them is why every other finding here touches this file. It's also the single highest-churn file in the report subsystem,…
- **Fix:** Split into: alerts/attention.ts (the contract types, per ARCH-1), reports/digest-render.ts (pure HTML, sharing the ARCH-3 escape util), and keep runDigest/collectAttention as the orchestrator in digest.ts. isIdempotencyConflict belongs next to the ResendClient in send/resend.ts so the message-string coupling lives with the code that produces the message.
- [ ] fixed

### R62 · approve-report.mts test mocks openBase and approveReport, wiring unexercised

- **Where:** `tests/dashboard/approve-report-adapter.test.ts:3`
- **Lens:** dim-tests
- **Why:** It never exercises the adapter wiring getReportByIdAirtable/approveReportRow into approveReport deps; only closure construction is uncovered (approveReport is tested separately in approve.test.ts).
- **Fix:** Optional: one integration test running real approveReport with only the fake base mocked.
- [ ] fixed

---

## Refuted (false positives — recorded for the record)

- **A wrong recipient corrected after a failed stamp is never re-delivered to the right address within 24h (idempotency dedupe wins)** (`src/reports/send/orchestrate.ts:145-162, 206`) — refuted: The claim's load-bearing premise is that "Resend keys dedupe on the Idempotency-Key alone, not the `to` field," so a corrected recipient with an "otherwise-identical body" gets silently deduped, returns the original message id, stampSent succeeds, and the operator sees a green "sent" line while the…
- **Launch preview render (launch.ts) omits the header dims/placeholder that the real send (orchestrate.ts) computes — the dashboard preview can differ from the delivered email** (`src/recipes/launch.ts:132-142 vs src/reports/send/orchestrate.ts:123-140`) — refuted: The structural facts check out: launch.ts:132-142 renders the "Rendered HTML" preview WITHOUT headerWidth/headerHeight/headerBgColor, while sendOne (orchestrate.ts:123-140) renders WITH them (137-139, sourced from prepareHeaderImage at 118). But the claim is a false positive on significance and…
- **Non-atomic read-then-create idempotency guard lets concurrent/retried `report --due` runs create duplicate drafts → duplicate client emails** (`src/cli/commands/report.ts:64-94 (guard) + src/reports/airtable/reports.ts:122-1`) — refuted: The code-mechanics half of the claim is accurate: draftDueReports (src/cli/commands/report.ts:64-94) reads `reports` once via listAllReports, then guards each item with an in-memory `reports.some(r => r.siteId===…&&r.reportType===…&&r.period===period)` (lines 77-79) with no fresh point lookup…
- **Same-day digest content change is swallowed as 'already sent today' — newly-drafted reports stay invisible to the operator until tomorrow** (`src/reports/digest.ts:357-388 (isIdempotencyConflict path) + 179-186`) — refuted: The code reads exactly as described, but it is intended-by-design and not a defect. Verified facts: idempotencyKey is `digest-${digestDateKey(today)}` (digest.ts:363) where digestDateKey returns `d.toISOString().slice(0,10)` (UTC date, 166-167). On a same-UTC-day re-send with a changed body, Resend…
- **writeDigestState get-or-create is non-atomic; a duplicated/parallel digest run can create a second 'Digest State' row, after which readDigestState reads an arbitrary one** (`src/alerts/digest-state.ts:88-110 + 62-79`) — refuted: The code pattern is described accurately: writeDigestState (digest-state.ts:88-110) does a non-atomic get-or-create — select({maxRecords:1}), create() if no row else update() by id — and readDigestState (62-79) returns rows[0] of an unsorted select with no stable key/filter and no >1-row…
- **repoExists returns true/false on EXIT CODE only — a token/network failure to a private repo reads as 'does not exist'** (`src/github/gh.ts:106-109`) — refuted: The cited code is read correctly: src/github/gh.ts:106-109 is `async repoExists(repo) { const r = await spawn("gh", ["api", `repos/${repo}`], {...}); return r.code === 0; }`, which does collapse every non-zero exit (404, 401/403, 5xx, network) to `false`. But the claim's severity rests entirely on…
- **renovate.ts siteLabel reads meta.displayName, but every live caller passes meta:{} — the display-name branch is dead** (`src/alerts/renovate.ts:41-46, src/reports/digest.ts:263-270, src/cli/commands/gi`) — refuted: The narrow factual core is true but the claim's characterization (and one of its citations) is refuted, so it does not "CLEARLY confirm a real problem." What checks out: `collectRenovateFailures` has exactly ONE production caller — `src/reports/digest.ts:271`, inside `collectAttention` — which…
- **A Lighthouse miss is recorded as a whole-site write FAILURE, conflating LH flake with Airtable write-back failure in the CI gate** (`src/audits/write-audits-to-airtable.ts:96-108 (throw exitCode 1) feeding writeFl`) — refuted: The claim misreads the CI gate. It asserts the FLEET_WRITE_SUMMARY line is "the single line the nightly workflow greps to decide pass/fail" such that "failed spikes → gate goes RED → tracking issue filed." But .github/workflows/fleet-lighthouse.yml:78-94 shows the gate does NOT red on failed>0. It…
- **isComparableRange admits partial ranges like 5.x / 5.\* whose non-numeric segments parse to NaN, silently reporting them as 'same' (under-reporting drift)** (`src/audits/deps.ts:39 (isComparableRange) + :43-47 (parseSemver) + :49-59 (compa`) — refuted: REFUTED. The claim's core mechanism and concrete example are wrong. I read src/audits/deps.ts:39-59 and reproduced the exact functions in node. Two sub-facts ARE accurate: (a) isComparableRange's regex /^[\^~]?\d/ (line 40) admits "5.x"/"5.\*"/"5.0.x"; (b) parseSemver's `parts[1] ?? 0` (line 46)…
- **Webhook delivery-status write is unconditional last-writer-wins — an out-of-order svix retry can regress a terminal status** (`netlify/functions/resend-webhook.mts:120 and src/reports/airtable/reports.ts:222`) — refuted: The factual surface of the claim checks out: setDeliveryStatus (src/reports/airtable/reports.ts:222-228) is an unconditional `base(...).update(... "Delivery status": status)` with no read-compare-write/monotonicity guard, and the webhook (netlify/functions/resend-webhook.mts:120) calls it after…
- **Netlify functions deep-import internal src/ paths, bypassing the package's public exports map** (`netlify/functions/fleet-homepage.mts:2-7, approve-report.mts:2-7, site-dashboard`) — refuted: The claim's literal facts are accurate but its architectural framing is a category error, making it a false positive at the stated severity.\n\nWhat I verified as TRUE: fleet-homepage.mts:2-7, approve-report.mts:2-7, site-dashboard.mts:2-5, and resend-webhook.mts:4-5 do import deep relative paths…
- **Central withRecipe runner (spine of 7 recipes) has no direct test** (`src/recipes/_with-recipe.ts:50`) — refuted: The literal observation is accurate: there is no dedicated test file for the withRecipe wrapper (src/recipes/\_with-recipe.ts:50). No test in tests/ imports/references withRecipe or \_with-recipe; the wrapper is exercised only via the 7 recipes that consume it. However, the claim's stated RISK — that…
