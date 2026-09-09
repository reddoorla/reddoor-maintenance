# Reddoor Maintenance — Work Journal

Running log of build work: what was done, why, and where it landed.
Chronological — newest entry at the bottom. [CLAUDE.md](../CLAUDE.md) holds the
standing rules; `AUTONOMY.md` holds what a session may decide alone; this is the
history of arriving at both.

The convention is in [CLAUDE.md](../CLAUDE.md) under "The work journal": every
working session appends a dated entry, prose over bullets, why over what.
**History is never edited to be right** — an entry that stops being true is
corrected by a later entry that says which one it corrects.

---

## 2026-09-05 — Journal opened, CLAUDE.md brought back into version control, and 743 commits summarised rather than reconstructed (`chore/work-journal`)

Two things land together, and the second is the reason the first is worth having.

**The backfill, and its trust boundary.** The journal starts today, so this entry
is a deliberately coarse summary written from the commit log rather than from
memory. Detail below this line is trustworthy; detail above it is not, and
nothing here should be cited as though someone wrote it down at the time. The
commit log, `CHANGELOG.md` and the specs under `docs/superpowers/` remain the
record for anything before 2026-09-05.

**What this repo is.** `@reddoorla/maintenance` — the central fleet system for
every Reddoor site. It is simultaneously a CLI, a library the sites depend on for
their shared configs and test harnesses, a set of nightly audits, a report
generator and mailer, a Netlify-hosted operator dashboard, and the forms ingest
every site's contact form posts to. 743 commits on `main` from 2026-05-20 to
2026-09-04, currently v0.93.1, with **369 TypeScript source files against 471
test files** — a ratio that is itself a statement of intent for a system whose
failures are mostly silent.

**The eras, from the month counts.** May (193) is the CLI, the recipes and the
first audits, including the Svelte 5 codemods. June (259, the peak) is the
reports pipeline, the dashboard, forms and the fleet cockpit — and the autonomy
docs, i.e. the month the system started acting on its own findings rather than
only reporting them. July (127) is overwhelmingly Blux: `src/blux` is still the
largest directory in the repo at 63 files, more than `src/reports` (43) or
`src/audits` (33). August (135) is the Turso `src/db` layer and more dashboard.
September (29 so far) is almost entirely `prospect`, the external AEO/SEO audit
that scores a site nobody here controls.

**In flight, as of this entry.** `feat/audit-check-battery` is 34 commits ahead
of `main`, pushed, with no PR open — the `prospect` work. The only open PR is
#692, the changeset release, which is human-merge-only per `AUTONOMY.md`. The
Airtable → Turso migration is Phase 5→6: **Turso has been authoritative since
2026-08-31 (`dadb073`)** and Airtable is a swallowed shadow write pending
deletion, deferred on issue #539. Two issues were filed today against naming and
reporting debt that migration left behind — #697 (the a11y audit's pass summary
reports the fixture count, not the routes it actually ran) and #698 (1,835
occurrences of `airtable` in a namespace that now describes the wrong store).

**CLAUDE.md is tracked again, and that is a reversal.** It had been excluded from
version control in `.git/info/exclude` — never committed, no history — because
this repo is public and the file names where the Discord bot token lives, the
guild id, and which members of a client channel are Reddoor staff versus the
client. A rollout session stopped rather than commit it, which was the right call
to make without asking. Tucker's decision today is to track it: reviewed on the
basis that **none of that is a credential value** — the token line says where the
secret lives, not what it is, and the two snowflake ids are visible to anyone in
the server. The `#sonder` staff-vs-client note is the one genuinely
business-confidential line, and it goes public knowingly.

The cost of the old arrangement is what makes this worth recording. The standing
rules for the most complex repo in the fleet existed only on one machine. They
were not reviewable, not diffable, and not present for anyone — human or agent —
working from a fresh clone; every lesson in that file was one `rm -rf` from
gone. The reason to track it is the same reason to keep a journal.

**One thing this session did wrong here, recorded because the journal is for
this.** Earlier today a `git checkout main && git pull` was run in the main
checkout. The checkout failed silently — `main` was already checked out in
`.worktrees/ts-verdict`, and git refuses a second checkout of the same branch —
but the `&&` chain still reached `git pull`, which merged `origin/main` into
`feat/audit-check-battery` and left a merge commit on another session's WIP
branch. Nothing was lost (the merge was clean and orthogonal; that branch's own
files are byte-identical across it), and by the time it was noticed the other
session had committed on top, so undoing it would have destroyed real work. It
stays. This is exactly the collision CLAUDE.md's "never commit from the main
checkout" rule exists to prevent, and it happened by treating a shared checkout
as a place to run a quick read-only command.

