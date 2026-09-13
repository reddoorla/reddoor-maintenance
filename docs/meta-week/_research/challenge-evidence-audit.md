# Challenge: evidence audit of the 23 meta-week candidates

Audited 2026-09-12 against the live `reddoorla` org, the local checkouts in
`~/Documents/GitHub`, the reddoor-maintenance source tree at `9f5fc898`, and the
derived corpus. **I re-derived every load-bearing number rather than quoting the
candidate or the survey.** Where a claim did not reproduce, the reproduction
command and the number I actually got are below.

**Verdict split: 18 CONFIRMED, 5 OVERSTATED, 0 UNSUPPORTED.**

No candidate's central claim collapsed. That is itself the headline — but it is
not a free pass, because five candidates carry a stated number that is wrong,
and one of those errors (candidate 16) is the exact failure mode this repo's
top rule exists to catch: a derived view read as the state itself.

## Sandbox note, reproduced

Candidate 1 warns that `gh api .../secret-scanning/alerts` needs an unsandboxed
shell. **Confirmed, and more precisely than stated:** the _list_ endpoint works
sandboxed; the _alert-detail_ and _locations_ endpoints, and `api.github.com/graphql`,
fail with `tls: failed to verify certificate: x509: OSStatus -26276` every time.
A `--jq` on a failed call yields an EMPTY string at exit 0 in some shapes — the
same swallowing candidate 20 flags. Every live query below that touched a detail
endpoint was re-run unsandboxed.

---

## The five security candidates (1, 6, 7, 12, 18)

These overlap heavily, so the shared factual base is verified once here.

### Reproduced exactly

Enumerated all 28 public repos. **Five open alerts, in exactly the five repos
named, with exactly the stated types and dates** (`state=open`, `resolution=null`,
`push_protection_bypassed=false`, `validity=unknown` on all five):

| repo                 | #   | type                          | created              | age at 2026-09-12 |
| -------------------- | --- | ----------------------------- | -------------------- | ----------------- |
| gallerysonder        | 1   | google_api_key                | 2026-06-05T03:33:22Z | 99 d              |
| reddoor-maintenance  | 1   | stripe_webhook_signing_secret | 2026-06-09T18:11:26Z | 95 d              |
| reddoor-starter      | 1   | google_api_key                | 2026-07-24T22:08:21Z | 50 d              |
| beachfront-dentistry | 1   | google_api_key                | 2026-08-06T05:16:18Z | 37 d              |
| reddoor-starter-blux | 1   | google_api_key                | 2026-09-01T05:45:12Z | 11 d              |

**Hashes reproduce candidate 1's claim to the digit.** sha256 prefixes:
reddoor-starter and reddoor-starter-blux are the SAME key (`530de1c69475`),
gallerysonder `9b70e75de5eb`, beachfront `0ce943544da2`, reddoor-maintenance
`96ad2ccd8146`. Four distinct secrets, five repos — exactly as stated.

**Alert locations reproduce candidate 6 exactly:** `tests/webhook/resend-webhook.test.ts:99`,
`src/routes/dev/blux-frozen/the-pointe.html:5` (both starters), and
`src/lib/slices/ContentWidthMedia/index.svelte:174`. Two additions nobody
recorded: gallerysonder's alert also points at `.netlify/server/chunks/index3.js:762`,
a committed build artifact; and beachfront's points at `matching/spec-sections/contact.md:500`
and `matching/SPEC.md:7356` at commit `c10a05b` — i.e. the key was scraped into
the pixel-matching spec, it was never in application source.

**The `whsec_` characterization is exact and I strengthened it.** The repo's
current `TEST_SECRET` at `tests/webhook/resend-webhook.test.ts:195` is 38 chars
(`whsec_` + 32 alphanumerics), contains no `test`/`fake`/`example`/`dummy`/`sample`,
and its sha256 prefix is `96ad2ccd8146` — **byte-identical to the leaked value**.
`grep -rail stripe src/ netlify/ package.json` returns nothing. So candidate 6's
"treat it as live until one comparison proves otherwise" is the right posture,
and the comparison is still not done.

**Redaction at HEAD is complete, verified harder than claimed.** Candidate 6
checked `grep -ral AIza <repo>/src`. I scanned every _tracked_ file at HEAD in
beachfront-dentistry for `AIza[0-9A-Za-z_\-]{35}`: **zero hits.** (Three files
under `matching/` do contain a key, but `git ls-files --error-unmatch` shows all
three are UNTRACKED local artifacts.)

**Code claims, all exact.** `secretScanningGaps` is `src/audits/protection-coverage.ts:117-127`
and compares only the two status strings. `grep -ran 'secret-scanning/alerts'`
across `src/ .github/ netlify/ scripts/ tests/` returns **zero**. The only alerts
endpoint anywhere is `dependabot/alerts` at `src/github/gh-rest.ts:287`. The two
status strings come from the org listing jq at `src/github/gh.ts:642`, whose own
comment at `:135` says "from the same listing (no extra call)". `src/recipes/`
contains **zero** secret-scanning code, and `security_and_analysis` appears in
exactly three places in `src/`, all reads. `secret_scanning_validity_checks=disabled`
org-wide. Attention kinds (`src/alerts/attention.ts:39-55`) are exactly the ten
named; none is a secret.

