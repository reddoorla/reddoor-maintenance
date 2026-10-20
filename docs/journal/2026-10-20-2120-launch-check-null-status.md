## 2026-10-20 — launch-check judges a row with no status as before launch (#1450, this PR)

This adds to `2026-10-20-2042-review-minor-batch.md`, which left #1450 with the operator. He answered (a) at about 21:04Z. Now a row whose `status` is null gets the pre-launch schedule rules in `launch-check` only:

- its first report must not have passed;
- the day must be a strict `YYYY-MM-DD`;
- an unknown `testing_freq` is refused.

The reason is that `nextDueDate` drafts a null row like a live one. Before this, `status: null`, Quarterly, `maintenance_day: 2026-03-01`, no send yet, read `ok` on 2026-10-20, and its first report (2026-06-01) would then have drafted back-dated.

The review was clean. It noted one cost, now written in the docblock: a null row that has already sent reports is held to the same rule, though the scheduler counts its next report from the last send. `--allow-missing schedule` is the way past. No null-status rows exist today.