## 2026-09-05 — A fleet sweep now asks which repos can take a push, instead of finding out at the end (`chore/fleet-repos`)

Third time. A fleet-wide change is written, committed in every checkout, and
only at `git push` does it emerge that some of those repositories are archived
on GitHub and reject writes — with the work already done and the rollout short
by however many repos it was.

**What makes it recur is that archived is invisible from inside the clone.**
`git remote -v` shows an ordinary URL. `git ls-remote` succeeds. `git fetch`
succeeds. Only the push fails, and only after every commit exists. So the
condition cannot be noticed while there is still time to act on it, and each
session rediscovers it in the same place: the end.

It also gets reported wrongly. Earlier today this session told the operator
`reddoor-mailer` and `the-pointe` had "dead remotes". They do not — both remotes
are reachable and both repos are archived, which from the inside is the same
picture as deleted. The correction matters because the two have different
answers: a deleted repo is gone, an archived one is a decision the operator can
reverse.

`scripts/fleet-repos.sh` answers the question up front. Three of the 39
checkouts on the operator's machine cannot take a commit — `reddoor-mailer` and
`the-pointe` (archived) and `rfp-analyze` (no `origin` at all) — and a sweep
iterates `--pushable` and reports the rest rather than discovering them.

Two implementation notes worth keeping. It issues **one `gh repo list` per
owner, not one `gh repo view` per repo**: three API calls instead of thirty-nine,
3.9s instead of ~40s, which is the difference between running it every time and
not bothering. And it is written for **bash 3.2**, because that is what macOS
ships as `/bin/bash` — the first draft used associative arrays and died on
`declare: -A: invalid option`, which is exactly the kind of thing a script
nobody runs on the operator's own machine gets wrong.

One thing it surfaced that had nothing to do with archiving: the checkout
`welcome-to-the-flower-court` is `tucksravin/invitations`. Directory name and
repository name are not the same thing, and a sweep that assumes they are
addresses the wrong repository. The script maps by remote.

The rule is in CLAUDE.md under "Before a fleet sweep, ask which repos can
receive a push", including the one thing a session must not do about it:
unarchiving a repository to finish a rollout is the operator's decision, not a
step.

## 2026-09-08 — The replay caught the fix, and then caught my fix (`feat/audit-check-battery`, `22e5101`)

The battery branch had been sitting at forty commits with no PR, and the main
checkout carried a 51-line uncommitted patch to `site-checks.ts` whose comment
said it fixed two things: coyote.us and richardmacdonald.com being told their
own pages were missing from sitemaps they were in, and preveta.com's homepage
being counted twice. The question was whether the battery was ready to land.
Answering it meant running the three gates the progress doc had left unticked,
and the gates said something the comment did not.

Running `pnpm lint` in the main checkout reported 1,771 errors. Every one of
them was the same typescript-eslint parser error, and every one named a file
under `.worktrees/` — other sessions' checkouts, which ESLint walks because it
does not read `.gitignore`. In a clean worktree the count was one, and the one
was real: the patch defined a `contentPages` helper that nothing called. The
full suite reported 49 failures, all `listen EPERM` — the Bash sandbox refusing
sockets — and the same eight files passed 96/96 outside it. Neither number was
a finding about the code. Both were findings about the instrument, and the rule
at the top of CLAUDE.md is that the instrument is the suspect until it has
passed once.

The corpus replay then reported zero verdict changes from the patch. That would
have been the end of it, except the dumps on disk showed coyote.us still at 46
missing and richardmacdonald.com still at 52 of 52 — the very numbers the
comment claimed to fix. The reason was one function. `sitemap-coverage` never
called `norm2`; it keyed URLs with its own `u.replace(/\/+$/, "").split("#")[0]`,
which keeps scheme, `www.` and percent-encoding, so a sitemap listing `http://`
against an `https://` crawl matched nothing. The patch had changed `norm2` to
decode percent-escapes and written a correct comment about scheme being ignored
"by construction" — of a function the check did not use. The fix described was
right; the diff had never reached the place it needed to be.