**Posture gaps reproduce.** `vida-legacy-foundation` (public, non-archived,
`disabled`/`disabled`, pushed 2026-09-12T17:58:13Z) and `29-navy` (same, pushed
2026-09-12T18:43:11Z). `the-pointe` also has scanning off but is archived.
`the-tower` is archived with push protection off. 20 public repos return zero
open alerts — candidate 1's "erp-industrial, la-homelessness-initiative and
eighteen others" is exactly right. Issue **#754** is open since 2026-09-10, last
commented 2026-09-12T09:52:06Z, and its body carries both GAP lines verbatim plus
`Heal: run reddoor-maint self-updating <site>` — an instruction candidate 18
correctly identifies as false, since that recipe cannot enable scanning. **#652**
is open since 2026-09-01 with 9 comments, although reddoor-starter-blux now
reports `enabled`/`enabled`.

### What NOBODY established, and it is the decisive fact

**No candidate verified that any leaked Google Maps key is still the key the live
site serves.** GitHub cannot say — validity checks are off, so all five read
`validity: unknown`. I fetched `https://www.beachfrontdentistry.com/` and `/contact`
and `https://gallerysonder.com/` and found no `AIza`-shaped string in the HTML or
its top-level JS (the key is presumably in a lazily-imported chunk I did not
resolve). So "the leaked value is the live site's own key" is an assumption
everywhere it appears.

This does not lower the priority — it _sharpens candidate 18's ordering_, which
is the best-reasoned of the three remediation proposals: the first action is to
read the key's restriction state and its project's billing cap in the Google
Cloud console, because that is the only place the answer lives. Candidate 18's
structural argument is **confirmed at the code level**: `beachfront-dentistry/src/lib/blux/maps-loader.ts:32`
is `script.src = \`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${cbName}\``,
and `VITE_GOOGLE_MAPS_KEY` is consumed in `BluxWidget.svelte`, `LocationMap.svelte`
and `FrozenPage.svelte` — client-side Vite vars, compiled into the shipped bundle.
A Maps JS key is public by construction; the git leak adds close to zero
incremental disclosure, and **restriction, not secrecy, was always the control.**
Restrict-then-rotate is correct; rotate-first is, as candidate 18 says, theatre
with downtime attached.

### Per-candidate

- **Candidate 1 — CONFIRMED.** Every number, hash and line reproduces. Its
  self-flagged gap (whether the `whsec_` value is still wired) is real and
  still open.
- **Candidate 6 — CONFIRMED.** Locations, shape analysis, `validity: unknown`,
  `push_protection_bypassed: false`, zero Stripe refs, HEAD redaction — all exact.
- **Candidate 7 — CONFIRMED.** #754's text is verbatim. One wobble: the lens
  prose says "three further public repos have scanning switched off entirely,
  two of them active client projects"; the third is `the-pointe`, which is
  archived. The proposal body states this correctly.
- **Candidate 12 — CONFIRMED** (see its own section below; it is a different
  finding that happens to share the subject).
- **Candidate 18 — CONFIRMED.** `protection-coverage.ts:117-126`, `gh.ts:642`
  and the `:135` comment, `gh-rest.ts:287`, the `self-updating` gap, and
  `maps-loader.ts:32` are all exact. Its two-control proof design (must report
  1 on beachfront, 0 on the other 27, 0 after resolution) is stronger than the
  house-rule minimum, and both controls exist today.

---

## Candidate 2 — "Make prove-the-instrument a machine-checked property" — CONFIRMED

- `tests/build/` holds gate tests for exactly six scheduled workflows
  (daily-reports, fleet-db-backup, fleet-prismic-drift, fleet-security,
  fleet-smoke, report-rerender) plus `reusable-prismic-workflow.test.ts`. ✔
- `grep -ral release-health tests/` → **zero files** (exit 1). ✔ exact.
- `grep -ral fleet-form-e2e tests/` → **exactly one**, `tests/build/fleet-prismic-drift-workflow.test.ts`. ✔ exact.
- `fleet-lighthouse` is referenced by three test files, none a gate test. ✔
- `tests/build/fleet-smoke-workflow.test.ts:30` reads "The clean-sweep case is
  first on purpose. A gate that has only ever been seen to fail is an untested
  assertion, not an instrument." ✔ **verbatim, at line 30.**
- `runGate` is at line 50. ✔ exact.
- `tests/ci-gate.test.ts:14` derives the gate from `pkg.scripts.verify.split("&&")`. ✔
- The #711 quote is verbatim in the issue body: "inventing an abstraction over
  five same-day instances is how the next layer of unearned confidence gets built." ✔
- §9.2's "Three instruments, three false FAILs, zero true ones" is in the source
  document at line 1650. ✔
- Skill counts reproduce from `metrics.json`: writing-plans 45, executing-plans 4,
  using-git-worktrees 3, **verification-before-completion 1**. ✔

Correction: **59** open issues today, not 58.

