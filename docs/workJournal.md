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

## 2026-09-09 — match-harness reported "applied" for an install git silently dropped (#733)

`matchHarness` writes 17 template files and appends a marked block to three more
— 20 installed paths, 13 of them under `matching/`, 4 under `src/` — and commits
the lot through the shared `commit()` in `src/util/git.ts`, which stages with
`git add -A`. `git add -A` honours the site's `.gitignore` and exits 0 either
way, and git cannot re-include a file whose **parent directory** is excluded. So
on a site whose committed `.gitignore` already carries `matching/`, I measured:
13 of the 20 paths on disk, **0** of them in the commit, `git add -A` exit 0,
`git commit` exit 0, and a `RecipeResult` of `applied`. Nothing in the recipe
observed what landed. What the operator was left with is worse than nothing: a
`/dev/match/[uid]` route and a `src/lib/site-pages.test.ts` that DID commit, and
83 lines of CLAUDE.md rules instructing the next agent to run `matching/gate.sh`,
`matching/next.mjs` and `matching/harness.json` — files that existed on one
machine and on no other clone, CI runner or agent.

Measured, one rule at a time, against a real repo (site rule first, then the
recipe's own appended block, then `git add -A && git commit && git ls-tree -r`):
`matching/` drops 13; `**/matching/` drops 13; `/matching` drops 13;
`src/routes/dev/` drops 2; `*.test.ts` drops 1; `src/lib/site-pages.js` drops 1;
`CLAUDE.md` drops 1; `*.md` drops 3.

**The belief corrected on contact.** The class as it was handed to me included
`*.sh` and `*.mjs`. Both install correctly — measured 0 of 20 missing. The
reason is the recipe's own block: it appends `matching/*` followed by
`!matching/*.sh` / `!matching/*.mjs`, which come AFTER the site's rule (last
match wins) and, crucially, the `matching` directory itself is not excluded, so
git still descends into it. That is exactly why the pre-write ignore preflight I
designed first — `git check-ignore` in `plan()`, before a byte is written, which
is the friendlier failure and leaves zero residue — was built, tested and
abandoned: it would refuse two configurations that work. The question "will git
take this?" is only answerable after the final `.gitignore` exists, which is
where the check now lives. There is a negative-control test for this
(`a site-wide *.sh / *.mjs ignore is NOT the defect`) whose only job is to go
red if someone re-adds that preflight.

**The recipe's own block is a member of the class.** `!matching/*.md` does not
reach a nested path, so a site-wide `*.md` shadows `matching/spec-sections/_chrome.md`
and `_header.md` — two of the record stubs the recipe itself ships — plus
`CLAUDE.md`. That is the 3 above.

**Why FAIL and not FLAG.** A note would have left exit 0:
`src/cli/commands/match-harness.ts:74` turns only `status === "failed"` into
exit 1. A flag on a half-install that ships CLAUDE.md rules for absent scripts is
the same defect one step along.

**Why the manifest and not this run's writes.** A re-run over an unfixed site
re-writes everything, so "run it twice" does NOT discriminate — I checked, and a
delta check stayed green on it. The case that separates them is the one an
operator actually reaches by hand-copying a harness from another site (which is
how it arrived at beachfront-dentistry): every `matching/` file already
byte-correct on disk, so `planFileWrite` returns `skip` for all 13 and the run
writes NONE of them. A delta check finds nothing missing and reports a second
hollow "applied" over a commit that contains none of them. The manifest check
still refuses. That test — "refuses when the files are ALREADY on disk and
ignored" — is the only one of the seven that reddens when the check is switched
to `written`, and it is the reason the check is derived from
`MATCH_HARNESS_FILES` + `APPENDED_BLOCKS` rather than hand-listed.

**Positive evidence, both halves.** `pathsMissingFromHead` counts a path as
installed only when it is FOUND in `git ls-tree -r -z --name-only HEAD`; a git
failure yields an empty tree, so an error can only ever DENY. The half that is
easy to skip is the grant, so both halves were mutation-measured rather than
predicted. Neutering the guard so it never fires reddens 6 tests and leaves BOTH
positive controls green — which is exactly the hole a guard proven only to
refuse leaves open. Making the primitive refuse everything (`return [...paths]`)
reddens 21, including "every installed path is in HEAD's tree after a clean
install (the guard GRANTS)", "installs for real once the ignore rule is gone",
"a site-wide \*.sh / \*.mjs ignore is NOT the defect" and all 15 pre-existing
tests in the file. Only that second mutation proves the guard can say yes.

Two numbers I wrote into this entry before running the mutations were wrong and
are corrected above: I had "19 tests" (it is 21) and "all five refusal tests
would stay green" under that mutation — in fact two of the five go red, for the
wrong reason (over-refusal changes the notes they assert on), and three stay
green. Both came from copying predicted counts instead of measuring.

Also worth not walking twice: the obvious way to write the delete-the-guard
mutation, `if (false && missing.length > 0)`, does not fail the tests — it fails
`pnpm build`, because TypeScript drops control-flow narrowing inside statically
unreachable code and `prev` widens back to `string | null | undefined` at the
`writeFile` call. vitest's globalSetup rebuilds `dist` when it is stale, so a
mutation that does not type-check produces "No test files found" and zero named
failures. `if (missing.length < 0)` is the mutation that actually runs.

Two mechanics worth not rediscovering. `git ls-tree` **without** `--full-tree`
is prefix-relative to `cwd` (measured: from a subdirectory it prints
`inner/deep.txt`, with `--full-tree` `sub/inner/deep.txt`), which is what makes
the comparison correct if `site.path` is ever a repo subdirectory — do not add
the flag. And `-z` is load-bearing for non-ASCII: without it `ls-tree` prints
`"caf\303\251.txt"`, which would read as missing.

