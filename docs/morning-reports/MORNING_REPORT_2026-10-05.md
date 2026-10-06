# Morning brief — 2026-10-05 (scheduled PM pass, Monday, 11:49Z)

## One-line verdict

**Today is report day: the five Maintenance reports still preflight clean and draft in this afternoon's run, and the Williamson HD video restore is already published, so showing Tim needs only the walkthrough and his three launch facts. One new decision reached you only on a branch: #1143's D1 pull-sync is held (item 72).**

This pass started at **11:49Z (04:49 PDT)** [M, `date -u`]. It covers 10-04 16:05Z (the last report) → 10-05 12:00Z. It is the Monday pass: the fleet snapshot was re-read from Turso, P1 was re-ranked from scratch, and the week's reports went through `refute-claims` (below).

Clean [TEST] sends in a row: **1** (29 Navy, 2026-09-28, clean). There is no `awaiting` row.

## Top of stack (yours; ordered by date)

1. **Today, after ~15:00Z: approve five Maintenance drafts.** Data Dynamiq, Espada, LAHI, Revogen and Vineyard Custom Homes draft in today's `daily-reports` run. Approve each on its `/s/<slug>` page, and it sends with Tuesday's run.
   - At 11:55Z all five read `nextDueDate` 2026-10-05, and `preflightSite` returns no fail or warn finding for any of them [M, live Turso, read through a client that refused a test `UPDATE` first].
   - The gate was proven first: Espada with recipients and point of contact blanked returns `no recipients … the send will throw` [M].
   - All five carry a `ga4_property_id` [M]. **Correction to 10-04:** that does not mean all five have analytics.
     - Data Dynamiq's property (556916505) got a stream on 10-01, but its tag install waits on P1-26 (BACKLOG 49) [M, BACKLOG].
     - So its section will probably be empty or read `n/a` [I]. Check that line in its draft before you approve.
   - LAHI is the first send since #957: CMS Checked should read `n/a` and drop out of the email.
2. **Today: show Williamson Construction to Tim** (P0-5; hard date 10-19, cutover planned for Wed 10-14).
   - **The HD restore is already done** [M]. `list_releases` on `williamson-construction` returns no pending release. On the live Content API, `home` (published 10-04 16:50Z), `about-us` and `services` (19:22Z) carry the `-1080`, `-720` and phone renditions. P0-5's "first, publish" step needs nothing more from you.
   - Show him <https://williamson-construction-co.netlify.app>.
   - Ask him three things: **D0**, what Webflow billing stops on 10-19; **D6**, who receives `/join-the-team`; **D7**, who holds GoDaddy for the domain.
3. **New: #1143, the D1 nightly Prismic pull-sync, is held (Operator decisions 72).** It went through two dirty review rounds. Round 2's two safety blockers are fixed on the branch but not reviewed. Its two correctness majors are not fixed:
   - a declined PR reopens on any commit to the site's `main`;
   - GitHub's "Update branch" leaves a site `held` forever while the run stays green.

   _Ask:_ (a) split the workflow, so the job that runs the client's toolchain holds no App token; or (b) keep one job, fix the two majors, and run a third round. _Worker's pick:_ (a).

   The worker wrote this ask on #1143's own branch, so `main` never carried it until this pass [M]. Nothing waits on it.
