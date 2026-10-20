## 2026-10-20 — rfp-analyze runs in a cloud session (claude-skills#22, reddoor-rfp-analyses#3)

Worker session for the operator's 2026-10-19 brief, started from the cockpit session. The work is in the two other repos; this entry is the record from the maintenance side. Both repos' journals carry the same entry.

The operator asked on 2026-10-19 for `/rfp-analyze new` and `run` to work in a Claude Code cloud session with no setup beyond attaching `reddoor-rfp-analyses` and `claude-skills`. The install is a SessionStart hook in `reddoor-rfp-analyses` (`.claude/hooks/cloud-session-setup.sh`, PR reddoor-rfp-analyses#3). The skill gained cloud notes in SKILL.md and a calibrate test that can pass (claude-skills#22).

**What the container lacked, each one measured.**

- Skill install: the container had no `~/.claude/skills/rfp-analyze`, so the hook runs `install.sh`.
- Browser build: `playwright@1.60` wants `chromium_headless_shell-1223`, but `/opt/pw-browsers` ships 1194 and 1234. `capture.test.mjs` hung for 90 s and `e2e.test.mjs` failed on "Executable doesn't exist" until `playwright install chromium` ran. The CDN is reachable.
- Proxy CA: with an empty `HOME`, a Playwright load of ohiojusticefoundation.org fails with `ERR_CERT_AUTHORITY_INVALID`. After the hook imports the egress proxy's CA into `~/.pki/nssdb` from that same fresh `HOME`, the load returns `OK 200`.
- `REDDOOR_REPOS` needed only `reddoor-starter`. The skill reads its `src/lib/slices` and `docs/` and nothing else from the fleet. Calibration reads `_learnings/` inside the estimates repo. So the cloud is calibrated on exactly what the laptop is, and the operator didn't need to be asked. `reddoor-starter` is public, so the hook clones it without `add_repo`.

**One test that had never passed.** `calibrate computes per-phase multipliers` failed on every machine since the subtree import. `calibrate()` rounds to two places, 68/56 = 1.2142… comes back as 1.21, and the test allowed 0.001. The tolerance is now 0.005. Mutation check: swapping `act / est` for `est / act` turns it red. Skill tests: 28/28.

**The deterministic half matched the laptop byte for byte.** For Ohio Access to Justice Foundation (`clients/2026-05/ohio-justice-foundation`):

- `extract-pdf` is identical; so are Dulverton's and Discover Classical's.
- `calibrate` is identical to `multipliers.json`.
- `render-report` of the committed `bundle.json` equals the committed report except a 35-line section 1a that was added by hand after rendering, with 0 lines removed.
- A live cloud crawl captured 100/100 pages against the laptop's 99/100: the same 99 URLs plus one. 98 of the 99 shared pages fingerprint identically, and the clusters are 89+11 against 89+10.

**The fresh-session run.** A child session (`session_01VKHKyefz615AXg6WZTjjr3`) started from the PR branch.

- At startup the hook said, correctly, that `claude-skills` was not attached. `create_session` takes one source, so this was a real test of the negative path.
- After `add_repo` and a re-run, the hook took 24 s and `/rfp-analyze` appeared in the skill list mid-session.
- It ran all five phases in about 17 minutes, 14 of them crawling, with every answer taken from the original run's recorded decisions. It pushed `e8168e8` on `claude/ohio-cloud-rerun`.
- Phase 1 came out at 156 / 232 / 356 hrs against the laptop's 230 / 275 / 345.

**Why the numbers differ, and it isn't the cloud.** Row by row, the gap is three calibration multipliers: Setup 0.59×, Slices 0.43× and QA 0.43×. The cloud run applied them because SKILL.md step 5.2 says to. The laptop run deliberately did not, citing `_calibration-corpus.md` §8 ("do NOT then multiply … you'd be double-counting"). SKILL.md never mentions that rule, so a fresh laptop session would land where the cloud did. Filed as claude-skills#23.

The crawl also kept the first 100 sitemap URLs, which on a WordPress site means 2010–2012 posts and no core pages. The laptop run worked around this by hand in May. Filed as claude-skills#24, with the missing `provisional_type` and viewport-only screenshots.

The Phase 2 board-portal estimates differ more (38 / 60 / 91 against 145 / 195 / 255). That gap is scoping judgment, not machinery.

**Beliefs corrected.**

- "The hook is silent when it works" was half true. It sends no message, but a hand re-run prints npm's and Playwright's progress. The docs now say so.
- The 2026-10-20 brief expected `report.md`. The skill has written `<slug>-web-rfp-report.md` since 2026-05-28.
- The maintenance `CLAUDE.md` line saying the `rfp-analyze` checkout "has no `origin` at all" is stale: the source is in `reddoorla/claude-skills`. It was left for the operator.

**Not proven.** The web-UI case, with both repos attached at creation, was not exercised. The hook handles it by finding `/home/user/claude-skills` first. Merging both PRs was refused by the auto-mode classifier ("Merge Without Review"), so both wait on the operator.