The enumeration its proposal implies is correct: under
`{fleet-*,daily-reports,release-health,report-rerender}.yml`, nine workflows,
six with a gate test, and the three without are exactly fleet-form-e2e,
fleet-lighthouse and release-health.

---

## Candidate 3 — "Close the two gates that pass on an empty run and on their own failure" — OVERSTATED

The substance is right. One stated absolute is **false**, and the candidate's
own cited source contradicts it.

**Confirmed:**

- `fleet-form-e2e` has **no `wrote=0` check** and no unmeasured check. ✔
- `fleet-lighthouse.yml:106-108` carries `if [ "$wrote" -eq 0 ]` + `::error::fleet Lighthouse wrote 0 of $total site(s)` + `exit 1`. ✔ exact lines.
- The self-skip accommodation is documented at `fleet-form-e2e.yml:66-70` with no counter and no expiry. ✔ exact.
- `release-health.yml:97-99` sets `red=no` on an empty query, comment included: "(fresh repo, or the API call failed)". ✔
- `fleet-security.yml:237` is the positive-marker close: `if ! grep -q "PROTECTION_AUDIT gaps=0 "`. ✔ **exact line.**
- Run `34696929623` is real: fleet-form-e2e, conclusion **success**, 2026-09-12T13:37:11Z. ✔
- The 6/7 testMode split reproduces per-repo (see candidate 14). ✔

**Does not reproduce:** _"the only `exit 1` is the absent-summary case."_
`grep -n 'exit 1' .github/workflows/fleet-form-e2e.yml` returns **two**: line 86
(absent summary) and **line 122** (`$failed*4 > $total`, the >25% mass-flake
gate). The survey's own §5.4a table — which this candidate cites — records case E
("4 of 13 failed to write (>25%)") as `EXIT=1`. An implementer reading this
would add a gate that already half-exists.

Minor: the release-health close step is gated at line **166**, not 163.

---

## Candidate 4 — "Make the a11y gate scan the site, not two dev fixtures" — CONFIRMED

- `grep -l a11yRoutes */package.json` across all 41 checkouts → **exactly three**:
  29-navy, reddoor-starter, vida-legacy-foundation. ✔ exact.
- The two fixtures are `/dev/a11y-fixtures` and `/dev/animate-in`
  (`src/configs/playwright-a11y.ts:6-9`). ✔
- The source comment is **verbatim**: "This exists because scanning only fixtures
  let a critical `image-alt` violation ship to five production pages with CI
  green; it is opt-in because the audit runs with --fail-on-violations and most
  of the fleet has pre-existing debt." ✔
- #770 (commit `9f5fc898`) closes #697 and its body says the violation shipped to
  "five production pages on **gallerysonder**". gallerysonder is still
  fixtures-only today. ✔ exact.
- #680 and #700 are open and unfixed. #481 is closed (2026-08-02). ✔

