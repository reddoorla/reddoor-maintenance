# Cluster 02 — website (`reddoor-website`)

_Research layer for the 2026-07-30 → 2026-09-12 retrospective. One repo in this
cluster. Written for a reader with no other context._

---

## Coverage, before anything else

**Transcripts only retain back to 2026-08-10.** For 2026-07-30 → 2026-08-09 this
file has commits, pull requests and Discord messages and nothing else — no
prompts, no sessions, no tool counts. Everything said about those eleven days is
**RECONSTRUCTION** and is labelled as such where it appears.

Three further gaps, measured rather than assumed:

- **GitHub Actions runs for this repo begin 2026-08-22.** `runs.jsonl` holds 300
  runs for `reddoor-website`, the earliest dated `2026-08-22`. The go-live of the
  `/medtech` funnel on 2026-08-20 — the single largest merge of the window — has
  **no CI record at all** in the corpus. This is retention, not absence of runs.
- **No prospect-audit volume is measurable here.** The Airtable snapshot's
  `Reports` table (17 rows) is the fleet's _client maintenance_ reports. Prospect
  audits live in Turso and are not in this corpus. How many prospect reports were
  actually generated or sent in the window is **unknown from these sources**.
- **`repos.jsonl` reports `windowCommits: 286`; `commits.jsonl` holds 254 rows
  for this repo.** The 32-commit difference is almost certainly commits on
  unmerged branches (the checkout has 38 local branches and 8 worktrees). All
  numbers below use the 254 from `commits.jsonl` unless stated.

---

## The numbers

| Measure                                        | Value                                                                                                                | Source           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Commits in window                              | **254** (239 Tucker Lemos, **15** `reddoor-renovate[bot]`)                                                           | `commits.jsonl`  |
| Active commit days                             | **25**, 2026-07-31 → 2026-09-11                                                                                      | `commits.jsonl`  |
| Sessions (cwd under `/GitHub/reddoor-website`) | **701** (732 if scratchpad cwds are counted)                                                                         | `sessions.jsonl` |
| Sessions that carried an operator turn         | **39** — the other **662** are subagent / tool-only                                                                  | `sessions.jsonl` |
| Active session days                            | **22**, 2026-08-11 → 2026-09-10                                                                                      | `sessions.jsonl` |
| Prompt records                                 | 1,395 → **454 unique operator turns** after de-duplication and stripping task-notifications and compaction summaries | `prompts.jsonl`  |
| Tool calls                                     | **36,914**, of which Bash **24,471 (66%)**                                                                           | `sessions.jsonl` |
| Wall-clock session time                        | **25,815 min = 430.3 h**                                                                                             | `sessions.jsonl` |
| Interruptions                                  | **55** across 25 sessions                                                                                            | `sessions.jsonl` |
| PRs                                            | **65** — 58 merged, 7 closed; 54 `tucksravin`, 11 `app/reddoor-renovate`                                             | `prs.jsonl`      |
| PR line volume                                 | **+84,760 / −8,841 across 844 changed files**                                                                        | `prs.jsonl`      |
| PR reviews                                     | **0 across all 65 PRs**; 110 comments (bot/Netlify-dominated)                                                        | `prs.jsonl`      |
| CI runs (from 08-22)                           | 300: 264 success, 20 failure, 16 cancelled                                                                           | `runs.jsonl`     |
| ↳ `ci`                                         | 153 runs, **19 failures (12.4%)**                                                                                    | `runs.jsonl`     |
| ↳ `lighthouse`                                 | 103 runs, 1 failure, 16 cancelled                                                                                    | `runs.jsonl`     |
| ↳ `renovate`                                   | 44 runs, **0 failures**                                                                                              | `runs.jsonl`     |

Models, by session appearance: `claude-fable-5-1` 171, `claude-opus-5` 130,
`claude-fable-5` 127, `claude-haiku-4-5` 59, `claude-opus-4-5` 51,
`claude-sonnet-5` 41, `claude-opus-4-8` 4. Subagents: `general-purpose` 225,
`superpowers:code-reviewer` 125, `Explore` 7. Skills:
`figma:figma-design-to-code` 23, `artifact-design` 14,
`superpowers-chrome:browsing` 11, `superpowers:brainstorming` 10,
`superpowers:writing-plans` 10, `claude-api` 10,
`superpowers:subagent-driven-development` 7, `evening-review` 6, `figma-slices` 5.

**The session count is misleading and should not be reported as "726 sessions of
work".** 662 of the 701 have no operator turn; 234 last under a minute; 195 make
zero tool calls. The work actually lives in **eleven long-running operator
sessions**, most of which span two to three calendar days:

