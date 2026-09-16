# inv-07 — Data layer and external integrations

Survey date: **2026-09-12**. Central repo at `main` = `9f5fc898`.
Everything below that is stated as fact was read from a file or produced by a
command that is quoted inline. Where I could not measure something, I say so.

---

## 0. The one-paragraph version

Turso is live, healthy and backed up — the nightly `fleet-db-backup` run this
morning printed `DUMP_VERIFY loaded=true tables=11 rows=929 blob_bytes=7777769
mismatches=0` twice (once on the plaintext dump, once on the decrypted gpg
artifact) and `FLEET_DB_USAGE … worst=storage_bytes:0.67% threshold=50.00%
blocked=none at_capacity=none verdict=ok`. The whole fleet database is **929 rows
across 11 tables**. But **Airtable is not gone.** It received writes at
`2026-09-12T13:41:45` — three hours before this survey — and it is still the
fleet roster every batch job enumerates from, still a hard `500` precondition on
`resend-webhook.mts`, and still the only `sites`-INSERT path. Phase 6 (#646),
which deletes it, has had **zero commits, zero comments and zero linked PRs since
it was filed on 2026-08-31**; the one-week rollback window it gates on closed
around **2026-09-07, five days ago**. Meanwhile the operator said on 2026-09-05
_"yes, but airtable is no longer in our stack"_ — which is the exact belief #698
was opened to correct. The lead-path hardening issue #645 is **entirely unfixed
in the code**, verified item by item below, and the one instrument that would
catch its worst failure mode covers **6 of 13 maintained sites**.

---

## 1. Turso — post-flip state

### Where the code lives

| concern                                                                | path                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| connection + migration cache                                           | `src/db/client.ts`                                                      |
| table types (the `Database` interface)                                 | `src/db/schema.ts:265-277`                                              |
| migrations (17, `0001_init` → `0017_prospect_audits_opened_at`)        | `src/db/migrations.ts`                                                  |
| the freeze switch + strict mirror                                      | `src/db/freeze.ts`                                                      |
| fleet row reads (`sites`/`site_health`/`site_schedule`/`reports` join) | `src/db/fleet-state.ts`                                                 |
| lead rows                                                              | `src/db/submissions.ts`, `src/db/screenouts.ts`, `src/db/deadletter.ts` |
| backup/restore                                                         | `src/db/dump.ts`, quota `src/db/usage.ts`                               |
| Airtable→Turso importer / parity / sync (Phase-6 deletions)            | `src/db/import-airtable.ts`, `src/db/parity.ts`, `src/db/sync.ts`       |

Tables (`src/db/schema.ts:265`): `submissions`, `spam_screenouts`,
`fleet_events`, `_migrations`, `submission_deadletter`, `sites`, `site_health`,
`site_schedule`, `reports`, `prospect_audits`, `digest_state`.

### Credentials

`TURSO_DATABASE_URL` + optional `TURSO_AUTH_TOKEN`, read by
`readDbConfig()` (`src/db/client.ts:22-27`). Both are present in **both**
`~/.config/reddoor-maint/credentials.env` **and** the repo `.env`.
`TURSO_FLEET_USAGE` — the _platform_ token, a strictly more privileged
credential than the database token and the only one that can read quota — is in
the repo `.env` **only**, not in `credentials.env`. Also read:
`TURSO_ORG`, `TURSO_RESTORE_AUTH_TOKEN` (restore path).

### Health — measured

The flip is `dadb0730 2026-08-31 feat(db)!: THE FLIP — Turso is authoritative;
the hourly import retires with it (#612) (#643)`. `TURSO_IS_AUTHORITATIVE = true`
at `src/db/freeze.ts:52`. `.github/workflows/fleet-db-sync.yml` was deleted in
that same commit and `runs.jsonl` contains **zero** `fleet-db-sync` runs.

Every nightly in the central repo has been green every day the corpus covers
(2026-09-04 → 2026-09-12; earlier days are outside the GH API listing window the
corpus captured, so absence before 09-04 is a corpus artifact, not a gap):

```
ci                   {'success': 162, 'failure': 3}   last 2026-09-11 success
release              {'success': 40,  'failure': 1}   last 2026-09-11 success
fleet-db-backup      {'success': 9}                   last 2026-09-12 success
fleet-form-e2e       {'success': 9}                   last 2026-09-12 success
daily-reports        {'success': 9}                   last 2026-09-12 success
fleet-prismic-drift  {'success': 9}                   last 2026-09-12 success
fleet-smoke / -lighthouse / -security   {'success': 9-10 each}
```

From run `34684089299` (2026-09-12 08:45 UTC):

```
DUMP_VERIFY loaded=true tables=11 rows=929 blob_bytes=7777769 mismatches=0   (plaintext)
DUMP_VERIFY loaded=true tables=11 rows=929 blob_bytes=7777769 mismatches=0   (decrypted .gpg)
FLEET_DB_USAGE plan=starter elapsed=37.33% rows_read=0.01% rows_read_proj=0.04%
  rows_written=0.07% rows_written_proj=0.19% bytes_synced=0.00% storage_bytes=0.67%
  databases=1.00% locations=66.67% groups=0.00% measured=7
  worst=storage_bytes:0.67% threshold=50.00% blocked=none at_capacity=none verdict=ok
```

Two things that matter about that quota line. First, the "nightly Turso usage
alarm is still unbuilt" item listed in #646's _also queued_ section **is now
built** — `5b4befc5 feat(db): alarm on Turso plan-quota headroom before it
becomes an outage (#634)` added the separate `quota:` job in
`.github/workflows/fleet-db-backup.yml:167-228`. Second, the plan has
`overages: false`, so crossing a quota _blocks_ reads and writes rather than
billing; at 0.67% of the worst ceiling that is a smoke detector, not a concern.

The backup gate is one of the better-built instruments in this repo: it verifies
against an **origin manifest** embedded as the dump's first line
(`src/db/dump.ts:68-76`, `MANIFEST_PREFIX = "-- REDDOOR_DUMP_MANIFEST "`) rather
than against the dump's own INSERT counts — the earlier self-comparison would
have verified a dump that collected 5 of 44 sites as clean (`5c682c26 fix(db):
verify the backup against the ORIGIN, not against itself (#620)`) — and it
decrypts the artifact it actually uploads and re-runs the same gate on the
round-trip.

**Not measured:** I did not open a connection to Turso. Every number above comes
from the CI run's own output.

### What is NOT wired

`db parity`, `db sync` and `db import-airtable` still exist as CLI actions
(`src/cli/commands/db.ts:165,184,219`) but **no workflow, cron or script invokes
any of them** — `grep -rn "db parity\|db sync\|import-airtable" .github/ scripts/`
returns nothing. So there is no automated divergence check between the shadow
Airtable and the authoritative Turso. Parity was last proven by hand at the flip
(`FLEET_PARITY sites=44 health=44 schedule=44 reports=17 mismatches=0`, recorded
in the `src/db/freeze.ts:50` docblock). That number is now 12 days old.

---

## 2. What still lives in Airtable — and it is more than the operator thinks

Base schema (corpus `airtable-schema.json`): **Websites** (113 fields),
**Reports** (46), **Digest State** (3), **Submissions** (13), **Spam Screenouts**
(5).

Live row counts read today: Websites **45** (44 at flip + 1), Reports **17**,
Submissions **48**, Digest State **1**, Spam Screenouts **0**.

### Airtable is still being written, today

```
Form E2E checked at — newest 5:
  2026-09-12T13:41:45.991Z  Beachfront Dentistry
  2026-09-12T13:41:35.215Z  Reddoor
  2026-09-12T13:39:59.417Z  1836dig
  2026-09-12T13:39:21.446Z  Vineyard Custom Homes
  2026-09-12T13:38:44.745Z  Espada
```

and the nightly's own words, from run `34696929623`:

```
→ wrote 13 site(s) to Airtable
FLEET_WRITE_SUMMARY wrote=13 failed=0 total=13 mirrored=13 mirror_failed=0 mirror_missed=0
```

Airtable-first, Turso-mirrored-strict. `Prismic Models Checked At` is stamped
`2026-09-12T08:59:15` on all 13 maintained rows; `Deploy checked at` at
`2026-09-12T12:0x`; `Digest State.Updated At` at `2026-09-12T12:57:44`.

### Which tables are dead vs live

- **Submissions — dead.** 48 rows, oldest `2026-06-15`, **newest
  `2026-06-23T03:01:06`**. Leads moved to Turso at the Option-C hybrid cutover
  and nothing has written this table in almost three months.
- **Spam Screenouts — empty** (0 rows).
- **Reports — live-ish.** 17 rows, all `Delivery status: delivered`. Newest
  created `2026-08-31`, newest `Sent at` `2026-09-01T14:13:33` — i.e. the
  **first** post-flip send landed and the Resend delivery webhook wrote its
  status back successfully after the flip. That is a proven-once instrument.
- **Websites — fully live**, the fleet roster.
- **Digest State — fully live.**

### Where Airtable is load-bearing in code

`grep -rl "reports/airtable/" src netlify scripts` → **52 files**. 100 import
lines, of which 39 are `import type` — so **61 value imports**. The layer itself
is **2,300 LOC** across 7 files (`websites.ts` alone is 1,204).

Seven Netlify functions read `AIRTABLE_PAT`: `fleet-homepage.mts`,
`trigger-renovate.mts`, `resend-webhook.mts`, `form-ingest.mts`,
`report-commentary.mts`, `approve-report.mts`, `site-details.mts`. Env-var reads
across `netlify/` count **19 × TURSO_DATABASE_URL vs 9 × AIRTABLE_PAT**.

The hardest coupling is `src/db/fleet-state.ts:40-59` — the _Turso_ read path —
value-importing from the directory Phase 6 deletes:

```ts
import { … type RawRecord } from "./import-airtable.js";
import { toReportType, parseAutoEvidence, … } from "../reports/airtable/reports.js";
import { canonicalizeStatus } from "../reports/airtable/site-status.js";
import { parseNotifyRouting, parseSecurityAdvisories, toFrequency,
         toPrismicModelsVerdict, toVerdict, trimToNull } from "../reports/airtable/websites.js";
```

These run inside `rowFromJoined` on **every lead read**. #646 step 1 exists
precisely because deleting the directory first breaks Turso-only reads.

### The naming lie (#698, open since 2026-09-05)

#698 counts **1,835 occurrences of "airtable"** across ~51 files and
directories, including the user-facing flag `--write-airtable` on four commands.
The issue records the failure it caused twice in one 2026-09-04 session, and the
operator's own correction: _"why are you writing to airtable, we don't use it
anymore"_. Read that alongside the prompt on 2026-09-05 — _"yes, but airtable is
no longer in our stack"_ — and the shape is clear: **the vocabulary has
overtaken the code, and the operator's mental model has followed the
vocabulary.** The measurements in this section are the counter-evidence. Both
things are true at once: `--write-airtable` _is_ how you write Turso, and it
still writes Airtable too.

---

## 3. Issue #646 — Phase 6, the key open item

**State: OPEN. Created `2026-08-31T23:57:41Z`. `updatedAt` identical. 0
comments. No labels. No linked PR.** Nothing has touched it in the 12 days since
it was filed.

Its gate: _"Execute only after a clean post-flip week — this ends the rollback
window."_ Flip was 2026-08-31, so the window closed around **2026-09-07**. It is
now 2026-09-12. The week was clean (every nightly green, see §1). **The
precondition is met and the work has not started.** `src/db/freeze.ts:44-48`
still describes the Airtable write as _"kept as the shadow for the one-week
rollback window"_ — a comment that has outlived its own claim by five days.

I walked the eight steps against the code:

| #   | step                                                   | state today     | evidence                                                                                                                                                                                                         |
| --- | ------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | relocate pure helpers out of `src/reports/airtable/**` | **not started** | `src/db/fleet-state.ts:40-59` still value-imports them                                                                                                                                                           |
| 2   | port `resend-webhook` report path to Turso             | **not started** | `netlify/functions/resend-webhook.mts:63-73` still reads `AIRTABLE_PAT`/`AIRTABLE_BASE_ID` and returns `500 "Airtable env missing"`                                                                              |
| 3   | Turso-native `ensure-site`                             | **not started** | `src/reports/airtable/ensure-site.ts:80` still creates in Airtable, then mirrors the echo                                                                                                                        |
| 4   | batch enumeration off Airtable                         | **not started** | `.github/workflows/fleet-form-e2e.yml:58-60` and `fleet-prismic-drift.yml:110-111` still pass `AIRTABLE_PAT`; the CLI is invoked `--fleet airtable --write-airtable`                                             |
| 5   | remove `form-ingest.mts`'s Airtable hard gate          | **DONE**        | `8a4b0d73 2026-09-02 fix(forms): stop Airtable being able to cost a lead (#669)` replaced it with the `NO Airtable precondition here, deliberately` comment; the function now gates on `TURSO_DATABASE_URL` only |
| 6   | delete shadow writes + the layer                       | **not started** | 2,300 LOC, 52 importing files                                                                                                                                                                                    |
| 7   | sweep stragglers                                       | **not started** | 39 type-only imports remain                                                                                                                                                                                      |
| 8   | docs + close out #539/#612                             | **not started** | both still OPEN                                                                                                                                                                                                  |
| —   | _(also queued)_ nightly Turso usage alarm              | **DONE**        | `5b4befc5` (#634); `verdict=ok` nightly                                                                                                                                                                          |

So: **2 of 10 done, both of them done incidentally by other work.** The
dependency-ordered checklist proper has not been entered.

Note that step 5 was done in the _safe_ direction — the gate was removed while
`AIRTABLE_PAT` is still set on Netlify, which is exactly the order #646
prescribes. Nothing about #669 is a violation; it removed the sharpest edge and
left the rest.

---

## 4. Issue #645 — the lead-path gap. Verified unfixed, item by item.

**State: OPEN. Created `2026-08-31T23:57:40Z`, never updated, 0 comments.** Four
of its five items are still exactly as filed.

### 4.1 `ensure-site` resume gap → a site with no Turso row 404s every lead

`src/reports/airtable/ensure-site.ts`, the `exists` branch (lines ~93-114):

```ts
const updates: FieldSet = {};
…
consider(COLS.url, input.url, existing.url || null);
consider(COLS.pointOfContact, input.pointOfContact, existing.pointOfContact);
consider(COLS.gitRepo, input.gitRepo, existing.gitRepo);

const updatedFields = Object.keys(updates);
if (updatedFields.length > 0) {
  await base(WEBSITES_TABLE).update([{ id: existing.id, fields: updates }]);
  await mirror?.site(existing.id, updates);
}
return { status: "exists", siteId: existing.id, updatedFields, skippedMismatches };
```

There is **no `getSiteBySlug` check and no `mirrorSiteInsert` heal**. If the
Turso insert failed on the first run, the re-run takes this branch, finds
nothing to fill, mirrors nothing, reports `exists` — and `/new-site`'s
verification step reads it as success.

Post-flip that site's leads are unrecoverable, because the lookup no longer
falls back (`src/forms/site-lookup.ts:46`):

```ts
const hit = await deps.fromDb(slug);
if (hit) return hit;
…
if (strict) return null;        // strict defaults to TURSO_IS_AUTHORITATIVE === true
return deps.fromAirtable(slug);
```

### 4.2 `unknown-site` persists nothing — still true

`src/forms/ingest.ts:195` is verbatim what the issue quotes:

```ts
if (!site) return { status: "unknown-site", slug };
```

and the docblock above it (`:171-172`) states the boundary as a deliberate
design choice:

> _"A lookup that RESOLVES to null is still `unknown-site` — the store answered,
> and a junk slug is a rejection, not a lead to save."_

That reasoning was correct **before** the flip, when a missing Turso row was
survivable via the Airtable fallback. It is now the sentence that loses the
lead. The dead-letter path immediately above it (`:181-194`) only fires when the
lookup **throws**.

### 4.3 `db replay-deadletters` resolves against frozen Airtable — still true

`src/cli/commands/db.ts:89` and `:119`:

```ts
const { getWebsiteBySlug } = await import("../../reports/airtable/websites.js");
…
const result = await replayDeadLetters(db, {
  getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
```

Not `makeSiteLookup`. The **recovery** path and the **live** path therefore
disagree about what the fleet is.

### 4.4 `sites.name` immutable — still true

`EDITABLE_SITE_FIELDS` (`src/dashboard/site-details.ts:75-140`) contains
`url`, `pointOfContact`, `reportRecipientsTo/Cc`, `copyIntro/Contact/Footer`,
`searchQuery`, `ga4PropertyId`, `gitRepo`, `status`, `maintenanceFreq`,
`testingFreq`, `netlifyId`, `searchConsoleProperty`, `mailchimpAudienceId`,
`newsletterWebhook`, `maintenanceDay`, `testingDay`, `notifyRouting`,
`requireTurnstile`, `acceptedWatchConditions`, `mailchimpApiKey` — and **no
`name`**. A badly-named bootstrap sends client lead notifications from
`"acme-co Forms <…>"` forever. Spun out as its own issue **#664** (_"ensure-site:
--name is create-only, and the create message tells you to do the impossible"_,
open since 2026-09-01).

The sibling of this class **was** fixed: `a831939b 2026-09-04 fix(dashboard): a
site's url is editable from the console (#696)`, prompted by
vida-legacy-foundation pointing at a hostname that 404s, so every audit against
it was measuring nothing.

### 4.5 The compounding problem: nothing watches for any of this

This is the part #645 does not say and that the meta week should.

- **No alarm consumes `submission_deadletter`.** The only files referencing it
  are `src/forms/{ingest,replay,site-lookup}.ts`, `src/db/deadletter.ts`,
  `src/cli/{bin,commands/db}.ts`, `src/db/{schema,migrations}.ts`, and
  `netlify/functions/form-ingest.mts`. Nothing in `src/alerts/` or
  `src/dashboard/` touches it. The attention-item kinds
  (`src/alerts/attention.ts:40-52`) are: `analytics`, `ci`, `delivery`,
  `lighthouse`, `notify-bounce`, `preflight`, `prismic-drift`, `renovate`,
  `turnstile`, `vuln`. **No `deadletter`. No `form-e2e`. No `unknown-site`.**
  A dead-lettered lead is visible only to someone who runs
  `reddoor-maint db replay-deadletters` by hand.
- **The dead-letter has never fired** (per the standing fleet memory, 0 rows
  ever). By this repo's own top rule, that makes it an _untested assertion_, not
  an instrument.
- **The one instrument #646 calls "the one that catches a 404ing lead path"
  covers 6 of 13 maintained sites.** See §5.

---

## 5. Forms ingest pipeline

### Shape

Site's `/api/forms/+server.ts` → central `POST /api/forms/:slug`
(`netlify/functions/form-ingest.mts`, path-routed, `rateLimit 120/60s
aggregateBy ip`) → `verifyFormsToken` → `openDb` → `makeSiteLookup` (Turso-only)
→ screen-out beacon branch / Turnstile / `ingestSubmission` → `createSubmission`,
`classifySpam`, `makeNotify` (Resend), `forwardNewsletterToWebhook`,
`addMailchimpMember`, `stampNotified`, `stampFanout`.

Central modules: `src/forms/{ingest,site-lookup,token,turnstile,spam-classifier,
notify,webhook,mailchimp,meta,payload,replay,reply-copy,default-replies,ics,
rich-text,endpoint,client,action,prismic}.ts`.

### Credentials

- `FORMS_INGEST_TOKEN` — central, on the Netlify site; also in **both** credential
  files. Sites hold `FORMS_INGEST_URL` + `FORMS_INGEST_TOKEN` in their own
  Netlify env (`gallerysonder/src/routes/api/forms/+server.ts:38`).
- `TURSO_DATABASE_URL` — the only hard precondition left on the lead path
  (`form-ingest.mts:115-118`, `db-env-missing` → 500).
- `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` / `_2` / `_3`.
- Per-site secrets live **in the database row**, not in an env file:
  `mailchimp_api_key`, `mailchimp_audience_id`, `newsletter_webhook`
  (`src/db/schema.ts:93-95`). Fill rate is 1/45 for each Mailchimp column.
  The nightly dump is **not redacted** — `src/db/dump.ts` has no redaction
  path — which is why `BACKUP_PASSPHRASE`/gpg is load-bearing rather than
  hygienic.

### Health — the coverage gap, measured twice

`fleet-form-e2e` run `34696929623` (2026-09-12 13:37-13:42), per-site verdicts:

```
pass  msot / espada / vineyard-custom-homes / 1836dig / reddoor / beachfront-dentistry
skip  data-dynamiq / erp-industrials / la-homelessness-youth / revogen /
      sonder / la-homelessness-initiative / caltex
      "site /health does not declare forms.testMode — probe refused
       (testMode forwarding not yet rolled out here)"
FLEET_WRITE_SUMMARY wrote=13 failed=0 total=13 mirrored=13 mirror_failed=0 mirror_missed=0
```

Cross-checked independently against the local checkouts —
`grep -c testMode <repo>/src/routes/health/+server.ts` — and the split is
**exactly** the same 6/7. The declaring sites carry an explicit block:

```ts
// espada/src/routes/health/+server.ts:46-50
// Declares that this deploy's contact form forwards the `testMode` marker
// to central ingest (contact +page.server.ts buildPayload) — the fleet
// form-e2e probe refuses to submit without this flag.
```

`gallerysonder`'s block (`:42-46`) stops at `turnstile:`.

Two of the seven are the accepted formless cases (CalTex, LA-H Youth — the "no
form, no Turnstile" operator ruling). **Five maintained sites with real contact
forms — data-dynamiq, erp-industrials, la-homelessness-initiative, revogen,
sonder — have no end-to-end lead-path coverage at all.** For those five, the
#645 failure (missing Turso row → `unknown-site` → 404 → no dead-letter → no
alarm) is completely invisible. `sonder` is a paying client channel; on
`data-dynamiq` and `la-homelessness-initiative` the fleet has never recorded a
submission, so "working" has never been observed there by any means.

**There is no open issue tracking the `testMode` rollout.** `gh issue list
--search "testMode OR form-e2e in:title"` returns nothing relevant. The gap is
load-bearing and untracked.

The gate itself is honestly built — it keys on the machine-readable
`FLEET_WRITE_SUMMARY` line and errors explicitly when that line is **absent**
(`fleet-form-e2e.yml:84-86`), which is the "absent success marker" shape this
repo has been burned by. But `skip` is not `fail`, so the seven uncovered sites
never redden anything.

---

## 6. Prismic

**Code:** `src/prismic/models/{push,diff,remote,local,write,config,token,canon,
types,index}.ts`; CLI `src/cli/commands/prismic-models.ts`; nightly
`.github/workflows/fleet-prismic-drift.yml`; per-site CI recipe `prismic-ci`.

**Credentials — three coexisting naming schemes, only one of which the code reads:**

1. **Code's rule** (`src/prismic/models/token.ts:27-39`):
   `PRISMIC_TOKEN_<REPOSITORY_NAME upper-snaked>`, derived from the _Prismic
   repository name_, not the directory (`medical-solutions-of-texas` →
   `msot`; `reddoor-website` → `reddoor-la`; `beachfront-dentistry` →
   `48bb12d1`). Fleet mode passes `allowGeneric: false` so a stray
   `PRISMIC_WRITE_TOKEN` cannot cross-wire 18 repos onto one credential.
2. **GitHub Actions secrets**: 16 `PRISMIC_TOKEN_*` env lines in
   `fleet-prismic-drift.yml:117-132`. ✔ matches the rule.
3. **`~/.config/reddoor-maint/credentials.env`**: 11 `PRISMIC_TOKEN_*`. ✔ matches.
4. **Repo `.env`**: 11 keys named `<SITE>_PRISMIC` (`MSOT_PRISMIC`,
   `POINTE_PRISMIC`, `ALAMO_PRISMIC`, …). ✘ **matches nothing the code reads.**
   `grep` finds these names only in two 2026-08-12 design/plan docs, which
   describe them as un-derivable legacy names. They are seed material for the
   Actions secrets, retained after their purpose ended.

**Health — measured.** Run of 2026-09-12 08:58:

```
[msot]                      2 model(s) match Prismic — nothing to push.
[erp-industrials]           5 model(s) match
[espada]                    2   [vineyard-custom-homes] 8   [revogen] 10
[sonder → gallerysonder]   16   [reddoor → reddoor-la]  24
[beachfront-dentistry → 48bb12d1] 38   [caltex → caltex-landing] 6
[data-dynamiq] [la-homelessness-youth] [1836dig] [la-homelessness-initiative]
                            not a Prismic site (no repositoryName) — skipped
9 checked, 0 failed, 4 skipped (no Prismic config), of 13 site(s).
FLEET_WRITE_SUMMARY wrote=13 failed=0 total=13
```

Zero drift fleet-wide. `Prismic Models` = `pass` on all 9, `Prismic Models Drift`
= `not a Prismic site` on the 4.

**The coverage trap, corrected in the journal.** The 16-line env block is **not**
a 16-site coverage list — `--fleet airtable` resolves only sites whose Airtable
`Status` is `maintained`. The 2026-09-09 journal entry (`docs/workJournal.md:1182`,
_"A minted secret nobody read, and the coverage it does not buy"_) overturns
#746's own second clause and proves it from a production run: alamo-anatomy,
hedloc and the-pointe-burbank all have both a minted secret and an env line and
none is swept. 29-navy is still dark and needs two operator actions — the
`Status` flip and its **NULL `Git repo` cell**, which would make the clone throw
outright on the first night it is swept. Do the `Git repo` cell first.

The entry also records a discipline worth copying: the issue claimed 11 env
entries; the real number was 15, _"confirmed twice"_. A count read off a file
once is not a measurement.

---

## 7. Netlify

**Code:** `src/audits/netlify-deploy.ts` + `netlify-deploy-airtable.ts`; all 20
central functions in `netlify/functions/`; site deploys are Netlify-hosted.

**Credentials:** `NETLIFY_PAT` is what the code reads
(`src/audits/netlify-deploy.ts:184`); it lives in the **repo `.env`** and is
wired as an Actions secret on `fleet-lighthouse.yml:56` only. Separately,
`~/.config/reddoor-maint/credentials.env` holds `NETLIFY_AUTH_TOKEN` — the name
the Netlify **CLI** reads natively, which no code in this repo reads. Two
credentials, two names, two files, one service.

**Health — measured.** `Deploy status: ready` on 12 of 13 maintained sites,
`Deploy checked at 2026-09-12T12:0x`. **Beachfront Dentistry has a null
`Netlify ID`**, so its deploy has never been probed — and `Deploy status` drives
the cockpit's _Broken_ band, so that site is silently outside the one alarm that
would catch a failed production deploy.

The audit's failure semantics are well-designed: `{ ok: false }` (couldn't read)
is a distinct type from `{ ok: true, deploy: all-nulls }` (genuinely no deploy),
so a transient API blip cannot clear a real `error`.

