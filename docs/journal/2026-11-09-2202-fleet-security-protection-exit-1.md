# 2026-11-09 — fleet-security's nightly `##[error] exit code 1` was the protection audit finding gaps, and it hid a silent crash path

> Issue reddoorla/reddoor-maintenance#1979; PR on branch `fix/1979-protection-step-outcome`. Minors filed: #1986, #1987.

**The ask.** The morning reports of 11-05 and 11-09 noted that each night's `fleet-security` run logs `##[error]Process completed with exit code 1.` while it concludes success, "on 11-04 and the four nights to 11-08". The operator queued it at 12:35pm PT.

**Which step, and why green.** It comes from step 11, `Protection coverage audit (org-wide)` (job log of run 42571679746, 10:12pm PT 11-08). That step pipes `protection-audit --org reddoorla` into `tee` under `set -o pipefail`, and it carries `continue-on-error: true`. The CLI returns `protectionAuditExitCode(gaps)`, which is 1 whenever `gaps > 0`. That night it printed `PROTECTION_AUDIT gaps=11 covered=19 skipped=7 total=37`. Step 12 then did its job: it rewrote and commented on #754, "Fleet protection coverage gap". So the line was the alarm working, not a check that failed to run.

**Belief corrected: it did not start on 11-04.** The same error line and the same `gaps=11` summary appear in every run I pulled: 10-23, 10-27, 10-29, 11-01, 11-02 (both runs), 11-03, 11-04, 11-05 and 11-08. The 08-12 run (31572846875) printed `gaps=0 covered=24` with no error line. The step and its `continue-on-error` date from #483 (2026-08-02), and #754 was auto-filed on 09-10. So the line has printed on every night with a gap for about two months. The reports only started naming it on 11-05.

**Why it was still worth a change.** Harmless as a gap signal, but the step outcome was the only thing downstream steps read, and it could not tell a gap from a crash. `runOrExit` prints nothing and exits 1 on a throw. On a crash night, then:
- The step failed exactly as on a gap night.
- The open step commented "see run output" on #754.
- The UNMEASURED step (#1612) found no UNMEASURED line and passed.
- The Renovate outcome step warned `drought=unknown`.
- The run ended green.

So a real check could stop running with nobody told. That has not happened yet: every night on record printed its summary.

**The fix.** The step now classifies its own exit into `outputs.gaps`, following the repo's yes/no convention (`drought`, `drifted`, `behind`):
- `yes` means exit 1 beside a counted `PROTECTION_AUDIT gaps=N` with N > 0.
- `no` means exit 0.
- Anything else fails the step and sets no output.

The open and close issue steps key on that output. A failed audit step now only ever means "did not measure", so the renamed "Fail the run when the protection sweep did not measure" step always reds the run, with an `::error::` naming the cause. On gap nights the run is green, with no `##[error]` line, and #754 is updated as before.

**Review.** Two Opus rounds.
- **Round 1, one major:** my first version reddened the run only when `protection.out` had no summary. A summary beside a mismatched exit code, or printed just before a hang into the 15-minute timeout, still ended green with no issue touched. Round 1 also had three minors, all folded in: the conditions test checked only the positive side, two open-step tests described inputs that can no longer reach that step, and the generic failure issue body did not name the new cause.
- **Round 2, minors only, so clean:** two false comments and the step name were folded in. Two were filed. #1986: whether Actions reports a timed-out `continue-on-error` step as `failure` or `cancelled` is unproven, and if it is `cancelled`, that night still ends green. That is not a regression. #1987: a whitespace-only token takes the CLI's clean skip.

**Test changes.** Two assertions changed because the behaviour they pinned changed:
- The #1612 test "a sweep with real gaps leaves that step green" ran the fail-step script on gap output. That script now reds unconditionally, and on a gap night it no longer runs at all. The test moved to the audit step and asserts `gaps=yes` there.
- The conditions test for the protection-gap open and close steps evaluated `outcomes.protection = failure | success`. It now evaluates `output = yes | no`, plus negative cases.

**Mutations, all red:** dropping the exit-1 check, a gaps regex that accepts 0, the gaps branch falling through to `exit $code`, the round-1 summary-gated fail step, close or open keyed back on `outcome`, the clean path writing no output, and the open condition as `!= 'no'`.

**Not run:** `fleet-security` itself. It fires `renovate-dispatch` in client repos, so every step was exercised by extracting its shell, as the existing red-path tests do. The full suite gave 12967 passed and 1 failed. The failure is `tests/scripts/dropbox.test.ts` "re-executes through HTTPS_PROXY", which fails the same way on unmodified `main` in this container.

**The 2 `unmeasured` Renovate repos** (reddoor-website, roalson-interests) are a separate, designed WARN: the merge window is full, and they are "listed, never alarmed on alone". They are not this step's exit code, and I left them alone.

Usage: not readable