Corrections, neither decision-changing: **23** repos call the shared reusable CI,
not 22. The "24 of 27" denominator does not reproduce — on the shared CI it is
20 of 23 fixtures-only. The config file is `src/configs/playwright-a11y.ts`,
published as `configs/playwright-a11y.js` (which is what consumers import, so
the candidate's path is defensible).

---

## Candidate 5 — "Fire one known-good row through the lead-path alarms" — CONFIRMED

- `grep -rain 'deadletter|dead_letter' src/alerts/ src/dashboard/ .github/workflows/` → **zero hits**. ✔ exact.
- Attention kinds are exactly vuln, delivery, renovate, lighthouse, ci, analytics,
  preflight, turnstile, notify-bounce, prismic-drift. No deadletter, no form-e2e,
  no unknown-site. ✔ (union spans lines 39-55, not 40-52 — trivial.)
- `const turnstileWidget: "pass"|"fail"|null = turnstileFlag === false ? "fail" : null`
  is present with the full 2026-09-04 rationale comment above it. ✔ (line 61, not 60.)
- **`Require Turnstile` is `true` on exactly ONE of the 45 Airtable rows: Reddoor.** ✔ exact.
- The `Turnstile widget` column is absent from every row in the export — i.e.
  null fleet-wide, exactly as claimed. ✔
- `Form E2E OK` = `pass` on exactly six rows (MSOT, Espada, Vineyard Custom Homes,
  1836dig, Reddoor, Beachfront Dentistry), stamped 2026-09-12T13:38–13:41. ✔

So the red guardrail `requireTurnstile && turnstileWidget === "fail"` genuinely
cannot fire for any site today. Confirmed.

---

## Candidate 8 — "Close the #645 lead-path gap before Phase 6" — CONFIRMED

The most precisely-cited candidate in the set. Every line number is exact.

- `src/forms/ingest.ts:195` **is** `if (!site) return { status: "unknown-site", slug };` ✔
- The dead-letter path above it fires only when the lookup **throws**. ✔
- `src/forms/site-lookup.ts:46` **is** `if (strict) return null;` ✔
- `src/reports/airtable/ensure-site.ts` — the `exists` branch returns at line 113
  and the file contains **zero** references to `getSiteBySlug` or `mirrorSiteInsert`. ✔
- `src/cli/commands/db.ts:89` imports `getWebsiteBySlug` from the Airtable module;
  `:119` wires it into `replayDeadLetters`. ✔ both exact.
- `fleetWriteFailed` / `mirrorMissed` at `src/audits/write-audits-to-airtable.ts:287`. ✔ exact.
- #645: open since 2026-08-31T23:57:40Z, **0 comments, `updated_at` identical to
  `created_at`**. ✔ exact.
- `grep -rl FORMS_INGEST_URL */src` → **26 entries**. ✔ exact.
- `vida-legacy-foundation/src/routes/[[lang=lang]]/contact/+page.server.ts` and
  `29-navy/src/routes/contact/+page.server.ts` both exist and both reference ingest. ✔ exact paths.
- Non-maintained checkouts declaring `testMode` in `/health`: 29-navy, hedloc,
  the-pointe-burbank, the-tower-burbank, vida-legacy-foundation — **exactly the
  five named** (plus canvas-starter and the two starters, which are templates). ✔

Its own flagged unknown — whether those five are deployed and taking real traffic —
is still unknown, and it is right that this is the first ten minutes of the work.

---

## Candidate 9 — "Declare the rollback window closed" — CONFIRMED

- #646: open since **2026-08-31T23:57:41Z**, 0 comments, `updated_at == created_at`. ✔ timestamp exact to the second.
- #539 and #612 open; **59** open issues total (candidate says 58).
- `src/db/freeze.ts:44-45`: "The Airtable write is kept as the shadow for / the
  one-week rollback window". ✔
- The docblock records `FLEET_PARITY sites=44 health=44 schedule=44 reports=17 mismatches=0`. ✔ exact.
- `db parity` exists at `src/cli/commands/db.ts:165`. ✔ exact line.
- **`grep -rn "db parity\|db sync\|import-airtable" .github/ scripts/` returns
  NOTHING (exit 1).** ✔ exact — no workflow, cron or script runs it.
- #698's body does say "**1,835 occurrences** across ~51 files and directories"
  and "`--write-airtable` on 4 commands", and does record both 2026-09-04
  failures. ✔ The candidate correctly attributes these to the issue rather than
  claiming them as its own measurement. (For reference, my own count over `src/`
  alone is 925 occurrences across 124 files — a different denominator, not a
  contradiction.)
- `src/db/fleet-state.ts` value-imports `mapWebsiteRecord`, `toReportType`,
  `canonicalizeStatus`, `parseNotifyRouting` etc. from `./import-airtable.js` and
  `../reports/airtable/*` at lines 38-59. ✔
- Beachfront's `Form E2E checked at` = **2026-09-12T13:41:45.991Z**. ✔ exact.

Not independently checked: "Phase-6 walkthrough: 2 of 10 steps done", and the
`daily-reports` "No reports due" output (the workflow did run and succeed on
2026-09-12; I did not read its log).

---

## Candidate 10 — "Get one backup copy off GitHub" — CONFIRMED

- `.github/workflows/fleet-db-backup.yml` uploads `dump.sql.gpg` with
  `retention-days: 30`, and `upload-artifact` appears **exactly once** in the
  file — there is no second destination. ✔
- `src/db/dump.ts` contains **zero** occurrences of `redact`. ✔
- `src/db/schema.ts:93-95` puts `newsletter_webhook`, `mailchimp_api_key`,
  `mailchimp_audience_id` in the site row. ✔ exact lines.
- `docs/runbooks/` holds six runbooks and **none is a restore runbook**. ✔
- `RESTORE refused=target-not-empty` at `src/cli/commands/db.ts:377`. ✔ exact line.
- Run `34684089299` is fleet-db-backup, **success**, 2026-09-12T08:45:29Z. ✔
- `BACKUP_PASSPHRASE` is in `~/.config/reddoor-maint/credentials.env`, alongside
  three `.bak` copies dated **2026-08-10, 2026-08-14, 2026-09-01** — all in one
  directory on one machine. ✔ exact.

The candidate honestly flags that it could not establish whether a 1Password copy
exists. Still true; that check should remain step zero, exactly as written.

---

## Candidate 11 — "Inventory every credential" — OVERSTATED

One stated count is wrong, in a candidate whose whole point is that counts are
not currently knowable.

**Does not reproduce:** _"Nine keys appear in both main files."_ The intersection
is **SEVEN**, and they are exactly the seven the candidate lists by name:
`AIRTABLE_BASE_ID`, `AIRTABLE_PAT`, `CLAUDE_OAUTH`, `FORMS_INGEST_TOKEN`,
`RESEND_API_KEY`, `TURSO_AUTH_TOKEN`, `TURSO_DATABASE_URL`. The "and others" is
empty.

**Everything else confirmed:**

- 26 keys in `credentials.env`, 33 in the repo `.env`, `report-edit.env` created
  2026-09-11, 166 bytes, holding exactly `PROSPECT_EDIT_TOKEN` and `REPORT_EDIT_KEY`. ✔ exact.
- `loadCredentialsIntoEnv` reads only the canonical path; a missing file is a
  silent no-op; `process.env` wins (`src/util/credentials.ts:61-62`). ✔
- The four dead keys — `DROPBOX_ACCESS_TOKEN`, `FIGMA_PAT`, `GOOGLE_SEARCH_API_KEY`,
  `TURNSTILE_SECRET_KEY_1` — have **zero** references across `src/ netlify/ scripts/`. ✔ exact.
- 11 `<SITE>_PRISMIC` keys in `.env`; the code derives `PRISMIC_TOKEN_<SLUG>` at
  `src/prismic/models/token.ts:27-39`. ✔ exact.
- `NETLIFY_PAT` at `src/audits/netlify-deploy.ts:184`. ✔ exact.
- `TURSO_FLEET_USAGE` is in the repo `.env` only, and is referenced by code. ✔
- #650 and #710 are both open. ✔

One naming slip: the trap documented at `docs/runbooks/turnstile-widgets.md:18-24`
is about **`TURNSTILE_SITE_KEY_1`**, not `TURNSTILE_SECRET_KEY_1`. Both exist in
`.env`; neither is read by code, which reads `TURNSTILE_SECRET_KEY`/`_2`/`_3`
(`netlify/functions/form-ingest.mts:206-207`). The naming-drift claim stands; the
citation points at the sitekey's trap.

---

## Candidate 12 — "Put --limit on every tracking-issue query" — CONFIRMED

**The single most cleanly reproducible finding in the whole set, and I reproduced
the live failure, not just the code smell.**

- `grep -rn 'gh issue list' .github/workflows/` → **24 call sites across 9
  workflows** (fleet-prismic-drift, daily-reports, fleet-db-backup, fleet-form-e2e,
  fleet-lighthouse, fleet-security, release-health, time-travel, fleet-smoke). ✔ exact.
- `grep -rn -A3 'gh issue list' | grep -c limit` → **0**. ✔ exact.
- Live, today, against reddoorla/reddoor-maintenance:

```
$ gh issue list --state open --json number,title \
    --jq 'map(select(.title=="Fleet protection coverage gap")) | .[].number'
754

$ gh issue list --state open --limit 200 --json number,title --jq '…'
754
652
```

**The workflow's own query cannot see #652. The truncation is live.** ✔

- `src/github/gh.ts` carries the documented fix and the trap comment — "the
  default page of 30 is exactly the trap that produced the 2026-07-31 false
  'queue is empty'" — applied there and **nowhere else**. ✔ (Comment is at
  lines 635-636, not 640-641.)

