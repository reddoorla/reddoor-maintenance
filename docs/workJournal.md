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

## 2026-09-09 — A minted secret nobody read, and the coverage it does not buy (#746, `fix/drift-sweep`)

`PRISMIC_TOKEN_29_NAVY` has existed as an Actions secret on this repo and
nothing consumed it. Found as a set difference rather than by eye — 13
`PRISMIC_TOKEN_*` secret names against the workflow's env lines, `comm -23`
returning exactly one member. The reverse direction has three members
(`REDDOOR_WIREFRAMER`, `THE_POINTE`, `THE_TOWER_BURBANK`), and those are the
file's deliberate extra width, left alone: an extra name is inert, a missing one
is a site the operator never mints a secret for.

**The belief this corrects is the issue's own.** #746 reads as "29 Navy is not
covered by the drift sweep, because its env line is missing", and the second
clause is false. The env line was never what grants coverage. `--fleet airtable`
resolves only sites whose Airtable Status is `maintained`, and 29 Navy's is
`building`. The disproof was already running in production: alamo-anatomy,
hedloc and the-pointe-burbank each have **both** the minted secret and the env
line, and none of the three is swept. Last night's real run (34334202327) said
so in its own words — "9 checked, 0 failed, 4 skipped (no Prismic config), of 13
site(s)", `FLEET_WRITE_SUMMARY wrote=13 failed=0 total=13` — and none of those
13 is any of them. Adding the line changes nothing tonight. It removes a latent
go-live defect: the night a Status flips, the sweep has the credential instead
of reporting the site token-missing and writing `unknown`.

So the workflow now carries a paragraph saying exactly that, in the file where
someone will otherwise read a 16-line env block as a 16-site coverage list. That
is this repo's own corollary rule — a field that can only observe configuration
must not be read as the thing it cannot observe — applied to a list of names.

The issue's measurement was also wrong in a way worth recording: it said the env
block held **eleven** entries. It held fifteen, confirmed twice (by `grep -c` and
by the test helper's own `stepEnv` parser). A count read off a file once is not a
measurement.

**Two counts moved 15 → 16 and neither is test-guarded**, in the workflow comment
and in the runbook. They were split by date rather than folded into the old
measurement — the first 15 were measured 2026-08-13, 29-navy was added today —
because extending "(same measurement)" over a repo that measurement never looked
at is how a comment becomes confidently false. They will drift again on the next
site; guarding the count with a test, or stating it in one place instead of two,
is the durable fix and is not in this PR.

**What CI cannot do here, stated plainly.** The class is "a central
`PRISMIC_TOKEN_*` secret is minted but no env line consumes it". It has exactly
one member today, and no unit test can enumerate GitHub secrets, so nothing in
the suite can catch the next one. The only guard this change adds for the class
is a sentence in the runbook directly beneath the mint command. A scheduled check
diffing org secrets against the env block would close it properly; that needs
`secrets: read` and a token decision, and wants its own issue.

**Honest accounting on the second test.** `keeps a digit-leading repository name
a legal identifier` did not go red before the fix and never could — it exercises
`prismicTokenEnvName`, which the fix does not touch. It is characterization, not
coverage. Its mutation (`PRISMIC_TOKEN_${slug}` → `${slug}_PRISMIC_TOKEN`) reddens
ten tests including the pre-existing 48bb12d1 one, so it isolates nothing. And its
second assertion — the `/^[A-Za-z_][A-Za-z0-9_]*$/` identifier check — is
strictly implied by the `toBe` above it: any value satisfying the equality also
satisfies the regex, so it can never fail on its own. It documents intent and
adds no failure mode. Kept for the shape, and it would be the first thing to drop
from a leaner diff.

The mutation that does carry the fix is deleting the env line, which reddens
`carries the pre-launch repositories whose central secret is already minted` and
nothing else. Changing the same line's _value_ to another site's secret reddens
the pre-existing cross-wiring guard while leaving the new test green — the
separation that proves the two measure different properties.

29 Navy is still dark after this, and two operator actions stand between it and
coverage: the Status flip (a launch decision), and its Airtable `Git repo` cell,
which is NULL and would make the clone throw outright the first night it is
swept. Do the `Git repo` cell first, or both together — flipping Status alone
makes the nightly noisier, not more correct.

## 2026-09-10 — A match-harness block region gets an END, so an installed site can be corrected (#739, #753, `fix/p739`)

`mergeBlock` returned `null` the instant its marker appeared in the target file.
That is exactly right for "never append the block twice" and exactly wrong for
everything else: the block's CONTENTS could then never change on a site that had
already installed one. When #739 was filed the argument was "fix it before v1
installs anywhere". That window has closed — 0.95.0 is published and 29 Navy
carries all three blocks — so a fix that only helped fresh installs would have
been worth nothing. The recovery path for an already-installed, un-terminated
region is the whole design, not a compatibility shim bolted onto it.

**The issue understates the harm, and it is worth writing down which way.** It
reads as a staleness problem. On `.gitignore` it is an upgrade brick. That block
is a negated whitelist over `matching/*`, so a harness file at any path it does
not re-include — `matching/tools/x.mjs`, `matching/config.yml`, a future
`matching/harness.ts` — is on disk, absent from the commit, and
`pathsMissingFromHead` then refuses the ENTIRE install and reverts it. The
remedy is to widen the whitelist. Widening the whitelist was the one edit
`mergeBlock` made unreachable. So the recipe could brick itself on the next file
it gains, with the fix sitting in a file it had promised never to touch again.

**What landed.** `planBlockWrite(existing, marker, endMarker, block, previous)`
— the two options the issue sketched, welded together, because each alone has a
hole the other fills. A terminator makes the region addressable _from now on_;
byte-matching against a previously shipped body is what makes the FIRST
transition safe, on a v1 region that has no terminator to find. Four states: no
marker → append the region; marker and terminator → skip if the body is current,
replace in place if it matches something we shipped, flag otherwise; marker with
NO terminator → walk `[block, ...previous]` and require
`existing.startsWith(candidate, bodyStart)`, an exact byte match at the exact
offset, with everything after it kept verbatim as the site's own tail.

**"The region runs to end-of-file" was rejected on evidence, not taste.**
`mergeGitignore` (sync-configs) appends its managed block at EOF into both
`.gitignore` and `.prettierignore`. Run `sync-configs` after `match-harness` and
an EOF-delimited replace eats the canonical fleet ignore entries. 29 Navy
happens to have nothing after its blocks, which is precisely the accident that
makes a bad rule look fine. T1 seeds that tail and asserts whole-file equality.

**0.95.1 changes no block body at all.** Its entire job is to install the three
terminators, which makes the first-ever exercise of a brand-new replace path a
provably content-neutral write: one line per file. That scoping was forced by
mechanics, not preference — the END markers had to go in the authored `index.ts`
rather than beside the start markers in the generated `template.ts`, because
regenerating `template.ts` today ships beachfront's undeclared drift (see
below). The split is a real smell and the comment at the constants says so.