**Refusing does not leave the site dirty.** `withRecipe`'s failure path
force-checks-out the operator's branch and deletes the recipe branch, which
cleans up everything git _tracked_ — but these paths are ignored, so git does not
know they exist. The refusal therefore puts back, itself, every path this run
wrote and git then refused: prior content restored, or the file deleted if we
created it from nothing, then `rmdir` (deepest-first, non-empty refused) on the
directories that leaves empty. Asserted with a `shasum` snapshot of every file
before and after. Deliberately narrow: a file the operator already had on disk
that git refuses is left alone — it was there before the run.

**What this does not cover, and is not fixed here.** The check is presence, not
content: a path in HEAD with the wrong bytes passes, because `planFileWrite`
already owns content. `commit()` is shared, so every recipe that creates a NEW
path has the same shape available to it — I did not enumerate which others create
paths a site plausibly ignores. `withRecipe` still returns `commits: [sha]` on
the failed path for a commit `restoreAfterFailure` then deletes with the branch;
`formatResult` does not print commits for a failure so nothing user-visible lies,
but a programmatic consumer gets a dangling SHA. On a detached HEAD `withRecipe`
captures `original = null` and skips the restore entirely, so the half-install
commit stays on the maint branch (the result is still "failed" with full notes).
And `git()` uses `execFile`'s default 1 MB `maxBuffer`, shared with the existing
`listTrackedFiles`: on a site whose HEAD tree exceeds that, `ls-tree` rejects and
the guard refuses a good install. Fail-closed, but a false refusal. All four are
pre-existing or out of this PR's scope; none is fixed here.

No change was needed in `beachfront-dentistry`. I re-ran
`node scripts/gen-match-harness-template.mjs` against its `main` after the fix
and `git status` stayed clean — regeneration is still a no-op.

## 2026-09-09 — PR #733's census.sh shipped a green nobody measured (#733, `feat/match-harness-recipe`)

> Superseded in part by 2026-09-09 (last) — Verification found the eighth member of the class.

`matching/census.sh` is one of the seven files this recipe copies **verbatim**
into every site it installs, and #733 had 26 tests over it, none of them
touching census. It reported `Phase 3 CLEAN — 0 undeclared type mismatches` and
exited 0 without measuring anything. Seven ways, all measured on the unfixed
template: `style-census.mjs` absent; present but crashing; present but silent;
both pages rendering zero text runs; a typo'd page argument; an empty `pages`
table; and `census-count.mjs` failing its own import of `census-deviations.mjs`.
Five of those are now vitest cases that were watched red first, printing that
exact sentence; the other two were measured by hand in a scratch tree, because
they have no test and I would otherwise have been asserting them.

The blast radius is the reason this was a blocker rather than a bug. Every site
the recipe installs gets this file, and the failure is silent in the flattering
direction — the gate that catches the 11px footer line and the cyan-vs-teal link
that the pixel diff is structurally blind to, answering "clean" because it never
looked.

**The fix went into the source, not the copy.** `template.ts` is generated by
`scripts/gen-match-harness-template.mjs`; the edit is in
`beachfront-dentistry/matching/{census.sh,census-count.mjs}` on its own branch
(`fix/census-sh-vacuous-clean`, `133d5cb`, unpushed) and `template.ts` was
regenerated. The check that made this safe was done **first**: regeneration from
beachfront `main` 29bb4d2 against the committed `template.ts` was a byte-for-byte
no-op, so every hunk in the resulting diff is attributable to this change and
nothing else. It landed in exactly two constants — `CENSUS_SH_TEMPLATE`
(330-423 in the committed file) and `CENSUS_COUNT_MJS_TEMPLATE` (925-983) — six
hunks, none outside. That check is a stop condition, not a formality: anyone
regenerating from a stale beachfront clone silently reverts this fix while the
generator cheerfully prints `17 files, all round-trip verified`.

**A belief corrected on contact.** The reviewer's suggested shape was
gate.sh's preflight — compare `page-diff --version` against `REPORT_SCHEMA`
before spending a run. It does not transfer: `style-census.mjs` has no
`--version` at all. `page-diff.mjs:191-195` defines one; nothing in style-census
writes one, and adding one would put this recipe's correctness inside the
`matching-a-page` skill's release cycle, in a repo neither this PR nor the sites
control. The substitute is style-census's own usage banner
(`style-census.mjs:151-157`), and it is better than a version string here
because `import { chromium } from "playwright"` at `style-census.mjs:19` runs
before it — so a skill checkout with no browser dependency fails once, in the
preflight, instead of writing 27 crash logs that every reader downstream counts
as zero.

**The mutation evidence, named, because a guard proven only to refuse is not
proven.** Each mutation applied to the generated template, at a site verified to
be inside the constant under test, then the file restored:

| mutation                                    | result                   | reddened                                                             |
| ------------------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| GUARD 2 per-run evidence check → `if false` | 2 failed / 32 passed     | refuses when every run died; refuses two pages that rendered no text |
| GUARD 3 `$ROWS` check → `if false`          | 1 / 33                   | refuses a page name that matches nothing                             |
| `done < <(pages)` → a pipe                  | **5 failed / 29 passed** | including **reports CLEAN when the census ran and found nothing**    |
| GUARD 1 `-f "$SC"` probe → `if false`       | 1 / 33                   | refuses when style-census.mjs is not installed at all                |
| GUARD 1 banner `case` arm → `*)`            | 1 / 33                   | refuses a style-census that will not answer its usage banner         |
| counts regex `[1-9][0-9]*` → `[0-9]+`       | 1 / 33                   | refuses two pages that rendered no text                              |
| restore census-count's `0 0 0` catch        | 1 / 33                   | census-count.mjs refuses a log it cannot read                        |
| `TOTAL=$((TOTAL + n))` → `+ 0`              | 1 / 33                   | still fails on the mismatches a completed census found               |