| Span                          | Wall clock             | Operator turns | Tool calls | What it was                                                 |
| ----------------------------- | ---------------------- | -------------- | ---------- | ----------------------------------------------------------- |
| 08-11 22:20 → 08-13 23:44     | 2,964 min (49.4 h)     | 152            | 4,655      | `/medtech` from Figma                                       |
| 08-16 15:51 → 08-17 02:52     | 661 min                | 54             | 1,033      | process section, arrows, modal                              |
| 08-17 18:04 → 08-18 01:54     | 469 min                | 48             | 604        | inquiry forms, CRM embed debugging                          |
| 08-18 16:14 → 08-20 21:50     | 3,216 min (53.6 h)     | 269            | 3,503      | the whole funnel, CRM API, booking, go-live                 |
| 08-21 00:43 → 00:58           | 16 min                 | 6              | 25         | the CRM data-privacy question                               |
| 08-24 17:14 → 17:53           | 39 min                 | 4              | 36         | three-tier audit product brainstorm                         |
| **08-24 19:13 → 08-27 17:59** | **4,246 min (70.8 h)** | **498**        | **11,825** | **the prospect audit product, birth to first honest draft** |
| 08-31 17:33 → 09-03 05:06     | 3,573 min (59.6 h)     | 223            | 1,878      | report honesty rebuild, Gate A                              |
| 09-03 16:00 → 09-06 17:24     | 4,403 min (73.4 h)     | 56             | 1,426      | the check battery, apple.com calibration                    |
| 09-08 16:29 → 09-09 20:59     | 1,710 min              | 43             | 537        | OG cards, `route_meta`, portfolio pin, stack readout        |
| 09-10 16:08 → 09-11 05:14     | 785 min                | 14             | 252        | Tim's round 3, promotion, edit mode                         |

The 08-24 session alone carries 32% of the window's operator turns and 32% of its
tool calls in this repo.

---

## What the repo is, and the two products inside it

`reddoorla.com` — Reddoor Creative's own marketing site. SvelteKit 2 / Svelte 5 /
Tailwind v4 / Prismic on Netlify, 597 total commits since 2024-07-29. In this
window it stops being a portfolio site and becomes **the studio's sales
apparatus**, along two tracks that barely touch each other in the code and share
only the deploy pipeline:

**MEASURED**, by conventional-commit scope:

| Track                                                                                   | Commits | Span          | Active days |
| --------------------------------------------------------------------------------------- | ------- | ------------- | ----------- |
| Prospect report product (`report`/`audit`/`prospect`)                                   | **94**  | 08-25 → 09-11 | 12          |
| Marketing funnel (`funnel`/`industry`/`inquiry`/`medtech`/`crm`/`booking`/`schedule`/…) | **75**  | 08-12 → 08-24 | 8           |
| Marketing site craft (`portfolio`/`og`/`slideshow`/`404`/`a11y`/`prismic`)              | **42**  | 08-12 → 09-10 | 9           |
| Dependencies + CI                                                                       | **25**  | 07-31 → 09-10 | 13          |