**A belief the briefing carried, corrected on contact.** "`MATCH_HARNESS_PREVIOUS`
is now non-empty, carrying one prior body each for harness.mjs, gate.sh and
next.mjs" is false. It is `{}` at `template.ts:1426`, `{}` in the generator at
`gen-match-harness-template.mjs:509`, and identical at `v0.95.0` and `main`. The
generator never reads its own output — `OUT` appears once as a `join` and once
in a `writeFileSync` — so there is no carry-forward mechanism in this tree at
all. The standing rule that warns about it describes an intent, not the code.
The hazard it names is real for any carry-forward design, which is why the new
`previous.ts` is hand-authored and its header states the rule in the only form
that cannot be got wrong: a body is recorded only when SUPERSEDED, and its
source is a published git tag, never a working tree.

**Measured, and it changes what the next session may safely do.** Beachfront —
the verbatim source for the seven COPIED files — has drifted from the shipped
template on three of them: `harness.mjs` 170 changed lines, `gate.sh` 76,
`next.mjs` 67, **313 total** against beachfront `main` (`a7cee52`), and 429
against `b53d1bc`, the open `fix/p751-unanchored-score` branch. So anyone who
runs `node scripts/gen-match-harness-template.mjs` for any reason today ships
313 lines of undeclared harness behaviour and — because `MATCH_HARNESS_PREVIOUS`
is `{}` — flags all three files forever on 29 Navy. That is the whole other half
of this defect class and it is **#753**, filed with the numbers, not left in a
code comment.

**Honest accounting on the tests.** Seven mutations, all narrowings, each proven
landed with `grep -n` and measured by the NAME of the test that reddened. Three
are worth keeping in mind:

- Narrowing v1 recovery to a region that reaches EOF (`bodyStart +
candidate.length !== existing.length`) reddened T1 _and nothing else_ — T4's
  CLAUDE.md seed does end at EOF, so it stayed green. That asymmetry is the
  check that the mutation landed where I thought it did, and it held.
- Narrowing the `terminate` arm to `previous.length > 0` is the important one:
  with the shipped `MATCH_HARNESS_BLOCK_PREVIOUS = {}`, no v1 site would ever be
  terminated and the entire migration would be green and inert. It reddened T4
  and T3 by name.
- `lastIndexOf(marker)` instead of `indexOf` reddened only T6 — the mis-anchor
  case, where the marker appears first inside the site's own prose. Anchoring on
  the first occurrence means a mis-anchor degrades to `flag`, never to a write.

**One process loss, recorded because it cost real time.** Reverting the first
mutation with `git checkout -- src/recipes/match-harness/index.ts` deleted the
entire uncommitted implementation, silently — the standing rule about reverting
that way is written for the GENERATED `template.ts`, where HEAD is the truth, and
it is exactly wrong for authored work that has not been committed yet. The three
mutations that followed then "passed" against the original code and their reds
were meaningless. Every mutation was re-run against a saved pristine copy, with
`diff -q` after each revert as positive evidence the file came back byte-identical.