So the patch came out and the work went in test-first: five sitemap cases
(scheme, `%26` against `&`, `www.`, a noindex link, a canonical alias), four
content-page cases (an alias counted once, noindex excused from headline and
description, an all-noindex site reading not-applicable), and four guards for
what must not change. Nine red, four green, then the implementation. Every
check that compares URLs now goes through `norm2`; `contentPages` folds an
alias and drops a page the site hides from search; `meta-noindex` still reads
every page; a page whose `metas` were never captured is kept, because dropping
it on a guess would silence a real finding to hide our gap.

Then the replay caught that version too. It reported four reversals, and one of
them was sapidyne.com's `description-length` flipping to "all 1 are between 40
and 200 characters". Sapidyne declares `/` as the canonical on 19 of its 20
pages — each with its own title and its own headline. That is the defect
`canonical-self` exists to report, not aliasing, and folding on the declaration
alone had measured the whole site as one page. The belief that went wrong was
simple to state once it had failed: a page that says it is another page is not
therefore that page. Two more red tests for the mis-declared shape, and the
rule became `sameDocument` — a page folds only onto a page we read that reads
the same, title, description and headline all agreeing. `byDeclaredAddress`,
which folds on the declaration, is still right for the checks that compare
pages to each other, because those guard with "skip if fewer than two remain";
it must never feed a per-page check, and now nothing per-page calls it.

The replay after that: zero new fails on old evidence, three reversals — icovy
`h1-present` (17 pages counted: `/old-home-2` is a true alias of `/`, three
pages are noindex), revogen `sitemap-coverage` (12 linked became 11, a query
variant folded), thepointeburbank `sitemap-coverage` (a one-page crawl whose
homepage the sitemap listed under another spelling) — and one new claim,
sapidyne `h1-distinct`: fourteen pages carry one tagline as their headline, and
had never been compared because the fold hid them. Each was read against the
dump before it was accepted. reddoorla.com live, before and after: the same
eleven fails, zero unmeasured, all real — the first live run in this branch's
log that found no instrument bug. The website's all-pass fixture, regenerated
and diffed: 76 = 76.

Two things about the instruments are worth carrying. The replay compares
status only, so "nothing changed" means no verdict flipped, not that a change
did nothing — read `--key <check> --fails` for evidence. And the disk corpus is
the one to replay: the database rows predate `metas`, `links` and `scriptSrcs`,
so a replay over the database exercises half the battery.

Honest accounting. Earlier the same session, two fleet repos had sat red for
five days on Dependabot alerts filed against a `package-lock.json` deleted in
June — GitHub's dependency graph keeps a manifest after the file is gone. Both
were dismissed as inaccurate and #702 asks the security audit to tell the two
apart. The reddoorla.com run also surfaced a real content bug on our own site:
an internal link to the old UID `/portfolio/strategy-advantage-website`, which
serves 200 beside `/portfolio/strategy-advantage1` with no canonical on either,
and no canonical anywhere on the site. The CSP preconnect logged on 09-03 is
still unfixed. Left open from the same replay table: sapidyne (37 "missing" →
`/uploads/1/…`) and theburbankstudios (90 → `/api/…`) count files and endpoints
as pages a sitemap must list — the next false accusation in this check.
`title-length` was not scoped into `contentPages`. `favicon-declared` reaches
no verdict on any corpus site, by design. T3-08, T4-15 and screenshots remain
the operator's calls.

Landed as three commits on the branch (the fix with its tests and changeset,
the `.worktrees/` eslint ignore, the progress doc), `origin/main` merged in
taking main's `CLAUDE.md` over the branch's stale copy, and PRs opened on both
sides — the website's renderer into `staging` as reddoor-website#167. The
patch in the main checkout is superseded and can be discarded.

## 2026-09-08 (later) — the next false accusation, and the two behind it (`fix/sitemap-counts-files`)

The previous entry closed by naming what to fix next: sapidyne.com told its own
37 pages were missing from its sitemap, theburbankstudios.com told 90, and both
lists made mostly of files. That was right about the symptom and short by two
faults.

Reading the lists rather than the counts is what found them. Sapidyne's 37 are
`/uploads/1/1/8/8/118887362/…` — technical notes, handling guides, a price
list, product photographs — and theburbankstudios' 90 are `/api/media/file/…`
and `/images/floorplans/…`, stage plans and building photographs. A sitemap
lists pages. The rule that replaced "every address a link points at" is an
allow-list of page extensions rather than a deny-list of file ones, because the
two fail in opposite directions: an extension we did not think of reads as a
file and is quietly excused, which costs a finding, where a deny-list would
read it as a page and demand a stranger list their `.dwg`. Missing our own gap
beats printing their fault.