**Known trap, open:** #710 (2026-09-09) — _"`netlify env:set --site <id>` exits 0
and writes nothing — a false green in every runbook that uses it"_. Not fixed.
Every credential-provisioning runbook that uses that command is currently
unreliable, which is directly upstream of §5's rollout work.

---

## 8. Resend

**Code:** `src/reports/send/{resend,orchestrate,idempotency,rerender,
render-from-row}.ts`, `src/forms/notify.ts` (lead notifications +
autoresponders), `netlify/functions/resend-webhook.mts` (svix-signed delivery
events), `src/reports/webhook-events.ts`.

**Credentials:** `RESEND_API_KEY` (`src/reports/send/resend.ts:36`) — present in
**both** credential files and as an Actions secret on `daily-reports.yml`;
`RESEND_WEBHOOK_SECRET` on the central Netlify site only.

**Health.** Last real send: `2026-09-01T14:13:33Z`, `Delivery status: delivered`
— so the whole chain (draft → approve → send → svix webhook → status write-back)
was exercised once **after** the flip and worked. All 17 Reports rows are
`delivered`; none stuck.

Today's `daily-reports` run: `NEXT_DUE_WRITE wrote=0 skipped=45 failed=0
mirrored=0 …` / `No reports due.` / `No reports ready to send.` That is
correct, not broken — next-due is anchored on the last `Sent at` plus the
frequency (`src/reports/due.ts`), and the six 2026-08-24 quarterly sends put the
next batch around late November. Worth naming anyway: **the send path will not
self-exercise again for ~10 weeks**, so if Phase 6 breaks it, the break will be
discovered in November.

**The Airtable gate.** `netlify/functions/resend-webhook.mts:69-73`:

```ts
if (!airtablePat || !baseId) {
  console.error("[resend-webhook] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
  return new Response("Airtable env missing", { status: 500 });
}
```

This is the same shape #669 removed from `form-ingest.mts`. It is less severe
(a delivery status, not a lead) and svix retries, but it is a live coupling that
turns "someone pulled the Airtable env vars" into a 500 — and it is #646 step 2,
which must land **before** those env vars are pulled.

---

## 9. Discord

**Code: none.** `grep -rln "DISCORD\|discord.com" src/ netlify/ scripts/ .github/`
returns **zero files**. There is no client, no script, no MCP server, no test, no
health check. The entire integration is a paragraph of prose in `CLAUDE.md`
telling an agent to curl `https://discord.com/api/v10` with
`Authorization: Bot $DISCORD_BOT_KEY`.

**Credentials:** `DISCORD_BOT_KEY` + `DISCORD_BOT_ID` in the **repo `.env`** —
the documented exception to the "credentials go in `~/.config`" rule, and they
are genuinely absent from `credentials.env` (I enumerated its 26 keys; neither
is there). `CLAUDE.md` records that the key was proven to be a bot token, not an
OAuth client secret: `GET /users/@me` → 200 as "Message Reader"
(`1536468462141055086`), while the same value fails a `client_credentials`
grant with `invalid_client`.

**Health — measured.** The corpus fetch pulled **109 channels and 688 messages**
today (2026-09-12 11:44-11:46) with `comms-errors.txt` at **0 bytes**. Message
volume by month: 2026-07 = 41, 2026-08 = 441, 2026-09 = 206. Top authors
`nicole_35266` (202), `timholmes_62898` (187), `tucksravin` (178),
`eriksvendsen_89989` (121). The token works and the channels are active.

The standing gotcha remains: Discord **403s Python-urllib's default UA silently**
— a urllib scan of all 109 channels once returned "0 hits" with no error. Use
curl or set a UA. `discord.com` is off the sandbox allowlist.

**Assessment:** healthy, and simultaneously the least-engineered thing in the
fleet. No code means no test, no version, no failure mode anyone has enumerated,
and a credential whose only documentation is a prose paragraph that has already
been wrong once (an older memory named a non-existent `DISCORD_BOT_TOKEN`).

---

## 10. Cloudflare Turnstile

**Code:** `src/forms/turnstile.ts` (the four-outcome verifier + multi-widget
retry), `src/audits/form-e2e.ts` + `form-e2e-airtable.ts` (owns the verdict since
#695), `src/audits/function-health-airtable.ts:60` (now only writes `"fail"`),
`src/alerts/digest-collectors.ts:329-360` (the red guardrail),
`docs/runbooks/turnstile-widgets.md`.

**Credentials:** central `TURNSTILE_SECRET_KEY`, `_2`, `_3` on the Netlify site,
tried in order (`verifyTurnstileWithSecrets`, `src/forms/turnstile.ts:131-148`;
the retry is safe because `invalid-input-secret` does **not** consume the
single-use token — verified empirically 2026-07-28). Per-site
`PUBLIC_TURNSTILE_SITE_KEY` in each site's Netlify env.

Repo `.env` has `TURNSTILE_SECRET_KEY_1` / `TURNSTILE_SITE_KEY_1`. **The `_1`
suffix matches no name the code reads** (`grep -rn TURNSTILE_SECRET_KEY_1 src
netlify scripts .github` → nothing), and `TURNSTILE_SITE_KEY_1` is documented as
an active trap: `docs/runbooks/turnstile-widgets.md:19-24` says it is widget
"Forms 1", **full since before the runbook existed** (10-hostname free-tier cap),
and copying it into a new site produces the silent-110200 state — which it did on
2026-09-04 on vida-legacy-foundation (#689). The runbook's instruction is
explicit: _"Treat the `.env` values as the secrets for verification, never as a
source of a sitekey for a new site."_

**Widget capacity is managed by a copy-paste `node -e` snippet in the runbook**
(`:38-46`) hitting `api.cloudflare.com/.../challenges/widgets` with
`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_PAT` from the repo `.env`. No code, no
audit, no alarm. Adding a widget requires **two coupled changes in one commit** —
a new Netlify env var _and_ a new entry in `form-ingest.mts`'s fixed secrets
array — and missing the code half fails open silently.

**Health — and an honest caveat.** `#689` (closed 2026-09-04) established that
the old `Turnstile widget` verdict was an env-var truthiness check that could
never distinguish a working widget from a 110200 one. #695 moved ownership to
`form-e2e`, which drives real Chromium against the real widget. That is a strict
improvement.

**But the `Turnstile widget` column is now empty on all 45 Websites rows.**
`function-health` writes `null` (= clear) whenever the flag isn't literally
`false`, and `form-e2e` only opines for the 6 sites it can probe — and it evidently
found no rendered widget on any of them ("key set, no widget on the page → null,
CLEARS"). Consequence: the red guardrail
(`requireTurnstile && turnstileWidget === "fail"`,
`digest-collectors.ts:336`) currently cannot fire for any site, and the only site
with `Require Turnstile: true` is **Reddoor**, whose verdict is blank. I have
**not** verified whether Reddoor's live widget renders — that needs a browser
against the live page, which is outside this survey's read-only scope. Flagging
it as _unverified_, not as broken.

---

## 11. Google Analytics + Search Console

**Code:** `src/reports/ga/{config,client,failover}.ts`,
`src/reports/search/client.ts`, `src/alerts/analytics-health.ts`.

**Credentials:** `GA_SUBJECT` (comma-separated Workspace subjects, tried in
order via `withSubjectFailover`) + a service-account JSON key. Path defaults to
`~/.config/reddoor-maint/ga-service-account.json` (present, 2377 bytes, mode
600, dated Jun 1) or `GA_SA_KEY_PATH`. In CI the key arrives as
`GA_SA_KEY_JSON` (the file _contents_) and is `printf`'d to
`$RUNNER_TEMP/ga-service-account.json` with `chmod 600`
(`daily-reports.yml:113-118`). Search Console reuses the **same** service
account and subjects with the `webmasters.readonly` scope.
`GA_SUBJECT` is in `credentials.env`; the repo `.env` has no GA keys.

**Fill rate:** `GA4 property ID` on **11 of 45** rows (8 of 13 maintained —
missing on 1836dig, Data Dynamiq, LA Homelessness Initiative, Revogen).
`Search Console property` on **1 of 45** (Reddoor). `Search query` on 3.
So Search Console enrichment is effectively a one-site feature.

**Health — the instrument caveat that matters.** `daily-reports.yml:145-161`
contains the _only_ GA credential proof: it greps the rendered preview for a
literal `>ANALYTICS<` and fails the step when absent. That check is gated on
`if: ${{ inputs.preview_site }}` — i.e. it **only runs on a manual
`workflow_dispatch`**. The scheduled `report --due` path asserts nothing about
GA, and today's scheduled run had no reports due, so it exercised no GA call at
all. GA credentials are therefore **unproven since whenever the last manual
preview was run**, and I did not find that run in the 9-day window the corpus
covers.

This is the #523 fix working (the preview path now takes `--enrich`, so it does
real IO instead of being a check that could never pass) — but only on the path
nobody invokes automatically.

**Standing rule:** gallerysonder consent-gates GTM, so a measured 0 there is
real. Never backfill it.

---

## 12. Credential topology — the actual map

`~/.config/reddoor-maint/credentials.env` (26 keys, mode 600, last modified
2026-09-01; three dated `.bak` copies alongside it):

```
AIRTABLE_BASE_ID  AIRTABLE_PAT  BACKUP_PASSPHRASE  CLAUDE_OAUTH
FORMS_INGEST_TOKEN  GA_SUBJECT  GITHUB_TOKEN  NETLIFY_AUTH_TOKEN  OPERATOR_EMAIL
PRISMIC_TOKEN_{48BB12D1, ALAMO_ANATOMY, CALTEX_LANDING, ERP_INDUSTRIAL, ESPADA,
  GALLERYSONDER, HEDLOC, MSOT, REDDOOR_LA, REVOGEN, THE_POINTE_BURBANK,
  VINEYARD_CUSTOM_HOMES}
PROSPECT_LLM_AUTH  RENOVATE_TOKEN  RESEND_API_KEY
TURSO_AUTH_TOKEN  TURSO_DATABASE_URL
```

Repo `.env` (33 keys, 7224 bytes, last modified 2026-08-31):

```
AIRTABLE_BASE_ID  AIRTABLE_PAT  CLAUDE_OAUTH  CLOUDFLARE_ACCOUNT_ID  CLOUDFLARE_PAT
DISCORD_BOT_ID  DISCORD_BOT_KEY  DROPBOX_ACCESS_TOKEN  FIGMA_PAT
FORMS_INGEST_TOKEN  FORMS_INGEST_URL  GOOGLE_SEARCH_API_KEY  MARKUP_API_KEY
NETLIFY_PAT  PRISMIC_REPOSITORY_NAME  PRISMIC_WRITE_TOKEN  RESEND_API_KEY
TURNSTILE_SECRET_KEY_1  TURNSTILE_SITE_KEY_1  TURSO_AUTH_TOKEN  TURSO_DATABASE_URL
TURSO_FLEET_USAGE
{ALAMO, BEACHFRONT, CALTEX, ERP, ESPADA, HEDLOC, MSOT, POINTE, REDDOOR, SONDER,
 VINEYARD}_PRISMIC
```

No secret values were read or printed; these are `awk -F= '/^[A-Za-z_]/ {print $1}'`
outputs, cross-checked against the files' `=`-line counts (26 and 33).

**What this map says:**

1. **The "credentials live in `~/.config`, Discord is the exception" rule is
   not what the disk shows.** The repo `.env` holds `AIRTABLE_PAT`,
   `TURSO_AUTH_TOKEN`, `RESEND_API_KEY`, `NETLIFY_PAT`, `CLOUDFLARE_PAT`,
   `FORMS_INGEST_TOKEN` and 11 Prismic tokens. Discord is one of _many_
   exceptions, not the exception.
2. **Nine keys are duplicated across both files** (`AIRTABLE_*`, `CLAUDE_OAUTH`,
   `FORMS_INGEST_TOKEN`, `RESEND_API_KEY`, `TURSO_*`), with no mechanism
   keeping them in sync. `process.env` wins over the file
   (`src/util/credentials.ts:51-62`), so which value is live depends on how the
   shell was started.
3. **Four repo-`.env` keys are consumed by nothing.**
   `DROPBOX_ACCESS_TOKEN` and `FIGMA_PAT`: 0 references anywhere in the repo.
   `GOOGLE_SEARCH_API_KEY`: referenced only in two 2026-06 design docs that say
   it is **obsolete and removed**. `TURNSTILE_SECRET_KEY_1`: the code reads
   `TURNSTILE_SECRET_KEY`/`_2`/`_3`.
4. **`TURSO_FLEET_USAGE` exists only in the repo `.env`.** The nightly reads it
   from an Actions secret, so a local `db usage` works only from the repo root.
5. **Known-bad:** #650 (open, 2026-09-01) — _"credentials.env `GITHUB_TOKEN`
   returns 401"_. Recipes that gh-api with it fail.

---

## 13. Risks, ranked

1. **Phase 6 is 5 days past its gate and untouched, while its precondition (a
   clean week) is met.** Every day the shadow persists is a day the "which store
   is authoritative" question has two answers in the codebase. _Measured._
2. **#645's four defects are all live, and the instrument that would catch the
   worst one covers 6 of 13 maintained sites.** Five maintained sites with real
   forms have no end-to-end lead-path coverage, no dead-letter alarm, and no
   tracking issue for the rollout. _Measured._
3. **Belief/reality divergence on Airtable.** The operator stated on 2026-09-05
   that Airtable is out of the stack; Airtable was written at 13:41 today,
   52 files import its layer, and 7 Netlify functions read its PAT. #698 names
   this and is unfixed. _Measured._
4. **No automated parity between the shadow and the authoritative store.**
   `db parity` exists and nothing runs it; the last proof is 12 days old.
   _Measured._
5. **Turnstile verdict is null fleet-wide**, so the red guardrail cannot fire,
   and the one `Require Turnstile` site's widget state is unverified.
   _Partly measured — the null column is measured; whether Reddoor's live widget
   works is not._
6. **Beachfront Dentistry has no `Netlify ID`**, so it is outside the deploy
   alarm that feeds the cockpit's Broken band. _Measured._
7. **GA credentials are proven only on a manual dispatch path**, and the
   automatic path will not exercise a send again until ~late November.
   _Measured for the gate's `if:` condition; the last manual proof date is
   unknown to me._
8. **Credential sprawl**: 9 duplicated keys with no sync, 4 dead keys, 2 name
   schemes per service (Netlify, Prismic, Turnstile). _Measured._

---

## 14. What I did not check

- I never opened a connection to Turso, Airtable's write API, Netlify's API,
  Resend, Cloudflare or Prismic. Every health claim above is from CI output, a
  read-only corpus dump, or a file on disk.
- I did not run any test suite, build, or `db parity`.
- I did not verify whether Reddoor's live Turnstile widget renders (needs a
  browser on the live page).
- I did not establish when GA credentials were last proven via the
  `preview_site` dispatch — only that the scheduled path never proves them.
- Corpus `runs.jsonl` covers 2026-09-04 → 2026-09-12 for the nightlies; earlier
  absence in that file is an API-listing-window artifact and I have treated it
  as such throughout.
