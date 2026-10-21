# 2026-10-21 — form-e2e reads the POST, and a sweep that probed nothing is red

**Where it landed:** branch `claude/1610-form-e2e-blind`, closing #1610. Brief: the workspace's `briefs/2026-10-21-write-gate-blind-spots.md`. The shared write gate it sits beside is #1605 (#1653).

**Why.** The P1-33 sweep found two blind inputs.

- **The banner was the whole verdict.** A local fixture whose POST returned 500, and whose page wrote its error into the same `role="status"` region as its thanks, scored `post_status=500 status=pass` in headless Chromium.
- **Every site self-skipping read green.** When `/health` drops `forms.testMode` on all 10 sites, every one self-skips and is still written (`checkedAt`, a Turnstile null). The output was `wrote=10 failed=0` with a warning only.

**What changed.**

- Once the status region shows, the runner gives the same-site action POST up to 2 s to answer. A 4xx or 5xx takes the existing failure path, whose detail now opens "the status region showed, but the submission failed — POST 500 …".
- The workflow reds only when `probed=0`, meaning no site submitted (a pass or a warn). Partial self-skips stay the warning the workflow's own comment defends for the rollout: 7 of 17 sites on 10-19 and 2 of 17 on 10-20. A 25% threshold would have redded a real night.

**Known-good.** Last night and the night before, 21 rows across the two form-e2e runs were probes that submitted, so `probed > 0`. The banner-and-POST check adds no wait when the POST has already answered, which on the fixture it always has.

**Not checked.** Whether any fleet site actually renders errors in `role="status"` (the issue's realism caveat). The starter was not read.