Two of those are worth reading twice. Neutering the per-run evidence check
returns the crash case to `Phase 3 CLEAN` exit 0 — it reproduces the reported
blocker exactly, which is the strongest thing I can say about the guard. And
turning the loop's process substitution into a pipe reddens the GRANT case,
because every counter then dies in a subshell and GUARD 3 refuses a census that
actually ran. Without a case that asserts the guards say **yes**, that
regression would be invisible and would look like a working gate.

Two mutations exit 2 either way. Deleting the `-f "$SC"` probe still exits 2
(the banner probe catches it, with a different message); widening the `case` arm
still exits 2 (it falls through to `CENSUS INCOMPLETE`). A case asserting only
the exit code would pass under both, which is why each asserts its own message
**and** the absence of the other refusals.

**Found here, not fixed here**, both filed rather than left as notes: census.sh
honours no `matching/PAUSED` switch while `next.mjs:25-30` and
`strikes.mjs:36-42` do (#735 — beachfront has been PAUSED since 2026-09-01, so
running it there today would spend 27 browser-pair runs during a declared
pause); and the recipe's installed `CLAUDE_MD_BLOCK` documents gate.sh, next.mjs
and strikes.mjs and never mentions census.sh at all, so Phase 3 arrives on a
fresh site with no rule and no operator's challenge (#736).

**What this does not cover.** A run that completes and lies. A style-census that
walks both pages but silently drops half the DOM writes a perfect header and
counts line and is granted. These guards prove the tool RAN, not that it looked
at everything; region-count parity would be the next rung and is out of scope.
The two greps are also a real coupling to the skill's output format — if a
future style-census reformats its counts line, census.sh refuses every run and
exits 2. That is the correct direction to fail and it is loud, but it will read
as a false alarm, and the fix then is to update the greps, not delete them.

## 2026-09-09 (later) — match-harness ran an unbounded `pnpm exec` inside every fleet clone (#733, `feat/match-harness-recipe`)

The recipe's format step called `formatWithPrettier(deps.spawn, cwd, toFormat)`
with neither `bin` nor `timeoutMs`. `_prettier.ts:90-94` turns that into
`pnpm exec prettier --write …`, and `src/audits/util/spawn.ts` sets `detached`
(line 91) and installs its kill timer (line 136) only when `timeoutMs` is
present — so it ran with no timeout, no process group, and nothing to kill.

**The fleet is the normal input here, not an edge case.** `prepareFleetSites`
calls `cloneIfNeeded`, and `grep -rn 'pnpm\|install' src/cli/fleet/clone-if-needed.ts`
exits 1 — the file contains neither token. A cloned site has no `node_modules`.
Recorded from the pre-fix code against a fixture with none, the recipe's single
spawn was `cmd: "pnpm"`, `args: ["exec", "prettier", "--write", …8 paths]`,
`opts: { cwd }` — no `timeoutMs` key at all. That is an unrequested full install
in a live client repo, which is also how a swept `pnpm-lock.yaml` would have got
into the recipe's commit. And `_prettier.ts:44-58` already records what happens
next in a repo that does not depend on prettier: `pnpm exec` falls through to
the CALLING repo's binary and exits 0, reporting success for a format the target
never did — the false green this project's first rule forbids.

The fix is `prismic-ci`'s, line for line (`src/recipes/prismic-ci/index.ts:285-294`):
resolve the target's own prettier POSITIVELY with `resolveTargetPrettier(cwd)`,
run it by absolute path under `PRETTIER_TIMEOUT_MS = 60_000` (the same budget as
`prismic-ci:41` and `src/prismic/models/write.ts:328`), and when it resolves to
null push the flag note and spawn nothing. Skip-with-a-note was chosen over
"install then format" because installing is an unrequested mutation of ~20 live
client repos, and over "format anyway" for the reason above. `resolvePrettier`
is injectable on `MatchHarnessDeps` exactly as on `PrismicCiDeps`, because
without it the new cases could only be written against a fixture with ~20
devDependencies installed.

**Two existing tests were measuring the wrong thing, and one would have gone
green while doing it.** The real-prettier cases from the ownership fix earlier
today (`a site whose prettier config differs…`, `puts every recipe-owned file in
the site's .prettierignore…`) run against `foreignPrettierSite()`, which has no
`node_modules` — after the fix nothing would have formatted, and their positive
control (`site-pages.js` comes back rewritten) would have failed outright. They
now inject the stand-in bin. Worse: `flags — but still commits — when the site's
prettier cannot run` would have kept PASSING, because the skip path raises the
same note — it would have measured "prettier was absent" under a name claiming
"prettier ran and failed". It now injects a bin too and asserts the spawn
happened, so the two paths are distinct cases.

**Grant-side evidence, since a guard proven only to refuse is not proven.** Two
of the five cases are grants: one asserts the spawn HAPPENED with the resolved
absolute `cmd`, `--write` first, no `exec` argument, `cwd` = the site,
`timeoutMs` = 60_000, status `applied` and NO flag note; the other injects
nothing and asserts the production default spawns the exact `realpath` of the
prettier inside that checkout. Without the second, the rest would prove only
that the injected fake is wired up. Two constraints found by running it: the
`node_modules` case must commit a `.gitignore` first or `withRecipe`'s
`git status --porcelain` check throws on the untracked directory, and the
expectation must be `await realpath(…)` — `mkdtemp` hands back `/var/folders/…`,
which on macOS is a symlink to `/private/var/…`, and `resolveTargetPrettier`
returns the realpath.

**The honest cost.** Every fleet site now carries the prettier flag note,
because a fresh clone has nothing to run. That is the intended outcome and it
must not be "fixed" by suppressing the note — the exposure is bounded (the
formatted set is only the site-owned records plus CLAUDE.md, all shipped
prettier-clean), and the operator reads CI's format job per site instead. A
`true` from this step also now means less than it looks: "the binary at
`<repoRoot>/node_modules/.bin/prettier` exited 0", not "the files match the
site's CI config" — a stale `node_modules` formats with a stale prettier and
still reports true. `prismic-ci` guards its analogue with a byte re-compare;
match-harness cannot, because its formatted files are expected to change.

