# Morning brief — 2026-08-26

## One-line verdict

The code shipped yesterday is in good shape and the 07-06 backlog is 90% cleared — but **the freeze you scheduled for next week does not yet have a rollback story**, two of your safety instruments (the backup verifier and the query-plan gate) report green on questions they structurally cannot fail, and the browser JavaScript running your console has three execution-only defects no markup test can see.

## Top of stack (do these first)

1. **Do not flip `TURSO_IS_AUTHORITATIVE` until the backup is origin-anchored and one real restore into Turso has been rehearsed.** (CRIT-1.) You decided yesterday that the hourly import *and* parity both stop at the flip, which makes the nightly dump the entire rollback story — and that dump's verifier compares the dump against itself, so it cannot detect under-dumping. Two small fixes; both must land before the flip. ~40 min.
2. **Fix the nested-sitemap SSRF in the prospect crawler** (HIGH-1). One line, proven exploit, and the runner holds Turso/Resend/Anthropic secrets. ~15 min.
3. **Close the two query-plan holes** (HIGH-8, HIGH-9). The gate is green while three raw scans of the unbounded `submissions` table ship on a request path, because it tests function *names* rather than predicate *shapes* — add the three scenarios first so the fix is provably a fix. And the cockpit root ships 1.17 MB of report HTML per page load to compute 16 booleans, in a file that already solved this exact problem for `sites` 320 lines earlier. ~30 min for both.

**Before you forget:** `fix/skip-spam-for-in-development` (HIGH-4) looks finished and is now a permanent no-op — decide it or delete it while it is still fresh.

---

## Findings — CRITICAL

### CRIT-1 — The backup verifier compares the dump against itself, so it cannot detect under-dumping. The freeze makes this the only rollback.