Correction: **59** open issues today, not 58 — which makes the point sharper,
not weaker. This candidate also supplies the mechanism for the duplicate-issue
puzzle candidate 7 flags but does not explain.

---

## Candidate 13 — "Build one roster reconciler" — CONFIRMED

- Airtable `Websites`: **45 rows**, status counter **exactly**
  `{maintained:13, archived:12, external:9, building:7, hosted-only:2, launching:2}`. ✔
- **41 git checkouts** in `~/Documents/GitHub`. ✔ (44 directories, 41 with `.git`.)
- **28 public org repos.** ✔
- Discord message counts reproduce **exactly**: worthe 100 (API-capped),
  trinity-law-school 33, roalson-interests 13. ✔
- `Worthe` is `Status=archived` while `#worthe` is tied for busiest channel. ✔
- `29 Navy` is `building` with an **empty `Git repo` cell**, while the repo exists
  locally, exists publicly, and has secret scanning off. ✔
- `composition-hospitality` and `the-tower` are org repos with **no local checkout**. ✔
- `Hedloc` and `Alamo Anatomy` are `launching`, both with real repos, both with
  `Last security audit at` = **2026-07-08** — 66 days. ✔ exact.
- `src/inventory/airtable.ts` and `src/inventory/local.ts` exist; `listOrgRepos`
  exists in `gh.ts`; `resolve-sites.ts` accepts `--fleet <file.json>`. ✔

Two phrasing imprecisions, neither decision-changing: **15** non-archived rows
have an empty `Git repo` cell, not four — but the four named (29 Navy, Domaru,
Williamson Homes, Williamson Construction Co) are exactly the four `building`
rows, and `external`/`hosted-only` rows legitimately have none. And the corpus
holds 20 Discord channels total, of which roughly 15 are client channels;
`#water-cooler`, `#tangents`, `#inspiration`, `#schedule` and `#new-business`
are internal.

---

## Candidate 14 — "Give fleet-form-e2e a self-skip counter" — CONFIRMED

The most precisely-evidenced candidate in the set. Its census reproduced
**per repo, exactly**, by two independent routes.

`grep -c testMode <repo>/src/routes/health/+server.ts` across the 13 maintained
checkouts:

- **Declares (6):** beachfront-dentistry, reddoor-website, medical-solutions-of-texas,
  espada, vineyard-custom-homes, 1836dig
- **Absent (7):** gallerysonder, revogen, erp-industrial, data-dynamiq,
  la-homelessness-initiative, caltex-landing, la-homelessness-youth

And independently, the Airtable `Form E2E OK` column is `pass` on **exactly those
same six rows** and null on the other 39. Two routes, same answer.