4. **Release PR #1140, `0.104.1`:** clean, opened 10-04 21:42Z [M]. It carries #1144 (the `lint` audit honours `.prettierignore`). Without it, the sites moved to the Prismic CLI read `fail` (two unformatted files) on their own generated files. You merged #1100 at 21:16Z, and `v0.104.0` was published at 21:36Z [M].
5. **Undated, still open:**
   - **Mantis, 🔴:** secret scanning, push protection and a ruleset on `mantis-landscaping`, and on the two Williamson repos (#754, BACKLOG 33 (d)). The newest #754 comment is still the 10-04 sweep [M]. Today's security sweep has not run yet.
   - **Mantis P4a:** submit the live `/contact-us` once from an ordinary browser (item 71's remaining half). Automation cannot mint a real Turnstile token.
   - **#1090 phase 5:** for each of the 13 migrated repos, click "Switch to type builder" and set the simulator URL in that repository's Prismic settings. Item 57 lists the URLs.
   - **#1090 item 57 (a), 🔴:** `PRISMIC_WRITE_TOKEN` for vida-legacy-foundation. The Tower Burbank is probably no longer an ask, by your 10-05 "dont worry about non maintenance sites" [I: that answer was about MCP activation, not tokens].
   - **Roalson 55 (ii):** name the colour to bring back at 20%, and what it goes over.
   - **Privacy 45 and 46:** parked.

### Yours to build [H]

None tagged.

### Waiting on you (Discord)

None.

[M, ~11:52Z: 8 channels active in 14 days, 66 candidate mentions, 0 neither replied to nor reacted to by you. The positive control widened the window to 20 days. It found 17 channels and 114 candidates, and it surfaced Erik's 09-17 lines in #full-financial, #acacia-landscaping and #alamo-anatomy, which earlier passes listed as answers rather than asks. So the scan still sees an unanswered mention. One limit: each channel reads at most 100 messages in the window.]

## What landed since the 10-04 report (merged on `main`)

Thirty-one PRs merged after 16:05Z: the release #1100, and thirty between #1116 and #1150, every one from a worker session or by you [M, pulls API]. #1117 (16:04Z) and #1118 were in the last report, and they are listed again below for completeness. In short:

| Area | PRs |
| --- | --- |
| **Mantis**: P2a, P2b seed and publish, `prismic-ci` (decision 69), P4a contact form, P4b newsletter (71) | #1118, #1122, #1130, #1135, #1139, #1147, #1150 |
| **#1090, the Prismic CLI migration**: baseline swapped to the `prismic` CLI (#1134); 13 site repos plus williamson-construction-co landed in phase 4 (#1145, #1149); `lint` honours `.prettierignore` (#1144) | #1126, #1134, #1138, #1144, #1145, #1149 |
| **Video (decision 63)**: the `video` encode command; phone rendition at 1200k; step 0 readings; the ERP rollout row | #1116, #1125, #1127, #1128, #1131, #1133, #1146 |
| **Privacy (P1-26)**: `analytics-tag` refuses a site with no `/privacy` | #1129, #1137 |
| **Tooling**: `prismic-ci` from the cloud (#1117); Lighthouse under root in a container (#1136, closed #1132); `land-prs` picks the merge method per base (#1141); starter cloud hook (70, #1142) | #1117, #1136, #1141, #1142 |
| **Docs**: the 10-04 PM pass, P0-5, the sites-in-build answers | #1119, #1120, #1121, #1123, #1124 |

Release `0.104.0` was published (#1100).

**Open PRs** [M, ~11:50Z]: **#1140** (release, yours, clean) and **#1143** (draft, held: item 72). Nothing else is open.

## Nightlies (scheduled, 10-04 16:05Z → 10-05 12:00Z) [M, Actions API and job logs]

Six scheduled runs in the window, all `success` on `main`:

| Run | When | Result |
| --- | --- | --- |
| renovate | 10-04 16:01Z, 10-05 02:32Z | green |
| release-health (10-04, pending at the last report) | 10-04 18:17Z | green |
| forms-deadletter-replay | 10-04 21:58Z, 10-05 06:17Z | green; the dead-letter table is empty [M, Turso] |
| fleet-db-backup | 10-05 11:45Z | `DUMP_VERIFY loaded=true tables=11 rows=1101 mismatches=0`, on the dump and on the round-tripped `.gpg` |

The row count rose by 2 (1099 → 1101), the first rise after three days of falls.

No "Nightly … failing" issue opened or closed. The bot-filed issues still open are #754 and #1007.

**Pending at 12:00Z (not yet started):** fleet-prismic-drift, fleet-security, fleet-lighthouse, daily-reports (the five drafts), fleet-smoke, fleet-form-e2e, release-health, and the later renovate and forms-deadletter-replay slots. These are the first fleet sweeps to run after phase 4 moved 13 sites to the Prismic CLI. The prismic-drift and lighthouse `lint` lines are the ones to read: #1144 is on `main`, so the nightlies run with it, even though the npm package does not carry it until #1140.

## Fleet snapshot (Monday, live Turso, SELECT-only) [M]

The full version is in BACKLOG's "Fleet snapshot".

- **Rows:** 47 sites, 15 of them maintained. Since 09-29, Mantis was added and Domaru archived.
- **Cockpit: 1 attention, 0 watch, 14 healthy** (on 09-29 it was 1 / 13 / 0).
  - The one attention item is Reddoor: "1 Renovate PR failing CI".
  - This was rebuilt with `buildCockpitModel` over the live rows, without the bounce and dead-letter inputs, so the attention count is a lower bound.
- **Unread submissions: 339**, Sonder 249 of them. The count was 327 on 09-29.
- **Certificates:** Espada 31 days, Beachfront 32, ERP 33. On 09-27 they read 38, 39 and 40.
  - Sonder (30 then) and 1836dig (32 then) have since renewed, which suggests these three renew near 30 days [I].
  - Re-read on 10-08.

## Refuting the week's claims (Monday)

Eleven [M] claims from the 09-30, 10-01 and 10-04 reports went through `refute-claims` against `main` at `ebcd0dc2`, one skeptic per claim and a completeness critic. Their evidence was the repo files, plus job-log lines and Turso reads saved this morning under `.session-logs/refute-evidence/`.

**Result: 8 confirmed, 2 refuted, 1 untested.**

- **Confirmed:**
  - `template.ts:32` still scaffolds `"footer"`.
  - `BASELINE_CSP` is at `:103`, and `frame-src` at `:117`.
  - The GA4 ids for Data Dynamiq (556916505) and Revogen (545817747).
  - Nothing merged between `a1424bdf` and #1117.
  - The GOLA branch: 13 commits, no PR.
  - The backup's `rows=1106/1100/1099`.
  - The lighthouse `wrote=21` and `retried` lines.
- **Refuted, though neither report was wrong:**
  - The 10-01 brief's `results = await audit(site);` at `launch.ts:618`. It was true on 10-01 (`git show` of that morning's `main` prints it at 618), but #1105 moved the call to `:717` as `audit({ ...site, deployedUrl })`. The item is done, so the brief is history and no pointer is needed.
  - "withFreePort only rewrites a URL's port". That narrowing was this pass's paraphrase. The 10-04 report said "only rewrites a url", and the function also forces the host to `localhost` (`free-port.ts:49`).
- **Untested:** that all five reports due today are due today. This is a behaviour claim, so no document can settle it. Its experiment is the SELECT-only read at the top of this report, which ran this morning with its control.

The critic found the finding that mattered.

- **The 10-04 line "so all five now carry an analytics section" over-reached.** It was [M] on the property id and [I] on the conclusion, and BACKLOG 49 says Data Dynamiq's tag is not installed. This report corrects it (top of stack 1), and the 10-04 report has a forward pointer.
- **Further open questions, not followed up:**
  - "Re-stamped at 13:48Z" is the run's creation time. Its summary lines are stamped 14:07–14:08Z.
  - The backup's `blob_bytes` reads 11437644 on every day while rows change. Either no blob changed, or the verify does not cover blob contents. This is worth one look by a worker [I].

## What went wrong, or nearly did

- **A worker's stop-condition question lived only on its own PR branch.** The D1 worker wrote item 57's held note into `docs/BACKLOG.md` on `claude/wizardly-brown-2ylvcv`, the head of the very PR being held. So nothing on `main` asked you anything for 13 hours. CLAUDE.md says to land the line as a docs-only PR, and that step was skipped. It is item 72 now.
- **A second unlanded docs tail:** `claude/jolly-keller-9h8tzh` has five docs commits not on `main` (10-05 01:32Z, no PR), from the session that landed #1149 two minutes earlier [M for the commits; whose session it is, I]. It is reported, not touched.
- **`list_sessions` / `get_session` are still not available to this Routine** [M, ToolSearch: no match].

## Live worker sessions (reported, not touched)

- **D1 pull-sync** (#1143, `claude/wizardly-brown-2ylvcv`, 10-04 22:21Z): ended at its hold; item 72.
- **#1090 phase 4** (`claude/jolly-keller-9h8tzh`, 10-05 01:32Z): landed #1149, and left the five-commit tail above.
- **Mantis** (P4b, #1150 at 02:50Z): landed; P5 is next and unclaimed.
- **GOLA** (`claude/practical-ride-kbipzv`): idle since 10-01 02:25:59Z, 13 commits, no PR [M].

## Next for agents (from the backlog, re-ranked)

**P1 order after the full re-rank:**

1. **P1-27, the port-picker race:** recommended. It is GREEN, small, and a red `build` already traced to it. No `EADDRINUSE` handling exists anywhere [M].
2. **P1-25, the Prismic toolbar under the CSP baseline:** recommended. It moved up because phase 4 put 13 sites on the Type Builder and simulator path, so previews and the toolbar are now used fleet-wide. `frame-src` at `src/configs/svelte.ts:117` is still `self` plus Vimeo [M].
3. **P1-24, the hydration marker:** ready, but ranked third because it is M-sized and needs `reddoor-starter`.

**Not ready:**

- **Mantis P5** is the owning session's next phase, not a fresh brief.
- **#921** needs a re-measure.
- **#1143** waits on item 72.

### Briefs

```markdown
## Worker brief — P1-27: retry an audit's server on EADDRINUSE

**Item.** P1-27 · no issue yet (open one) · 🟢 GREEN · effort S
`findFreePort` binds :0, closes, and hands the port to a server that binds it
later. On 2026-09-30 #1066's `build` failed 7 tests in
`tests/audits/a11y-live-spec.test.ts` with `EADDRINUSE … port: 40937` on a head
that differed from a green one only in docs [M, BACKLOG P1-27]. Nothing retries.

**Verify first.** `grep -n EADDRINUSE src/util/free-port.ts src/audits/a11y.ts src/audits/lighthouse.ts src/audits/smoke.ts`
Expect: no match [M, 2026-10-05 11:57Z].

**Start here.**

- `src/util/free-port.ts:24` — `findFreePort` (the TOCTOU note above it); `:47` `withFreePort`
- `src/audits/a11y.ts:407-415` — the second-port helper, and `:1272`, the preview port
- `src/audits/lighthouse.ts:190` — the port for the lhci server (it was `:164` on 10-04; #1136 moved it)
- `src/audits/smoke.ts:240` — the smoke server's port
- `tests/util/free-port.test.ts`, `tests/audits/a11y-live-spec.test.ts` — tests to extend

**Done when.** A test that squats the first port picked still gets an audit
result from each of a11y, lighthouse and smoke (up to 3 tries with a fresh
port), a server that fails for any other reason fails at once without a
retry, and each of those tests goes red with the retry removed.

**Mutations I will run** (each must turn a test red):

1. Remove the retry (today's behaviour).
2. Retry on every spawn error, not only EADDRINUSE.
3. Retry with the same port instead of a fresh one.
4. Allow unlimited tries.

**Stop conditions** (beyond AUTONOMY.md's six):

- If the server's EADDRINUSE cannot be told apart from other failures without
  parsing localized output, write the options under Operator decisions, land
  that line, and end.
- Do not change `--strictPort`: auditing the wrong server is worse than failing.
- Two dirty review rounds → "Operator decisions", landed on `main` as a
  docs-only PR (not only on your branch), not a third round.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` →
   Concurrent sessions); if one under a day old touches these files, stop.
2. Open and claim the issue. Worktree from `origin/main`. Red test first.
3. Repo checks (`pnpm lint`, `pnpm typecheck`, the changed tests), then a
   review, with the mutations table in the PR body.
4. Move P1-27 to BACKLOG's Done section in the same PR.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`.
6. Journal entry in `docs/workJournal.md`, landed before the session ends.
```

```markdown
## Worker brief — P1-25: the Prismic toolbar and previews under the shared CSP baseline

**Item.** P1-25 · no issue yet (open one) · 🟡 YELLOW · effort S
On a wired site the CSP blocked the Prismic toolbar
(`prismic.io/prismic-toolbar/4.1.10/toolbar.js`), the `<repo>.prismic.io`
iframe, and html2canvas for Share (williamson-homes#7). Fixed per site in
williamson-homes (`ca6027f`) and the starter (reddoor-starter#164); the
central baseline still has the gap.

**Verify first.** `sed -n 103,120p src/configs/svelte.ts; grep -n prismicRepository src/configs/svelte.ts`
Expect: `BASELINE_CSP` at line 103, `"frame-src": ["self", "https://player.vimeo.com"]`
at line 117, and no `prismicRepository` [M, 2026-10-05 11:57Z].

**Start here.**

- `src/configs/svelte.ts:103-118` — `BASELINE_CSP` (`script-src` at `:107`, `frame-src` `:117`, `connect-src` `:118`)
- `src/configs/svelte.ts:149`, `:174` — how a site's override replaces a directive
- `tests/configs/svelte.test.ts` — the config's tests
- reddoor-starter#164 — the per-site fix to match

**Done when.** The baseline admits the toolbar's script path and html2canvas,
and, given an optional `prismicRepository` option on `createSvelteConfig`,
that repository's `https://<repo>.prismic.io` in `frame-src`; with no option,
no Prismic host is framed. Each of those is pinned by a test. The fleet
rollout is per-repo PRs (🔴 as a mass push), not part of this item.

**Mutations I will run** (each must turn a test red):

1. Drop the toolbar host from `script-src`.
2. Frame `https://*.prismic.io` instead of the one repository.
3. Frame the repository host when `prismicRepository` is unset.
4. Let a site's `frame-src` override drop Vimeo silently (the existing replace rule must still hold).

**Stop conditions** (beyond AUTONOMY.md's six):

- If admitting html2canvas needs `unsafe-eval` or a `blob:` that widens
  `script-src`, stop and write the options under Operator decisions.
- No fleet sweep.
- Two dirty review rounds → "Operator decisions", landed on `main`, not a third round.

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches (`CLAUDE.md` →
   Concurrent sessions); if one under a day old touches these files, stop.
2. Open and claim the issue. Worktree from `origin/main`. Red test first.
3. Repo checks (`pnpm lint`, `pnpm typecheck`, the changed tests), a
   changeset, then the 3-lens review (feat), with the mutations table in the PR body.
4. Move P1-25 to BACKLOG's Done section in the same PR.
5. `node scripts/land-prs.mjs <pr>` from a worktree detached at `origin/main`.
6. Journal entry in `docs/workJournal.md`, landed before the session ends.
```

## Evening

**Headline: #1143 waits on your answer to item 72.** Do you want one narrow review of `5a46bd67`, or should it land now? Also new tonight: one ask that exists only on a branch (item 87, #1199). `time-travel` is red, and a worker has claimed it (#1171 → #1193). [M]

Evening pass, 2026-10-05 17:49 PT (00:49Z 10-06). `<since>` = #1151 merged_at, 2026-10-05T12:07:33Z.

### Asks (all dated 2026-10-05, in the order they were written)

1. **Five October Maintenance drafts, held by you for the Best Practices 78 (P0-4, #1197).** Data Dynamiq, Espada, LA Homelessness Initiative, Revogen and Vineyard Custom Homes are drafted and pending approval [M, Turso SELECT]. Don't approve them until the BP worker clears the 78. After that, approve on `/s/data-dynamiq`, `/s/espada`, `/s/la-homelessness-initiative`, `/s/revogen` and `/s/vineyard-custom-homes`, and each one sends with the next run. LAHI stores 100, so the hold on it is yours to lift separately [M, journal #1197].
2. **Verdict on the five [TEST] sends from 22:47Z** (Data Dynamiq, Espada, LAHI, Revogen, Vineyard; Clean-send streak table). Reply `clean` or say what was wrong. The streak stays at 1 until you answer [M].
3. **Item 79 leftovers (CalTex):** tell Erik that Our Story and AED Programs are live. Then delete the stray asset `_t3eeXeDKfYMiE5v` in caltex-landing's Prismic media library [M, BACKLOG].
4. **Item 80: mantis-landscaping#29.** (a) land it as it is, or (b) run a third review round. Worker's pick: (a).
5. **Item 81: Roalson release `asP91BIAAH8K23X-`.** Upload `hwy-46-at-spencer-ranch-feature.jpg` and `hwy-46-at-spencer-ranch-package.pdf` to the Roalson media library, or tell a session where they are. Then publish the release. Nothing on `main` records that it was published [I].
6. **Item 82: two Roalson aerials** (Loop 1604 at Dove Canyon, 5930 Bandera Road). (a) ask Matt for landscape aerials, (b) letterbox them, or (c) accept a trimmed outline. Pick: (a).
7. **Item 85: merge caltex-landing `staging` into `main`.** That is the production deploy, and it puts editors on slices. Worker's pick: merge it as is.
8. **Item 72: #1143, the D1 pull-sync split.** (a) authorise one narrow review of `5a46bd67` (the two blocker fixes), and land if it comes back clean; or (b) land now, with the first scheduled run as the instrument. Pick: (a). Since 00:32Z the PR head has had `main` merged in three times (now `138cbd0a`), so a live session is keeping it current [I]. Also from item 72, still yours: decide whether to rotate the-pointe-burbank's `PRISMIC_WRITE_TOKEN`, which round 3's demo printed into a session transcript (🔴).
9. **Item 87, asked only on a branch** (`claude/sleepy-allen-vhbrwu`, open #1199), verbatim:
   > 87. **Dead letters wait two replay cycles before they alarm? (new 2026-10-05, from issue #1190's inventory.)** … - _Ask:_ (a) wait two replay cycles (12h from the oldest unreplayed row's `received_at`) before alarming, for a slug that resolves to a site; (b) keep alarming from the first row. - _Worker's pick:_ (a). A slug that resolves to no site stays CRITICAL at once either way: replay cannot place it.
10. **Unprotected branch `claude/jolly-keller-9h8tzh`** (3 commits not on `main`, no PR, last commit 23.3 h ago: "docs: resolve the BACKLOG and journal merge with main; prettier on the journal table"). Open a PR from it, or say it can go. The morning report reported it without asking.
11. **Release PR #1183** (`chore(release): version packages`, opened 22:32Z, CI in progress) is yours to land, as always.

Still yours from earlier answers, not re-asked: item 74 (the Williamson poster frames, by hand) and item 78 (the Mantis matching gate, laptop only).

### Evidence

`EVENING_BRANCHES_SUMMARY main_decision_lines=507 asks=1 decision_lines=2 stale=8 stale_fresh=1 scanned=13 older_skipped=30 now=2026-10-06T00:50:09.149Z` [M]. The scan covered 13 branches, so the check ran. The other branch-only decision lines are `jolly-keller`'s status notes, which are not asks. The seven `older` unprotected branches are known residue: `a11y-blend-mode-unmeasured`, `a11y-browser-missing-csp-r3`, `blissful-feynman-xxghob`, `digest-send-exact-rule`, `nifty-dirac-2zmegy`, `pm-0930-answers` and `practical-ride-kbipzv`.

**Nightlies, scheduled, created ≥ 10-05 00:50Z** [M, Actions API and job logs]:

| Run | Result | FLEET_WRITE_SUMMARY |
| --- | --- | --- |
| fleet-db-backup | success | (no line; not a fleet write) |
| fleet-prismic-drift | success | wrote=15 failed=0 total=15 |
| fleet-security | success | wrote=15 failed=0 total=15 |
| fleet-lighthouse | success | wrote=15 failed=0 total=15; wrote=23 failed=0 total=23 |
| daily-reports | success | 5 drafted; digest sent |
| fleet-smoke | success | wrote=15 failed=0 total=15 |
| fleet-form-e2e | success | wrote=15 failed=0 total=15 |
| time-travel | **failure** | 1 file failed: `tests/audits/a11y-live-spec.test.ts` "freezeMotion reaches ::before and ::after (#1018)"; 8602 tests passed. Issue #1171, claimed 23:09Z, fix in #1193 |
| release-health | success | — |
| renovate ×2, forms-deadletter-replay ×3 | success | — |

No nightly is pending. Issues opened since `<since>`: #1171 (time-travel, open) and #1190 (cockpit "just wait", open). Closed: #1155 and #1156.

**Merged since 12:07Z: 42 PRs.** All are the operator account's sessions except #1140 (renovate). Code: #1164 (P1-27, the audit port retry), #1160 and #1178 (analytics-tag; Data Dynamiq GA4 live), #1157 (P1-25, the Prismic toolbar CSP), #1194 (P1-24, the smoke `data-hydrated` marker), #1195 (`verify-dump` hashes contents), #1162 (the evening pass and its script), #1140 (release). The rest are docs and BACKLOG: #1152–#1154, #1158, #1159, #1161, #1163, #1165–#1170, #1172–#1177, #1179–#1182, #1184–#1186, #1188, #1189, #1191, #1192, #1196–#1198 and #1200.

**Open PRs, 00:5xZ:** #1183 release (CI in progress); #1143 (CI in progress, item 72); #1193 (time-travel fix, CI in progress); #1199 (item 87, CI in progress); #1187 (docs, post kit, green). None is a draft and none has a failing check [M].
