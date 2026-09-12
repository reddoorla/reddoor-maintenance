# Second pass — what needs you

Compiled 2026-09-12. These are the items this research could not close on its
own, either because they need a decision that is yours to make, or because they
need access no agent here has. Ordered by consequence, not by effort.

Everything below is **measured** unless it says otherwise. Where an item is a
question rather than a finding, it is phrased as a question.

---

## 1. Four secrets are published in the git history of five public repos

**Nothing is leaking from any working tree today** — a sweep of all 41 checkouts
found no tracked file at HEAD matching a Google key pattern, and no repo tracks
`.netlify/` build output. The exposure is entirely historical, which for a public
repository is the exposure that cannot be cleaned by deleting the file.

Five secret-scanning alerts are **open with `resolution: null`**, aged 11–99
days:

| repo                   | type                            | created    | age  | path                                         |
| ---------------------- | ------------------------------- | ---------- | ---- | -------------------------------------------- |
| `reddoor-maintenance`  | `stripe_webhook_signing_secret` | 2026-06-09 | 95 d | `tests/webhook/resend-webhook.test.ts`       |
| `gallerysonder`        | `google_api_key`                | 2026-06-05 | 99 d | `.netlify/server/chunks/index3.js` + source  |
| `reddoor-starter`      | `google_api_key`                | 2026-07-24 | 50 d | `src/routes/dev/blux-frozen/the-pointe.html` |
| `beachfront-dentistry` | `google_api_key`                | 2026-08-06 | 37 d | `matching/SPEC.md`                           |
| `reddoor-starter-blux` | `google_api_key`                | 2026-09-01 | 11 d | `src/routes/dev/blux-frozen/the-pointe.html` |

`reddoor-starter` and `reddoor-starter-blux` hold the **same key** (SHA-256
prefix `530de1c69475`) at the **same path** — the blux snapshot inherited it at
the track split on 2026-09-01. The value is **the-pointe's key**, i.e. a client's,
sitting in the public template every new site is cloned from.

**What I need from you:**

- **The one fact that decides urgency: are these Google keys HTTP-referrer
  restricted?** Only the Google Cloud console can answer that. A referrer-locked
  browser key that is public is close to inert; an unrestricted one is billable
  by anyone who finds it. I did **not** test the keys — exercising a client's
  live credential is an action on their production system and is your call, and a
  restricted key would fail a probe regardless, making the test ambiguous.
- **Rotate, restrict, or restrict-then-rotate?** Rotation breaks map rendering on
  the client's live site until the new key deploys. Two of the four keys are
  clients', not Reddoor's.
- **Is the `reddoor-maintenance` Stripe value real or a fixture fake?** This repo
  has precedent for a _real_ endpoint sitting in a committed fixture.
- **Should the five alerts be triaged even if you decide not to rotate?** Closing
  them as "won't fix, restricted" is a decision; leaving them open for 99 days is
  not.

**Also:** secret scanning is **disabled** on several public repos including
`29-navy`, `vida-legacy-foundation` and `the-pointe`, so the true count may
exceed five. Enabling it org-wide is a one-time setting.

**And the structural point, which is the real finding:** this sweep had to be run
by hand today. No nightly job, cockpit band, or audit check reports open
secret-scanning alerts. The fleet has instruments for dependency vulnerabilities,
Lighthouse, form deliverability, Prismic drift and branch protection — and none
for this. The oldest alert sat open 99 days without surfacing anywhere.

---

## 2. Local-only git objects — RESOLVED, with a correction

> **This section was corrected after first being written.** The first pass
> reported "159 unpushed commits across 13 repos" and implied they were work at
> risk. The raw count was right; the characterisation was wrong. Breaking the
> count down by _which ref holds it_ shows most of it is stash entries and
> archive tags, not branch work. The corrected figure for unpushed work on
> branches is **~38 commits**, not 159. The original number is left visible here
> because the gap between "commits not on a remote" and "work at risk" is exactly
> the kind of thing a count hides.

### What was done

**Pushed, on the operator's instruction (2026-09-12):**

| repo                          | what went up                                    | result                                 |
| ----------------------------- | ----------------------------------------------- | -------------------------------------- |
| `Broken`                      | `main`, 19 commits                              | `f9b673a..ee2cf8c`                     |
| `welcome-to-the-flower-court` | `feat/sigil-badges`, 33 commits (~+4,962 lines) | new branch on `tucksravin/invitations` |
| `welcome-to-the-flower-court` | `main`, 2 commits                               | `1694d30..47f044a`                     |

Both verified afterwards at **0 commits not on a remote**. 54 commits secured.