- No open issue tracks the testMode rollout. ✔ (checked with `--limit 200`.)
- §5.4a's executed-gate table is in the source at lines 844-851: case A
  (positive control) `EXIT=0`, B `EXIT=1`, **C (zero sites) `EXIT=0` ← the hole**,
  **D (all self-skipped) `EXIT=0`**, E `EXIT=1`; fleet-lighthouse on the same
  input `EXIT=1`. ✔ Note this table **did** include a positive control, which is
  the house rule being honoured.
- `tests/build/` has no gate test for fleet-form-e2e or fleet-lighthouse. ✔
- 8 of 13 maintained sites have no `test` script — **exactly the list given**. ✔

---

## Candidate 15 — "Ship a per-site conformance report" — OVERSTATED

Its own measurements are exact; two figures borrowed from §3.4-3.5 do not
reproduce at the stated magnitude.

**Exact:**

- `grep -l a11yRoutes */package.json` → 29-navy, reddoor-starter,
  vida-legacy-foundation — **none of them one of the 13 maintained sites**. ✔
- No `test` script in gallerysonder, revogen, medical-solutions-of-texas,
  erp-industrial, vineyard-custom-homes, caltex-landing, 1836dig,
  la-homelessness-youth — **8 of 13, exactly that list**. ✔
- `pnpm-workspace.yaml` overrides block present in **12 of 13**, absent only in
  **la-homelessness-youth**. ✔
- `src/audits/a11y.ts` comment verbatim. ✔

**Does not reproduce:** _"netlify.toml says `pnpm build` in 8 repos and `pnpm run
build` in 11."_ Across all 30 `netlify.toml` files I get **10** and **14**. The
`functions = "functions/"` count is **exactly 8**, as claimed. The drift is real;
the build-command split is quoted at the wrong denominator.

---

## Candidate 16 — "Measure Renovate by outcomes landed" — OVERSTATED

**This is the one candidate that made the mistake the house rule is about.** Its
proposal is right and its instrument claims are exact; its headline number is
flatly contradicted by the live data, and the error's shape is a derived view
read as the state itself — the subject of issue #711, which a sibling candidate
quotes approvingly.

**Claimed:** "branch `renovate/all-minor-patch` tip committed 2026-09-07T01:58:33Z,
associated PRs `#51:MERGED:2026-07-13, #76:MERGED:2026-07-20, #87:MERGED:2026-07-27`
— i.e. … the last grouped PR merged 47 days ago."

**Actual**, from `gh api 'repos/reddoorla/reddoor-starter/pulls?state=all&head=reddoorla:renovate/all-minor-patch'`:

```
#100  created 2026-08-10T01:04:12Z  merged 2026-08-12T20:12:29Z
#95   created 2026-08-03T01:56:53Z  merged 2026-08-03T14:52:13Z
#87   created 2026-07-27T10:31:58Z  merged 2026-08-01T00:21:03Z
#76   created 2026-07-20T09:49:21Z  merged 2026-07-26T20:20:13Z
#51   created 2026-07-13T10:17:11Z  merged 2026-07-17T19:51:12Z
```

Five PRs, not three. **The last grouped PR merged 2026-08-12 — 31 days ago, not 47.**
And the three dates quoted as merge dates are the **creation** dates. Most likely
cause: reading a branch-tip `associatedPullRequests` view, which after a rebase
no longer names the PRs the branch actually produced.

The corrected figure is the one candidates 6 and 19 give independently, and I
reproduced it from the PR corpus: **the grouped channel last OPENED a PR on
2026-08-10** (a fleet-wide batch of 19), and has opened none since.

**Instrument claims, all exact:**

- `renovateGaps` `protection-coverage.ts:133`, `renovateBlockedGaps` `:181`,
  `dashboardVocabularyGaps` `:205`. ✔
- `"awaiting schedule"` **is** already in `KNOWN_DASHBOARD_SECTIONS`
  (`src/github/gh.ts:190`), so the vocabulary check correctly returns nothing. ✔
- `grep -rain 'lastMergedRenovate|daysSinceMerged|prless|noPullRequest' src/` →
  **zero hits**. There is no outcome metric anywhere. ✔ exact.
- Renovate CI: **1,626 success / 3 failure = 0.18%**. ✔ exact.
- Branch head carries **exactly one status** (`renovate/stability-days`, SUCCESS)
  and **zero check runs**. ✔ exact.

---

## Candidate 17 — "Schedule sync-configs --dry as a standing drift report" — OVERSTATED

**Exact:**

- `src/recipes/sync-configs.ts` and `src/cli/commands/sync-configs.ts` exist. ✔
- The `ConfigName` union at `src/types.ts:46-56` has **exactly 10** entries:
  lighthouse, eslint, prettier, prettier-ignore, playwright-a11y, svelte,
  gitignore, renovate-action, renovate-config, netlify. ✔ exact.
- `dryPlan` (line 54) delegates to the recipe's own `planTemplateDiffs`, with the
  comment **verbatim**: "a preview that disagrees with the command it previews is
  worse than none." ✔
- **`grep -rn 'sync-configs' --include='*.yml' --include='*.sh' --include='*.mjs'`
  returns exactly one hit: `scripts/smoke-dist.mjs:171`.** It is never scheduled. ✔ exact.
