# Cluster 01 — central: `reddoor-maintenance`

_Retrospective research note, window 2026-07-30 → 2026-09-12. Written for a
reader with no other context. Every number below is labelled MEASURED (read out
of the derived corpus or out of the repo with read-only git) or INFERRED. Where
a source is blind, the blindness is stated rather than papered over._

---

## What this repo is

`reddoorla/reddoor-maintenance` is the orchestrator for a ~45-site web
studio. It is published to npm as `@reddoorla/maintenance` and every client site
in the fleet installs it: the sites are thin, and this repo is the brain. It
holds the audits (accessibility, smoke, Lighthouse, security posture, form
end-to-end), the report pipeline that drafts and sends client maintenance
emails, the cockpit/dashboard the operator approves those reports from, the
central form-ingest that catches every client lead, the "recipes" that install
and upgrade shared machinery into site repos, a Blux/Webflow render-conversion
layer, and — new inside this window — a database, a headless CMS-model delivery
pipeline, and a saleable external SEO/AEO audit product.

It is by a wide margin the densest repo on the machine: 413 of the window's
2,622 commits (15.8%) and 219 of its 857 pull requests (25.6%), both the highest
of any repo. MEASURED.

---

## The shape of the work, in numbers

All MEASURED.

|                                                |                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Commits in window                              | **413** — 369 by Tucker Lemos, 43 by `reddoor-renovate[bot]`, 1 by `github-actions[bot]`                                         |
| Of the 369 human commits                       | 182 end in `(#N)` (squash-merge commits); 187 are the branch commits that rode into them — so ≈182 distinct landed units of work |
| Active commit days                             | **27 of 45**; first 2026-07-30, last 2026-09-11                                                                                  |
| Sessions (cwd under the repo or its worktrees) | **334** — 108 main-loop transcripts, 226 subagent transcripts                                                                    |
| Active session days                            | **16**, 2026-08-12 → 2026-09-12                                                                                                  |
| Operator prompts                               | **497** raw; **183** once task-notifications, compaction preambles and duplicates are stripped                                   |
| Tool calls                                     | **18,846** — Bash 13,479 (71.5%), Edit 1,815, Read 1,362, Write 666, `ctx_execute` 548, `ctx_batch_execute` 212, Agent 146       |
| Interruptions / API errors                     | 6 / 17                                                                                                                           |
| PRs                                            | **219** (182 `tucksravin`, 37 `app/reddoor-renovate`); 211 MERGED, 5 CLOSED, 3 OPEN; numbers **#469 → #771**                     |
| PR diff                                        | human PRs **+148,777 / −4,661**; all PRs +153,927 / −8,917 across 1,733 changed files                                            |
| GitHub reviews recorded                        | **0**, across all 219 PRs. 10 comments total                                                                                     |
| Human merge latency                            | median **10.3 min**, mean 209.5, p90 182.2, max 9,690 min (#507, a release PR left over the weekend)                             |
| npm releases                                   | **29** `chore(release): version packages` merges; version went **0.75.1 → 0.95.1**                                               |
| Repo growth                                    | `src` .ts files 274 → **379**; `*.test.ts` files 312 → **484**; base→HEAD diff **589 files, +143,398 / −2,454**                  |

Commit types: feat 160, fix 128, docs 45, chore 10, test 8, ci 6, perf 6,
style 3, wip 1. Commit scopes, top eight: **prospect 75**, db 39, forms 33,
dashboard 28, header-image 24, reports 23, cockpit 11, audit 9. The single
largest theme of the window is a product that did not exist on 2026-08-23.

Subsystems that went from nothing to shipped inside the window: `src/prospect`
0 → 30 files / **15,598 lines**; `src/prismic` 0 → 10 files / 2,199 lines;
`src/images` 0 → 1. `src/db` went 7 → 19 files / 4,719 lines, and database
migrations `0006` through `0017` — twelve of the seventeen that exist — all
landed in this window, the first on 2026-08-23. MEASURED from `src/db/migrations.ts`
plus `git log -S`.

Three days carry the load: **2026-08-24 / 25 / 26 produced 198 commits and 74
opened PRs** — 48% of the window's commits in 6.7% of its days. MEASURED.

---

## Coverage: what this record can and cannot see

This matters more than usual here, because three separate sources are truncated
in three different ways and each truncation flatters a different part of the story.

**1. Transcripts start 2026-08-10.** For **2026-07-30 → 2026-08-09** there are
no sessions and no prompts anywhere in the corpus. That period holds **52
commits and 35 opened PRs** in this repo. Everything said about it below is
RECONSTRUCTION from commit subjects, PR titles and diff sizes — plus Discord,
which does cover the period. There is no record of what was asked for, only of
what landed.

**2. Even inside transcript coverage, this repo's own attribution has a hole.**
`2026-09-02 → 2026-09-07` contains **43 central-repo commits and zero sessions
whose cwd is `reddoor-maintenance`**. The work is not missing; the mapping is.
Tracing branch names across the session index: the 2026-09-03 CMS-authored
auto-reply work (#681, #682, #684, #686 — twelve commits) ran from a session
whose cwd was `/Documents/GitHub/gallerysonder`, carrying the central branches
`feat/prismic-reply-copy` and `feat/reply-rich-text`, and its trigger prompt was
a client one: _"look at carlo's email, still spinning around on the tag stuff,
but while they're figuring that out, can we do the parked 'make custom rsvp
auto-replies' item"_. The 2026-09-04 Turnstile work (#691/#693/#694/#695) ran
the same way from `vida-legacy-foundation`: _"re:turnstile, did you look in the
reddoor maint env?"_, then _"go for the fixes, can we set a new key for VLF? we
want turnstile on this site"_. MEASURED. **Central capability is routinely built
from a client repo's chair, in response to a client need — so any cwd-keyed
count of this repo, including the 334/497 above, is a lower bound.** Sixteen
sessions in other repos carry a central branch name (excluding the generic
`chore/work-journal`, which several repos share).

**3. CI history is capped at 300 runs per repo, so this repo's reaches back only
to 2026-09-04.** Within that nine-day slice: 165 `ci` runs (162 success, 3
failure), 41 `release` (40/1), 18 `renovate` (all green), and nine nightly fleet
workflows at 9–10 consecutive successes each. Overall 4 failures in 300 runs =
**1.3%**. That is NOT a window-wide CI health figure and must not be quoted as
one; the earlier 36 days of this repo's Actions history are simply not in the
corpus. The two `gh-errors.txt` entries confirm the collector was also dropping
run pages to connection resets.

**4. The Airtable JSON in the corpus is a frozen artifact, not the live record.**
45 `Websites` rows, 17 `Reports`, 48 `Submissions` — and the Submissions stop on
**2026-06-23**, the Reports' last `Sent at` is **2026-09-01**. That is not a
data-collection failure; it is the outcome of the migration described below.
Since 2026-08-31 the operational record lives in Turso and is not in this corpus
at all.

**5. Session `durMin` is wall-clock span, not effort.** The 334 sessions sum to
489.8 "hours", but one session alone runs 2026-08-17T18:51 → 2026-08-25T00:38
(10,427 minutes) with 245 tool calls. These spans overlap and include sleep.
Tool calls (18,846) and prompts are the honest effort proxies; the hours figure
should not be used.

---

## How the work is actually driven

The operator's working unit is one very long-lived session, resumed across every
limit the platform imposes. MEASURED: eight sessions in this repo exceed ten
hours of span, and the largest — 2026-09-08T19:00 → 2026-09-11T19:54, **4,374
minutes, 2,484 tool calls, 178 operator turns** — is a single continuous
conversation covering the prospect check battery, the match-harness recipe, and
the report override layer. The seams show in the prompts themselves: _"hit a
session limit, continue"_, _"hit my api limit"_, _"hit a usage limit, continue"_,
_"hit fable limit, continue on opus"_. Compaction preambles account for a large
share of the 497-prompt count; only 183 are genuinely distinct operator turns.

The register is terse and directive. The median prompt is 404 characters, and a
large fraction are three-to-six words: _"continue on"_, _"go for it"_, _"finish
it"_, _"merge on green"_, _"what's up next?"_, _"anything else outstanding?"_.
Substance appears in two places only — when he is making a business decision
(_"latency is worth accuracy for us, we are a design firm"_) and when he is
reporting a defect in something the system just produced.

Execution is delegated hard. In this repo alone, 112 `general-purpose` subagents
and 26 `superpowers:code-reviewer` subagents were spawned, and 226 of the 334
session transcripts ARE subagents. The largest single example: **PR #526 (+24,211
/ −16 across 66 files) was produced across 2026-08-12→14 by 156 sessions in one
worktree, 150 of them subagent transcripts**, executing a 33-task written plan.
MEASURED.

Review is entirely in-session. **Zero of 219 PRs carry a GitHub review**, and the
median human PR merges 10.3 minutes after it opens. The quality gate is not the
PR; it is the code-reviewer subagent plus the operator reading a summary and
saying "merge on green". This is a deliberate posture — `AUTONOMY.md` and the
`merge-authority-policy` memory encode "everything but releases" — but it means
the PR record contains almost no diagnostic signal about what was contested.

---

## The work, by theme

### A. The report email got a face (2026-07-31) — RECONSTRUCTION

The window opens mid-stride on the client report pipeline. Three PRs on 07-30
fix the daily cron's missing GA/Search Console credentials (#469), un-break every
control on the dashboard's per-site page — a dead inline script (#470) — and
restyle the approve button (#471). Then on 07-31 a 21-commit run lands the
**header-image generator** (#476, +3,474 across 27 files): screenshot a client's
live homepage, composite it into a bundled device plate, solve the domain
typography against a reference, and stamp the result into the report email.

The commit sequence itself is the evidence of method, and it is unusually legible
for a day with no transcript: `docs(...) design` → `docs(...) implementation plan`
→ bundle the asset → **`docs: correct the screen rect — derive it from the bezel`**
→ measured plate geometry → pure compose pipeline → capture behind injected
browser IO → `test: plate fidelity verifier` → **`fix: capture with load +
best-effort idle, not networkidle`**. Design, plan, measure, isolate IO for
testability, build a verifier, then correct a belief on contact with live sites.
The `networkidle` correction is the one the memory record kept: it broke 4 of 14
live sites. A companion commit, `test(dist): assert bundled assets exist in the
PUBLISHED layout`, is the same instinct one level up — the asset test was written
against the shipped artifact, not the source tree.

This feature got its client review six weeks later, in Discord, on 2026-09-01,
and it did not go well: Erik posted _"@everyone Can we do a better website
screenshot than this, please?"_ and _"That screen just looks like the least sexy
version of the SONDER site, which you guys made so amazing."_ Tucker: _"oh we can,
right now the pipeline does a live snapshot of the site, I'll get it to work
around cookies in future"_. MEASURED from `discord-messages.jsonl`. The
screenshot was capturing gallerysonder's cookie-consent overlay. Two prompts on
2026-09-01 — _"add an issue, look at the message erik sent in discord re:sonder
screenshot"_ — filed it, and it was still open at the end of the window. **A
feature can be technically verified against a fidelity harness and still fail its
actual audience, and the gap here was 32 days.**

### B. Fleet governance, hardened (2026-08-01 → 08-03) — RECONSTRUCTION

A dense three-day run on the machinery that keeps 40 repos in a known state.
Platform auto-merge was disabled fleet-wide so Renovate owns merges (#478);
Renovate stopped authenticating as the operator's personal token and became a
GitHub App (#484), with the org PAT retired a week later (#514); a nightly
org-wide **protection-coverage alarm with ruleset self-healing** was added (#483,
+1,459), then widened to a full posture floor (#486). #503 is the most
interesting title of the run — _"catch a Renovate that runs green but is
forbidden to act"_ — a gate built specifically because green had already meant
nothing once. The memory record says nine repos had been silently frozen by
stale old-identity branches with green CI after the App migration.

Also in the run: #498, _"stop reporting captured leads as failed submissions"_,
and #505, _"show who a submission would email, and confirm the guard by reading
it back"_. Both are honesty fixes to the forms pipeline — one stops a false
alarm, one refuses to claim a routing target it has not verified.

**Then the repo goes dark: 2026-08-04 → 2026-08-09, zero commits, zero PRs.**
Discord, which does cover that period, shows why: the Beachfront Dentistry
Webflow→SvelteKit cutover. Tim on 08-06: _"This renews on August 8 so if we can
get it close enough I say we switch it"_; Tucker on 08-07: _"will be a little
bit, I need to set the forms to live too so they aren't missing leads over the
weekend"_; on 08-08: _"dns is switched over"_. INFERRED from Discord, not from
any session record: the central repo pauses when a launch is in flight.

### C. Headless Prismic model delivery (2026-08-12 → 08-17) — #526

The largest PR of the window (+24,211 / −16, 66 files). The problem: delivering a
content-model change to a client site meant a human opening Slice Machine. The
solution: model changes ride a normal PR, CI comments the delta, merging pushes
to Prismic through the Custom Types API.

Three things about it are worth carrying.

**The tokens were never missing.** The plan assumed credentials had to be
provisioned. Eleven sat in this repo's own `.env` the whole time under
`<SITE>_PRISMIC` names, and one more in `revogen/.env`. Tucker's prompt is the
whole correction: _"the tokens should all be minted, in the maint env and across
other repos on this machine, try and find them and then let me know what you're
missing"_, then _"They're not labeled correctly, but check keys and imply which
they should be"_, then _"they are labeled with PRISMIC as the suffix"_. MEASURED
from prompts.

**Ownership was proven, not inferred.** Rather than trust the labels, all 13
distinct tokens were probed against all 15 repositories — **195 calls** to
`GET customtypes.prismic.io/customtypes` with the `repository:` header. Three
labels lied: `POINTE_PRISMIC` is `the-pointe-burbank`, `REDDOOR_PRISMIC` is
`reddoor-la`, `BEACHFRONT_PRISMIC` is `48bb12d1`. 24 secrets then installed
across 13 repos. That probe is the single best instance in the window of the
repo's governing rule applied to a credential rather than to a test.

**The operator was right about the schedule and the model was wrong.** On 08-16
Tucker asked _"why do we have to wait until monday rather than bumping all the
repos now?"_ The answer had been Renovate's `before 6pm on monday` window. It is
a cadence, not a constraint; the real gate is green CI plus a green Netlify
preview. All 12 site bumps were done that day, one PR per repo, all 12 CI-green,
all 12 merged after previews were verified through the Netlify API. The feature
went live on 8 sites the same day. MEASURED from the memory record and the
commit log.

Follow-ups #530 and #532 are both refusals rather than features: refuse to
install a workflow the site's pinned CLI cannot run (with three distinct
verdicts — too old / cannot establish / ambiguous, because a gate that cannot
tell "too old" from "could not read" reports one as the other), and let an
expected model divergence be acknowledged **until a date** rather than muted
forever.

### D. The Airtable quota, and the migration it caused (2026-08-17 → 08-31) — #539

This is the spine of the window and it starts with one prompt, at 02:02 on
2026-08-17:

> _"hit my api limit for airtable and we're only halfway through the month, does
> not seem scalable. it might be worth it to reconsider hosting everything on in
> turso since we're still early on this stack. do research and give me your
> thoughts."_

Three and a half hours later, having read the research:

> _"I don't consistently use airtables ui for things, and we have the capability
> to build something more purpose built. let's make a plan for that, we don't need
> to spend more money"_

The same day the quota outage produced a live incident — _"I just sent a test
submission and don't see anything in the cockpit or on my phone"_, then _"wait,
lead loss? are emails not getting to clients?"_ — and the operator then did
something worth naming: he **paid to remove the urgency, and deferred the fix**.
_"let's save the full turso migration for next weekend, can you pin it as an
issue and a plan? I want to save tokens for a game jam and we've time now that i
paid for airtable."_ MEASURED. Six days later the deferral is lifted explicitly:
_"no need to conserve tokens this week"_ (08-23).

What then shipped, 08-23 → 08-31, in phases, each its own PR:

- **Phase 0** (#553): dead-letter a lead whose site lookup fails. The lead-loss
  incident turned into a durable guarantee before any schema work began.
- **Phase 1** (#554, #555, #556): writer map, schema, Airtable importer, parity
  harness; nightly encrypted backups with a restore rehearsed every run; hot-path
  indexes behind an EXPLAIN-query-plan gate.
- **Phase 2** (#557–#564): hourly Airtable→Turso sync, then every request path —
  form ingest, submissions page, site editor, cockpit, reports, header images —
  reads fleet state from Turso.
- **Phase 3** (#565–#567): health, schedule, audit and github-signals writers all
  dual-write.
- **Phase 4** (#569–#604): the console gets what Airtable's UI was providing —
  a sortable fleet table, full site-editor field coverage, a write-only Mailchimp
  key field, report commentary editing, preview refresh. Plus a **three-stage
  status-vocabulary migration**: stage 1 accept both vocabularies, stage 2 writers
  emit the new one, stage 3 the old names leave the code.
- **Phase 5 / THE FLIP** (#643, merged by the operator 2026-08-31): Turso becomes
  authoritative and the hourly import retires with it.

The operator's two governing instructions here are worth quoting because they
pull in opposite directions and both were honoured: _"can we run both in parallel
for a time so theres zero risk of losing any more leads?"_ (08-24), and one turn
later, _"we're trusting turso unless you have some reason to think that's not a
good idea"_. Dual-write with Airtable retained as a frozen rollback target for one
week was the synthesis.

Two measured details from the vocabulary stage are the most transferable thing in
the whole migration. **Deleting a single-select option in Airtable clears the
cells using it** — and a blank status is `eligible-by-default` in the due/preflight
path, so one stray cell would have silently activated a site for client reports.
All 44 cells were counted for blanks after the operator deleted the 7 old options;
zero. And a branch that had been sitting unpushed since 08-17,
`fix/skip-spam-for-in-development`, gated on `site.status !== "in development"` —
a string the vocabulary migration had deleted. Merging it would have shipped a
permanent no-op **with green tests**, because its own fixtures constructed rows
using the dead value. **Check unmerged branches against schema changes that
landed after them.**

The pre-merge review of the flip found three regressions the one-line switch would
have exposed, all fixed in-PR, and one of them generalises: `stampSent` never
mirrored `sent_at`/`resend_message_id`, and the exclusion's own comment justified
itself by citing "the hourly sync converges those" — **the exact mechanism the PR
deletes**. Four Netlify request handlers had the same shape, each with its own
`try{…}catch{console.error}` commented "the sync converges it", and grep could
never have found them because _not mentioning_ `TURSO_IS_AUTHORITATIVE` is the
defect. **When retiring a converger, grep the comments for its name — its
dependents justify themselves by it.**

Post-flip evidence, MEASURED: parity mismatches = 0 across all 52 green hourly
runs of the rollback week; backups 8/8; dead-letter 0 rows ever. Airtable's
Submissions table in this corpus stopping at 2026-06-23 and its Reports at
2026-09-01 is the migration's own footprint.

### E. The prospect audit — the largest thing built, and a new product (2026-08-24 → 09-12)

`prospect` is the top commit scope of the window at **75 commits**, and
`src/prospect` is 30 files and **15,598 lines** that did not exist on 2026-08-23.
It is an external SEO/AEO audit: crawl a stranger's site politely, run a battery
of deterministic checks, ask the AI engines what they say about the business,
score it, render a branded self-contained report, serve it at a tokened public
URL `/r/:token`, and email a PDF. Three big PRs carry it — #580 (+12,380, 51
files), #638 (+8,443, 40 files), #703 (+12,413, 28 files) — plus the cockpit
trigger (#581), Google sign-in for the cockpit (#583), and dozens of correction
commits.

The correction commits are the story. Read in order they are a record of a tool
being argued out of overclaiming:

- `fix: never fake a measured zero`
- `fix: do not score findability when no page was readable`
- `fix: fail the lighthouse stage when nothing was measured`
- `fix: never claim an unmeasured sidecar was checked, and verify quoted evidence`
- `fix: make the report say only what the audit actually established`
- `fix: divide visibility by the probes sent, not the ones that returned`
- `fix: a check reports an answer, and our missing data is never their defect`
- `fix: an error we cannot diagnose is a bug of its own`
- `docs(aeo): kill the 93% hallucination stat, keep the mechanism it borrowed`
- `feat: let the operator pick the goal, and prove every check can pass`

That last one is the house rule applied to a whole battery at once: before
shipping, demonstrate that each check is _capable_ of passing. A check that can
only fail is not a check.

**The operator became the tool's best adversarial reviewer, on his own company.**
On 2026-09-09 at 01:04 he pasted back the report's "What the AI says about you
that is not on your site" section — nine claims about Reddoor Creative — with the
one-line finding: _"several of these things are on our site…"_. Then, after a
first fix split it into two sections, he rejected his own approved fix:

> _"I think let's undo the split, all can stay under the top level if we remove a
> bit from the heading … now the hedging is honest and necessary; there's a
> greyness in things that are said elsewhere but could be implied from our site.
> For instance 'A man named Tim leads Reddoor Creative.' I'm guessing AI got this
> from linkedin because tim is more active than erik there, but both tim and erik
> are listed on our site, so it's a bit overblown to say its not on our site, even
> though it flags real misleading information"_

MEASURED, verbatim. The wording that shipped is _"These are claims that seem not
to be sourced from your site."_ **The defect was epistemic, not a bug: the tool
was stating as fact a relationship it could only infer.**

The check battery itself (#703, 2026-09-08) is titled "46 checks, four states,
proven against the corpus". Today the shipped `TIER*_CHECK_KEYS` lists in
`src/prospect/site-checks.ts` enumerate **76 keys** across five tiers, so the
battery grew by two-thirds in the four days after that PR. MEASURED by parsing
the file. The four states — pass / fail / not-applicable / **unmeasured** — are
the design's core: a check that could not run says so instead of returning a
flattering pass.

Validation runs against a stored corpus of **29 sites** (~40MB of crawls). The
scale of what that caught is worth recording exactly: allowing any namespace
prefix on `<loc>` counted image-sitemap entries as listed URLs, and **11 of 29
corpus sites emit them** — compositionhospitality went **8,149 → 573** listed
URLs once `<image:loc>` stopped counting (93% of its "sitemap" was its own
images), salonsbyjc 11,346 → 8,659, foodallergyinstitute 1,138 → 105,
thepointeburbank 52 → 1. Separately, sapidyne.com declares `/` as canonical on
19 of its 20 pages, and folding pages on the _declaration_ collapsed the whole
site to one page, reading `description-length` as "all 1 are between 40 and 200
characters" — hiding the exact defect `canonical-self` exists to report.
**A page that says it is another page is not therefore that page.** And counting
every anchor as a page a sitemap must list told sapidyne it was missing 37 pages
(33 PDFs under `/uploads/`) and theburbankstudios 90 (stage plans under
`/api/media/file/`). The replacement is an **allow-list of page extensions, never
a deny-list of file ones** — an unknown extension then reads as a file and is
quietly excused, costing us a finding, rather than demanding a stranger sitemap
their `.dwg`. **Missing our own gap beats printing their fault.**

Commercial context, MEASURED from Discord: on 2026-09-09 Erik posted an
AEO/GEO guide from a newsletter, _"in case it adds value"_, and Tucker replied
_"this is almost the same thing to what i'm making haha"_.

### F. Forms and client leads — the thing that is never allowed to be wrong

33 commits under `forms`, spread across the whole window, and the operator's own
statement of priority on 2026-08-31: _"do one more deep review of this, if
everything worked as it should last week, and if you're missing any regressions.
**most sensitive area is forms and client leads**"_.

What landed: newsletter fan-out recorded and Mailchimp members tagged by source
(#477); captured leads no longer reported as failed (#498); the notification
target shown and read back rather than asserted (#505); autoresponder suppressed
for same-domain spoofed submissions (#513); spam handling skipped for
in-development sites (#551); dead-lettering for a lead whose site lookup fails
(#553); a **blocked-sender-domain tier** in the spam classifier (#622); Airtable
made unable to cost a lead (#669); and CMS-authored auto-replies with calendar
invites (#681/#682/#684/#686), which — see the coverage section — were built from
a client repo's session in response to a client request.

The blocked-domain tier has the measurement that justifies it: `jmailservice.com`
sent 17 submissions across **four unrelated client sites** between 2026-06-17 and
2026-08-25 using **11 distinct `firstname.lastname@` addresses**, and **10 of
them reached the operator's inbox**. The existing cross-site `repeat-sender`
signal keys on the exact email, so identity rotation defeats it while the domain
holds. The new tier scores at `SPAM_THRESHOLD` so a blocked domain buckets alone.
And the guardrail on the guardrail: the entry bar for the list is "we read every
row", because a ratio query would have blocked `lemos.com` — the operator's own
test traffic.

The form end-to-end probe, meanwhile, produced a month of false alarms. Rotating
"no success banner — POST 200/204" warnings across espada ×3, vineyard, beachfront
and reddoor, 08-25 → 08-31, were **one instrument weakness, not five site bugs**
(#641): the probe filled the form right after `domcontentloaded` and never
re-checked, so a client re-render during the settle wiped the fills and native
validation blocked the submit client-side — and the "POST 200/204" in the warning
was matching **Google Analytics' collect beacon and Cloudflare Turnstile
telemetry**, never the form action. Every one of those sites' forms worked.

### G. Recipes as versioned products — match-harness (2026-09-09 → 09-10)

`src/recipes` is how shared machinery gets installed into and upgraded inside 40
site repos. The window's headline addition is **#733, the match-harness recipe**
(+5,058, 18 files): the Webflow-rebuild pixel-matching gate turned from a thing
you re-write per site into an installable, versioned, safe-replaceable artefact.
Four follow-up fixes (#744/#748, #739/#758, #751/#759, #730/#749) land the next
day. The work journal's entries for those two days are the most detailed in the
file and are worth reading directly.

### H. The operator override layer (2026-09-09 → 09-11)

The window's last feature, and the cleanest example of a request arriving as a
question rather than a spec:

> _"is there a way we could integrate it with prismic? have a source report but
> any line of it can be overwritten? or do some thinking/investigation annd come
> back with recs"_ (09-09 17:52)

followed, after the recommendation, by a correction of scope that the design had
got wrong: _"ok so all the changes would live in the cockpit? we want them to
still show up on the site as well, not just on email"_. Then spec (#743), plans
(#745), and implementation across migrations `0015`/`0016`/`0017`: store
overrides on a prospect audit (#761), serve a report with them (#762), an endpoint
to save them (#765), prove an edit reaches the live report and the PDF (#766),
and show in the cockpit when a report was edited and last opened (#768). The last
human commit of the window, `9f5fc898`, is `fix(a11y): the summary counts the
routes that ran, not the fixture defaults` — the same honesty-of-denominator bug
class as everything else, one more time.

### I. Process infrastructure the operator built for himself (2026-09-05)

Two small PRs on a two-commit day, both about the cost of forgetting.

**#699 opened `docs/workJournal.md` and brought `CLAUDE.md` into version
control**, reversing a standing convention. The journal's rule — newest at the
bottom, never corrected in place, a later entry corrects an earlier one, and the
only edit an old entry may take is a one-line forward pointer to whatever
overturned it — is a deliberate design for preserving _what was believed at the
time_. The window ends with 1,975 lines of it.

**#701 added `scripts/fleet-repos.sh`**, which answers "which repos can take a
push" _before_ a sweep instead of at push time. It exists because three separate
sessions had run a fleet-wide change to completion before discovering that
`reddoor-mailer` and `the-pointe` are archived on GitHub and `rfp-analyze` has no
origin — and **an archived repo is invisible from inside its clone**:
`git remote -v`, `git ls-remote` and `git fetch` all behave normally, and only
the push fails, after every commit has been written. One of those three sessions
reported the cause wrongly ("dead remote"). The script also maps by remote rather
than by directory name, because the checkout `welcome-to-the-flower-court` is the
repo `tucksravin/invitations`.

---

## The signature defect class: green that could never have been red

This repo's `CLAUDE.md` leads with one rule — _"A new gate, alarm, check, or
probe must be shown to PASS on a known-good input before any FAIL it produces is
reported as a finding"_ — and the window supplies a dozen instances of both that
failure mode and its mirror image. Collected, because it is the single most
useful pattern for anyone recommending workflow changes here.

1. **The GA-credentials gate that could never pass** (#523, 2026-08-12). A CI gate
   asserting a report carried its ANALYTICS section reported "GA credentials did
   not resolve" twice, with total confidence. It was built on `report --preview`,
   which does no IO at all. The credentials were fine. Fix: the preview path takes
   `--enrich`.

2. **The backup verifier that compared the dump against itself** (found in the
   2026-08-25 evening review, fixed by #620). `expected` was parsed from the dump
   _text_; `restored` came from loading that same dump. Under-dumping shrinks both
   and prints `mismatches=0`. The only origin-anchored assertion in the pipeline
   was one `grep '^INSERT INTO sites '`. `submissions` — 354 client leads — and
   `reports` had no presence gate at all, **and the freeze had just made this the
   entire rollback story**. Also found: no restore path _into_ Turso had ever been
   rehearsed (the nightly "rehearsal" is `:memory:`), and `gpg` was not installed
   on the only machine holding `BACKUP_PASSPHRASE`.

3. **The query-plan gate that tested function names, not predicate shapes** (fixed
   #624). `countSubmissionsFiltered` had only `{}` and `{siteId}` scenarios, while
   `{search}`, `{reason}` and `{formType}` each raw-scanned `submissions` on the
   live `/submissions` request path. The gate printed `raw_scans=0`. The tell was
   sitting in the same file: its sibling `listSubmissionsFiltered` _did_ have an
   every-WHERE-shape scenario.

4. **`ci.yml` installed no Playwright browser** (#704, 2026-09-08). Every other
   workflow in the repo installed one; `ci.yml` did not, because nothing in the
   unit suite had ever needed a browser. A real-Chromium test — the one proving
   the Tier 4 form probe aborts a submission _before it leaves the browser_ —
   passed locally and on the PR and then reddened `main` through `release.yml`.
   The tempting fix, skipping the spec when no browser is present, would have
   retired the one instrument standing between the fleet and actually posting a
   stranger's contact form.

5. **The match-harness gate that said ALL DONE over runs that never happened**
   (#744, 2026-09-09). `gate.sh:120` was `echo "$page exit=$?"` — it printed the
   status and discarded it. Every page-diff could fail and the gate still reported
   completion, exit 0, no `report.json` written. The scorer had the matching hole:
   its denominator summed only over pages that produced a parseable report, so
   eight of nine pages could print `SCORE 160/160` while the ninth was never
   measured. **Found by _using_ the recipe on a real site, not by three rounds of
   adversarial review of it.**

6. **The mutation test whose weakest mutation was the one used.** Verifying #744's
   fix, four of `uncountable()`'s six arms had no case at all, and _deleting_
   `if (m.truncated) return "truncated";` left the suite green at 81/81 —
   restoring the exact false green. Every arm was then proven by **narrowing**
   rather than deleting. Seven mutations, seven single-arm reds by name, 95/95.

7. **A trap inside the mutation workflow itself.** The documented mutate → test →
   revert loop does not restore `template.ts`: the generator carries the existing
   `MATCH_HARNESS_PREVIOUS` forward and appends the current on-disk body, so the
   second regeneration files the **mutant** as a legitimate prior release.
   Measured: one cycle left `template.ts` **693 lines larger than HEAD** carrying
   two copies of the predicate. A committed fossil would make the recipe silently
   safe-replace a site carrying that exact broken file.

8. **`pnpm lint` reporting 1,771 errors, none of them findings** (2026-09-08).
   Every one was the same parser error and every one named a file under
   `.worktrees/` — other sessions' checkouts, which ESLint walks because it does
   not read `.gitignore`. In a clean worktree the count was one, and that one was
   real. The full suite's 49 failures the same day were all `listen EPERM`, the
   Bash sandbox refusing sockets; the same eight files passed 96/96 outside it.
   **Neither number was a finding about the code.**

9. **The replay's two blind spots** — the most valuable instrument-literacy note
   in the window. `scripts/replay-checks.mts` compares **status only**, so an
   evidence change (46 → 45 missing) is invisible and "0 changes" means no verdict
   flipped, not that the fix did nothing. And it **cannot exercise a crawl-layer
   fix at all**, because it re-scores checks over stored crawls: anything computed
   at crawl time is frozen at whatever the old code produced. A green replay over
   a parser change means nothing. The corpus refresh is the only instrument that
   can see those, and `reddoorla.com`'s sitemap holding at 49 → 49 was the
   known-good control that made the refresh trustworthy.

10. **Ghost vulnerabilities nothing could fix.** GitHub's dependency graph keeps a
    manifest after the file is deleted, so two fleet repos sat red for five days
    on Dependabot alerts filed against a `package-lock.json` deleted in June —
    high alerts with no file to bump, and the graph toggle is unavailable on public
    repos. The security audit could not tell an unfixable finding from a real one;
    #702 asks it to.

11. **A green nightly that measured nothing.** A "fleet smoke green" means _all
    sites measured_, not _all sites passed_ — and CPU starvation on the operator's
    own Mac (a leaked `ctx_execute` node process at 100% for 12h44m, load averages
    63–79) silently degraded four corpus sites' browser checks to `unmeasured`
    while the run still exited 0. The tell was duration against unmeasured-count:
    909s, 7,692s, 9,963s and 9,868s against a 98–172s baseline; the four re-ran in
    92–167s once the machine was free. **Kill your own background processes — a
    script that printed its answer has not necessarily exited.**

12. **The corpus-refresh runner itself had three silent traps**, all fixed
    2026-09-09: it `cd`'d to the main checkout (routinely parked on some other
    session's stale branch, so it re-crawled with old code and reported success);
    a re-run skipped all 29 slugs already marked `ok` and exited 0 having done
    nothing; and it wrote dumps in place, so a half-dead run left a corpus of
    mixed vintages. And the note on its own new guard is exactly right: _"Am I on
    origin/main after checking out origin/main" is a gate that cannot fail, so it
    is not the gate._

The corollary that recurs across 2, 3, 8 and 11 is the one the `CLAUDE.md` rule
does not state: **a check that has only ever passed is as suspect as one that has
only ever failed.**

---

## Tried and abandoned, or left stranded

MEASURED from local branch state and PR state.

- **`fix/blux-migrate-clean-repo-retry` (50 commits ahead, last 2026-07-22) and
  `fix/blux-migrate-depalette-png` (49 ahead, 2026-07-22)**, plus
  `backup/emit-prerebase-ac2a90f` (51 ahead, 2026-07-23). Three substantial Blux
  branches that entered the window already dead and never moved. Blux work
  continued in-window only as small `feat(blux)`/`fix(blux)` commits on main
  (#474, #475, #506, #666). Reviving these would mean rebasing ~50 commits across
  a 231-commit gap; INFERRED, not attempted.
- **`docs/airtable-to-turso-spec` (2 ahead, 2026-08-17)** — the original migration
  spec branch. It has an explicit do-not-merge marker in the memory record: it is
  9+ days behind and its diff _deletes_ ~5,200 lines of docs that landed since.
  The two files worth keeping were taken across by hand in #629. The branch and
  its worktree are still on disk.
- **`fix/form-e2e-budget-attribution` (1 ahead, 2026-08-17)** — one `wip(form-e2e)`
  commit, `72c2f275`, stranded in its own sibling worktree. The problem it was
  attacking was solved differently by #552 six days later.
- **`chore/ci-probe` / PR #752** and **PR #637** ("netlify deploy control probe —
  temporary, do not merge") — two deliberate throwaway probes, closed unmerged.
  These are the good kind of abandonment: a control PR opened to answer a question
  no local test could.
- **Three Renovate PRs closed unmerged**: mjml v5 (#489, +1,228) and two
  `brace-expansion` "security" bumps (#495, #496). The brace-expansion ones are
  recorded as a persistent misread of pnpm override _keys_ — the standing
  instruction is never to merge them.
- **The AI Visibility score was built, then killed.** `feat(prospect): AI-visibility
probes across Perplexity and Claude web search` (08-24) → several corrections →
  `fix(prospect): finish killing the AI Visibility score — email, PDF and CLI`
  (08-31). Roughly a week of work removed from the product because the number
  could not be made to mean anything defensible. Replaced by "measure the answer
  space, not just the visibility score" (#638).
- **`llms.txt` scoring** was built and then explicitly removed:
  `fix(prospect): stop scoring llms.txt, and stop recommending it` (08-26), one
  of three commits that same day retiring claims the AEO research had imported
  uncritically (`kill the 93% hallucination stat`, `retire the Foursquare and
MERJ-attribution claims`).

---

## State at the end of the window (2026-09-12)

MEASURED.

- `main` at `9f5fc898`, last human commit 2026-09-11. One untracked file in the
  main checkout (`fmt.mjs`).
- **Five worktrees, in four different conventions**: the main checkout;
  `reddoor-maintenance-e2ebudget` and `reddoor-maintenance-turso-spec` as siblings
  _outside_ the repo; `.worktrees/journal-fix`; and `.claude-worktrees/meta-week`.
  Historic session cwds show a fifth, `.claude/worktrees/`. This is not cosmetic:
  the 1,771-error lint incident above happened because ESLint walked `.worktrees/`.
- Three PRs open: **#769** (a journal correction — _"correct the entry that
  invented two token-compare defects"_, i.e. the record correcting itself), **#771**
  (the pending release, human-only by policy), **#716** (a Renovate vitest security
  bump).
- Nine nightly/daily workflows green on every run in the visible nine-day slice:
  `fleet-smoke`, `fleet-security`, `fleet-lighthouse`, `fleet-form-e2e`,
  `fleet-prismic-drift`, `fleet-db-backup`, `daily-reports`, `release-health`,
  `time-travel`. Remember what a green `fleet-smoke` means here: _all measured_,
  not _all passed_.
- Turso is authoritative (since 2026-08-31). **Phase 6 (#646) is due and requires
  the operator's explicit go**, because it ends the rollback window; the rollback
  week nominally ended ~2026-09-07 and Phase 6 had not run by 09-12. One operator
  decision is still open from the flip: accept-or-run the hosted-target restore
  rehearsal.
- Two known open defects carried forward: **#645** — a site with no Turso row 404s
  _all_ its leads with no dead-letter — and the Sonder cookie-banner screenshot.
- `@reddoorla/maintenance` at **0.95.1**.

---

## Reading notes for whoever recommends changes

Three things the numbers say that the commit log does not.

**The operator's highest-leverage act is reading output, not writing prompts.**
Every one of the window's most valuable corrections came from him looking at a
rendered artefact and saying it was wrong: the report's AI-claims list (_"several
of these things are on our site…"_), the announcement email preview, the Discord
screenshot complaint, _"I just sent a test submission and don't see anything"_.
The prompts that produce work are three words long; the prompts that produce
_quality_ are the ones quoting the product back at it.

**Attribution by working directory is structurally wrong for this repo.** 43
central commits across six days have no session under a central cwd, and the two
traced cases were both central capability built from a client's chair because a
client asked. Any measurement of "where the time went" that buckets by cwd will
under-count the orchestrator and over-count whichever site happened to be open.

**The false-green catalogue is not a list of mistakes; it is the repo's actual
subject matter.** Twelve distinct instances in six weeks, in a codebase whose
governing document already warns about exactly this, in a repo where the ratio of
test files to source files is 484:379. The failure mode is not carelessness — it
is that a fleet this size is mostly instruments, and an instrument's own
correctness is the hardest thing in the system to observe. The interventions that
worked were all the same shape: run the instrument on a known-good input
(`reddoorla.com` 49 → 49), demand an artefact rather than a status (`--check-run`),
prove each arm by narrowing rather than deleting, and _use_ the thing rather than
review it.