The second fault was one level up, in the crawl. `parseSitemapLocs` allows an
optional namespace prefix on `<loc>`, which is correct for a sitemap that
writes `<sitemap:loc>` and wrong for `<image:loc>` — the image extension that
Squarespace, Wix and Yoast all emit inside each `<url>`. Eleven of the 29
corpus sites carry them. vascularperfusion.solutions lists thirteen pages and
sixty images, and the row we would have shown them read "73 URLs listed". The
count is the evidence in that sentence, so the sentence was false. The image
namespace is the only sitemap extension that defines a bare `loc`, so excluding
it by name is the whole fix.

The third sat between the two. The alias fold added last week runs on the
linked side, folding a page onto the one it is a confirmed alias of — but the
sitemap side was still keyed raw. Squarespace serves a homepage at `/` and at
`/home`, both declaring one canonical, and lists `/home`. So the entry that
lists their homepage never met the address their own links point at, and we
told them their homepage was missing from their own sitemap. Both sides fold
through one map now. And `title-length` was still measuring every page we read
while `description-length` measured the pages the site publishes: two checks
reading the same field, disagreeing about which pages exist.

Seven tests, five of them red first — a linked file, a sitemap-listed alias, a
noindexed title, an alias counted once, an `<image:loc>` — and two guards
written to stay green: a page served under `.html` is still demanded, and a
title too short on a page the site publishes still fails. The three guards
already in the file kept holding.

What the instruments said. The corpus replay: **0 new fails on old evidence**,
six reversals, one new claim — three of the reversals and the claim carried
over from the previous pass, three of them this change, all fail→pass.
sitemap-coverage went eight fails to five, coyote.us 45 → 1 and sapidyne.com
37 → 2. Each survivor was read against its dump: richardmacdonald.com's
`/love`, `/courage` and `/joy` are crawled pages absent from a 32-entry sitemap,
gallerysonder.com's three `/rsvp/*` are linked and unlisted, reddoorla.com's is
the stale UID we already knew. All real.

The replay could not judge the parser, and saying so is the point. It re-scores
checks over stored crawls, and `urlCount` in those crawls was computed by the
old parser at crawl time — a crawl-layer fix is invisible to it, and a green
replay would have meant nothing. Proven on live sitemap bytes instead:
vascularperfusion.solutions 73 → 13, thepointeburbank.com 52 → 1, and
reddoorla.com 49 → 49. That last one is the one that matters, because an
instrument that only ever changes numbers has not been shown to leave a good
sitemap alone.

reddoorla.com live: the same eleven fails, zero unmeasured, `title-length`
reading "all 20". The website's all-pass fixture regenerated to 76 checks with
nothing failing and no key drift, so it needs no change.

Left open. `sapidyne.com/store/checkout` is a Weebly checkout, linked and
unlisted, and we call it a missing page — literally true and close to useless.
The clean fix belongs to the site, which should noindex it, and that is what
the well-configured stores in the corpus do; a heuristic guessing which paths
are functional would be a worse instrument than the one it replaced. The three
decisions that had been the operator's are now settled and recorded in the
progress doc: T3-08 dropped, T4-15 to be a marked test payload behind a per-run
flag when it is built, and screenshots to be a Turso BLOB rather than base64 in
`result_json` — Airtable's attachment URLs, the other candidate, are signed and
expire, and a prospect opens their report weeks after we send it.

## 2026-09-08 (later still) — A recipe that could not run on a new site, and two gates that granted greens from absences (`feat/prismic-ci-positional-and-launch-guard`)

Plan E Tasks 1–6, executed to open the PR. Sixteen commits. The code is small;
almost everything worth recording is what the reviews found, because five of the
seven defects on this branch were introduced by the plan itself or by the fixes
for earlier ones.

**The actual bug.** `reddoor-maint prismic-ci <path>` had never worked. The
positional inventory provider builds `{ path, name }` and nothing else
(`src/inventory/local.ts:11`), the recipe read `site.gitRepo` directly, so every
positional run refused with "no Git repo on this site". A site being bootstrapped
is precisely the case with no Airtable row — `--fleet airtable` filters
`building` and `launching` out — so the only path `/new-site` could use was the
one that did not work. `self-updating` had already solved it with a private
`resolveRepo`; that is now the shared `resolveOwnerRepo` in `src/util/git.ts`,
byte-identical in the move (verified by diffing the two bodies, not by reading
them).