- `resolve-sites.ts` accepts `--fleet <file.json>` (line 50+). ✔
- `isSvelteConfigCompliant` exists with the preserve-customization rationale. ✔
- "five repos have no prettier config" ✔ **exact** among non-archived shared-CI
  repos: canvas-starter, data-dynamiq, reddoor-starter-blux, the-pointe-burbank,
  the-tower-burbank (six including the archived the-pointe).

**Does not reproduce:** _"seven repos carry a frozen lighthouserc.json whose
startServerCommand lacks `--port 5173 --strictPort`."_ There are **19**
`lighthouserc.json` files across the checkouts; **not one** contains `strictPort`;
and only **six** declare a `startServerCommand` at all (all `pnpm vite:dev`), the
other 13 declaring none. The drift is larger and differently shaped than stated —
which strengthens the proposal but means the quoted number should not be reused.

---

## Candidate 19 — "Settle the dead Renovate grouped channel on Monday 2026-09-14" — CONFIRMED

Its errors all run **conservative** — it understates the spread — and every
decision-bearing number is exact.

- **25** repos hold a `renovate/all-minor-patch` branch (candidate says 23),
  **every one PR-less**, **every head dated 2026-09-07**. ✔ pattern exact.
- Head carries exactly one status (`renovate/stability-days`=SUCCESS) and **zero
  check runs**. ✔ exact.
- **103** PR-less `renovate/*` branches across non-archived org repos (candidate
  says ~90), out of 151 total.
- **Lockfile versions reproduce exactly:** la-homelessness-initiative 0.81.0,
  data-dynamiq 0.81.0, the-tower-burbank 0.90.1, gallerysonder 0.93.0, central
  package at 0.95.1, and **no site is on 0.95.1**. The four sites on 0.81.0 are
  1836dig, data-dynamiq, la-homelessness-initiative, la-homelessness-youth — 14
  minors behind. ✔
- CI pin: **21** repos on `8f9852c`, reddoor-website **alone** on `c714d9e`
  (candidate says 22/1 — and omits a third pin, `the-pointe` on `4a32c3d`, which
  is archived). The "v1.4.2 has reached 1 of 23" claim is exact. ✔
- Grouped channel last opened 2026-08-10. ✔ confirmed from the PR corpus.

Two things to carry forward that the candidate omits. "Five Mondays" is **four**
elapsed (08-17, 08-24, 08-31, 09-07); 09-14 is the fifth and is the probe date.
And more important: **Renovate is not dead.** It opened **78 PRs since 2026-08-31**
on `npm-*-vulnerability` and `lock-file-maintenance` branches (32 on 09-09 alone,
many still open). The silence is specific to the grouped non-major channel —
which makes the one-repo `ci.yml` control experiment a genuinely good design,
since the security channel opening PRs while the grouped one does not is itself
a discriminating observation.

---

## Candidate 20 — "Reconcile the three contradictory facts about cookie@0.6.0" — CONFIRMED

The most precisely reproducible drift claim audited. Every idiom count is exact.

| idiom                              | repos                                                          | candidate |
| ---------------------------------- | -------------------------------------------------------------- | --------- |
| `">=0.7.0 <1"`                     | 11 (excl. 2 maintenance worktrees)                             | 11 ✔      |
| `^0.7.2` (4 quoting variants)      | 8                                                              | 8 ✔       |
| `">=0.7.0 <2"`                     | 1836dig, hedloc                                                | ✔ exact   |
| `"@sveltejs/kit>cookie": "^0.7.0"` | caltex-landing                                                 | ✔ exact   |
| no overrides block                 | la-homelessness-youth, the-pointe, welcome-to-the-flower-court | ✔ exact   |

- `grep -n 'cookie: 0.6.0' la-homelessness-youth/pnpm-lock.yaml` → **line 1803**,
  arriving as `@sveltejs/kit`'s own dependency. ✔ **exact line.**
- Sibling la-homelessness-initiative resolves `cookie: 0.7.2`. ✔
- canvas-starter and the-pointe-burbank both resolve **sharp@0.33.5** alongside
  0.35.3, with **imagetools-core@6.0.4**. ✔ exact.
- Airtable, today: LA Homelessness Youth audited **2026-09-12T09:51:04.970Z**,
  Critical/High/Moderate/Low all **0**, `Security advisories` = **`'[]'`**. ✔ exact.
- The `x509: OSStatus -26276` sandbox failure on the Dependabot alerts API
  reproduces. ✔

(A sixth idiom exists — reddoor-md-pdf uses `^0.7.0` — but it is not a site repo.)

**The candidate's refusal to conclude is the correct posture**, and this audit
does not resolve it either: the three facts still do not reconcile, and the
API-on-a-control step remains the right first move.

---

## Candidate 21 — "Measure the a11y debt on the 13 maintained sites" — CONFIRMED

- 3 repos opted in, **none of them among the 13 maintained**. ✔ exact.
- **Exactly four** repos carry a `test:a11y` script: 29-navy, reddoor-starter,
  the-pointe, vida-legacy-foundation. ✔ exact.
