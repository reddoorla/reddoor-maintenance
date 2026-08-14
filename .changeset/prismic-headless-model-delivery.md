---
"@reddoorla/maintenance": minor
---

Deliver Prismic content-model changes headlessly, from a reviewed PR.

A custom-type or slice-model edit now rides normal code review: CI comments the
delta on the pull request, and merging pushes the models to Prismic through the
Custom Types API. Nobody opens Slice Machine to deliver a schema change, and the
same comparison runs nightly across the fleet so an out-of-band cloud edit —
Type Builder, a dashboard hand-edit, a stray Slice Machine push — surfaces as
drift on the site's row rather than as a surprise months later.

The reason this is worth building rather than tolerating: the Migration API
silently drops any document field the registered model does not declare. HTTP
200, no warning, content gone. A unit test cannot catch it, because the local
model is correct and the binding constraint is the remote one.

New: `prismic-models [site]` (dry by default; `--apply`, `--pull`, `--tokens`,
`--fleet`, `--comment-file`, `--write-airtable`), a `prismic-ci` recipe and
fleet command that roll the delivery workflow out as a per-repo pull request,
a nightly `fleet-prismic-drift` sweep, and three Airtable verdict columns wired
through to the cockpit and the morning digest.

Two properties the design is built around, both enforced rather than documented:

- **Nothing deletes.** The models module exports no delete path, and a
  module-wide capability guard fails the suite if any file in it acquires one
  through a channel the guard can see. Models present only in Prismic are
  reported, never removed. The guard is a tripwire against accidental
  introduction and explicitly not a security boundary — its header names the
  escape classes that remain open.
- **"I could not read it" never renders as "it is not there."** Every probe in
  this feature separates whether a check ran from what it found, because
  collapsing the two is how a fleet check reports a clean run it never
  performed.

Two operator steps are required before any of it does anything: add `unknown`
as a third option to the Airtable `Prismic Models` single-select, and mint the
`PRISMIC_TOKEN_*` secrets — `prismic-models --fleet airtable --tokens` prints
the exact name per site and is the only authority on them, because four of the
fifteen derive from a Prismic repository name that differs from the repo's.