**The message that told operators to do two impossible things.** Both callers
reported a `null` identity as "no Git repo (set Airtable 'Git repo' or add an
origin remote)". An origin of `git@github.com:espada.git` — owner omitted —
resolves to `null` **without throwing**, via `parseOwnerRepo` returning null for
fewer than two segments rather than via the catch. So the operator is told to add
an origin remote they already have, and to set an Airtable row a pre-launch site
does not have. Both callers now say the identity could not be **determined**. The
second caller was found only by grepping for the string after fixing the first —
the class rule working exactly as written.

**A claim corrected in one direction, then in the other.** Five comments across
four files said Renovate's github-actions manager bumps the installed
reusable-workflow pin. The plan's replacement said Renovate has **never** done
so. That is false: 17 site repos took v1.2.0 → v1.3.0 in the weeks after that tag
(`reddoorla/espada#40` is the diff, on a `renovate/all-minor-patch` branch). The
search that produced "never" was `--author app/renovate`, which returns zero rows
because Renovate is self-hosted here and its PRs are authored by the operator
before 2026-08-02 and by `reddoor-renovate[bot]` after — a well-formed query, no
error, confident empty set. The shipped claim is the narrow true one: it bumped
this ref before, proposed neither of the last two tags, so propagation must be
verified rather than assumed. A supplied "verified fact" about the author name
was itself stale by the same mechanism and was caught during implementation.

**Both new launch gates granted a green from an absence.** This is the part worth
re-reading later.

`dev-guard` refuses to draft while a site's `/dev/match` twin is live, by
requiring `/dev/match/home` to answer 404 with the site's own error page. The
unguarded twin answers 404 for **any uid absent from its assembly map**, through
the same `+error.svelte`. On a site whose uids do not include `home`, the check
could never fail — guarded or not. Closed with a deny clause on the route's own
"no assembly for" message; a deny can only ever refuse, so widening it is safe.
The deny's wording is itself a weak coupling to a string in another package's
template, recorded as #719 and commented at both ends.

Its liveness control was `/dev/a11y-fixtures`. The premise (every native site
ships it) was true and the conclusion was still wrong: it made the gate depend on
an unguarded dev route being publicly reachable, so the fleet-wide fix for
dev-routes-in-production would have deleted the control and failed every launch.
Moved to `/health`. That reversal is the most transferable thing here — the
premise was never the problem.

Then the same shape turned up one layer down, in the fix's own sibling.
`matchingDisposition` ANDed three greps across a whole file, so a twin needed
only an `$app/environment` import and a non-refusing `if (!dev)` to pass while
fully live — and Beachfront's real twin already carries `error(404` for its own
unrelated reason, leaving exactly one missing import between it and a false pass.
It now extracts the actual consequent of each `if (!dev)` and tests only that.
It also rejected the very `src/routes/dev/+layout.server.ts` guard that the
`/health` move had been made to accommodate: one half of the feature hardened for
a fix the other half refused.

**Numbers, exactly.** `pnpm verify` exit 0, 6310 passed / 4 skipped across 479
files, against a 6282-test baseline at `969c6cb`. Five instances of the Renovate
claim removed, one deliberately kept (`prismic-ci/template.ts:38` is true — the
manager does _read_ a `uses:` tag). 54 of 55 `/dev` routes across 23 repos ship
unguarded (#717).

**Two honest limits on what shipped.** The comment stripper under-strips a regex
literal containing a quote, and the literal masker then blanks the same region —
two bugs cancelling, so that shape now produces a false _negative_, blocking a
launch on a correctly guarded file. Stated as such in the code rather than
claimed as a direction guarantee. And `matchingDisposition` remains a source
check named as one; it cannot observe the deployed build, which is what
`dev-guard` is for.

**Issues opened rather than fixed here:** #712 (identity provenance), #713
(push target vs PR target), #717 (unguarded dev routes), #719 (machine-readable
tell), #723 (gate coverage gaps), #724 (a third owner/repo validator). #714 was
opened and closed by me the same night — its premise, that a v1.4.0 pin was
stale, evaporated once I compared the tags and found v1.4.1 touched only
`ci.yml`.

**Not merged by the agent that wrote it.** The plan marks the merge GREEN tier.
Seven claims between this session and a concurrent one turned out wrong tonight,
two of them corrections to corrections, and this package is what ~30 client repos
build against. The PR is open for a human.