**The tests were about the state this release ends, not the state it creates.**
An adversarial verification pass found that `planBlockWrite`'s marker-AND-
terminator branch — `index.ts:127-136` — was defended by no test anywhere in the
repository. Every case above seeds a _v1_ region: a marker with no terminator,
the shape 0.95.0 shipped. That is the shape this release exists to migrate away
from, so the moment it has run the fleet, the v1 recovery loop those six tests
exercise is dead on every site and the terminated branch is the only path left.
Two mutants proved it: narrowing the previous-body match makes a terminated
region un-upgradeable, reintroducing #739 one version along; returning `replace`
where the code returns `flag` silently overwrites a hand-edited block. Both left
the whole suite green. Two cases now seed a TERMINATED region and pin the two
arms — upgrade-in-place with the site's own tail intact, and leave-alone — and
each mutant now kills exactly the one test written for it and no other. The
generalisable form: a migration's tests naturally describe the state it starts
from, because that state is what the author has in front of them, and the state
it _leaves every consumer in_ is the one that has to survive the next release.

**A deprecation note and an import switch shipped together; the data migration
they both depended on did not.** This branch introduced a hand-authored
`previous.ts` on the argument that `template.ts` is generated and its
`MATCH_HARNESS_PREVIOUS` therefore cannot be trusted to remember anything — true
of the mechanism, and the reason #753 exists. What it also did was re-point
`index.ts` at that new file's EMPTY table, while the populated one sat in
`template.ts` with three entries and no importer. The bodies were supposed to
move across in #753. Until they do, "the generated table is dead" is a statement
about where the code is going, not about what the code does, and the recipe
believed it a release early.

Measured on rebase onto `e322ca5`: `pnpm verify` red, one failed test —
`UPGRADES a site running the shipped v1 gate.sh rather than flagging it`. The
diff is unambiguous about the cost: the site keeps a `gate.sh` with no
`MEASURED`, `ATTEMPTED`, `UNMEASURED` or `SEEN`, which is the gate that said ALL
DONE over runs that never happened. So #739 as first written would have
un-shipped #744's fix to every site already carrying the v1 gate — a week after
merging it. `previous.ts` now holds only the BLOCK table, which is genuinely new
here and genuinely empty (0.95.1 changes no block body, only terminates them),
and the file table stays where it is and stays populated.

Worth its own line: of the two tests that touch the real shipped table, only one
could see this. `carries the render it previously shipped forward, per
recipe-owned path` imports `MATCH_HARNESS_PREVIOUS` from `template.js` and
asserts its contents — so it stayed green throughout, because the table was
still populated and still correct. Nothing about it observes which table the
RECIPE reads. The one that caught it, `UPGRADES a site running the shipped v1
gate.sh rather than flagging it`, runs `matchHarness` end to end with no
injected `previous`, so the wiring is on the path. Two tests over the same
export, one of them load-bearing: asserting a data table's contents is not
coverage of the code that consumes it, and the difference is invisible until
someone re-points the import.

**What is NOT done.** Nothing detects an un-migrated site; the operator has to
re-run `reddoor-maint match-harness 29-navy --ref <url>` once, and `--ref` is
inert on a re-run because `harness.json` is site-owned and skipped. And the
migration is exact-byte: a site whose CLAUDE.md block was reflowed (a
`proseWrap: "always"` prettier config would do it — 0 of 18 fleet clones set
`proseWrap` today) matches no candidate and is FLAGGED with a note naming the
file. It is never silently skipped and never overwritten, but a human reconciles
it once. Both carried in #753.

## 2026-09-10 — next.mjs scored 12/3 and called the backlog empty, and the table of