**Tracking issues filed** in the remaining eleven repositories, each listing that
repo's own local-only branches, tags and stashes:

| repo                         | issue                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| `la-homelessness-initiative` | [#43](https://github.com/reddoorla/la-homelessness-initiative/issues/43) |
| `reddoor-maintenance`        | [#773](https://github.com/reddoorla/reddoor-maintenance/issues/773)      |
| `data-dynamiq`               | [#49](https://github.com/reddoorla/data-dynamiq/issues/49)               |
| `revogen`                    | [#77](https://github.com/reddoorla/revogen/issues/77)                    |
| `gallerysonder`              | [#100](https://github.com/reddoorla/gallerysonder/issues/100)            |
| `reddoor-starter`            | [#126](https://github.com/reddoorla/reddoor-starter/issues/126)          |
| `reddoor-website`            | [#182](https://github.com/reddoorla/reddoor-website/issues/182)          |
| `beachfront-dentistry`       | [#60](https://github.com/reddoorla/beachfront-dentistry/issues/60)       |
| `vineyard-custom-homes`      | [#64](https://github.com/reddoorla/vineyard-custom-homes/issues/64)      |
| `dont-lose-your-head`        | [#65](https://github.com/tucksravin/dont-lose-your-head/issues/65)       |
| `vida-legacy-foundation`     | [#75](https://github.com/reddoorla/vida-legacy-foundation/issues/75)     |

### What the count actually consisted of

| repo                         | branches | tags   | stash  | note                                          |
| ---------------------------- | -------- | ------ | ------ | --------------------------------------------- |
| `reddoor-maintenance`        | 12       | —      | **28** | three abandoned July `blux-migrate` branches  |
| `la-homelessness-initiative` | —        | **19** | —      | one tag: `archive/generalized-legacy-svelte4` |
| `data-dynamiq`               | 9        | —      | —      | four branches, Jun–Jul, all stale             |
| `revogen`                    | 5        | —      | —      | two branches, 2026-06-30                      |
| `reddoor-starter`            | 4        | —      | —      | incl. a pnpm security bump                    |
| `reddoor-website`            | 4        | —      | —      | three branches, 2026-08-24/26                 |
| `gallerysonder`              | —        | 1      | 3      |                                               |
| `beachfront-dentistry`       | 2        | —      | —      | `fix/p751-unanchored-score`, 2026-09-10       |
| `vineyard-custom-homes`      | —        | —      | 2      | stash only                                    |
| `dont-lose-your-head`        | 1        | —      | —      |                                               |
| `vida-legacy-foundation`     | 1        | —      | —      | Nicole's second review round, 2026-09-09      |

Two things this breakdown surfaces that the aggregate hid:

- **`reddoor-maintenance` is carrying 28 commits of stash.** Stashes never push
  and do not survive a clean checkout. That is the largest single pocket of
  local-only work in the fleet, and it is in the central repo.
- **`la-homelessness-initiative`'s 19 are an archive tag, not lost work** — but an
  archive tag that was never pushed is the only record of the state it marks, so
  it is still worth pushing.

Also still uncommitted in working trees: `caldea` has a modified
`docs/workJournal.md`, and `a-budget` has two untracked TypeScript files
(`close-months.ts`, `month-audit.ts`) plus a modified `CLAUDE.md`. Neither was
touched.

**Instrument note.** `git rev-list --count --all --not --remotes` overcounts in a
repo whose remote refs are stale or absent — `rfp-analyze`'s 24 were entirely an
artifact of it having no origin. Any future check of this kind should report
_per-ref_, not per-repo, or it will keep conflating a stash with a lost branch.
(A later evidence-audit pass added the reason `rfp-analyze` is not an exposure at
all: its content is mirrored in `reddoorla/claude-skills`.)

### Two things genuinely without version control

Separate from the above, and not fixed by pushing anything:

- **`octagonal-led-turn-counter` is not a git repository.** No `.git`, nested or
  otherwise. 50.9 session-hours and 56 prompts across three days exist only as
  files on one disk — no history, no remote, no recovery. `git init` and a push
  is a two-minute job if the work is worth keeping; if it is not, deleting it
  deliberately is also an answer.
- **`reddoor-maintenance` holds 28 commits of stash.** Stashes never push and do
  not survive a clean checkout. Tracked in
  [#773](https://github.com/reddoorla/reddoor-maintenance/issues/773).

---

## 3. #646 — Phase 6 is due, and it is the keystone

The Airtable → Turso flip went live 2026-08-31. **#646 deletes the Airtable
layer, and it has been due since 2026-09-07 and untouched for 12 days.** Two of
its ten checklist items are done, both incidentally.

It needs your explicit go because **merging it ends the rollback window**.

This is not just one issue. The inventory's central structural finding is that
the system is _centralised in code and decentralised in data, and the data half
is half-migrated_: Turso is authoritative (`src/db/freeze.ts:52`), but Airtable
is still the **roster** — all four nightly `audit` sweeps pass
`--fleet airtable`, and `src/inventory/` contains `local.ts`, `json.ts`,
`airtable.ts` and no `turso.ts`. So every quality instrument the fleet owns still
depends on a store that no longer owns the truth, which is why an Airtable quota
event still reds four nightlies.

**Related, and also yours:** the hosted-target restore — accept the rehearsal
already done, or run it again before Phase 6 closes the window?

---

## 4. Decisions only you can make

Lifted from `01-fleet-current-state.md` §12A, which has the full detail.

| #     | question                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2    | **What is `src/blux` for?** ~20k lines across 63 source and 77 test files, no workflow, no active consumer, and its first consumer is archived.                                                       |
| A3    | **What is `src/webflow` for?** Cold since 2026-07-28, lowest test:src ratio in the repo, while a 2026-09-08 design and five plans route _around_ it.                                                  |
| A4/A6 | **`reddoor-website` `staging` is 15 commits ahead of `main`** with no promotion rule. It holds proven work (report edit mode, #176–#181). Promote it? And who may promote, going forward (#545/#623)? |
| A5    | `build` is required in the central ruleset but `validate` in `.github`'s. Reconcile? (Parked for you since 2026-08-02.)                                                                               |
| A7    | **The `sharp` security wave: 26–31 PRs across 14–17 repos**, all green and CLEAN, held open _by design_. This needs one sitting, once.                                                                |
| A8    | **`canvas-starter`: promote, fold, or archive?** Not marked as a template, no development since 2026-07-24, and the only holder of 8 slices from a deleted library generation.                        |
| A9    | **Does `.claude/settings.json` join `CLAUDE.md` in version control?** The argument that won for `CLAUDE.md` in #699 applies unchanged.                                                                |

---

## 5. Things I found that you may simply know the answer to

- **Two active Discord client channels have no repository**: `#worthe` (100+
  messages, capped) and `#trinity-law-school` (33). Prospective work?
  Externally hosted? Either way the fleet's tooling cannot see them.
- **Only 13 of 45 Airtable `Websites` rows are `status=maintained`**, and that
  status gates _every_ fleet sweep — so two-thirds of the recorded fleet is
  outside the automation by configuration. Nine more sites are live or nearly
  live (`launching` 2, `building` 7) and therefore swept by nothing. Deliberate?
- **`reddoorla/the-tower` is archived** and has no local checkout, so
  `scripts/fleet-repos.sh` cannot see it. That makes **four** archived repos,
  not the three the project docs name. Worth a line in `CLAUDE.md`.
- **`claude-mem` has recorded nothing for 71 of the 73 days since it was
  installed.** You have five overlapping memory layers; one is dead. Remove it,
  or fix it?
- **`CLAUDE.md:206-213` points every session at superseded text.** A forward
  pointer would fix it in one line.

---

## 6. Questions the evidence could not answer

Stated so nobody mistakes a gap for a finding — and so Fable knows where a fresh
pass would actually add something.

- **Whether compaction was chosen or automatic.** 288 compaction events were
  counted from transcript markers that cannot distinguish `/compact` typed by you
  from an auto-trigger. The difference matters a great deal for what to
  recommend, and the corpus cannot settle it. **You can, in one sentence.**
- **What happened on 2026-08-27.** Output fell 96% immediately after the window's
  heaviest three days. The transcripts show the stop but not the reason —
  exhaustion, travel, client meeting, or simply finishing. The same shape recurs
  after Sep 10. It is the single most repeated pattern in the calendar and the
  evidence is silent on its cause.
- **Whether the 38% personal-project share is deliberate.** Presented
  analytically and without judgement; whether it is the right split is a life
  question, not a data question.
- **Anything before 2026-08-10.** Claude Code transcripts do not retain further
  back, so the first eleven days of the window are git-only reconstruction. If
  you want that period covered properly in future, transcript retention is the
  thing to change — and it is worth deciding _now_, because this same analysis
  run in three months will have the same eleven-day hole moving ahead of it.

---

## 7. One thing I did not do, deliberately

I did not push any branch, rotate any credential, triage any alert, merge any
PR, or modify any repository outside this documentation branch. Every
observation above is read-only.

The one exception worth naming: I created a git worktree at
`.claude-worktrees/meta-week` on branch `docs/meta-week-2026-09-12`, per the
project rule against committing from the main checkout. It contains only these
documents and their supporting data.