- `src/audits/a11y.ts:186-199` comment verbatim. ✔
- The #770 fix comment names the case precisely: "vida-legacy-foundation added
  eight real routes and read 'across 2 routes'; all ten had been scanned the
  whole time (#697)." ✔ **exact**, which also means its proposed PASS control
  (vida must report 8, not 2) is well-founded and checkable.
- gallerysonder is named in #770's commit body as where the violation shipped. ✔

Same "24 of 27" denominator wobble as candidate 4; the proposal's own scoping to
the maintained 13 is exact.

---

## Candidate 22 — "Collapse the blux formatting debt and put forward pointers" — CONFIRMED

The documentation half is exact. The formatting half the candidate itself marks
as inferred, and it remains unexecuted — correctly, since its own proposal makes
proving it step one.

- `docs/superpowers/specs/2026-08-31-starter-track-split-design.md:74` still says
  shared improvements "are pulled into the Blux repo with `git merge starter/main`". ✔
- Line **81** of the same file: "Expected to be small and localized". ✔ **verbatim.**
- The companion plan repeats the instruction **twice** —
  `docs/superpowers/plans/2026-08-31-starter-track-split.md:146` and `:1525`. ✔ exact.
- **Neither file carries a `> Superseded in part by …` pointer**, though the
  affordance is in active use in `docs/workJournal.md` and one 2026-09-08 plan. ✔
- `CLAUDE.md` carries the corrected cherry-pick rule at ~194 and then points the
  reader at that exact spec at **line 204**. ✔

Its self-flagged prior question — "is `src/blux` substrate or dead weight?" —
is the right gate, and this audit does not answer it.

---

## Candidate 23 — "Make the plan-phase boundary the session boundary" — CONFIRMED

Recomputed independently from `sessions.jsonl` and `prompts-unique.jsonl`. The
concentration numbers reproduce to the unit.

| claim                                          | candidate             | reproduced                  |
| ---------------------------------------------- | --------------------- | --------------------------- |
| main-thread human sessions                     | 283                   | **283** ✔                   |
| sessions with ≥20 operator turns               | 33                    | **33** ✔                    |
| turns held by those 33                         | 5,100 / 5,692         | **5,100 / 5,692** ✔         |
| tool calls held by those 33                    | 88,629 / 95,272       | **88,629 / 95,272** ✔       |
| median span of those 33                        | 29.3 h                | **29.2 h** ✔                |
| max span                                       | 98.2 h                | **98.2 h** ✔                |
| Broken worst session                           | 98.2 h / 686 / 12,789 | **exact** ✔                 |
| Broken second                                  | 54.9 h / 594 / 12,144 | **exact** ✔                 |
| vida-legacy-foundation                         | 77.4 h                | **77.4 h** ✔                |
| auto-compaction preambles                      | 119, deduped by UUID  | **119, 119 unique UUIDs** ✔ |
| total interruptions                            | 212                   | **212** ✔                   |
| writing-plans / executing-plans / verification | 45 / 4 / 1            | **45 / 4 / 1** ✔            |

Three caveats, none fatal:

1. **"104 of 212 interruptions occur in those 33 sessions" mixes denominators.**
   104 is right, but 212 is the fleet-wide total including subagent sessions.
   Against main-thread sessions the figure is **104 of 119 — 87%**. The candidate
   _understates_ its own case by better than half.
2. **The repo-switch figures do not reproduce exactly.** My typed-only filter
   (dropping compaction preambles and slash commands) gives **1,775 adjacent
   pairs, 980 switches = 55.2%, median gap 3.0 min, 63% within five minutes**,
   against the candidate's 1,684 / 1,005 / 59.7% / 2.9 min / 64%. The gap and
   within-5-minute figures match; the rate is ~4.5 points lower under my filter.
   Directionally solid, exact rate filter-dependent.
3. **"Median preamble length 17,295 chars, 2.07M re-injected" cannot be checked
   from this corpus** — `prompts-unique.jsonl` truncates prompt text at 6,000
   chars. Plausible, unverified here.

The documented failure mode it cites — "The pixel-matching program has ENDED"
carried inside a compaction summary and violated ~30 minutes later — is in
`04-journal-beat-by-beat.md` as described.

---

## Cross-cutting notes for whoever builds from this list

1. **Candidate 16's number must not be reused.** "47 days" and the three-PR list
   are wrong; the grouped channel's real last activity is 2026-08-10 (opened) /
   2026-08-12 (merged). Candidates 6 and 19 carry the correct figure.
2. **Renovate is not dead — the grouped channel is.** 78 Renovate PRs since
   2026-08-31. Any write-up saying "Renovate stopped" will be falsified the
   moment someone opens the PR list, and will discredit the real finding.
3. **The decisive security fact is missing from all five security candidates:**
   nobody has established that any leaked key is still live, and GitHub cannot
   say because validity checks are off. Candidate 18's ordering (read the console
   first) is the only proposal that starts where the answer actually is.
4. **Candidate 12 is the cheapest high-leverage item and the only one whose
   failure I reproduced live.** It is also the delivery layer every other
   instrument here depends on.
5. **Two independent candidates reproduced the same 6/7 testMode split by
   different routes** (health-endpoint grep; Airtable `Form E2E OK` column).
   That is the strongest-evidenced operational gap in the list.
