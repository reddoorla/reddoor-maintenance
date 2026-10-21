# 2026-10-21 — Two blind gates closest to a client: dead-letter replay and daily-reports

**Where it landed:** #1630 (#1615, dead-letter replay) and this PR, #1631 (#1613, daily-reports). The brief is reddoorla/reddoor-workspace `briefs/2026-10-21-blind-gates-leads-and-reports.md`. The inputs come from that morning's negative-control sweep (`audits/2026-10-21-nightly-negative-controls/README.md` there).

**Why these two.** Both gates sit one step from a client. The dead-letter replay printed `PASS: replayed=3` in two cases: three leads that the store had just refused (a retired `formType`), and three leads placed with no email because `RESEND_API_KEY` was unset. Both kinds were counted in `replayed=`. Daily-reports had three blind spots. It called an empty approved queue a successful send. It never read `NEXT_DUE_WRITE`. And a truncated send-log row re-sent the digest as `decision=first` while the gate, which read only the write, passed.

**How each was proved.** The rule was known-good first. Every case ran the real code: the `db replay-deadletters` handler, `report --send-ready`, `report --digest`, and `writeNextDueDates`. Each ran on a scratch `file:` database migrated by the checkout, and its output went into the step's bash, extracted from the YAML. The healthy inputs were last night's real lines:

- runs 39560536344 and 39454599845: `NEXT_DUE_WRITE wrote=0 skipped=47 failed=0 mirrored=0 mirror_failed=0 mirror_missed=0`, `No reports ready to send.`, `DIGEST_SEND_LOG write=1 decision=worse`;
- the replay's empty queue.

Each was shown green before any red was trusted. Production was read once, read-only, at about 7:40am PT. It had 47 sites, 0 unsent reports, 0 approved reports outside the queue, 0 sites without a `site_schedule` row, and all three `digest_state` rows decoded, so tonight's runs cannot trip the new gates.

**"Nothing approved" against "approvals the queue cannot see", from the code.** The approve write requires `draft_ready = 1`, and a supersede touches only unapproved rows. So an approved, unsent, unwithdrawn row that is not draft-ready lies outside every intended path. Announce's reuse path is one real way in, because it hands `queueDraft` a row that may already be approved. The send now reds by name on such rows. The check is one query, the queue's own WHERE with `draft_ready = 0`. My first version compared two reads, and round 1 showed that an approval landing between them reds a healthy run. A store with no sites is red too.

**What this cannot see**, said in the PR: a swapped database that looks normal but holds none of the operator's approvals. Only a second authority could catch that, for example the 16:07Z send clock passing an expected count. That lives in `src/dashboard/**`, which another session owned today.

**The review found more than the tests did.**

- #1630 took three rounds and #1631 three. Two lenses found #1630's worst defect on their own. A rejected or un-emailed row is terminal, so the next replay is green, and before the fix it would have closed the tracking issue as "Recovered" six hours later while the lead stayed lost. The issue now names each row, and a green run leaves open any issue that names one.
- The test-evidence lens kept finding mutations that survived:
  - a `gh` stub that ignored `--jq`, so "reads the comments" was the body test run twice;
  - missing-counter tests that dropped two counters at once, so neither half was proven;
  - a CLI exit code nobody asserted, because the gate ignores it;
  - a query that dropped `sent_at`, `withdrawn_at` or `approved_to_send` with every test still green.

  Each is now red. One worth remembering is a bash fact: inside an `if`, `[ "" -gt 0 ]` is false. A marker missing a counter therefore passes unless something checks for the empty string first.

- Round 2's SIGPIPE finding on #1630's close step (`printf | grep -q` under pipefail) was real in the abstract but cannot fire today, because the workflow sets no `shell:` and Actions runs `bash -e`. It became a here-string anyway.

**Defects of my own that CI or a test caught:**

- moving the replay report out of `db.ts` shifted five runbook citations in `continuity.md`; `runbook-anchors` caught three;
- an apostrophe in "site's", inside the single-quoted `printf` of the daily-reports issue step, ended the string early. `tracking-issue-conditions` caught it before the push.

**Filed, not built:**

- #1626: an accepted lead on a site with no recipient reads as notify `skipped`, in live ingest as well as in replay;
- #1634: round 3's test gaps on #1630, namely open → close never run end to end, a one-lead marker case, and the 50-line boundary.
- #1639: round 3's minors on #1631. A stuck unqueued approval reds twice a day under send-clock wording, and the send-log shape check accepts any one known key.