**Found here, not fixed here.** The defect class is three call sites, not one:
`grep -rn formatWithPrettier src/` gives `match-harness/index.ts` (fixed),
`health-endpoint/index.ts:83` and `smoke-suite/index.ts:224`, all three omitting
both options. Both siblings are equally fleet-reachable —
`src/cli/commands/health-endpoint.ts:37,42` and `smoke-suite.ts:37,42` call
`prepareFleetSites` then `runRecipeOverSites`, the same two lines as
`match-harness.ts:42,65` — so they run the identical unbounded `pnpm exec` in
every cloned client repo today, on `main`. Filed as #737 rather than folded in,
because
each needs its own mutation-proven surgery and stacking two unrelated recipe
fixes into a draft feature PR is the batching mistake this file already records.
(`src/cli/commands/prismic-models.ts:842` is NOT an instance: it forwards
`fmtOpts`, and `src/prismic/models/write.ts:563` supplies both.) Also:
`_prettier.ts:60-64` says timeoutMs-omitted is "the historical behaviour of this
helper's two recipe callers" — that sentence was FALSE on this branch, where
three callers omitted it. This fix makes it true again by coincidence, and
fixing the two siblings will make it false the other way; whoever does them
should correct the sentence in the same PR.

**What no test here covers.** The swept `pnpm-lock.yaml` is closed _causally_ —
nothing is spawned in the target at all, and one case asserts `calls` is `[]` —
not by an assertion on the committed file list. A `not.toContain("pnpm-lock.yaml")`
would be vacuous against a faked spawn and would pass on the pre-fix code too;
reddening it honestly would need the real `defaultSpawn` to run a live install
inside the unit suite. Recorded rather than papered over. And
`resolveTargetPrettier` collapses EACCES to null, so "I could not look" and
"the site has no prettier" raise the same note.

## 2026-09-09 (later still) — the guards ran for the first time; 5 of checkRef's 8 arms were removable at once (#733, `feat/match-harness-recipe`)

An adversarial review of #733 reported that of 35 mutations it applied, 25
reddened nothing. I reproduced the ones this entry is about, and the shape of
the finding held: everything the branch had proved was that the recipe **copied
bytes** and that three installed scripts **refuse**. A refusal-only suite cannot
tell a working guard from a guard that refuses everything, and it had never once
touched the two guards with the largest blast radius.

**The measurement, in one line each.** Deleting `if (!dev) error(404, { message:
"Not found" });` from the shipped route template and regenerating left the ENTIRE
suite green — 6358 passed / 4 skipped, nothing red. Removing five of `checkRef`'s
refusal arms together (selfHosts, non-200, Location, missing refMark, candMark)
also left the entire suite green: 6358 passed, 0 failed. `checkRef` is the
preflight whose whole thesis is "a 200 is NOT evidence", and it could be reduced
to `return { ok: true }` for every case the branch tested. Reverting the CLI
command's `--matrix` presence test to the truthiness test its own source comment
warns against — `opts.matrix ? … : undefined`, which silently drops `--matrix 0`
and substitutes the default `[1440, 834, 390]` — also left all 6358 green,
because `matchHarness` had never been reached through the command at all: the one
CLI test naming it mocks `resolveSites` to an empty inventory and runs the
argument handling over zero sites.

**Why the byte tests could not have caught any of it.** The two cases that touch
the route file compare the installed bytes with `MATCH_ROUTE_SERVER_TEMPLATE` —
the same generated constant the mutation is applied to. They are a tautology
under any mutation applied at the source, which is the only place a mutation to a
generated file may be applied. The same is true of every case that loops
`MATCH_HARNESS_FILES` to decide what to check: deleting a row deletes its own
check.

**What was added: 24 cases, 40 → 58 in `tests/recipes/match-harness.test.ts` plus
a new 6-case `tests/cli/match-harness-command.test.ts`.** Each runs the INSTALLED
artefact and pins ONE arm with every other arm arranged to pass, so a green is
that arm and nothing else. Suite 6358 → 6382 passed (4 skipped, 6386 collected),
479 → 480 files, ~50s.

