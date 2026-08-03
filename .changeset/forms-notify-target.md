---
"@reddoorla/maintenance": minor
---

New `forms-notify-target <site>` command: show who a form submission would email before sending one, and optionally flip the pre-launch guard with a read-back confirmation.

The guard is a single Airtable `Status` cell. Nothing reported its state while testing — not the site, not `/health`, nothing between "I intended to flip it" and "the client received a test lead" — so on 2026-08-03 a flip that never landed sent a real client a test submission, which email cannot undo.

Read-only by default. `--set on` routes notifications to the operator and then RE-READS the row to confirm; an unconfirmed flip prints `NOT CONFIRMED`, says not to test-submit, and exits non-zero, because a write call returning is not evidence the field changed. `--set off` requires an explicit `--restore <status>` and the command refuses to flip a site that is not `maintenance`, so it can never invent a status for a site that was `hosting` or `legacy`.

Every address it reports comes back out of `resolveRecipients` itself — for a routed site each branch is probed and the results unioned — so the answer cannot drift from the real send path.