The two tracks are **sequential, not concurrent**. The funnel work stops dead on
2026-08-24 (the last `inquiry`/`og` funnel commits and PRs #136/#138) and the
prospect report starts the next day. Nothing in the corpus suggests the funnel
was abandoned; it was finished and shipped.

---

## 1. 2026-07-30 → 2026-08-10 — RECONSTRUCTION

Eight commits, all infrastructure: `chore(ci): run renovate twice daily` (#116),
`ci(renovate): authenticate as the reddoor-renovate GitHub App` (#117), two
non-major dependency waves, a lockfile maintenance, `setup-node` to v7, and
`fix(lint): allow the data prop in +error.svelte pages` (#123). Three Renovate
PRs were **closed unmerged** — #121 and #125, both `cookie@<0.7.0 to v1/v2`, which
the fleet memory records as Renovate misreading a pnpm _override key_ as a
version range, and #126, a superseded lockfile PR.

There are **zero commits between 2026-08-04 and 2026-08-10**. Discord says why,
and this is the only evidence for the period that is not git:

- 08-04, `#rd-website`, Tim: "The landing page is ready. There are some minor text
  tweaks that Erik and I working through but it won't affect the design in any
  way." Then: "just do a quick wire frame first / then let's check in on it."
- 08-04 and 08-06, Nicole posts the same Figma board —
  `RD-Sales-Funnel-LP?node-id=3074-2227` — the board that becomes `/medtech`.
- 08-06 → 08-08, `#website-maintenance` is a _different_ project entirely
  (Beachfront Dentistry DNS cutover, Markup.io review round, "$40" of Webflow
  billing at stake).

**INFERRED, and the inference is cheap:** the week of 2026-08-03 was copy and
design work happening in Figma and Google Docs, not in this repo. The build
starts the moment the board is final — the first `/medtech` commit is
2026-08-12 and the first operator prompt of the whole window, 2026-08-11 22:29,
is that same Figma URL.

---

## 2. 2026-08-11 → 2026-08-24 — `/medtech` and the inquiry-to-booked-call funnel

### The ask

> "want to add this (board v2 only, see the comments). should be at /medtech,
> with the ability to make more of these for different industries with the slice
> model. reuse slices we already have if possible" — 2026-08-11 22:29

That one sentence sets the constraint that governs the next two weeks: **an
industry landing page must be a repeatable Prismic composition, not a bespoke
page.** Everything about the implementation follows from it, including the pain.

### The shape of the loop

The Figma-to-slices loop ran ~50 turns a day across 08-11→08-13, and the corpus
shows its exact rhythm: Tucker pushes a Prismic model from Slice Machine, the
agent writes the slice, a Netlify deploy preview goes into `#rd-website`, and
Nicole, Tim and Erik comment on the preview. The handoff points are all manual
and all in the prompts — `"is slice machine open?"`, `"pushed types"`,
`"published the migrate"`, `"pushed from slice machine, do you want the switch
image or the before image?"`, `"pushed logo grid go ahead with the pusj"`.

Corrections came back as design authority, not as bug reports:

> "I don't see the before after toggle for phlex, no logo soup, and I want you to
> do a close pass of the spacing margins, **we're supposed to match the figma
> exactly, that's why its there**" — 08-12 19:27

> "don't roll your own slideshow, we have a component for that" — 08-12 20:53

> "you're wrong about animateIn, the vertical cascade happens because of scroll
> triggers and feels better and more reactive that way, don't do the vertical
> list" — 08-16 22:45

> "the animation still results in the heads of the arrows not touching the line,
> **please use playwright to check things as you build them**" — 08-16 20:05

That last one is the workflow-relevant line in this whole section: the operator
had to _ask_ for the agent to measure its own visual output, on day four of a
design-matching task, in a repo that already had Playwright wired.

### What it cost in PRs — a re-cut chain

The branch was opened as a PR three times.

- **#128** `feat(industry): repeatable industry landing pages, first one at
/medtech` — **+10,147 / −639 across 70 files**. **CLOSED.**
- **#132** `feat(industry): number the framework steps, route CTAs to an inquiry
modal` — **+14,269 / −643 across 89 files**. **CLOSED.**
- **#133** `Release: medtech industry landing page + inquiry funnel` — **+25,026 /
  −650 across 155 files. MERGED 2026-08-20 into `main`.**

The reason is in the prompts: on 08-18 20:41 Tucker asks `"whats pr 128?"`, then
`"close 128 if we have all the commits, lets move this onto staging, industry
page = sales funnel"`. #128 and #132 were superseded when the scope changed from
"a landing page" to "a landing page plus the entire lead funnel behind it". No
work was lost, but two review surfaces were thrown away and the thing that
actually shipped was a **155-file, 25,000-line single merge with zero reviews on
it** (`nReviews: 0`, corpus-wide for this repo).

### The scope expansion, in Tucker's own words

> "alright, scope is growing, **I own this now not Tim**. I gave you read access
> for everything in the CRM, check discord for an overview, but I want to follow
> the templates that this company gave us while always using our site and our
> design language." — 08-18 17:59

From there the funnel grew a server-side CRM sync over the official API, a
`/schedule` booking page reading a live calendar, branded reschedule / cancel /
add-to-calendar / unsubscribe / resubscribe / meeting-outcome pages, attribution
capture, an abandoned-application resume link, and on 08-24 a **$10k+ budget gate
where a "No" self-opts-out to `/not-a-fit`** (#136).

### `docs/inquiry-funnel.md` — the single most interesting artefact in the repo

**1,843 lines / 15,239 words**, written alongside the code, and it is the only
document in the cluster that **grades every claim**:

| grade          | meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| **verified**   | Read directly out of the CRM API, the codebase, or a test run               |
| **documented** | Stated by a first-party source (Tim's Loom, the offer sheet, the worksheet) |
| **inferred**   | Our reading of the above; the reasoning is given so you can disagree        |

It is also where the window's cleanest **"prove the instrument"** episode lives,
and it caught itself four times in three days. The error shape is identical each
time: **reading an empty render as evidence that the field does not exist.**

1. **§6.14, tags.** Claimed the namespaced `outcome …` tags were a ready-made
   hook. Verified since: they exist on **zero** contacts and are absent from the
   location's complete **44-tag** list. The claim came from the template's shape,
   not the location's data. Also: "I claimed nothing listens for them — that is
   **unprovable** here, since workflow triggers are unreadable by API. It was an
   inference stated as fact."
2. **§6.15, the Z-004 workflows.** Claimed `Z-004-2`/`Z-004-3` send review
   requests on a dead link. Both wrong: the workflow list is **37 entries and
   contains no Z-004 series at all** — the numbering runs Z-002, Z-003, Z-015,
   Z-016.
3. **§6.17, `{{appointment.id}}`.** An SMS arrived reading
   `https://staging.reddoorla.com/reschedule/` with no id, so the field was
   declared broken and a `/reschedule` fallback shipped on the strength of it.
   **The conclusion was wrong** — Tucker had sent that message directly, not
   through the no-show workflow, so _every_ `{{appointment.*}}` field would render
   empty regardless. The message carried its own control and the first read missed
   it: `contact.first_name` resolved to "Tucker" and both `custom_values`
   resolved, while both appointment fields were blank. "**Two appointment fields
   empty and every non-appointment field populated is the signature of a missing
   scope, not a missing field.**"
4. **`{{contact.name}}`, corrected 2026-08-20.** Declared "not a field in this
   context". It is a field and it works — a probe SMS rendered it as
   `Tucker Lemos`. The three chase emails rendered it empty because **those
   contacts had no name**; `tim@reddoorla.com` still has an empty first and last
   name today.

The rule the doc finally writes down: **"an empty render is only evidence about
the field when something else proves the source had a value to give."** This is
the fleet's own "prove the instrument" rule rediscovered in a completely
different domain, at a cost of four wrong claims and at least one shipped
fallback.

### Two genuine external defects the walkthrough found

Measured with two throwaway contacts on 2026-08-18:

```
upsert dupe-phone-a@example.com + (212) 867-5309  -> id jWap2a96VWPiW3G16PtC
upsert dupe-phone-b@example.com + (212) 867-5309  -> id jWap2a96VWPiW3G16PtC   (same record)
                                                     stored email now ...-b@example.com
```

`POST /contacts/upsert` **dedupes on phone and overwrites the email** with no
error. A company mainline, a couple, or a receptionist booking for someone else
collapses two leads into one and the first lead's address is gone. Separately, a
phone number typed twice was stored neither time, with SMS consent recorded — and
three theories were tested and disproved before the real one.

### The decision that kept being re-opened

§6.16 exists only because the "should the add-to-calendar links stay on GHL?"
question was raised **three separate times** — first as optional, then as a missed
link under "check all the links", then a third time off an audit's output. Tucker
on 08-19 22:48: **"the calendar is fine, we've talked about this three times."**
The doc's own conclusion: "A decision that has been made is not a finding, and a
completeness sweep is not a licence to reopen it." **This is a workflow defect
worth naming for Fable:** a completeness-oriented agent has no memory of settled
scope and will re-surface closed decisions as findings on every sweep.

### Go-live, and the process rule it produced

#133 and #134 merged on 2026-08-20 and the funnel went live. On the same day
Tucker wrote the rule that governs the rest of the window — and had already
written it three days earlier as a to-do:

> "piece to add as part of our process (add as an issue to be tackled next week)
> every site should have this shape and branch protection should force us to push
> everything into staging and then staging onto main, rather than letting branches
> go directly into production." — 08-17 20:51

---

## 3. 2026-08-24 → 2026-09-05 — the prospect report product

### How it started

Not as a feature request. On 08-24 17:14 Tucker pastes a Zoom doc and asks for a
**three-tier audit product**; by 08-24 22:25 it is "let's make a plan for the
external audit tool, should tie into the reddoor maintenance platform"; by 08-25
14:49, away from his computer, it is "add a page to the cockpit where someone (me
tim or erik) can type in a url and trigger an audit". The engine lives in
`reddoor-maintenance`. **This repo's job is to render it**, and that turns out to
be where the product decisions actually get made.

By 08-25 21:45 the report has outgrown a PDF: "yes, I want it to become a real
route, let's make a plan for that", then "instead of /prospect it should be
/audit". Three commits on 08-25 are pure naming discipline —
`docs(prospect): name the outward surfaces "audit", not "prospect"` and
`docs(prospect): the website route is /audit/[token], not /r/[token]`.

### The honesty rebuild — the spine of the whole window

Between 08-26 and 09-03 this repo's commit log reads like an argument with
itself, and Tucker is on one side of it throughout. The sequence, in order:

- 08-26 `fix(report): take the visibility denominator from what was asked`
- 08-26 `feat(report): weight the basics by what they find, not by having been checked`
- 08-26 `docs(report): stop presenting the audit corpus as a cross-site finding`
- 08-26 `fix(report): argue the visibility limit from research, not from our own nine audits`
- 08-26 `fix(report): drop the AI visibility score and report the field instead`
- 08-26 `fix(report): claim only what the citation list can support`
- 08-26 `fix(report): chart only the category answers, and stop calling a desktop total a phone load`
- 09-01 `fix(report): a second phone number is a second office, not a contradiction`
- 09-02 `fix(report): one verdict per claim, and stop saying robots.txt proves reach`
- 09-02 `fix(report): the methods no longer assert that AI crawlers run no JavaScript`
- 09-02 `feat(report): one narrative — headline finding, findings only, passes in one disclosure`
- 09-08 `fix(report): a finding and a limit are not the same list`
- 09-09 `copy(report): claims not sourced from your site, rather than not found on it`
- 09-09 `copy(report): the heading claims nothing, the hedged line carries it`

Four operator prompts drove most of it, and they are the highest-value quotes in
this cluster:

> "**you're saying things are universal based on 13 sites.** This is not the
> ironclad corpus of data you're presenting it as, it is useful but it is heavily
> cherrypicked, use it to check things but you should be putting more weight on
> external research unless I choose to do an actual well designed study here"
> — 08-27 00:42

> "I also want it **greenable, if a test can never come back 'this is right' or
> only have minor nits, it's a bad test**" — 08-27 02:57

> "AND visibility is that actual long term goal, we just need to be honest about
> what is and is not in a clients control. citation share is no more within our
> control, you can prove its winnable by showing me the winners, but that doesn't
> mean we have the method or the capital to win." — 08-26 20:14

> "we just can't should never make promises we don't know we can keep" — 08-26 20:27

The "greenable" line is the repo-wide rule stated from the other direction: a
check that can only ever fail is not a check, it is a sales tactic. It is the
reason the **AI visibility score was deleted**, and the commit body is worth
quoting because the honest accounting is explicit:

> "It scored zero for **six of the eleven sites audited so far**, including our
> own, and nothing in this audit reliably moves it. … The reasoning was about
> honesty and it was not wrong, but the picture it makes is a scoreboard with the
> reader last." — `4b0af16`

And the replacement is better because it is _more_ informative, not less:
Beachfront's citation field is **29 citations to listing sites and 16 to the sites
of local practices** — the second kind is reachable, the first is not, "and the
old lede printed the same zero for both."

### The denominator bug — a flakier run looked better

```
total = categoryProbes.length          // the probes that ANSWERED
```

under a comment claiming it was "the number of searches actually run". A probe the
engine errored on was dropped upstream, so it left the denominator too: **five
asked with three failures read "named in 1 of 2" and implied a score of 50 where
the truth is 1 of 5.** The commit body's own summary: **"A flakier run looked
better."** Separately, the same line re-derived visibility as
`domainCited || brandMentioned`, looser than the scorer's rule, so a business
called "Creative Studio" could be shown as "named in this answer" directly above a
score of zero — **the page contradicting itself**. Three regression tests, each
verified to fail against the old behaviour.

Note the honest accounting in that commit: _"This is the same defect fixed in the
audit itself in `reddoorla/reddoor-maintenance#631`; it existed here separately
because this file recomputes rather than reads."_ Two copies of one bug, because
the renderer re-derived what the scorer had already decided.

### The operator as the instrument-prover

Three times in this stretch the _operator_ caught a number the tests did not:

- **08-31 23:22** — "didn't we say we were killing ai visibility as a score?" (it
  had come back).
- **09-03 02:52** — "**is 94 the max readability?**" It was not. The all-pass
  fixture had a placeholder 94 where the scorer's own test pins a perfect site at
  100 (60 JS-dependence + 25 heading structure + 15 schema), "and made the
  check-check-check page look capped". Fixed in `366202d`.
- **09-04 18:27** — "**76 checks 53/67 passing doesn't scan, what's going on
  there**" — three different denominators on one page.

And the all-pass fixture itself was regenerated **five times between 09-04 and
09-05**, because — as `92d25b3` puts it — _"A fixture where everything passes
exercises none of the hard cases: fourteen findings competing for order, a
truncated evidence line, a stage that came back unmeasured."_ Rendering one real
audit locally immediately paid for itself: the report said **"3 rules need a human"
and then listed four**, because the count was a per-page maximum and the names
were a union.

### Calibrating against known-good sites

09-04 → 09-06: `"alright, see if this runs on apple.com"`, then
`"cut noopener, talk to me about the checks apple failed in more detail and see if
you can justify keeping them in the suite"`, then `"would any of these provide
actual value to apple to know? I suspect these things would've been flagged if
they were a real issue with the budget behind that site"`, then `"do you have
another site you'd want to look at as 'known good' to calibrate?"`.

**This is the repo's "prove the instrument before you trust its verdict" rule
being applied to a product rather than to a gate**, and it is the single most
transferable behaviour in the cluster: every check in the battery had to survive a
site that is known to be well built. `apple.com` failing a check was treated as
evidence against the check, not against Apple.

Two guardrails came out of it: `"i think that most sites are going to have this
issue and I'd need you to have strong evidence that it's an actual problem worth
flagging"` (09-05), and `"add the probe forms false switch and use it, we don't
need to be sending off a load of chaff to potential clients"` (09-05) — the audit
was submitting real contact forms on prospects' sites.

### The evidence standard

> "**as an ex-leukemia researcher, in future, always read the methods please.**
> it's always more valuable to know what people did rather than what conclusions
> they drew from it" — 08-27 04:21

> "wait that's the method? **this space's bar for evidence is in hell**"
> — 08-27 05:00

> "you're saying nobody else has directly refuted or tried to test the vercel
> claim? that seems far fetched to me" — 08-27 05:05

> "before we go chasing this down a rabbit hole, **how many sites actually require
> js to see their content? any in our corpus?** … most of the sites are ours and
> pre-rendered on sveltekit, so they would pass fine. hold until I get some test
> sites from tim and erik, we need more data" — 08-27 05:09/05:12

The last exchange is the corpus's own sampling bias caught in real time: the
evidence base for "AI crawlers don't run JS" was 9–13 sites, nearly all of them
Reddoor's own pre-rendered SvelteKit builds, which cannot fail that check. The
commit `fix(report): the methods no longer assert that AI crawlers run no
JavaScript` (09-02) is what that argument cost.

### Cost pressure is a first-class constraint here

Six prompts in this stretch are about money or limits, and they change the
design: `"is there a reason we're using opus? could we go with a cheaper model?"`
(08-25), `"how did sonnet do vs opus?"` (08-25), `"went over spending thresholds
for the api, is there a way to use credits from here we've already paid for … have
an env toggle between this and the actual API usage"` (08-31), `"we're burning a
lot of tokens here, can you do a review to make sure this run will acutally work
please?"` (09-01), `"take 5 representative sites and run"` (09-01),
`"running out of credits this week"` (08-27). Eight prompts across the window are
pure `"hit a session limit, continue"`.

---

## 4. 2026-09-08 → 2026-09-11 — share cards, the portfolio pin, and edit mode

Three parallel threads in one 1,710-minute session, all kicked off by one Discord
message from Tim on 09-08:

> "Two things to get updated on the RD site: 1. Portfolio page. Each project needs
> immediate context. Right now a user has to guess what's going on…" and, on the
> OG image, "**It shouldn't be the PNG of the debossed reddoor logo. It looks super
> cheesy.**"

**OG cards** (#162, #165, #168): satori + `@resvg/resvg-wasm`, a headline registry
and a card-path builder — then the defect below. **`route_meta`** (#163): a Prismic
custom type so code-routed pages get editable meta without a deploy. **The
portfolio pin** (#164, #166, #175, #179): a sticky project title that took
**four rounds of Tim's notes across three days** and eleven commits — bare type,
then a pad, then a translucent disc, then back to bare type, then arrow under the
label, then flush with the nav wordmark, then 48px inside a project / 96px between,
then stopping at Sonder's baseline rather than its container.

The measured end of that: `.archive-title` carried `line-height: normal`, which
Besley resolves to **1.68**. Invisible while the heading was one line; the moment
it broke in two, Tim wrote **"you can drive a semi through the two lines."** Nicole
had it at 125%. Rendered baseline gap, before → after, at each of the five
breakpoints the type scale defines:

```
390/480    67 -> 50   (40px type)
768        80 -> 60   (48px)
1024      101 -> 75   (60px)
1224      121 -> 90   (72px)
1280+     168 -> 125  (100px)
```

The test asserts the _ratio_ at every step rather than a px value, "so it pins
Tim's ratio rather than a number that is only true at desktop." Nicole's verdict
on 09-10: **"ooooohh i like this. no notes."**

**Edit mode** (#181, 09-11) is the last feature of the window: an operator opens
`/audit/{token}/edit`, clicks any uniquely-resolvable line, retypes it, and the
change lands on the live report and on the PDF leave-behind. It is the website
half of a two-repo feature whose other half is `reddoor-maintenance` #762/#765.

---

## The false-green file

This is the highest-value section for the downstream reader. **Every one of these
is a gate or a probe that was green on a question it could not fail**, in a repo
whose parent explicitly holds "prove the instrument before you trust its verdict"
as its first rule. All are MEASURED, from commit bodies and `docs/`.

**1. The a11y suite was structurally blind to the entire landmark and heading
surface.** (`docs/a11y-landmark-and-heading-gaps.md`, found 2026-08-20 while
chasing a flaky smoke test.) The specs scan
`withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"])` — defensible, scoping the
gate to conformance obligations. But in axe-core 4.13.0 `landmark-one-main`,
`landmark-unique`, `page-has-heading-one` and `heading-order` are all tagged
**`best-practice`**, and `duplicate-id` is **`deprecated`**. So:

| Route      | `<h1>` | `<nav>` | `<footer>` inside `<main>` |
| ---------- | ------ | ------- | -------------------------- |
| `/`        | **5**  | 0       | yes                        |
| `/about`   | **0**  | 0       | yes                        |
| `/medtech` | 1      | 0       | yes                        |

Five `<h1>`s on the home page (fragments of the animated hero, the stem repeated
three times), no `<h1>` at all on `/about`, no `<nav>` anywhere. "**None of them
has ever failed CI, and none of them will.**"

**2. Two `<main>` landmarks on every single navigation, for half a second.**
(`cfea1a7`.) `<main id="main-content">` sat inside `{#key data.pathname}`, and
`out:fade` runs 500ms while `in:fade` waits 700ms — so the outgoing and incoming
copies overlapped. Verified by counting `main` across a navigation: it reached 2.
Invisible for the same tag reason as above. **And the fix exposed a second false
green:** _"Six guards in five specs polled `main` opacity to wait out the fade.
`main` no longer fades, so every one of them would have returned 1 immediately and
waited for nothing — quietly removing the protection they exist to provide and
letting axe scan mid-fade."_

**3. Red type on a red ground that axe scored as passing.** (`fb61d08`.) The
report's closing band rendered its rail label in `#D71920` on `#D71920`.
`.bg-paper-red` paints a background-**image** (a watercolour tile) and never a
background-color, so axe's colour-contrast rule resolves the backdrop as
transparent, walks up to `body { background-color: white }`, and **scores the
label as red on white, which passes comfortably.** Caught by eye — Tucker, 08-26
19:10: "red headings on red paper disappear, make sure anything on that bg is
white." The replacement gate reads the computed colour of every leaf inside
`.bg-paper-red` across five real pages and was **verified by reverting the fixture
to the broken state and watching it fail.**

**4. A 502 on every SSR route that the CI gate could not see.** (`91852ec`.) The
first staging deploy carrying `/og/[kind]/[id].png` in the Netlify function 502'd
`/contact`, `/audit`, 404s and `/health`: satori shapes text through harfbuzzjs,
which reads `hb.wasm` from disk at start-up, and Netlify's packager does not ship
that file. **"Prerendered pages, and the CI gate that only looks at them, stayed
green throughout."** Fixed by `prerender = true` (verified: **0 references in
`.netlify/server/manifest.js`**, and the built function answers `/health` 200) —
and the lighthouse workflow now requires the preview's `/health` first, "the check
that would have caught this."

**5. A carousel test that passed without hydration.** (`3d301e9`.) The chrome
reveal is pure CSS (`opacity-0 group-hover:opacity-100`), so hovering takes
opacity to 1 whether or not Svelte has hydrated, and `waitUntil: "load"` says
nothing about hydration — **"hovered and the chrome is visible" was a false
green.** Under a cold Vite compile the subsequent Pause click landed on an inert
button and the failure surfaced a line later as a missing "Play slideshow",
pointing nowhere near the cause. Failed reliably with all four tests in the file,
passed reliably alone.

**6. A 404 guard that would have passed on the wrong page.** (`e69e522`.) The
designed 404 lived under the `[uid]` routes in **three identical copies** and
rendered only when one of those routes matched; a two-segment miss
(`/projects/nope`) fell through to a plain root boundary. Reproduced on production
_and_ staging. The new smoke test asserts **"the designed page's own copy and
title — not '404', which the plain page printed too."**

**7. The prospect report's own instruments.** Covered above: the answered-probe
denominator (a flakier run looked better), the 94-vs-100 all-pass fixture, "3
rules need a human" listing four, 53/67 of 76.

**8. The token was the credential, and two channels logged it.** (`f12e134`.)
`gtag` loads on every page and sends `page_location` from `location.href`, so
every view of `/audit/{token}` put the token into GA4 property data — readable by
anyone with property access, exportable to BigQuery. `stripQueryParams.ts` already
names this exact hazard and four other credential-bearing routes already set
`meta_referrer: no-referrer`; `/audit/` did neither. _"A path segment is strictly
worse than the query param those were written for: stripping cannot help, because
you cannot strip the URL the page IS."_ Same commit fixed WCAG 2.2.2 on the
slideshow: while autoplaying, the pause control was behind `hover` and
`focus-within`, and **touch has neither** — an autoplaying carousel with no
reachable pause on a phone. "Desktop and keyboard both pass, which is why nothing
caught it; axe has no 2.2.2 rule and the suite runs desktop Chromium."

**9. The platform undid a security property, silently.** (`2c1b408`, 09-11.) Edit
mode deliberately lives on a separate path so the address an operator edits at is
not one query string away from the address a prospect is sent. The key is
exchanged for a cookie and the route 303s to the bare path. **Measured on the
deploy preview, the `Location` header still carried `?k=<key>`** — and when a
control marker was added, the 303 came back carrying `?k=<key>&zzzmarker=1`, the
whole original query. Netlify's own trailing-slash 308, which this repo does not
author, preserved it too. **Two redirects, one ours and one the platform's, both
appending.** The client-side `replaceState` scrub is therefore not a second line
of defence — it is the only thing that clears the key. Generalises: _"anywhere in
the fleet that strips a sensitive query parameter by redirecting to a bare path is
not doing what it looks like it is doing."_

**10. Four vacuous tests in the edit-mode feature, three of them the agent's
own.** The plan stubbed `cookies: { get: () => "s3cret" }` — **a getter that
answers to any name**, so the test passes against an implementation reading the
wrong cookie. Proven by mutation: under a wrong cookie name the plan's test stayed
green and only the name-pinning test added afterwards went red. The symptom would
have been `opened_at` silently recording every operator preview as a prospect
read — exactly the signal the header exists to protect, and nothing else would
have contradicted it.

**11. The first end-to-end proof of edit mode was a green-looking nothing.** It
picked `siteChecks.data[0].why`, a key whose text the report does not render — so
"the edited text is not on the page" was true and "the original is not on the page"
was also true, and the run read as a clean _failure of the feature_. **Of 230
candidate strings in the payload, only 145 are rendered at all.** Checking the
precondition (is the original on screen _before_ I edit it?) turns the same script
from noise into proof. _"A probe that does not verify its own subject is on screen
is measuring nothing"_ — and note the direction of the error: **it failed in the
way that looks like a real finding.**

**12. Two things the plan got wrong that would have shipped.** `keyMatches` was
specified with `a.length === b.length &&` under a comment about constant-time
comparison — leaking the configured key's length, and the **third instance of that
pattern in the fleet** after `src/forms/token.ts` and `/api/meeting-outcome`, both
still live. And the plan said to generate `REPORT_EDIT_KEY` with
`openssl rand -base64 32`, but that key travels in a URL as `?k=`, and **base64
contains `+`, which a query string decodes to a space** — so a generated key would
work or fail depending on whether it happened to contain one, and regenerating
would appear to fix it. Hex now, reason recorded in `.env.example`.

**13. A live credential printed into a transcript.** An end-to-end probe printed a
`Location` header without redacting it, putting a live `REPORT_EDIT_KEY` and a
prospect report token into a session transcript. Key rotated within minutes,
rotation verified by fingerprint on both sites. _"A probe that handles credentials
should redact at the point of printing, not rely on the author remembering which
header happens to contain one."_

---

## Process changes made in this repo, in this window

These are the durable outputs, and all three were **operator-initiated**.

**1. `staging` → `main`, with promotion reserved to a human.** Proposed 08-17,
enforced 08-26 after Tucker asked `"have you been pushing to main or working
through staging?"`:

> "flow should be PR->staging->PR->main, and **only I should have the authority to
> promote staging to main. I want a safe space to push wildly to with AI, but you
> need my eyes and review on anything that goes out into the wild**" — 08-26 15:28

MEASURED: PR bases split **32 `staging` / 32 `main` / 1 other**, and `main`'s 27
merges are dominated by six explicit `promote:` / `Promote` PRs (#146 +2,333,
#153 +1,027, #157 +620, #160 +3,094, #178 +6,058, plus #133 the go-live).

**2. Squash-merging promotions permanently diverged the branches.** Promoting
`staging` into `main` by squash meant `main` never contained `staging`'s commits,
so every subsequent `staging` PR carried the whole accumulated diff again. The
visible cost: **#147 was opened at +2,353/−283 and closed; the same change went in
as #149 at +28/−8** once the divergence was repaired. Fixed on 09-02 by #154
(`chore: merge main into staging, ending the squash divergence`), after which
Tucker asked **"talk to me about what we lose by making staging -> main merge
only"** and then **"let's do it, the goal going forward (here and everywhere) is to
build a system where everything goes through staging before it gets to main"**.

**3. CI on `staging`, and the cold-compile flake.** #134 (08-20) added
`ci: run on pushes to staging` and `test(smoke): compile every route before the
workers start`. MEASURED: `staging` is the single most CI-exercised branch at **45
of 153 `ci` runs**. The flake fix is honestly labelled in its own commit: _"this
targets a verified mechanism — those routes were genuinely uncached — but it is an
improvement, not a proven fix. Local measurement here is not trustworthy… CI is
the controlled environment; watch the flaky count there."_ It was still not fully
fixed: on 09-10 a leading spec that did a full `page.goto` at each of seven
breakpoints **took down the promotion PR's `ci/ci` run** with
`net::ERR_ABORTED; maybe frame was detached` after passing locally every time.
Rewritten to one navigation + `setViewportSize` + polling: **2.8s, down from
39.6s**, and re-verified against the defect (with `line-height: normal` restored it
fails at 390 with 67px against the 50px the type scale asks for).

---

## Honest accounting, and what the corpus cannot tell you

- **The 726/701-session figure overstates the work.** Only 39 sessions carried an
  operator turn; 662 were subagent or tool-only. The real unit is 22 working days
  and eleven multi-day sessions.
- **Zero code reviews.** `nReviews: 0` on all 65 PRs. Review pressure came from
  three other places entirely: the `superpowers:code-reviewer` subagent (125
  invocations), Tucker reading previews, and Tim/Nicole/Erik commenting in
  `#rd-website` on Netlify deploy-preview links. That is a real review loop, but it
  is a _visual_ one — nothing in it would catch a vacuous test.
- **The funnel's 25,000-line merge went in unreviewed and unrecorded by CI.** #133
  merged 2026-08-20; the corpus has no Actions runs before 2026-08-22.
- **The prospect report's value is unproven in this corpus.** It was demonstrated
  to Tim and Erik and posted on LinkedIn (Tim, `#rd-marketing`, 08-26: "I also
  posted an AEO/SEO audit offer on LI as a slide show and a reel"), but no send
  volume, no reply rate and no booked call is measurable here. `opened_at`
  instrumentation shipped 09-10; there is no data from it in this snapshot.
- **A win credited to the wrong change.** The 08-20 `test(smoke)` route-warming
  commit was presented as a flake fix and labelled honestly as "an improvement,
  not a proven fix" — and the 09-10 CI failure confirms the caution was right. The
  actual flake fixes were the two later, mechanism-specific ones (hydration gate,
  resize-not-renavigate).
- **The repo's own work journal is thin.** Two entries only: the 09-05 backfill and
  the 09-11 edit-mode entry. The institutional memory for the largest piece of work
  in the window lives in `docs/inquiry-funnel.md` (1,843 lines) and in commit
  bodies, which are unusually long and unusually good. The journal convention
  arrived (09-05, #161) _after_ the two biggest features had already shipped.

---

## Open loops at 2026-09-12

- **Why Netlify appends the query to a 303 to a bare path is still unexplained.**
  Cause not isolated — the sandbox refused to let a dev server bind and the preview
  had a rotated key baked in by the time the question was asked. "Someone should
  still find out why."
- **Three length-leaking token comparisons remain live** (`src/forms/token.ts` and
  `/api/meeting-outcome` in this repo's fleet), deliberately untouched.
- **The website cannot move past `@reddoorla/maintenance@^0.83.0`** — `c9af969`
  (08-25) reverts the 0.87 bump because it breaks CI's a11y job dev server. This
  blocks sharing constants across the two repos, which is why
  `x-reddoor-edit-session` is documented as a **cross-repo contract that degrades
  silently**.
- **Four open issues filed into `reddoor-maintenance` from this repo's sessions:**
  fleet-wide staging→main flow, the dashboard rework ("now this is tim/erik
  facing"), converting the cockpit dashboard to Svelte, and a programmatic
  "design review" tool built from Nicole/Tim/Erik's accumulated notes.
- **`main` was last promoted 2026-09-10 (#178, +6,058/−404 across 71 files).**
  `staging` carries the edit-mode work (#181, merged 09-11) and has not been
  promoted; the checkout sits on `chore/renovate-base-branch-and-slideshow-flake`
  with a clean tree and **8 worktrees / 38 local branches**.