[`src/cli/commands/db.ts:300-312`](../../src/cli/commands/db.ts#L300). `expected` is parsed **from the dump text** (`countInsertsInDump(sql)`); `restored` comes from loading **that same dump** into a scratch db. Both sides derive from one artifact, so if `dumpDatabase` ever emitted 5 of 44 sites, both numbers shrink together and the gate prints `mismatches=0`. I read these lines directly, not via summary.

The only origin-anchored assertion in the whole pipeline is [`fleet-db-backup.yml:61`](../../.github/workflows/fleet-db-backup.yml#L61) — `grep -qE '^INSERT INTO sites '`, i.e. "at least one site row exists". **`submissions` (354 irreplaceable client leads) and `reports` (rendered HTML bodies) have no presence gate at all.**

This is the exact shape CLAUDE.md's first rule is about, inverted: not a check that has only ever failed, but a check that *structurally cannot fail* on the thing it claims to guard.

Non-theoretical mechanism: [`dump.ts:68`](../../src/db/dump.ts#L68) issues `SELECT * FROM sites ORDER BY rowid` with no pagination. That single response already carries **7.78 MB of BLOBs at 12/44 sites backfilled**; at full backfill it is ~28 MB in one libSQL HTTP response. If that ever degrades to truncation rather than an error, the self-comparing gate hides it.

Two more halves of the same problem:

- **No restore path into Turso exists and none has ever been rehearsed.** The nightly "rehearsal" is `createClient({url:":memory:"})` + `executeMultiple` ([`db.ts:293-295`](../../src/cli/commands/db.ts#L293)) — that proves the SQL parses, not that you can get it back into Turso. A real recovery means replaying 17.35 MB of SQL with 7.8 MB of inline hex over HTTP into a fresh Turso db, which is a materially different operation.
- **`gpg` is not installed on your Mac** — the only machine holding `BACKUP_PASSPHRASE`. Recovery day is the wrong day to discover that.

**What was proven to work** (so this is calibrated, not alarmist): the newest artifact was downloaded, decrypted with your local passphrase, and diffed against live Turso. `sites` 44 = 44. **`header_image` BLOBs round-trip byte-exactly on real data — 7,777,769 bytes across 12 sites, identical both sides.** The dump reads `sqlite_master`, so new tables are picked up automatically; there is no "table the dump never learned about" bug. Retention is 30 days against a 1-week rollback window. Runs are 3/3 green. The passphrase link works — that had never been tested before tonight.

**Fix:** have `db dump` emit an origin manifest (`tableCounts` + `SELECT SUM(LENGTH(header_image))` against the **live** db, as a sidecar or SQL comment header), and make `verify-dump` compare against *that*, not against the dump text. Then add `db restore --url <target> --file <dump>` and do one hand-run rehearsal into a scratch Turso db before the flip. Install gnupg locally and write a 10-line runbook.

---

## Findings — HIGH

### HIGH-1 — Proven SSRF: a prospect's sitemap index makes the runner fetch arbitrary URLs

[`src/prospect/crawl.ts:350-354`](../../src/prospect/crawl.ts#L350). `child` comes straight from the audited site's `sitemap.xml` and reaches `fetch()` with no origin check, no scheme check, and no `isPrivateOrLoopbackHost`. The guard 80 lines above ([`:422`](../../src/prospect/crawl.ts#L422)) exists for exactly this and its own comment says so.

Proven by running it against a stub sitemap index, with controls (a benign index yields 0 internal fetches; the existing redirect guard still throws):

```
SSRF REACHED: 3 internal URL(s) fetched
  http://169.254.169.254/latest/meta-data/iam/security-credentials/
  http://127.0.0.1:8080/admin
  http://[::1]/
```

The tool audits sites Reddoor wants to pitch; a hostile or compromised prospect site is the threat model. The runner is a GitHub Actions job holding `TURSO_AUTH_TOKEN`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`.

**Mitigating, and worth stating:** it is *blind*. Responses are parsed for `<loc>` and then origin-filtered, so body content does not reach the report. The only leak is `crawl.sitemap.urlCount`. No test covers this path — [`crawl.test.ts:100`](../../tests/prospect/crawl.test.ts#L100) covers the happy path, and the two SSRF tests cover only the redirect guard.

**Fix:** filter `child` inside the loop — same origin plus `isPrivateOrLoopbackHost`. One line.

### HIGH-2 — `saveDetail` never resyncs `defaultValue`, so every later blur re-POSTs the field forever

[`render.ts:1023-1027`](../../src/dashboard/render.ts#L1023) fires on `i.value !== i.defaultValue`; [`saveDetail` at :1000-1013](../../src/dashboard/render.ts#L1000) never touches `defaultValue`. The commentary handler 25 lines below **does** ([`:1059`](../../src/dashboard/render.ts#L1059) `t.defaultValue = t.value`) — that inconsistency is the proof it is an oversight, not a decision. I read both.

After one successful edit, every subsequent focus+blur of that field fires another Airtable write, until reload. Worst case is the secret row, which deliberately emits no `value` attribute, so `defaultValue` is permanently `""` and every blur after typing re-POSTs the credential.

**Why this matters more than it looks:** one Airtable quota exhaustion already reddened six workflows fleet-wide (2026-08-17). A tab-through of the details form is a cheap way to burn writes.

**Fix:** one line in `saveDetail`'s `.then` — `if (r.ok && "defaultValue" in el) el.defaultValue = el.value;`

### HIGH-3 — Two approve buttons share one report id; each handler updates only one

`approveButton(r, …)` is emitted for the same pending report at both [`render.ts:294`](../../src/dashboard/render.ts#L294) (pending list) and [`:339`](../../src/dashboard/render.ts#L339) (reports history). The override handler at [`:958`](../../src/dashboard/render.ts#L958) then uses `document.querySelector` — **singular**, first match only. Verified by rendering: a health-clean pending report yields 2 `button.approve` with the same `data-report-id`; a sent report yields 0 (so the probe isn't miscounting).

After Approve or Override, the duplicate button still reads "Approve" and, in the gate-clear case, is still enabled. The second click is a server-side no-op, but the UI contradicts itself in the two places you look. No markup test can see this.

**Fix:** `querySelectorAll` + `forEach`, or stop emitting the history-table button — it is redundant with the pending list.

### ~~HIGH-4~~ — WITHDRAWN 2026-08-26: this finding was wrong

**Corrected while acting on this brief.** The work shipped on **2026-08-23 as PR
#551** (`843543a`), and `main` gates on `site.status !== "building"` — the live
vocabulary value. It is not inert and there is nothing to fix.

What I actually read was a **stale local worktree**
(`../reddoor-maintenance-devspam`) parked on `add2820`, a superseded pre-review
commit that was rewritten before merge. The remote branch head is `e357151`. I
asserted "never pushed" without running `git ls-remote` or `gh pr list` — the
exact check CLAUDE.md prescribes before calling a branch stuck, and the same
mistake shape as the 2026-08-12 "16 stuck PRs".

Worth doing: `git worktree remove ../reddoor-maintenance-devspam`, so the next
review's archaeology doesn't find the same corpse.

<details>
<summary>Original (incorrect) finding</summary>

#### HIGH-4 — `fix/skip-spam-for-in-development` is now silently inert and looks finished

Branch `add2820`, committed 2026-08-17, never pushed. It has source, **99 lines of tests, and a changeset** — it looks ready to ship. It gates on:

```ts
const spamHandlingEnabled = site.status !== "in development";
```

and its fixtures use `status: "in development"` and `status: "maintenance"`. **Both values were deleted from the vocabulary** by stages 1–3 (#571/#576/#589, 24–25 Aug). Live values are `building | launching | maintained | hosted-only | external | archived`, the alias map is gone, and `canonicalizeStatus` is the identity.

So if merged today: `site.status` can never equal `"in development"`, spam handling stays on for every site, and **the feature is a permanent no-op** — with green tests, because they construct the row by hand with the dead string. This is the same failure class the vocabulary migration already hit ("fixtures encoding a state Airtable can no longer hold"), sitting one command away from shipping.

**Fix:** rewrite against `building`, or delete the branch. Do not merge as-is.

</details>

### HIGH-5 — LA Homelessness Youth is `maintained` but cannot send, and its "client" is you

`node dist/cli/bin.js preflight --all` → **"1 fail, 1 warn. NOT safe to send."**

- `header-image-missing` — no Header image on the row; **the send will throw**.
- `recipient-operator-address` — resolved To is only `contact@tuckerlemos.com`.

And `forms-notify-target` confirms the second half is worse than a report problem: status is `maintained`, so the system reports *"A submission right now would notify: THE CLIENT"* — and that client address is yours. A real form lead reaches you while the system believes the client was notified.

This is the inverse of the 2026-08-03 1836dig incident, and it has been latent since at least the D5 work, where "LA Homelessness Youth has no header image anywhere" was already noted.

**Fix:** generate a header image (`header-image "LA Homelessness Youth"`), and set a real Point of Contact — or move the site out of `maintained` if it genuinely has no client contact yet.

**SHARPENED 2026-08-26 while acting on this.** It is the third option, and the
evidence is unambiguous. Surveying all 44 sites for three independent signals —
a `*.netlify.app` URL (no custom domain, i.e. pre-DNS-cutover), no header image,
and an operator/blank Point of Contact — **LA Homelessness Youth is the only one
of the 13 `maintained` sites that trips any of them, and it trips all three**:

```
maintained (13)
  LA Homelessness Youth | https://la-homelessness-youth.netlify.app | NETLIFY-HOST NO-HEADER POC=OPERATOR
  (the other 12: custom domain, header image, real POC — none flagged)

launching (2)
  Alamo Anatomy | https://alamo-anatomy.netlify.app/ | NO-HEADER
  Hedloc        | https://hedloc.netlify.app/        | NO-HEADER
```

That is the exact signature of the `launching` bucket. So the finding is not
"generate a header image and set a POC" — it is **the status is wrong**, and
[[launch-period sites are out of fleet scope]]. Generating a header image would
make a pre-cutover site *look* ready to send monthly client reports to an address
that is the operator's own, which is worse than the current loud failure.

Left for the operator: this is a status change on a live row, and only Tucker
knows whether the DNS cutover is pending or the client contact simply is not
recorded yet.

### HIGH-6 — The encrypted artifact is never verified; only the plaintext is

[`fleet-db-backup.yml:68`](../../.github/workflows/fleet-db-backup.yml#L68) verifies `dump.sql`; [`:83-86`](../../.github/workflows/fleet-db-backup.yml#L83) then encrypts and deletes it. **Nothing ever decrypts the `.gpg` that is actually retained.** A corrupt or truncated gpg output uploads green — `if-no-files-found: error` only catches a missing file. The first-ever decrypt of a produced artifact happened tonight, by hand, and succeeded; that is one data point, not a gate.

**Fix:** after encrypting, decrypt back to `dump.check.sql` and re-run `db verify-dump` on that. Verify what you keep.

### HIGH-7 (latent, destructive) — a datetime in a date cell silently clears the schedule on an untouched blur

[`render.ts:526-528`](../../src/dashboard/render.ts#L526) interpolates the raw Airtable cell into `<input type="date">` with no normalization. If the cell ever holds `2026-08-01T00:00:00.000Z`, the browser's sanitization makes `.value` empty while `.defaultValue` keeps the raw string — so the blur guard fires **with no user edit**, and [`site-details.ts:174`](../../src/dashboard/site-details.ts#L174) accepts `""` as a valid clear. `maintenance day` / `testing day` feed the code-owned next-due schedule, so the site silently reschedules.

**Dormant today** — those columns are Airtable `date` (date-only), so they render `YYYY-MM-DD`. It goes live the instant anyone ticks "include time". The defect is that nothing in the renderer, the script, or the server stops it.

**Fix:** normalize in `dateRow` (`value.slice(0,10)`), and harden the blur guard so a field that rendered non-empty cannot post `""` without an explicit gesture — the `secret` kind already has that shape via `__clear__`.

---

### HIGH-8 — The query-plan gate is green while three request-path raw scans ship

The gate reports `DB_QUERY_PLAN scenarios=52 statements=57 raw_scans=0`. It is green because **it tests function names, not predicate shapes.**

`countSubmissionsFiltered` has exactly two scenarios — [`query-plans.test.ts:181`](../../tests/db/query-plans.test.ts#L181) `{}` and [`:186`](../../tests/db/query-plans.test.ts#L186) `{siteId}` — and both happen to land on an index. I verified that list myself. Three other filter shapes raw-scan `submissions`, confirmed through the repo's own harness:

```
countSubmissionsFiltered({search})    SCAN submissions   ==> would FAIL the build
countSubmissionsFiltered({reason})    SCAN submissions   ==> would FAIL the build
countSubmissionsFiltered({formType})  SCAN submissions   ==> would FAIL the build
```

`form_type` has **no index at all**. [`submissions-page.mts:106-116`](../../netlify/functions/submissions-page.mts#L106) calls this twice per page load. `submissions` is the one unbounded-growth table — 354 rows now, append-only, one per fleet lead forever. A search costs 708 row scans today; at 50k submissions it is 100k.

Note the asymmetry that proves it is an oversight: `listSubmissionsFiltered` *does* get an "every WHERE shape" scenario ([`:165`](../../tests/db/query-plans.test.ts#L165)). The count sibling running on the same request with the same filter never got one. The export-completeness check at `:495` is satisfied because it matches names.

**This is the 2026-08-12 class again** — an instrument reporting zero because it only ever asked about states that were already fine.

**Fix, in order:** (1) add the three scenarios *first*, so the fix is provably a fix; (2) `CREATE INDEX idx_submissions_form_type`; (3) `search`/`reason` are `LIKE '%…%'` and genuinely unindexable — allowlist with justification, or drop the second count when they are active; (4) structurally, drive the gate from a filter matrix (every `SubmissionFilter` key × every filtered function) so no future filtered function ships with an unexercised predicate.

### HIGH-9 — The cockpit ships 1.17 MB of report HTML per page load, to compute 16 booleans

[`fleet-state.ts:500-507`](../../src/db/fleet-state.ts#L500) — `listAllReports` uses `.selectAll()`, which includes `rendered_html`. Live: all 16 reports carry a body, **1,172,629 bytes total, avg 73 KB, max 95 KB**. The consumer is [`fleet-homepage.mts:76`](../../netlify/functions/fleet-homepage.mts#L76), and that function owns `path: ["/"]` — every operator load of the cockpit root.

The column is fetched only to be tested for null ([`:484-487`](../../src/db/fleet-state.ts#L484) → `renderedHtmlAttachment`).

**The proof it is an oversight rather than a decision is 320 lines up in the same file.** `SITE_COLUMNS` ([`:176`](../../src/db/fleet-state.ts#L176)) deliberately omits `sites.header_image`, with the comment *"a selectAll would haul megabytes into every site lookup… and Turso bills the bytes"*, and a blob-exclusion test keeps it honest. `reports.rendered_html` is the identical hazard with no equivalent guard and no test. I read both.

The allowlist entry's own justification says *"window it before Phase 4's report review adds volume."* Phase 4 shipped; the windowing never happened. On **rows** the entry is still fine (16). On **bytes** it was never reasoning about the right thing — at the stated ~44/month, a year is ~39 MB per page load.

**Fix:** an explicit `REPORT_LIST_COLUMNS` omitting `rendered_html`, plus ``select(sql`rendered_html is not null`.as("has_html"))``. Mirror the sites blob-exclusion test. Windowing then becomes optional rather than urgent.

### HIGH-10 — The nightly Turso usage check does not exist

The design called for a "nightly usage check, alarming at 50% of any metric". **It was never built** — so it has never run, has never been green, and by this repo's own first rule is not evidence of anything. Next week Turso becomes the only store, and the one alarm that would warn you of a hard wall is absent.

Evidence of where it was looked for: all 15 workflows grepped for `turso|usage|quota|headroom|rows_read` (only secret wiring and two unrelated "headroom" comments); a repo-wide grep for `api.turso|turso.tech|rows_read|storage_bytes|turso db inspect` returns **zero matches** — nothing here has ever spoken to the Turso Platform API; `src/alerts/` has five modules, none about DB usage; no `db` subcommand; none of the 8 open issues tracks it.

**Fix:** a `db usage` subcommand emitting `FLEET_DB_USAGE rows_read=… storage_bytes=… pct_max=…` on every run (including zeros, same contract as `FLEET_PARITY`), wired into `fleet-db-backup.yml` — which already runs nightly with the right secrets and `issues: write`. Needs a *platform* token; the DB-level `TURSO_AUTH_TOKEN` cannot read usage.

---

## Findings — MEDIUM

### MED-15 — The scan detector's "`USING` ⇒ fine" rule is wrong for a row-scan-metered store

[`query-plan-harness.ts:80-89`](../../tests/db/query-plan-harness.ts#L80) skips any plan line containing `USING`, justified as *"an index-ordered traversal under a LIMIT stops early."* Sound for `listSubmissionsFiltered({})` — false for three confirmed cases: `countNotifyBouncedBySite` (aggregate, no LIMIT, reads all 354), `countSubmissionsFiltered({})` (`COUNT(*)`, no LIMIT), and `listSubmissionsFiltered({reason})` (residual `LIKE` the index cannot serve, so a zero-match filter scans the whole table despite `LIMIT 50`).

Turso meters **row scans**; an index-ordered full traversal scans exactly as many rows as a raw one. The rule imports a page-IO intuition into a per-row-billed store. **Fix:** flag `SCAN … USING [COVERING] INDEX` unless the statement has a LIMIT *and* no residual predicate — or at minimum allowlist these three so they are reviewed rather than invisible.

### MED-16 — `COUNT(*)` on request paths, which the design explicitly forbade

Reachable from Netlify handlers: `countSubmissionsFiltered` ×2 ([`submissions-page.mts:108`](../../netlify/functions/submissions-page.mts#L108), `:114`), `countNotifyBouncedBySite` ([`fleet-homepage.mts:7`](../../netlify/functions/fleet-homepage.mts#L7), full index scan, no LIMIT), and `listScreenOutsSince`'s live `markedSpam` group-by ([`screenouts.ts:35,59`](../../src/db/screenouts.ts#L35)). `countAutoSpamSince` is fine (`SEARCH … USING idx_submissions_status`). The batch-side `countSubmissionsSinceBySite` is acceptable — digest cron only.

**Fix:** these three cockpit strips are slow-moving "since a window" numbers. Compute them once in the nightly cron and fold them into the `digest_state` singleton the homepage already reads by PK, rather than recomputing across the whole submissions table on every page load.

### MED-1 — `digest_state` and `prospect_audits` are in no backup as of tonight

Live `_migrations` shows `0009_prospect_audits` applied 2026-08-25T07:05Z and `0011_digest_state` at 2026-08-26T00:51Z — both **after** the 05:05Z backup. The 08-25 artifact contains 9 CREATE TABLEs; live has 11.

Self-healing: the 04:30Z run (about an hour after this brief is written) reads `sqlite_master` and will pick both up. **Verify it did** rather than assuming. The review point is that `tables=9` is *printed and never asserted* — [`db.ts:316`](../../src/cli/commands/db.ts#L316) emits it, and the workflow greps only `loaded=true .* mismatches=0`. A table a migration failed to create would ride green forever.

**Fix:** assert the dump's CREATE TABLE set covers every key of the `Database` interface ([`schema.ts:230-242`](../../src/db/schema.ts#L230)).

### MED-2 — The nightly gate asserts counts, never content

`tableCounts` is `SELECT COUNT(*)`. A dump where every `header_image` came back NULL, or every em-dash-laden `commentary` was mangled, has identical counts and passes. The only content assertion is a hand-seeded **4-byte** BLOB fixture ([`dump.test.ts:60-64`](../../tests/db/dump.test.ts#L60)) — and this repo's own lesson is that hand-written fixtures cannot catch real-output drift. Folding `SUM(LENGTH(header_image))` (7,777,769 today) into the origin manifest proves the BLOB round-trip on real data every night.

### MED-3 — A contact-form submission can red the nightly backup

[`dump.ts:86`](../../src/db/dump.ts#L86)'s insert counter is line-anchored (`/^INSERT INTO …/gm`) over a file whose values span newlines. `submissions` free text is attacker-supplied and 343 such rows are in the dump. A message containing a line starting `INSERT INTO sites ` inflates `expected` and reds the backup. Not data loss — but a spam-triggerable outage of your last line of defence, during freeze week. The origin-manifest fix removes this class entirely.

### MED-4 — The shared-password fallback is live in production and bypasses Google sign-in

[`auth/require.ts:184`](../../src/dashboard/auth/require.ts#L184) grants full operator rights on `DASHBOARD_PASSWORD` alone. The comment scopes the intent to "deploy previews, and the first day of the rollout", but the only condition is the variable being set. `resolveRequestedBy` then records `"cockpit"` — so the audit trail #588 was written to fix degrades to anonymous for anyone using it. Static password, no rotation, no MFA, no lockout.

`process.env.CONTEXT` (Netlify's own production signal) is not read anywhere in the repo — an available, unused lever.

**Unverified:** whether `DASHBOARD_PASSWORD` is still set in production. One `netlify env:get` settles it. **Fix:** gate on `CONTEXT !== "production"`, or unset it now that #583 has landed.

### MED-5 — The private runner accepts an arbitrary `ref`

[`docs/private-runner/prospect-audit.yml:30-34,50-54`](../../docs/private-runner/prospect-audit.yml#L30). `reddoor-maintenance` is public, so `refs/pull/N/merge` exists for any PR anyone opens; a dispatch with that ref runs a stranger's code in a job holding Turso, Resend and Anthropic secrets. Requires `actions: write` on the runner repo, so it is post-compromise amplification rather than initial access — but that token lives in the cockpit's Netlify env and is shared with the Renovate trigger. **Fix:** drop the input or allowlist it to `main`.

### MED-6 — No spend cap on prospect audits

One audit is structurally ~1 Opus call at 16k tokens, up to 28 Sonnet calls with up to 112 billed web searches, 7 Perplexity calls, a 20-page double crawl, a 3-pass Lighthouse and a PDF render, in a 30-minute billed Actions job. Stopping N requests: operator auth, 30/min/IP, a 10-minute same-URL dedupe, per-URL concurrency. **Not stopped: distinct URLs.** One session can dispatch ~30 audits/minute against 30 hostnames indefinitely. No daily cap, no per-operator quota, no kill switch, no budget alarm anywhere in `src/prospect/**`. Combined with MED-4, the population that can do this is "anyone holding the shared password". **Fix:** a per-day count from `listRecentProspectAudits` before dispatch — ~5 lines, reusing machinery that exists.

### MED-7 — The private-host guard runs *after* the first fetch, and the CLI has none

[`crawl.ts:391`](../../src/prospect/crawl.ts#L391) fetches `start`; [`:422`](../../src/prospect/crawl.ts#L422) then checks the host. Proven: `crawlSite("http://169.254.169.254/…")` fetches once, then throws. [`prospect-audit.ts:151`](../../src/cli/commands/prospect-audit.ts#L151) validates only `isHttpUrl` — the sole guard today is `triggerProspectAudit`, one layer at the far end. **Fix:** move the check to the top of `crawlSite`.

### MED-8 — The design and plan for #539 are not on `main`, and are 9 days stale

`docs/superpowers/{plans,specs}/2026-08-17-airtable-to-turso-migration*` exist only on the unmerged branch `docs/airtable-to-turso-spec`, last touched 2026-08-17. Nine days of Phase 4 and Phase 5 decisions have landed in code and issue comments; the doc still says *"Phase 5 — freeze. Airtable read-only; parity runs for one week"* — the self-contradiction you resolved yesterday. Anyone reading `main` has no design doc for the largest project in flight, days before an irreversible step.

### MED-9 — Nothing enforces that a new mirror factory honours the freeze switch

Six `strict: boolean = TURSO_IS_AUTHORITATIVE` default parameters now sit across five modules (`site-mirror`, `report-mirror`, `health-mirror` ×2, `write-audits-to-airtable`, `site-lookup`). Each independently remembers to honour it. A seventh writer added later that simply forgets the parameter is invisible — the freeze simulation only catches what a test already exercises.

This repo has precedent for exactly this kind of lockstep gate (the editor-fields/importer lockstep, the query-plans classification gate). **Fix:** a test asserting every module importing `freeze.js` has both-sides coverage, or a registry the factories must join. *(Self-critical: I wrote four of those six yesterday.)*

### MED-10 — The prospect-audits page has no inline-script parse gate

`RUN_SCRIPT` ([`prospect-audits-render.ts:88-138`](../../src/dashboard/prospect-audits-render.ts#L88), 50 lines) never reaches `expectAllScriptsParse` — the gate covers the site dashboard, cockpit and submissions page only. Its own header comment cites the exact build-time-`\n` incident the gate exists to catch. **Fix: one `it()` block.** Cheapest item in this brief.

### MED-11 — `rfPhase` is dead code; the endpoint always sends `step: null`

[`fleet-render.ts:353-362`](../../src/dashboard/fleet-render.ts#L353) maps a workflow step to a human phase, with a careful ordering comment. [`refresh-fleet.ts:97`](../../src/dashboard/refresh-fleet.ts#L97) returns `step: null` unconditionally, so the "auditing the fleet…" line never renders. Untested on both sides. **Fix:** populate `step`, or delete `rfPhase`. Shipping both halves and wiring neither is the worst option.

### MED-12 — The one `innerHTML` sink, fed by a remote API

[`fleet-render.ts:363-390`](../../src/dashboard/fleet-render.ts#L363) interpolates `w.url` and `w.step` unescaped and assigns via `innerHTML`. Values come from our own workflow files and GitHub's `html_url` — which is why the inline comment calls it safe — but it is an unescaped sink fed by a remote response, inside the one function nothing executes. Everywhere else the house rule is `textContent` and says so out loud. **Fix:** build rows with `createElement`, or gate `w.url` on an `https://github.com/` prefix.

### MED-13 — Ingest rate limiting still keys on the fleet site's egress (carried, 3rd brief)

[`form-ingest.mts:39`](../../netlify/functions/form-ingest.mts#L39) `aggregateBy: ["ip"]`, unchanged since 07-06. Traffic is server-to-server, so the limiter cannot throttle an abusive visitor at all, and a legitimate burst from one busy site can hit 120/min → `429` → dropped lead. Per-slug limiting remains the noted fix. **This is the only 07-06 finding still fully open.**

### MED-14 — Two sites resolve to the same report recipient

`preflight --all`: MSOT and Revogen both resolve to `accounting@revogenbiologics.com`. Fine if one person owns both; a copy-paste error on one row otherwise. Worth 30 seconds to confirm.

**CHECKED 2026-08-26 — it is THREE sites, and it looks deliberate.** Querying every
shared Point of Contact across the fleet rather than reading the two `preflight`
happened to surface:

| site | url | status |
| --- | --- | --- |
| Alamo Anatomy | `alamo-anatomy.netlify.app` | launching |
| MSOT | `medicalsolutionsoftx.com` | maintained |
| Revogen | `revogen.com` | maintained |

All three point at `accounting@revogenbiologics.com`, and no other address is
shared by any two sites in the fleet. Three Texas medical/biotech properties
billing through one accounting mailbox is a coherent client group, not a
copy-paste slip — so the likely answer is "fine", but with a third site the brief
did not know about, one of which is still `launching`.

Still a 30-second confirmation for the operator, now with the actual list.

---

## Findings — LOW

- **LOW-1 — `.worktrees/` is not gitignored.** It is the only thing in `git status`, and it will stay there. One line in `.gitignore`.
- **LOW-2 — 60+ stale local branches and 14 worktrees.** Most map to squash-merged PRs, so `--no-merged` overstates it, but the genuinely-orphaned signal is buried. `git fetch --prune` + a `branch -d` sweep makes the next review's archaeology honest.
- **LOW-3 — An empty stash from 2026-07-07.** `stash@{0}` diffs to nothing against its base. Pure noise; `git stash drop`.
- **LOW-4 — `fix/form-e2e-budget-attribution` is a `wip(` commit with no tests.** The migration plan said "finish or discard it independently" on 08-17; still sitting. 42 added lines in `src/audits/form-e2e.ts`, no test file touched.
- **LOW-5 — 9 dependency advisories, all dev-only.** 5 high / 3 moderate / 1 low, every one behind `@lhci/cli` or `eslint-plugin-svelte`. **None reach production** — I traced all six paths. Notably three are `ip-address` SSRF-classification bugs, which sound relevant to HIGH-1 but are behind lighthouse's puppeteer proxy-agent and are not in that fetch path.
- **LOW-6 — The multi-select comma invariant is unasserted.** `DETAIL_VALUE_FN` joins on `","`, the server splits on `/[,\n]/`. Safe only because no `WATCH_CONDITION_OPTIONS` entry contains a comma, and nothing says so. One assertion.
- **LOW-7 — The parse gate has two blind spots.** `/<script>([\s\S]*?)<\/script>/g` matches only attribute-less tags (a future `<script type="module">` is skipped silently) and cannot see inline handler attributes like `submissions-page-render.ts:158`'s `onsubmit=`.
- **LOW-8 — `escapeHtml` is a landmine in script context.** No helper exists for interpolating into a `<script>` body, and the house style is "escapeHtml everything" — but `&quot;`/`&amp;` are not decoded inside script raw text, so the first person to reach for it will corrupt the JS rather than escape it. The correct tool is `JSON.stringify(v).replace(/<\//g, "<\\/")`. Worth adding before someone needs it.
- **LOW-9 — Silent NUL stripping in the dump.** [`dump.ts:43`](../../src/db/dump.ts#L43) `.replaceAll(" ","")`, justified as "cannot legitimately appear" — but `submissions` free text is attacker-supplied and SQLite stores NUL in TEXT happily. Backup would silently differ from origin with no signal.
- **LOW-10 — IPv6 gap in `isPrivateOrLoopbackHost`.** [`url.ts:74-83`](../../src/util/url.ts#L74) misses the deprecated `[::127.0.0.1]` form. Theoretical — not routable to loopback on Linux. The IPv4 side is solid (WHATWG canonicalises `127.1`, `2130706433`, `0x7f.0.0.1` before the regex sees them).
- **LOW-11 — Unauthenticated env-presence oracle.** [`prospect-audit-run.mts:36-53`](../../netlify/functions/prospect-audit-run.mts#L36) answers GET with `{DASHBOARD_PASSWORD: true, …}` before CSRF and auth. No values leak, but it tells an anonymous caller that the MED-4 fallback is live — the reconnaissance step for it. Mirrors `trigger-renovate.mts`, so it is a consistent pattern rather than an oversight.
- **LOW-13 — Hourly parity pulls every rendered report body.** [`parity.ts:135`](../../src/db/parity.ts#L135) `selectAll()` on `reports` runs hourly in `fleet-db-sync`, so the same 1.17 MB crosses the wire **24×/day** to diff field values. Correctly EXEMPT (batch job, full-table comparison is the point) — not a gate defect, just metered egress that grows with HIGH-9. Project it down to the columns `mapReportRecord` actually produces.
- **LOW-12 — `nextElementSibling` coupling.** [`render.ts:930`](../../src/dashboard/render.ts#L930) depends on `.override-form` being the immediately-next element; any element inserted between kills "Send anyway…" silently. The handler six lines below already uses `closest()` — the inconsistency is the tell.

---

## Graded — the 07-06 brief's backlog

Nine of ten closed. This is a genuinely good clearance rate and worth knowing before you re-read that brief.

| 07-06 finding | Status |
|---|---|
| HIGH-1 Turnstile collapses `timeout-or-duplicate` into fail | **Fixed** — benign codes now map to `unverifiable` ([`turnstile.ts:15-17`](../../src/forms/turnstile.ts#L15)) |
| HIGH-2 no test for `requireTurnstile` + `unverifiable` → new | **Fixed** — [`ingest.test.ts:427`](../../tests/forms/ingest.test.ts#L427) |
| MED-1 README missing `TURNSTILE_SECRET_KEY` | **Fixed** — [`README.md:414`](../../README.md#L414) |
| MED-2 dead frequency guard, tests asserting the opposite | **Fixed** — warn moved into `toFrequency` ([`websites.ts:403`](../../src/reports/airtable/websites.ts#L403)) |
| MED-3 `buildPayload` unguarded in `action.ts` | **Fixed** — try/catch → 400, mirroring the endpoint |
| MED-4 non-Latin name penalty | **Fixed** — weight 50 → 25, with the reasoning in a comment |
| MED-5 legit-vertical keywords | **Fixed** — narrowed to `"online casino"`, `"casino bonus"` etc. |
| MED-7 ingest rate limit keys on egress | **Still open** → MED-13 above |
| LOW-4 GA single-subject SPOF (*"5th brief… stop deferring"*) | **Fixed** — `subjects: string[]` + `withSubjectFailover` |
| LOW-5 dead `playwrightA11yConfig` export (*"5th brief"*) | **Fixed** — alias removed |

---

## Investigated — not a bug (so you don't re-investigate)

- **No script-context injection anywhere in the dashboard.** The only two interpolations into `render.ts`'s `<script>` are compile-time constants (`DETAIL_VALUE_FN`, `SUBMISSION_STATUS_SCRIPT`). Zero site names, commentary, URLs or Airtable strings reach any script body; `AUDIT_SCRIPT`, `FLEET_BROWSE_SCRIPT` and `RUN_SCRIPT` contain no `${}` at all. Every server string reaches the DOM via `textContent`. The only unescaped sink is MED-12.
- **Prospect-audit auth (#583) is genuinely well built.** Versioned HMAC-SHA256 over the encoded payload, `timingSafeEqual` with a length pre-check, real PKCE S256, signed `/auth`-scoped state cookie, `email_verified === true` required, allowlist re-read per request (real revocation), `safeReturnTo` covering `//`, `/\` and control chars. #588 left nothing unguarded.
- **The report token is sound.** `randomBytes(16)` → 22-char base64url = a true 128 bits from a CSPRNG, regex-validated before every read, `UNIQUE`-constrained with a test. Both token routes refuse identically and leak nothing about existence.
- **No anonymous caller can spend money, send email, or write a row.** Everything costly sits behind `requireOperator` + CSRF, in that order. The two public routes return a 301 and a single row by token.
- **Prompt injection is defended.** Per-run random fence tag, explicit data/instruction framing, and `verifyEvidence` mechanically checks every model quote against real crawled page text.
- **The audit report is genuinely unlisted.** All three noindex guards verified: `x-robots-tag`, per-page `<meta name="robots">`, and `Disallow: /audit/` in `robots.txt`, plus `cache-control: private, no-store`.
- **Header-image BLOBs round-trip byte-exactly through the backup** — 7,777,769 bytes across 12 sites, live vs decrypted artifact. This was the single thing most worth checking and it is fine.
- **CSRF is header-based** (Sec-Fetch-Site/Origin), so the bare same-origin `fetch` POSTs need no token. Not a gap.
- **Zero TODO/FIXME/HACK markers in the source tree.** The one `XXX` hit is `recXXX` inside a docstring. Unusual and worth knowing.
- **Secret hygiene is clean.** `.env` ignored and never in history; only `.env.example` tracked.
- **All 14 workflows green for 3 consecutive days**, and the local gate is green on `af748d6` — 5319 tests, typecheck, lint.
- **The `listSites` allowlist entry is still safe and well-reasoned** — 44 rows, bounded by fleet size not data growth, exactly as its justification says, with the header BLOB excluded and a test keeping that honest.
- **All 11 EXEMPT modules re-verified: none has grown a request-path query.** `header-images.ts` was chased specifically as the likeliest stale exemption — its only consumers are three CLI paths. `import-airtable`, `parity`, `dump` and `sync` are invoked solely from `fleet-db-sync`/`fleet-db-backup`; no Netlify function imports any of them.
- **The Phase 5 write paths are uniformly by-PK and correctly gated**, including the mirrors added yesterday — the scenario comments show the HTML-bearing table was deliberately avoided.
- **The query-plan gate's own self-proving tests work in both directions** (a known-bad probe and a known-good probe, both live). The gate's problem is coverage, not correctness.

---

## Open loops carried forward

- **MED-13** (ingest rate-limit keying) — 3rd brief. Not urgent; per-slug limiting when the forms path is next opened.
- **LOW-2 / LOW-3 / LOW-1** branch, stash and gitignore hygiene — one 10-minute sweep clears all three and makes the next review's archaeology honest.
- **#582 (Svelte rework)** — unblocked since its three prerequisites landed, still not started. Since #591 the untested surface has *grown* by six behaviours (checkbox, multi-select, secret, date, rerender, commentary). Three of tonight's HIGH findings are in that string, one of them a silent-data-deletion path. **346 lines of shipped browser JS; 5 lines (1.4%) are executed by a test.** It is getting more urgent, not less.
- **`fix/form-e2e-budget-attribution`** (LOW-4) — flagged in the migration plan on 08-17 as "finish or discard"; unchanged.

---

## Decisions deferred

Each with my provisional call, since you were not available.

1. **Does the freeze slip?** *Provisional: the flip slips only if CRIT-1's two fixes are not done first — they are ~40 minutes, so the week-of-Aug-31 target survives.* I did not change the schedule or reopen the decision; the code is ready and inert, this is purely about the rollback path.
2. **HIGH-4: rewrite or delete `fix/skip-spam-for-in-development`?** *Provisional: rewrite.* The intent (don't spam-filter a site that isn't live) is still valid under `building`, and the 99 lines of tests are reusable once the fixtures move to live values. But **do not merge it as-is**, and if the intent has lapsed, delete it rather than leaving a green-looking no-op on the shelf.
3. **HIGH-5: fix the site, or move it out of `maintained`?** *Provisional: fix the header image, then ask whose address the Point of Contact should be.* I did not want to guess whether LA Homelessness Youth has a client contact yet — if it does not, `maintained` is the wrong status and the report rotation should not include it.
4. **MED-4: is `DASHBOARD_PASSWORD` still set in production?** *Provisional: assume yes and gate the fallback on `CONTEXT`.* One `netlify env:get` settles it; the gate is correct either way and costs nothing if the variable is already gone.
5. **MED-8: merge the migration plan branch, or rewrite it on main?** *Provisional: rewrite on main.* The 08-17 doc is stale enough (it still carries the read-only/parity contradiction) that merging it verbatim would land a wrong document; the issue thread is now the better record.

---

## What I did NOT do tonight

Read-only exercise. **No commits, no PRs, no pushes, no live-service writes, no fixes** — the repo is exactly as you left it at `af748d6`, with `.worktrees/` the only thing in `git status`.

Local test/lint/typecheck and `pnpm audit` were run (they mutate nothing shared). Read-only queries were run against production Turso, and one backup artifact was downloaded and decrypted locally to verify CRIT-1's claims — **the decrypted plaintext held 343 client leads and was deleted immediately after measuring.** The SSRF proof in HIGH-1 ran against a local stub, never against a real host.

The only file changed anywhere is this brief, plus three read-only permission rules added to `.claude/settings.local.json` during the pre-clearance step.

All three of your steers were covered: backup/restore (CRIT-1, HIGH-6, MED-1/2/3, LOW-9), Turso headroom and query-plan drift (HIGH-8/9/10, MED-15/16, LOW-13), and the untested dashboard script (HIGH-2/3/7, MED-10/11/12, LOW-6/7/8/12). Nothing was left running.