shipped bodies stopped feeding on itself (#751, #753, `fix/p751`)

`next.mjs` divided a real pass count by an imaginary denominator on the exact
shape every new site starts in. `harness.mjs` derived `TOTALS[page]` as
`(anchors.length + 1) * MATRIX.length`, which is an exact identity for an
ANCHORED run and nothing at all without anchors: `splitRegions`
(page-diff.mjs:103-110) cuts by anchor only when there are anchors, falling back
to the page's own `<section>` boxes and then to an even four-row grid
(lib/regions.mjs:27-35, `gridRows = 4`, labels `grid-<r>-<c>`).

Measured, not recalled. On the untouched recipe seed (`anchors: []`, matrix
`[1440, 834, 390]`) page-diff produces 12 grid regions; `next.mjs` printed
`SCORE 12/3 regions passing`, then `No open geometry failures. 0 declared
floor(s) remain.` and `Backlog is empty — Phases 5 (states) and 6 (adversarial
review) are what is left.`, exit 0. On 29-navy's matrix of four the same seed
prints `SCORE 16/4`. The absurd fraction is the harmless half — someone
questions `16/4`. Nobody questions "Backlog is empty", and it prints from the
same run.

**The belief this corrects, and it is the expensive one.** Two tests asserted
the defect as correct behaviour and had done since the recipe shipped:
`next.mjs SCORES a real corpus and names the worst region` asserted `SCORE 2/3`
over `anchors: []`, with the comment `// 3 = (0 anchors + 1) × 3 viewports,
derived by harness.mjs from the seed` — the false derivation written down as
fact — and `next.mjs exits 0 with no agenda once every region passes` asserted
`SCORE 3/3` plus `No open geometry failures`, exit 0, which IS the issue,
greened. They passed because the fixture supplied exactly 3 regions and the
fiction `(0 + 1) × 3` is also 3. The fiction and the fact coincided, so nothing
looked wrong. Both fixtures now use 12 regions against a fiction of 3
specifically so the two numbers can never agree again, and that constraint is
written into a comment in the test file because it is the whole reason this
shipped.

**The answer already existed twenty lines below the bug.** `checkRun`'s
`if (secs.length)` guard already declines to assert a region count without
anchors, and already writes down why — same fallback, same measurement, dated
2026-09-09. The fix reached the VALIDATOR and was never carried to the
DENOMINATOR. Choosing anything else now would have been answering one question
two ways in one file.

**Understated in the issue: the ranking, not just the number.** `scored` sorted
by `pass / total`, and an unanchored page's ratio is not bounded by 1. A passing
one scored `16/4 = 4.0` and sorted LAST, i.e. best, so `const worst =
scored[0].p` could never name the one page whose Phase 1 was not done. A failing
one scored `0/3 = 0.0`, sorted FIRST, and printed `NEXT: about — worst page`
with an agenda of `grid-0-0`, `grid-1-0` … — an instruction to fix geometry
against regions page-diff invented. Reproduced before the fix and again by
mutation after it.

The fix REFUSES rather than relabels: `scorable(key)` beside `TOTALS`,
`TOTALS = null` for a page whose count cannot be predicted, unscorable pages
filtered out of the ranking, the run's OWN region count printed as evidence for
the refusal (`home  12 region(s)  NOT SCORABLE — no anchors`), and exit 2. The
pass fraction is deliberately withheld — it is the number with no referent and
the number that gets quoted into a status line. With nothing scorable it prints
`NO SCORE — 0 of N page(s) have anchors` rather than `SCORE 0/0`, which is a
third lie and the one that reads best of all. Scoring the grid and labelling it
was rejected: "12 of 12 grid rows passed" is arithmetically honest and
semantically empty, and the label is prose beside a figure. Where a genuine
pre-Phase-1 baseline read is wanted, `SPEC_OPTIONAL=1` already exists and
already prints "Do NOT apply geometry fixes off this run."

Honest accounting on `null`: it does not poison arithmetic. `a + null` is `a`,
so a consumer that sums `TOTALS` without asking `scorable()` still gets a
too-small denominator — flattering, the direction the comment above `TOTALS`
warns about. `null` is a signal chosen for loud printing and
JSON-representability; the barrier is the predicate and the exit-2 guard. That
`0/null` really does print when the ranking filter is removed was seen during
mutation, which is the best argument for the signal being loud.

**A standing rule was wrong on this branch, and it is worth correcting.** The
session rule says `MATCH_HARNESS_PREVIOUS` "is live now — PREVIOUS is no longer
empty", and that the generator carries it forward and APPENDS the on-disk body,
so a regenerate-after-revert silently ships the mutant as a prior release. On
`fix/p751` none of that was true: `git log --oneline --
scripts/gen-match-harness-template.mjs` has exactly one commit (`9cd0e49`),
which hardcoded `export const MATCH_HARNESS_PREVIOUS … = {};` with the comment
"Empty at v1 — nothing has shipped", and template.ts:1426 confirmed `= {}`.
Regeneration was measured to be byte-idempotent. The `git checkout --` habit is
still right and was followed for all eleven mutations, but its stated mechanism
did not exist. After this PR the first half becomes true — PREVIOUS is populated
— and the second half still will not be: the generator reads committed files
under `scripts/match-harness-previous/<version>/`, never the working tree, so it
cannot absorb a mutant.

**Migration was the half that decides whether the fix reaches anyone.**
`@reddoorla/maintenance@0.95.0` is already published and installed. Run against
the real `planFileWrite`, a stock 0.95.0 install with `PREVIOUS = {}` returns
`flag`: the file is left byte-for-byte alone and the run adds the note
`matching/next.mjs differs from the shipped template and was left alone
(hand-edited?)`. The site would keep the broken `next.mjs` forever AND be
accused of an edit it never made. With the 0.95.0 body present it returns
`replace`. The prior bodies were extracted once from `git show
v0.95.0:src/recipes/match-harness/template.ts` — verified byte-equal under
`normalize()` to what 29-navy, a real 0.95.0 install, has on disk — and
committed under `scripts/match-harness-previous/0.95.0/` so they are auditable
in git rather than a 17 KB literal nobody can review.

**Coupled set, measured in both directions.** Because the scripts are copied
verbatim from beachfront and beachfront has drifted, 0.95.1 necessarily ships
that drift: `harness.mjs`, `gate.sh` and `next.mjs` differ from 0.95.0 while the
other four copied files are byte-identical and need no PREVIOUS entry. A new
`next.mjs` against a 0.95.0 `harness.mjs` dies with `SyntaxError: The requested
module './harness.mjs' does not provide an export named 'scorable'` — it does
not degrade, it does not load. A 0.95.0 `harness.mjs` given the new `gate.sh`'s
call answers `usage: harness.mjs --env | --table | --check-ref` and exits 2,
which gate.sh reads as NOT MEASURED for every page. So `planFileWrite`'s
per-file independence was itself the hazard, and `MATCH_HARNESS_COUPLED` plus a
two-pass install now demote the whole set to `flag` when any member is
hand-edited.

**A guard that over-refused, caught by an existing test rather than by
thinking.** The first version demoted `write` as well as `replace`. On a fresh
site with one hand-edited script that silently withheld sixteen files and turned
the install into a failure — `flags a hand-edited recipe-owned script and leaves
it byte-for-byte alone` went red. A file that is ABSENT cannot be "left alone":
there is nothing to preserve and skipping the write leaves no harness at all.
Narrowed to `replace` only. This is exactly the over-refusal failure mode the
plan named as the new code's own risk, and it took eleven minutes to hit.

**The drift also broke a gate test, correctly.** `gate.sh RUNS the page once the
reference verifies` went red after regeneration: the new `gate.sh` no longer
trusts page-diff's exit status and calls `harness.mjs --check-run`, which demands
a real `report.json` that is fresh, countable and covers the matrix asked for.
The test's stub page-diff printed a version string and wrote nothing, so every
page came back NOT MEASURED. The stub now writes the artefact a working run
produces. That is the gate getting stricter in the right direction — the test's
green used to be the absence of an error and now requires evidence.

Eleven mutations, each proven landed with `grep -n` on the mutated text and each
measured by the NAME of the test that reddened. Two discriminated exactly one
test: narrowing the exit to `unscorable.length && !scored.length` reddened only
the mixed-corpus test, and narrowing the coupled demotion to `blockedBy.length >
1` reddened only the hand-edited-set test while the clean-upgrade test stayed
green — which is the asymmetry that matters, because that guard's failure mode
is over-refusal and its test has to GRANT an upgrade, not merely deny one.

Two predictions in the plan were wrong and are recorded as such. Narrowing the
unscorable guard to `> 1` was predicted to redden only the single-page refusal;
it reddened the mixed-corpus test too, because that corpus also has exactly one
unanchored page. And dropping `next.mjs` from the PREVIOUS table was predicted
to redden the upgrade test on `differs from the shipped template`; it reddened
it on `expected 'noop' to be 'applied'` instead, because the coupled-set demotion
turned a partial upgrade into a total refusal — the missing entry became MORE
visible than predicted, not less.

Found and NOT fixed here, and each needs an issue rather than this paragraph:
`matrix: []` makes `TOTALS[p]` zero for an ANCHORED page and `pass/0` is
Infinity — the same class, a different input, and `harness.json` has no
validation pass at all; the coupled-set mechanism is a per-recipe list where the
general shape (a recipe shipping an interdependent set) recurs; and
`SPEC_OPTIONAL=1`'s per-page "do not apply geometry fixes off this run" and
`next.mjs`'s site-wide claim still do not talk to each other.

**Found 2026-09-09; landed 2026-09-10, by which point the branch had grown a
second subject.** Two things happened to it in between, and both are worth more
than the original fix.

**The refusal had to GRANT as well as deny.** `scorable(key)` started as "has
anchors"; verification found a second way to have no referent — an EMPTY MATRIX,
where `TOTALS` is `(anchors + 1) * 0 = 0` and the score reads `SCORE 8/0`. So
`scorable` now requires both, and `unscorableWhy` names which one is missing,
because a refusal that cannot say why is indistinguishable from a crash. Three
legs measured: empty matrix → `NOT SCORABLE — matrix is empty`; no anchors →
`NOT SCORABLE — no anchors`; both present → `SCORE 8/8`, exit 0. That last one
is the load-bearing case. A guard whose failure mode is over-refusal is only
proven by a green it GRANTS, and this file's own rule 1 says an error matcher
may never do more than deny.

**Two mutants survived the first verification pass, and both were about what the
operator is TOLD rather than what is written.** Deleting
`if (demotedRels.has(f.rel)) continue;` makes the coupled-set demotion also emit
a per-file "differs from the shipped template … (hand-edited?)" note for the two
files nobody touched — sending an operator to diff two files against a template
they already match. The existing test could not see it: it asserted the set note
NAMES all three files, and the false accusation names them too. The per-file note
is additive, so the assertion had to be about what is absent. Summing the score
over `latest` instead of `scored` puts an unscorable page's regions in the
numerator; the existing test had that page FAILING every region, so the wrong sum
added zero and nothing moved. The new case makes those 12 invented regions PASS
and the mutant prints `SCORE 17/6` — a numerator counting regions the denominator
has never contained. **Both existing tests were green against both mutants
because of the DATA they used, not because of what they asserted.**

**The table of previously shipped bodies was feeding on itself.** `main` grew a
carry-forward mechanism that reads bodies out of the committed `template.ts` on
every regeneration — automatic, which is the appeal, and self-feeding, which is
the problem: whatever sits in `template.ts` becomes a "previously shipped
release" on the next run. Mutate, regenerate, revert, regenerate, and the mutant
is now an entry. Measured on this branch: one such cycle added 693 lines and two
copies of the same predicate, and nothing failed. Entries in that table are the
bodies `planFileWrite` REPLACES WITHOUT ASKING, so a wrong one silently
overwrites a real site's file — the highest-blast-radius data the recipe carries.
It now comes from `scripts/match-harness-previous/<version>/`, copied from a
published tag and never re-derived. The cost is a manual step at release time.

**Proven lossless before the swap, both directions.** The three v0.95.0 bodies
are byte-identical (sha256, first 16) to what 29 Navy has installed today:
`f20982b377f501e9` gate.sh, `04305ae48d656b25` harness.mjs, `07fab93206564d29`
next.mjs. And running the real `planFileWrite` against 29 Navy's actual files
under BOTH mechanisms plans `replace` for all three, `skip` for the other
fourteen, and `flag` for none. A mechanism swap on this table is exactly the
change where "the tests pass" is not the question — the question is whether the
fleet's upgrade path still resolves, and that is a measurement against a real
site, not a fixture.

## 2026-09-10 — The prospect-report override store, and four instances of one bug (`feat/prospect-report-overrides`)

Plan A's storage half: three columns on `prospect_audits`, a validator, two
writers. The website half shipped earlier the same day and is live on staging,
accepting both the old bare-report response and the wrapped one it will get
when the API task lands. Nothing serves overrides yet.

**The migration split, proven rather than argued.** `overrides_json`,
`edited_at` and `opened_at` are three separate `ADD COLUMN` migrations, not one
with three statements. `migrate.ts` runs `executeMultiple(m.sql)` in a try,
swallows any `duplicate column name`, then records the marker unconditionally.
Constructed against the real runner:

```
COMBINED, crash mid-run + lost marker, re-run:
  marker recorded=true; overrides_json=true edited_at=false opened_at=false
  → marker says applied, two columns permanently missing
SPLIT, same crash: all three applied, all markers present → survives
```

`executeMultiple` aborts at the failing statement and prior statements persist,
so partial application is real and there is no wrapping transaction. 0003 and
0013 already carried this rule; the spec violated it and was corrected.

**One bug, four instances, and the pattern is the finding.** Every one had the
same shape: **validate one object, serialise a different one.**

- `Object.values()` on a non-plain object returns `[]`, and `[].every()` is
  vacuously true. `new Map([...])` returned `updated`, stored `{}`, and stamped
  `edited_at` — the operator's whole map discarded and reported as saved. A
  `Date` stored as a bare JSON string.
- A circular reference or `BigInt` inside a valid entry threw a `TypeError` out
  of a function declared to return a three-way union.
- No size cap: 2,288,891 characters accepted in one write, on a value re-served
  on every view of that report from a metered store. The sibling operator-write
  path caps at 2,000.
- `__proto__` stored verbatim; after parsing, a consumer using `Object.assign`
  measurably gets its prototype replaced, and the consumer is a separate repo.

Fixing them individually treated symptoms. The close is to build the stored map
from the fields the validator approved, so the stored bytes are the checked
bytes by construction. A `toJSON` on an entry had survived all four fixes and
stored `{"k":5}` for a pair that validated as `{original,text}`.

None of these is reachable from the live path — the caller is an HTTP JSON body
and `JSON.parse` produces only plain objects. They were fixed because this
validator's stated contract is that it is the only place a malformed value can
be caught, and a gate that passes on questions it cannot fail is the thing this
repo has a rule about.

**Two beliefs corrected on contact, both mine.**

A test comment claimed a dropped column in the listing select "would still
typecheck and still pass". It would not: the return type pins the columns, so
it is `TS2322` and the build dies before a test runs. The commit message that
introduced the comment had already disproved it at length. Commit messages are
read once and comments are read forever, so the disproved version was the one
that would have survived. The test is still worth having, for the regression it
actually catches: a select that satisfies the type while returning wrong data,
proved by aliasing `business as edited_at`, which typechecks clean and reds.

And dropping unknown entry keys was justified as mutually exclusive with
rejecting unserialisable input. It is not — build-from-validated-fields plus
reject-unknown-keys satisfies both. Drop-versus-reject is an independent policy
choice, and recording it as a forced consequence would have hidden that a
decision was made. Drop stands, on the distinction the file already draws: an
unknown TOP-LEVEL key is a whole override and is operator content, while an
entry key is read by nobody.

**Accepted, and now recorded as a decision rather than an accident:**
`setProspectAuditOverrides` replaces the map wholesale, so two concurrent
writers silently clobber each other. Fine for one operator team; `edited_at` is
the column an optimistic check would key on if a second editor ever exists. It
is pinned by a test so it stops being incidental.

**Not ours, and worth a separate look.**
`tests/prospect/interaction-harness.test.ts` fails its `afterAll` browser close
with `Hook timed out in 10000ms` under full-suite load — 14/14 pass in
isolation, and it reproduces at HEAD with this branch's changes stashed. The
`beforeAll` carries `60_000`; the `afterAll` has no explicit timeout. CI on
`main` is green across the last eight runs, so this is local, on a machine that
had 43 stray Chrome processes.

## 2026-09-10 — The report route serves its overrides, and a deploy gate nobody had checked (`feat/report-json-serves-overrides`)

Task 4 of the override-layer plan. `/api/audit-report/:token` now returns
`{report, overrides, editedAt, openedAt}` instead of the bare stored string,
built by string concatenation so `result_json` is still never parsed here.

**The finding is not the route. It is that the plan's precondition was unmet and
nothing in either repository would have said so.** The plan states "Task 1 must
be deployed first" — the website's tolerance for both response shapes. It was
merged, and it was live, on `staging` only. Checked against the Netlify API
rather than inferred: `reddoorla.com` builds `main`, `staging.reddoorla.com`
builds `staging`, and `reddoorla.com` was publishing `c662da3`, which is
`origin/main` exactly. `main`'s `fetchReport` still ends
`return (await res.json()) as AuditReport`.

That last line is why this was worth an hour. It is a **cast, not a parse**, so
handed the wrapper it does not throw. It yields a report object whose every
field is `undefined`. A premature deploy would not have produced a 500 or an
error page or anything a nightly would catch — it would have produced blank
reports, silently, on every prospect link already sitting in an inbox, and on
the PDF leave-behind with them, since `renderReportPdf` captures
`reddoorla.com/audit/{token}/print` and that calls this same route server-side.
The website is the only consumer; there is no third thing to break.

Measured, so the next person does not re-derive it: `main..staging` is 36
commits, `staging..main` is 4. A cherry-pick of `f8fe1c1` (the compat commit
alone, no design changes) onto `main` applies 5 of 6 files clean; the sixth is a
dev-only `+page.server.ts` that `main` does not have, so it drops. On `main`
with it applied: 415/415 unit tests, production build succeeds. Note the first
run of that probe failed 37 of 38 test files with `TSCONFIG_ERROR` — the absent
generated `.svelte-kit/tsconfig.json` on a fresh worktree, not a real failure.
`svelte-kit sync` first, always.

The promotion itself is the operator's: it would ship OG cards on every page and
Tim's round-1 portfolio pin while his round-2 tweaks sit in an open PR.

**Two vacuous tests, the same shape, both caught in review.** This is the third
and fourth instance of the pattern the last entry named.

`passes the stored JSON through byte-for-byte` built its fixture with
`JSON.stringify`. For canonical input, a route written as
`JSON.stringify({report: JSON.parse(stored), …})` emits a byte-identical body —
so the test passed against precisely the implementation it exists to forbid. It
predated this change and was already vacuous; concatenation is what made it
load-bearing. Fixed with a hand-written non-canonical fixture: spaces after `:`
and `,`, and `1.50`, which comes back `1.5`. Mutation-proven, and the comment
now says the literal must not be tidied back into a `stringify` call.

`openedAt` was never observed in the body in its non-null state. **Hardcoding
`"openedAt":null` in the route passed all 16 tests.** Fixed with a test that
reads back the timestamp a previous fetch wrote; under mutation it reds and
nothing else does, which also proves the 16 were blind to it.

A third, milder one shipped and was then hardened here: the coalescing hold test
compared ISO timestamps at millisecond resolution, so four calls landing inside
one millisecond would have compared a timestamp to itself. It did red under
mutation — by luck, not design. Backdated a second, now deterministic.

**A read route that amplified into writes.** `touchProspectAuditOpened` stamped
on every GET of a route that is unauthenticated by design and rate-limited at
120 req/min per IP: ~172,000 writes a day from a single address, into the Turso
project the whole fleet shares, configured `overages: false`, where crossing
quota blocks reads **and** writes for every site at once and where capacity is
not alarmed. That is an outage vector, not a billing detail. Coalesced to a
five-minute window inside the `WHERE` clause rather than a read-then-write in
the caller — one round trip, so two concurrent opens cannot both decide to
write. A refresh now costs nothing.

**Two suggestions declined, recorded so they are not re-litigated.** A timeout
race on the stamp: the route already awaits Turso on the same connection for
`getProspectAuditByToken` immediately above, so a store slow enough to matter
has already delayed the response before the stamp is reached. The stamp doubles
an existing exposure rather than introducing a new class of one; accepted, and
said so in the code. And exporting `x-reddoor-edit-session` as a shared constant:
right in principle, unavailable in fact, because the website cannot move past
`@reddoorla/maintenance@^0.83.0` without breaking the a11y job's dev server in
CI. A constant the consumer cannot import buys nothing, so the header is
documented as a cross-repo contract that degrades **silently** — if the two
drift, the skip quietly stops working and `opened_at` starts recording operator
previews as prospect reads.

**A belief corrected on contact.** I told the implementer that
`setProspectAuditOverrides` returns `"updated" | "invalid" | "not-found"`. It
returns `{status, token}` objects, and the plan says so correctly at line 501 —
the subagent reported the plan as wrong, and the plan was right. I came within
one edit of correcting a correct document on an agent's say-so.

Worth knowing about the signal itself: corporate email link scanners fetch
links, so `opened_at` will sometimes say a prospect opened a report when a
scanner did. That is a larger threat to its honesty than the fact that anyone
holding the token can spoof the header that suppresses it.

## 2026-09-10 — The override layer is live, and three probes that proved nothing first (#762, `e614e03`)

> Follows the entry above it, which left the website promotion open as the
> operator's call. It landed the same evening.

`reddoor-website#178` promoted `staging` to `main` and `reddoorla.com`
published `db6702f` at 22:39 UTC, which discharged the deploy gate task 4 was
being held behind. #762 merged at 22:57 and the ops app published `e614e03` at
22:58:34. The comment in `audit-report-json.mts` was rewritten before the merge
rather than deleted: the gate is now a record of a trap that is one commit away
any time that response shape changes again, and the line worth keeping from it
is that **merged is not deployed, and the branch that serves a report link is
not the one most work lands on.**

**Proven live, against production, not against a preview.** The deployed API
returns `["report","overrides","editedAt","openedAt"]`, HTTP 200,
`cache-control: private,no-store`. The fetch carried `x-reddoor-edit-session: 1`
and `opened_at` was `null` before and `null` after — so the skip works in
production, and the probe cost the operator nothing in signal. Both
`/audit/{token}` and `/audit/{token}/print` return 200 with substantial rendered
content.

**But the first three ways I tried to prove the page renders the payload all
proved nothing, and the controls are what caught it.** Worth writing down
because each looked convincing:

- _Does the page name the business?_ Contaminated. The audit is of
  `reddoorla.com`, and "Reddoor" is in the marketing site's own nav and footer,
  so the check passes whatever the payload contains.
- _Does the page contain the report's check copy?_ Contaminated, and this one is
  structural: the design doc already says check labels and reasons "live in
  source across both repos". A hit could be website-resident copy rather than
  payload-derived, so the match is meaningless.
- _Does the page render this run's measured scores?_ Inconclusive, and only
  because a control was included. Three of four scores matched — but the control
  number, chosen precisely because it is _not_ one of this run's scores, matched
  too. Bare number-matching against a 119 KB document proves nothing. Without
  the control this would have been reported as a pass.

What finally discriminated was the **hydration payload**, because it is what the
server's `load()` produced rather than what a component chose to display:
`overrides` is present, `editedAt`/`openedAt` are absent, and a nonsense control
key is absent. The old code would have shown the opposite — the wrapper's own
keys sitting where the report should be, because `as AuditReport` is a cast that
cannot fail. That asymmetry is the proof.

The general lesson is the repo's own rule pointing at probes rather than at
gates: a probe run only against the state you expect cannot tell you anything.
Every one of these was one control away from being an overstated claim, and the
scores probe actually was one until the control ran.

Still not proven, and not provable yet: that an _edited_ line survives to the
page and the PDF. That needs the save endpoint (task 5) to exist before there is
any override to render. Task 10 stays open.

## 2026-09-11 — Plan A task 10 closed: an operator edit reaches a live report (`96a9008`, reddoor-website#181)

The last open item in the override-layer plan, blocked since the feature began
for a structural reason: nothing could write an override until the save
endpoint existed, so there was never anything to prove rendered. #765 shipped
it, `PROSPECT_EDIT_TOKEN` was set on the ops app and both marketing sites, and
the ops app redeployed at 08:02 UTC to pick it up.

Measured against `reddoorla.com`, on Reddoor's own audit, reverted immediately:

```text
PRECONDITION  original is on the live page ......... true
1. SAVE       POST /api/audit-report/:token/overrides  200 {"ok":true}
2. API        serves the override back, editedAt set .. true
3. PAGE       renders the edit, original gone ........ true
3b. PRINT     renders it too, so the PDF follows ..... true
4. REVERT     mark gone, original restored ........... true
```

Step 3b matters more than it looks: the PDF leave-behind is a headless capture
of the print route, so proving that route renders the override is what proves
the emailed attachment carries it. Nothing in the email path needed changing.

**The first run of this proof was a green-looking nothing, and that is the part
worth keeping.** It chose `siteChecks.data[0].why` as its subject — a key whose
text the report does not render. So "the edited text is not on the page" was
true, and "the original is not on the page" was also true, and the output read
as a clean failure of the feature. Nothing was wrong except the choice of
subject. Of 230 candidate strings in that payload only 145 are rendered at all;
checking that the original is on screen BEFORE editing it turns the same script
from noise into proof. Generalised: a probe that does not verify its own subject
is observable is not measuring the thing it names, and it will fail in the
direction that looks like a real finding.

**Two operational notes.** `opened_at` on that row stayed null throughout,
because every probe fetch carried `x-reddoor-edit-session: 1` — the skip works
in production, and the proof cost nothing in signal. And `edited_at` is now
stamped on Reddoor's own audit row, which is the one piece of residue the revert
does not clear; the column has no "never edited" state to return to once a save
has happened.

Entries above this one describe plan A as complete except task 10. It is now
complete.
