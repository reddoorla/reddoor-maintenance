---
"@reddoorla/maintenance": patch
---

github/package-manager-pin: retire both accepted gaps, which now mask a real regression, and re-derive the fleet fixture from live GitHub (#690)

`PACKAGE_MANAGER_ACCEPTED_GAPS` accepted "no packageManager field" for
`reddoorla/claude-skills` and `reddoorla/reddoor-md-pdf` until 2026-10-01. Both
acceptances are dead, verified against live GitHub rather than inferred:

- both repos carry `packageManager: "pnpm@11.11.0"`;
- `reddoor-md-pdf`'s `pnpm/action-setup` step no longer takes a `version:`
  input at all — no repo in the fleet does;
- and `claude-skills` is PRIVATE, so this sweep skips it and has never judged
  it. The acceptance naming it could not have applied even while it stood.

A dead acceptance is not inert. It is scoped to one repo AND one surface, so
for as long as it stands the named repo is the only repo in the fleet whose
"no packageManager field" gap cannot gate. Had either of these two lost the
field again before the expiry date, the nightly would have reported it as
accepted-with-expiry and gated nothing — silencing exactly the two repos that
had most recently proven they were the ones that lose it.

The `realFleet()` fixture is re-derived from the org repo listing, every
repo's `package.json`, and all 75 workflow files parsed by this module's own
`parsePnpmActionSetupPins`. The shape it replaces was already untrue when it
was written: it listed `claude-skills` as a judged repo with no field (it is
private and skipped), called `reddoor-prospect-runner` and
`reddoor-rfp-analyses` out-of-scope package-less repos (both private, skipped
before that branch), and named six repos that do not exist in this org. The
judged population is 26 non-archived public repos — 25 on `pnpm@11.11.0`,
`.github` out of scope, six skipped.

The gate's own failing arms are kept and strengthened. Both now inject their
failure rather than borrowing a live repo's shape: a failing arm that depends
on one repo's current state stops being exercised the day that repo is fixed,
which is what happened to the arm built on `reddoor-md-pdf`'s real `ci.yml`.
The expiry mechanism is now driven through the injected `accepted` parameter,
because a test reading an empty shipped constant asserts nothing while looking
like it asserts something.