**Executing the route template turned out to be cheap, and it is the part worth
copying.** The route is a `.ts` file with three bare specifiers and two type
annotations. Supply the specifiers as three tiny packages under the tmp site's
own `node_modules` — `$app/environment` (the switch under test, reading
`process.env.MATCH_PROBE_DEV`), `@sveltejs/kit` (an `error` that throws what
SvelteKit's throws), `$lib/site-pages.js` (a re-export of the site's real file) —
and let Node strip the annotations natively. Nothing in the route is rewritten;
what runs is the byte-for-byte template the recipe wrote. Both legs then exist:
production must 404 with the guard's OWN `"Not found"` **while a `home` assembly
is sitting there for a route that reached line 2 to return**, and dev must return
that assembly with the route's own `devImg` applied (`{url, dimensions: {width:
1600, height: 1067}}`, not the seed's asset id). The two 404s are deliberately
distinguished — `"Not found"` from the guard versus `no assembly for "nope"
(have: home)` from the route — which is the same distinction `launch`'s
`dev-guard` step already refuses to conflate. Inverting the guard to `if (dev)`
reddens all three.

**Corrections to the review, each measured.**

- **`checkRef` has EIGHT refusal arms, not six.** The review omits the
  candidate-host equality test at harness.mjs:108 and the fetch-catch at
  harness.mjs:112-114. All eight now have a case, plus the grant.
- **The gitignore mutation as the review states it — "every `!matching/*`
  negation removed" — already reddened two existing cases**, because both assert
  the literal `!matching/PAUSED` (match-harness.test.ts:597 and :627). The real
  hole was the seven GLOB negations with `!matching/PAUSED` left in place.
- **That hole is also no longer what the review measured.** With
  `!matching/*.sh|mjs|md` removed, 39 of 58 cases in the file go red — not one —
  because `18d2a04` (this branch, earlier today) made the recipe itself refuse an
  install git did not take, so `install()` throws for every case downstream. The
  review's "left all 6337 green while 13 files were written and then ignored" was
  true of the branch as it stood when the review ran, and is false now.
- **Dropping `["STRIKES_MJS", …]` from the generator's COPIED table is likewise
  no longer a silent mutation:** `de7fc7c`'s literal 10/7 ownership census
  catches a count change. The new hand-written manifest is still worth its lines
  — it pins the PATH TEXT, the ORDER and the OWNER of all 17 rows, where a census
  only counts — but the honest claim is "sharper", not "the only thing that
  catches it".
- **The coverage figure is right and does not move.** The CLI command file
  measures 60% statements / 27.5% branches / 16.66% functions / 75% lines both
  before and after these six CLI cases, because they exec
  `dist/cli/bin.js` and in-process v8 coverage does not follow a subprocess. The
  pass criterion for that file is the mutation table, not the coverage table.
  Whole-repo coverage 90.49 / 84.74 / 89.41 / 91.52 against floors 78 / 67 / 76 / 80.
- **The review's "990 tests stay green" is the only figure in it that was wrong,
  and it understates the case** — the number is 6358.

**The production change the review bundled into this item had already landed.**
It proposed adding `resolveTargetPrettier` to `match-harness` as part of this
fix; that is `c8feb44`, committed earlier today with its own mutation proof and
its own journal entry, along with the case the review numbered 19 ("spawns
NOTHING when the site has no prettier of its own"). So this is 24 cases and no
production change, not 25 and one. The review also said not to pass a
`timeoutMs`; `c8feb44` passes one deliberately, because `src/audits/util/
spawn.ts` only sets `detached` and installs a kill timer when a timeout is
present, and an unbounded child in a client repo is the defect that commit
exists to close.

**Honest accounting.** One of the three new commit-surface cases is thinner than
it looks. `GIT TRACKS every installed file` overlaps the pre-existing `every
installed path is in HEAD's tree` almost completely — the mutation that reddens
one reddens the other, plus 37 more. Its whole marginal value is that its
expected list is hand-written rather than derived from `MATCH_HARNESS_FILES`, so
it survives a row being deleted from the generated table. That is a real
property, and it is a smaller one than the case's name suggests.

**What is NOT closed, named rather than implied.** `matching/*.log`,
`matching/*.json` and `matching/*.png` in `GITIGNORE_BLOCK` are unreachable as
behaviour while `matching/*` stands above them: removing them changes nothing
observable, and no honest test can redden that mutation. They are defence in
depth for a future relaxation of the line above, and they are stated as such
rather than covered. Nine further mutations from the review are deliberately left
open and filed as an issue rather than fixed here: the seven COPIED constants in
`template.ts` still have no round-trip guard (the generator test covers only the
three AUTHORED blocks and says so in its own docblock); `census.sh`,
`build-spec.mjs`, `census-count.mjs` and `strikes.mjs` are installed and never
executed by any test — `strikes.mjs` in particular is the mechanism behind
CLAUDE.md rule 3; `next.mjs`'s foreign-schema branch (58-61) and its
masked/neutralised/truncated/off-threshold skip (62-69) are both reachable from
exactly the fabricated corpus these new tests already write; `gate.sh`'s
hyphenated-round-tag refusal (53-60) and its `SPEC_OPTIONAL=1` path (100-104);
and the CLI command's `--fleet` prep path, which — unlike `prismic-ci:165-174` —
has NO "the inventory resolved NO SITES" refusal, so `--fleet` over an empty
inventory prints an empty string and exits 0. That last one is a hollow green of
exactly the shape this repo's first rule is about, but it is a missing BEHAVIOUR
rather than a missing test, so it belongs in its own PR.

**Portability cost, recorded because it will be a confusing failure if it
bites.** The three route cases import a `.ts` file in a subprocess and rely on
Node stripping types natively — Node ≥ 22.6, on by default from 22.18 / 24.
`.nvmrc` is 24.19.0 and every workflow pins node-version "24", so CI is safe, but
`package.json` `engines` says `>=20`; a contributor on Node 20 gets three red
route tests reading `the route probe did not run: <node error>`. Loud and
correctly named rather than a silent pass, and the cheap fix if it happens is
`node --experimental-strip-types probe-load.mjs`, a no-op on 24. Two smaller
notes: the route probe writes `node_modules/` and `probe-load.mjs` INTO the tmp
site after the recipe has committed, so anyone adding a git assertion to that
describe needs a fresh install; and the eight `checkRef` cases share ONE install
via `beforeAll`, re-seeding `harness.json` per case — safe while vitest runs a
file's `it`s sequentially, and a `describe.concurrent` there would make them race
over one file.

## 2026-09-09 (last) — Verification found the eighth member of the class (#733, `feat/match-harness-recipe`, bf#58)

Five agents designed fixes for PR #733's four blockers, five implemented them
serially, five verified adversarially. Four held. The fifth — `census.sh` — did
not, and the reason is worth more than the fix.

The census entry above enumerated seven ways `census.sh` could print
`Phase 3 CLEAN` over nothing, and closed all seven. The verifier found an
eighth, and I reproduced it in a scratch site before touching anything: a
**complete** census — header present, counts line present, `ref runs: 12
cand runs: 12   mismatches: 3   ambiguous: 0` — whose `y=` rows carried one
leading space instead of two printed `Phase 3 CLEAN — 0 undeclared type
mismatches`, exit 0, over a log that says on its own second line there are
three.

GUARD 2 matched that counts line with `grep -qE`. That answers _is it there_.
The number it contains was thrown away, and the count actually reported came
from `census-count.mjs`'s row parse — two readers of the same artefact, and
nothing comparing them. This is the shape CLAUDE.md names by example: each
correction reintroducing the same shape one step along. The first fix demanded
the artefact exist. It did not demand that the artefact and the number agree.

**Why this is structural and not contrived.** The printer is `style-census.mjs`,
versioned in the matching-a-page skill. The parser is `census-count.mjs`,
copied byte-for-byte into every site the recipe installs. Neither repository has
to change for them to drift, and `census-count.mjs:39` matches `/^ {2}y=/` —
one space is the whole failure.

**What the fix cost in reading, not in code.** GUARD 2c is fourteen lines, but
the shape of the comparison came out of the printer's source and could not have
been guessed. `style-census.mjs:175-177` truncates the mismatch print at 100
rows and states the remainder on its own line; `:184` truncates ambiguous rows
the same way and states **nothing**. So the identity is exact for mismatches —
parsed + remainder == reported — and only a floor for ambiguous. An equality
check written without reading that would have refused every census over 100
mismatches: a count the gate can honestly report, called drift. That case is
now a GRANT test, and dropping `+ ${more:-0}` from the arithmetic is the only
mutation that reddens it.

**A claim about coverage that was not backed.** The previous entry said the
guards were proved to grant and not only to refuse, which was true. What it did
not say — and what the verifier measured — is that three of the seven guard
branches could be deleted with all eight census tests still green: GUARD 2's
viewport-header half, GUARD 2b, and GUARD 3's empty-page-table arm. All three
worked when driven by hand. So this was missing evidence, not broken code — but
by this project's own rule that is the same failure, one report earlier.

Six cases now cover the four branches. Each was mutation-proven at source: the
mutation goes into beachfront's `matching/census.sh`, `template.ts` is
regenerated, the suite runs. Six mutations, each reddening **exactly one test by
name**, no collateral, then reverted and the suite re-confirmed at 64/64. The
mutation was proved to have landed at the site under test by `grep -n` on the
mutated line, not by a diff line count — that shortcut is exactly what let a
mutation land on the wrong line earlier in this branch and read as applied.

**The landing hazard, which is a process defect and not a code one.** The
verifier flagged that `census.sh` is recipe-owned: the fix has to be made in
beachfront and regenerated, so until beachfront merges it, regenerating from
`main` silently reverts 118 lines with a clean exit 0 and the message
`17 files, all round-trip verified`. That is bf#58, opened first and merged
first, for exactly that reason. The invariant "regeneration from beachfront main
is a no-op" is what this branch spent PR #56 establishing; it does not hold
again until bf#58 lands.

## 2026-09-09 — A floating CTA, and designing the edit layer the prospect report never had (reddoor-website#174, `docs/superpowers/specs/2026-09-09-prospect-report-operator-edits-design.md`)

The report gained a second offer of the conversation. In the slot the "back to
where you were" control already owns, once the reader is past the hero and while
the closing red band is off screen, a red-outline `Start a conversation` link
sits bottom-right. Two `IntersectionObserver`s gate it, and the return button
still wins the corner when both could show, so exactly one control is ever in
the slot. Verified in a real browser on the preview and again on staging: empty
at the top, the CTA at 45% depth, empty at the bottom, and an in-page jump swaps
it for the return button. Colour measured `rgb(215, 25, 32)` on white, 24px from
both edges.

**The instrument failure, which is the part worth keeping.** CI on #174 first
failed on `dl.google.com` returning a Hash Sum mismatch while installing
Playwright's Chrome — upstream, not ours, and green on rerun. Then after the
merge I checked whether staging had picked it up by grepping the served
`_app/immutable` chunks for `closingInView`. Twenty polls over roughly seven
minutes, every one "not yet". I was about to report staging as not deployed.

The probe could never have passed. Locals are minified, and the report component
lives in a chunk the page does not preload. Running the same probe against the
deploy preview — which I had _already proven in a browser_ renders the button —
found `closingInView`, `pastHero` and `Start a conversation` in **0 of 45**
chunks. A control on a known-good input took under a minute and turned twenty
confident measurements into zero. The browser check that had worked all along
was the instrument; the staging page was fine, and the first empty browser read
was a stale cached bundle, not a missing deploy.

**Prismic for the report: investigated and ruled out on evidence.** Tucker asked
whether an editable report could live in Prismic. The `reddoor-la` content API
answers anonymous callers: `GET /api/v2` returns 200 and a document search with
no credential returns `total_results_size: 80`. Five other fleet repositories
(`gallerysonder`, `caltex-landing`, `hedloc`, `vida-legacy`,
`the-pointe-burbank`) all return 200 unauthenticated too, so a private Prismic
repo would be new ground for this fleet rather than a setting to flip. Against
that, the audit's whole privacy model is that the 128-bit token in the URL _is_
the credential, backed by three independent noindex guards and a `no-referrer`
policy. Prospect audits are critical assessments of strangers' businesses that
often name their competitors. Publishing those into an enumerable content API
would undo all of it.

**A belief corrected on contact.** I told Tucker the edit layer could live
entirely in maintenance with no website change, because
`audit-report-json.mts` hands `result_json` back byte for byte and the website
is a dumb renderer of it. That holds only for the scope I recommended. Tucker
chose "any rendered line", and the website _composes_ some sentences itself —
`openingSummary`, `goalVerdict`, `headlineFinding`, `passes`, `collisionFix`,
`HEALTH_FIXES` and every `healthRows` label. Those never exist in the stored
payload, so no merge in maintenance can reach them. The clean one-repo property
did not survive the scope decision, and saying so before designing around it was
cheaper than discovering it in implementation.

The reverse worry turned out to be unfounded and worth recording too. Tucker
asked whether edits would show on the site or only in email. Only one thing
reads a stored audit — the JSON route — the old `/r/{token}` renderer is now a
301 to the site, `renderReportPdf()` is a headless capture of the site's own
print page, and the audit email goes to a fixed `PROSPECT_AUDIT_RECIPIENTS` list
rather than the prospect. So the site is the source and the PDF and email are
both downstream of it. The only surface that would not inherit an edit is the
local file `--out` writes, which is a run-time snapshot.

Four decisions are Tucker's, recorded in the spec: any rendered line is
editable, editing happens in place on the real report, there is no lock on send,
and edit mode is unlocked by a separate path plus a key that converts to a
cookie. I recommended a narrower edit scope and was overruled with the tradeoff
stated; the design implements the broad scope in full and keeps it honest by
storing the original text beside every override rather than by restricting what
can change. Nothing is built yet.

## 2026-09-09 — Report edits: spec approved, split into two plans (#743, `docs/superpowers/plans/2026-09-09-report-edits-{a,b}-*.md`)

Follows the entry above, which ends "nothing is built yet". Still true; this is
the plan for building it.

Split at the seam where the feature stops needing a UI. **Plan A** is the
override layer: three columns, a wrapped API response, and application in
`toReportView` plus the composed-sentence functions. It ends with overrides
written by `curl` and proven to change both the web report and the print page,
which is working software with no editor. **Plan B** is edit mode: the private
edit address, the key-for-cookie exchange, the click-to-edit layer and the save
proxy.

Three things the spec got wrong, all caught while writing the plans against the
real code:

- **Three migrations, not one with three statements.** `migrate.ts` treats
  `duplicate column name` as already-applied, and that recovery is only sound one
  statement at a time. A three-statement migration that added column one and lost
  its marker would be marked applied on the re-run and leave two columns
  permanently missing. Migration 0013 states the rule; the spec ignored it.
- **The key paths omitted the stage wrapper.** Every stage is a `StageResult`, so
  it is `siteChecks.data[12].why`, not `siteChecks[12].why`. Fixed in the spec
  before it merged.
- **The composed functions need no signature change.** All six already take
  `view: ReportView`, so the override map rides on the view. The spec proposed
  passing a map into each one.

And one thing worth writing down because it inverts the usual instinct:
**positional keys are safe here.** `fixes[2].why` is normally fragile because a
regeneration reorders the list. `result_json` is write-once and a re-audit mints
a new token with no overrides, so there is no drift for a key to survive.
Content-hashed addressing would have been machinery for a problem that cannot
occur. The plans keep a cheap `original`-text check anyway, mutation-tested,
because a guard defending an assumption is the one place the assumption gets
checked.

The honest limit, stated in plan B rather than discovered later: the edit layer
resolves a line by matching rendered text against the values the view knows are
overridable, and a string appearing twice on the page is skipped rather than
guessed. Plan B's last task requires measuring how many lines that leaves
unresolvable and recording the number, because "any rendered line" is the goal
and that count is the distance from it.

## 2026-09-09 — The gate said ALL DONE over runs that never happened (#744, `fix/gate-false-green`)

Found by _using_ the `match-harness` recipe rather than reviewing it. Three
adversarial review rounds on #733 did not surface this; installing the harness on
29 Navy and running the real gate against a real reference did, in one command:

```
########## home ##########
home exit=1
ALL DONE (smoke)
```

exit 0, and no `report.json` written. `gate.sh:120` was `echo "$page exit=$?"` —
it printed the status and discarded it, and the only non-zero paths out of the
script were the two preflight exits and the missing-SPEC branch. Every page-diff
in the table could fail and the gate still reported completion.

`next.mjs` caught the total-failure case and not the partial one: its denominator
summed `TOTALS[p]` over the pages that produced a parseable report, so a page
whose page-diff crashed contributed to neither numerator nor denominator. Eight
of nine pages could print `SCORE 160/160 regions passing` while the ninth was
never measured. That is the recipe's own changeset sentence — "a wrong
denominator makes the score a lie in the flattering direction" — arriving from
the other direction.

The fix demands an artefact per run rather than trusting a status: a new
`harness.mjs --check-run <page> <out-dir> <startedAt-iso>` that the gate asks
after every page, and a scorer that names what it could not measure instead of
dropping it. The freshness arm exists because `lib/report.mjs` mkdir -p's the
output directory and never clears it, so a crashed re-run under a tag used
before leaves the previous round's report byte-identical — requiring
`report.json` alone would have reproduced the same green one step along.

**What adversarial verification then caught, which is the more useful half.**
The code was right on every leg; its evidence was not. Four of `uncountable()`'s
six arms had no case at all, and deleting `if (m.truncated) return "truncated";`
left the whole suite green at 81/81 — restoring the exact false green over a
report page-diff itself describes as unscorable. Every arm is now proven through
**both** callers and by **narrowing** rather than deleting, because deletion is
the weakest mutation available and it is the one the first round used. Seven
mutations, seven single-arm reds by name, 95/95 at the end.

The freshness arm had the same shape of hole: `at < since` has no slack, but the
only stale fixture was dated 2020-01-01, so widening it to a full day of slack
survived — a six-year-old report is refused either way. The case that pins the
boundary is a report written one second before the run started, which is exactly
the crashed-re-run the guard's comment describes.

**A trap in the mutation workflow itself, worth more than the tests.** The
documented loop — edit beachfront, regenerate, test, revert beachfront,
regenerate — does not restore `template.ts`. The generator carries the existing
`MATCH_HARNESS_PREVIOUS` forward and appends the current on-disk body to it
(`scripts/gen-match-harness-template.mjs:502`, `:580-588`), so the second
regeneration files the **mutant** as a legitimate prior release. Measured: one
mutate/revert cycle left `template.ts` 693 lines larger than HEAD carrying two
copies of the predicate, and regenerating again did not shrink it. A committed
fossil would make the recipe silently safe-replace a site carrying that exact
broken file instead of flagging it as hand-edited. The only correct revert is
`git checkout -- src/recipes/match-harness/template.ts`. This became dangerous
precisely at this commit, because `MATCH_HARNESS_PREVIOUS` was `{}` until now —
it holds one prior body each for harness.mjs, gate.sh and next.mjs so that 29
Navy's already-installed copies are safe-replaced rather than flagged. HEAD's
table was checked for fossils and is clean.

## 2026-09-09 — The shared eslint config ignores the Phase 0 capture (#730, `fix/eslint-capture`)

29 Navy's first `matching/capture-reference.mjs` run turned `pnpm verify` red
with 745 eslint errors, and every one of them was in a file the site did not
write. The decomposition, measured twice: 377 in Webflow's main bundle
(`matching/spec/js/29navy-8c2435.b450607e.…js`), 78 in its schunk, 290 in
`jquery-3.5.1.min.…js`. 377 + 78 + 290 = 745, three files, nothing else —
mostly `'define' is not defined` and `no-unused-expressions`, which is what
linting a minified third-party bundle looks like.

**The belief corrected on contact.** The failure was read as an eslint quirk,
and prettier was assumed to be covered by `.prettierignore`. It is not. Prettier
3 defaults `--ignore-path` to `.gitignore`, and the match-harness recipe's
generated block carries `matching/*` — that, and nothing else, is what keeps
`prettier --check .` green over the same files. Run it as
`prettier --check matching/spec --ignore-path .prettierignore` and five files go
red. Eslint flat config reads no ignore file at all. **That asymmetry is the
bug** — not anything about eslint's rules, and not anything about the capture.
Two tools, one on-disk artifact, and only one of them was ever protected.

**The scoping call, and the negative control that justifies it.** The obvious
patch is `matching/`, and it is wrong: beachfront-dentistry ignores `matching/`
wholesale and has thereby un-linted its own `adv-verify-svc*.mjs`. The
less-obvious wrong answer is `matching/spec*`, which additionally swallows the
**tracked** `matching/spec-sections/`. `matching/spec/` is the only form that
takes the capture and leaves `probe-inventory.mjs`, `states/*.mjs` and
`spec-sections/` linted. All three forms were measured against
`ESLint.isPathIgnored`, not reasoned about — under `matching/` all three of ours
flip to IGNORED, under `matching/spec*` only `spec-sections/` does.

That is also why the new test is behavioural rather than a
`toContain("matching/spec/")` string check. A string assertion passes happily
for `matching/` and `matching/spec*` — both contain the substring, and both
break the thing the entry exists to protect. Only resolving the ignore for real
tells them apart. `isPathIgnored` stats nothing, so it needs no fixture tree.
The test carries a control assertion (`src/lib/site-pages.js` is not ignored)
because `isPathIgnored` also returns true for a path no config's `files`
matched — with a bare `[{ ignores }]` config even `src/lib/a.ts` comes back
ignored, so without the control a `false` above could not be read as "not in the
ignore list".

**Why the recipe installs nothing.** `eslint.config.js` is an EXACT-MATCH
`sync-configs` template (`existing === t.contents`, no compliance predicate, and
`eslint` is in the default `which` set), so any block the recipe appended would
be deleted on the next default sync — the same clobber that ate MSOT's `$utils`
alias and gallerysonder's security headers. And the recipe's only append idiom,
`mergeBlock`, is a marker-plus-literal-text append to a line-oriented ignore
file; there is no safe line-append into an ESM exported array (text after `];`
parses fine and does nothing). The shared config is the only correct home. Do
not walk this one twice.

**The live consequence of that same fact.** 29 Navy is carrying a 915-byte
`eslint.config.js` against the 177-byte template, so a routine
`reddoor-maint sync-configs` before the version bump deletes the workaround and
silently re-arms all 745. This fix does not close that window, it only makes it
finite. The workaround must stay until the release lands and the site bumps.

**Honest accounting on what this did NOT fix.** `reddoor-maint audit --only
lint` still reports **fail** on 29 Navy, and will after this lands. Two
independent defects in `src/audits/lint.ts`, both proven to predate the capture:
its prettier half calls `prettier.check()` directly and consults neither
`.prettierignore` nor `.gitignore` (proof: `src/prismicio-types.d.ts` is in
29-navy's `.prettierignore` and is reported unformatted anyway), and its eslint
half hands globally-ignored files to `lintFiles()` as explicit paths, costing a
"File ignored because of a matching ignore pattern" warning each —
`src/lib/slices/index.js`, ignored by the shared config since long before the
capture existed, produces that warning today. #730 converts 745 errors into 3
warnings there and leaves the prettier half red. **Do not read a green
`pnpm verify` on 29 Navy as this class being closed.**

Also not fixed, and each needs its own issue — **none of these are filed yet**,
which is a debt this entry is recording rather than discharging: (1) the
`lint.ts` audit above; (2) `eslint.config.js` arguably needs a compliance
predicate (`contents.includes("createEslintConfig")`) the way `svelte.config.js`
and `netlify.toml` have, so a site's legitimate local extension survives a sync;
(3) `reddoor-starter-blux` carries a hand-inlined config that never received
`docs/superpowers/` or `scratchpad/` either and will not receive this, so every
`new-site --track blux` reproduces #730 on its first capture. 17 of 25 local
repos consume `createEslintConfig`; the 8 that inline it are 1836dig,
beachfront-dentistry, canvas-starter, data-dynamiq, reddoor-starter-blux,
the-pointe, the-pointe-burbank, the-tower-burbank — and `the-pointe` is archived
and cannot take a push, so `scripts/fleet-repos.sh --skipped` comes first if
anyone sweeps those.

`scratch-diff*/` went in on class grounds and is the weaker half of this change:
same generated `.gitignore` block, same git-ignored-but-on-disk property, one
line. It has **no reproduced signal** — nothing in the harness writes it and no
clone on this machine has one. It is here because fixing this class one instance
at a time is the documented expensive mistake, but a reviewer could drop it and
#730 would still be complete.

Nothing here changes what the capture _is_. `capture-reference.mjs` line 31
hardcodes `const OUT = "matching/spec"`, and that hardcoding is exactly what
makes a single fleet-wide ignore entry safe. If it ever becomes configurable
this ignore silently stops matching and the 745 come back with no test to catch
it.
