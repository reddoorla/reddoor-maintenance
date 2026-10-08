## 2026-10-08 — "Refresh preview" writes the Search Console lookup back to `site_health` (P1-36, #1261)

The cockpit's Watch kept saying "Search Console: no property matched (lookup
2026-10-05)" for Data Dynamiq and LAHI after both resolved live at ~12:30Z.
The three lookup cells were written only by a draft (and by announce, a hit
the brief's verify grep did not expect: `src/recipes/announce.ts:135`).
"Refresh preview" ran the same `fetchSearch` and dropped its `lookup`. Now
`rerenderReport` hands that lookup to an injected `storeLookup`, bound in the
CLI to `mirrorHealthFields`, the function the draft's site mirror calls, with
the same `lookupFields` builder. A lookup that did not run (`lookup: null`:
no credentials, not enrolled, no period) writes nothing, so a credential-less
run never erases the evidence. The `REPORT_RERENDER` line gained
`lookup=resolved|no-property|soft-fail|not-run|no-row|write-failed`.

**The approved-report decision.** A SELECT-only read at ~15:50Z showed both
rows still `no-property` from 10-05 18:36/18:37Z, and both October
Maintenance reports `approved_to_send=1`, unsent. LAHI's `approved_at` is
15:04:18Z, six minutes before the operator's 15:10Z refresh. Data Dynamiq's
`approved_at` is null although the flag is set. Under the old code an
approved report skipped `measureSearch` entirely, so that refresh could not
have read `search=measured` for LAHI. The brief's line is not reconciled
here; it does not change the fix. A fix gated on "unapproved" would therefore
not have cleared either Watch line. I chose to run the lookup alone for an
approved, unsent report: the lookup is site state, nothing under
`src/reports/` (approve, send, render) reads the three columns (the
data-safety reviewer grepped the consumers: the cockpit, onboarding and the
row readers), and the report's evidence, scores and body stay locked: the
signal handed to the retick is still `undefined` for an approved report. A
sent report is still refused before anything runs.

**Review.** Three lenses, one round. Correctness: clean. Data safety: clean;
no new secret or permission (the workflow already writes reports with the
Turso token, and `field-map.ts:181-183` maps all three keys). Both flagged the
same minor point: a refresh during a Search Console outage writes `soft-fail`
over a good `resolved` (or over a real `no-property`, silently clearing the
Watch line). That is the draft's documented contract (`site-fields.ts`, "a
soft-fail or a no-match replaces an older `resolved`"), kept for parity; a
refresh just makes it reachable more often. Changing it is a contract change
for both writers, left alone. Tests: 16 mutations, two survivors (an approved
report on an opted-out site, and one with no period, both would have run the
lookup), now pinned. The full suite also caught what my own grep missed: the
CLI binding test's `fleet-state` mock had no `mirrorHealthFields`, so it now
pins the binding too (dropping the line goes red).

**A tooling slip.** My first mutation runner restored with `git checkout -q
src` while the implementation was uncommitted, which reverted it after M1;
M2–M4's first results ran on the old code and were discarded. Rerun after a
commit, each went red. Commit before mutating.

**What the operator presses.** On the cockpit, "refresh preview" on Data
Dynamiq's and LAHI's October reports. Each run's line should read
`lookup=resolved`; the Watch lines clear on the next cockpit load.
