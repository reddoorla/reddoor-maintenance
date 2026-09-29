# Cockpit design brief — three operators on Turso (#672)

Written 2026-09-29 for the operator to mark up. This is a brief, not a design
and not a plan. Nothing here has been built. Each open question at the end
carries a pick, and the pick is a proposal. Numbers marked [T] come from
read-only SELECTs against Turso on 2026-09-29 (evening UTC). Numbers marked
[S] come from the BACKLOG fleet snapshot taken at 05:36Z the same day.

## What exists today

| Route          | Shows                                                                                                                                          | Reads                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/`            | Verdict bar with "Audit fleet", the Needs-you feed, the browse panel (one card per site), and the Recently, Archived, Cardless and Inbox lanes | `sites`+`site_health`+`site_schedule`, `reports`, `submissions`, `submission_deadletter`, `fleet_events`, `digest_state` |
| `/fleet`       | A sortable, filterable inventory table                                                                                                         | `sites`+health+schedule                                                                                                  |
| `/s/:slug`     | One site: setup, alarms, pending approval, Lighthouse, health, vulnerabilities, reports, details editor, spam, submissions                     | the same tables plus `spam_screenouts`                                                                                   |
| `/submissions` | The lead inbox with facets and bulk mark-read                                                                                                  | `sites`, `submissions` (writes status)                                                                                   |
| `/audits`      | The prospect-audit run form and the recent-audits list                                                                                         | `prospect_audits`                                                                                                        |

- **Shared structure.** There is no shared shell. Each of the five renderers
  carries its own `STYLES`. The cockpit is the only page with a nav bar, and
  that bar holds one link (`/audits`). Every other page has "← Fleet home".
- **Size.** `src/dashboard/` is 6,601 lines today (auth included), up from 5,238 when #672 was filed and 3,135 on 2026-08-25.
- **Roles.** There are none. Everyone on `DASHBOARD_ALLOWED_EMAILS` has full
  operator rights.
- **Recorded identity.** An approval records the constant `"dashboard"`
  (`approve.ts:4`), not who approved it. The audit's `requested_by` is a
  workflow input and is not stored on the row.

## Who does what, and when

- **Tucker, the operator, reads the morning report first, not the cockpit.**
  Since 2026-09-30 the PM pass is the "is anything on fire" scan: 15–20
  minutes, once a day (`operating-model-review-2026-09-29.md` R1/R3).
  - That review's own table calls the cockpit "pull-only. Nothing tells you to
    look."
  - So the cockpit is where the morning report sends him to act: approve a
    report, fill a site field, clear the inbox, re-run a preview.
  - What he needs first is the list of **exact asks**, in the same words the
    PM pass uses ("29 Navy — set `Report recipients (To)` on `/s/29-navy`,
    then approve"). He does not need a fleet-wide verdict he has already read.
- **Tim and Erik** were meant to use `/audits` themselves: pick a site, pick
  a goal, run, send. The data says they have not used it lately.
  - **Volume.** 68 audits over 32 distinct URLs [T]. 66 of them ran between
    08-25 and 09-03, 34 on 09-01 alone, and the last one ran on 09-09.
  - **Follow-through.** 2 reports were ever opened (`opened_at`), 1 was
    edited, and 0 were claimed [T].
  - **Missing columns.** Who ran an audit, which goal it used, and whether
    and when it was sent are not columns at all, so the list cannot show
    them.
  - **Nothing written down.** I found no feedback from Tim or Erik on
    `/audits` in the repo.
- **Anyone looking at a single client** needs the answer to "is this site OK,
  and is anything waiting on us?" `/s/:slug` already has the data for that.
  Its header is the alarm verdict, but the order of sections below it follows
  the order the features were built in.

## What each person should see first

```text
/ (Tucker)                           /audits (Tim, Erik)
┌──────────────────────────────┐     ┌──────────────────────────────────┐
│ Asks · Sites · Inbox · Audits│     │ Asks · Sites · Inbox · Audits    │
├──────────────────────────────┤     ├──────────────────────────────────┤
│ 3 asks                       │     │ [ url ][ business ][ goal ▾ ] Run│
│ • 29 Navy: set recipients,   │     ├──────────────────────────────────┤
│   then approve   [Open]      │     │ site  goal  when  by  sent?  ⟳   │
│ • Reddoor: Prismic ack       │     │ …                                 │
│   expired 08-30  [Open]      │     └──────────────────────────────────┘
│ • Inbox: 329 unread          │
├──────────────────────────────┤
│ Broken 1 · Watch n · Setup n │  ← counts only; each links to /fleet filtered
│ Sweeps: smoke 63h old ⚠      │  ← staleness, since a stale sweep hides everything
└──────────────────────────────┘
```

## Pages: keep, merge or remove

- **Keep `/s/:slug`.** Reorder it to put asks and alarms first, then the
  reports, with the details editor last.
- **Keep `/submissions` as "Inbox".** Take the cockpit's Inbox lane off `/`
  and leave only the unread count.
- **Keep `/audits`, and make it Tim and Erik's front door.** Add the list
  columns that #672 names.
- **Merge the browse panel into `/fleet` and call it "Sites".** The panel and
  the table are two inventories of the same rows.
  - `/fleet` gains the watch-tag filter chips.
  - The `Trigger Renovate` button already lives on `/s/:slug`.
- **Slim `/` down to asks, counts and sweep freshness.**
  - The Needs-you feed becomes the asks list.
  - The verdict bar shrinks to the counts row.
  - The Recently and Archived lanes go to Sites.
  - The Cardless lane stays: those are dead letters, and they are asks.
- **Add one shared shell.** One nav bar on every page, plus shared styles and
  the auth chrome. This is most of the "no navigation" pain #672 describes.

## What the tiers should mean

The fleet is saturated today. The snapshot [S] showed 1 attention, 13 watch
and **0 healthy**. For 8 of the 13 watch sites, "Search Console property not
recorded" (#939) was the only reason. The Search Console writes since then
leave 6 of 15 maintained rows without a property and 5 without GA4 [T]. 8 of
the 15 already carry an accepted watch condition [T]. The tiers have not been
recomputed since those writes.

The cause is in `assignTier`: it puts two different kinds of thing in one
tier.

- **Roster gaps** are facts about the row, fixed once by writing a field: no
  GA4, no Search Console, no git repo, no Netlify ID, no custom domain.
- **Health drift** means the site is getting worse: Lighthouse between 75 and
  85, a last commit more than 30 days ago, Turnstile on but not verified.

**Proposed meanings:**

- **Broken** (today's attention) means something failed and a person must
  act.
  - It gains an **age**. The one attention item in the snapshot, Reddoor's
    Prismic drift, has been there since its acknowledgement expired on 08-30.
    Nothing says so.
  - An item broken for more than N days is itself an ask: fix it, re-acknowledge
    it, or re-tier the rule that raises it.
- **Watch** means health drift only. It stays acceptable through Accepted
  Watch Conditions.
- **Setup** is a new band that does not affect the verdict. It holds the
  roster gaps and shows on `/` as a count and on each card as a checklist.
  `/s/:slug` already has a Setup section, so this moves existing rules and
  adds no new ones.
- **Healthy** means no Broken and no Watch items. A site with Setup gaps can
  still be healthy.
- **Saturation guard.** If one reason puts more than half the maintained
  sites into one tier, the PM pass reports it as a rule problem, not as a
  fleet problem.

## Inline scripts no test executes (MED-18(c))

**What exists.** `AUDIT_SCRIPT` (fleet-render.ts:369), `FLEET_BROWSE_SCRIPT`
(fleet-browse-render.ts:257), `RUN_SCRIPT` (prospect-audits-render.ts:98), and
`SUBMISSION_STATUS_SCRIPT` (submission-view.ts:207, embedded twice). There is
also the roughly 200-line block in render.ts:934–1140 (approve, override,
rerender, trigger, details, commentary), plus two inline handlers.

**How they are tested.** `inline-script-syntax.test.ts` only parses them with
`new Function`. The one test that runs served code is
`detail-value-script.test.ts`, and it runs two fragments against hand-made
stubs.

**Would a port remove them?** A component port (#582's Svelte, since closed)
would remove them. It would also bring a build step and hydration into
Netlify functions, and on its own it would still not test behaviour. The
cheaper route removes the gap without a framework:

1. Move each script into its own `.ts` module that is served as a static
   file. It is no longer a template string.
2. Give each module a happy-dom test that renders the page's real HTML,
   clicks the button, and asserts the `fetch` call and the DOM result.

The merges above also delete two scripts outright: `FLEET_BROWSE_SCRIPT` and
most of `AUDIT_SCRIPT`.

## Open questions for the operator (each with my pick)

1. **Is the cockpit a start page or a place the morning report sends you?**
   _Pick: the place you get sent._ `/` becomes the asks list, worded exactly
   as the PM pass words them.
2. **Should roster gaps leave Watch for a separate Setup band?** _Pick: yes._
   It is the smallest change that makes "healthy" reachable.
3. **Do Tim and Erik actually use `/audits`? No audit has run since 09-09.**
   _Pick: ask them before building anything for them._ Add only the
   `requested_by`, `goal` and `sent_at` columns now, because they are cheap
   and the list is blind without them.
4. **Should Sites (`/fleet`) absorb the browse panel?** _Pick: yes._
5. **For MED-18(c), module files plus DOM tests, or a component port?**
   _Pick: module files plus DOM tests._ Reopen #582 only if the shell work
   shows a real need for components.
6. **Roles, or one flat allowlist?** _Pick: stay flat._ Record the signed-in
   email on approvals and audits instead of `"dashboard"`. If you want a
   different landing page per person, key it by email and skip roles.
7. **Sonder's 245 unread submissions (329 unread across the fleet [T]; the
   cockpit caps its list at 200).** _Pick: out of scope for the rework._ The
   rework shows a count, not a list. Whether to bulk mark-read old rows is
   your call separately.
8. **One rework PR series, or shell first?** _Pick: shell and nav first_ (no
   behaviour change), then the tier split, then the `/` slimming, then
   `/audits`. Each step can be reverted on its own.
