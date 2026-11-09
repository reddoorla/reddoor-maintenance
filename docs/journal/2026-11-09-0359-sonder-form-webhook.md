# 2026-11-09 — A per-site form webhook: every opted-in form type, full submission (branch `feat/form-webhook`)

Gallery Sonder wants every RSVP, newsletter signup, inquiry and appointment/contact submission sent to one webhook URL. Their marketing person will build the Salesforce side from it as a Zapier or Make hook. Until now the ingest forwarded only newsletter submissions, to `sites.newsletter_webhook`, with a lean seven-key body (email, name, formType, site, sourceUrl, utm, submittedAt). Any site using that URL maps that body, so it had to stay exactly as it was.

**Design, and why this one.** I added a second, independent destination instead of widening the first behind an opt-in flag. The new columns are `sites.form_webhook` (migration 0056) and `sites.form_webhook_types` (0057, a JSON array like `accepted_watch_conditions`; NULL means every type). Setting the URL is the opt-in. Extending `newsletter_webhook` would have needed a mode flag anyway, and would have left every existing newsletter hook one mis-set checkbox away from a different body. With a separate column, a site that never sets it cannot change behaviour.

`buildFormWebhookBody` sends:

- id, formType, site, name, email, phone and message;
- `fields`, the site's own fields: an inquiry's piece/artist/role, an RSVP's event/guests, an appointment's company/appointment_date/appointment_time;
- sourceUrl, the stored `utm` string plus `utm_source`…`utm_content` split out, and submittedAt.

Each attempt stamps `form-webhook:<outcome>` after the existing tokens. The prefix is `form-webhook:` rather than `webhook:` so that a site with both destinations stays unambiguous, and `fanoutFailures` reads any `<dest>:<outcome>`. Spam is never forwarded: the same `isSpam` guard covers it as the newsletter destinations. Both fields are editable on `/s/:slug`.

**Review round 1, three Opus lenses (behaviour, security, store/UI): no blocker, critical or major.** I folded in four minors and one nit, all in files the PR already touched:

- `fields` leaked ingest's own bookkeeping: `_reply` (the autoresponder copy, which `payload.ts` keeps on purpose) and the `composedMessage`/`visitorText` flags. The behaviour and security lenses both reproduced it. These keys are now stripped.
- The SSRF guard checks only the first URL. Now that the body is the whole submission, the form forward uses `redirect: "manual"`, so a 3xx is recorded rather than followed. The newsletter forwarder followed redirects before this PR too; I left it as it was and filed an issue.
- An unreadable `form_webhook_types` cell read as `[]`, which means every type, so a corrupt cell would have widened an inquiry-only site to every form. It now reads as a list that matches nothing, and the reader logs it.
- My edits had shifted line citations in `docs/runbooks/continuity.md` into `db.ts`, `ingest.ts`, `site-details.ts` and `fleet-state.ts`. One still passed the anchors test only because a neighbouring line happened to match. All are now pinned to their exact lines.
- The doc comment promised null for every absent value. In fact name and email are stored as "" when a form does not ask for them, and the comment now says so.

The remaining minors are filed as issues and linked from the PR.

**Mutations (named in the brief, run before review):**

| Mutation                          | Tests red |
| --------------------------------- | --------- |
| Drop the form-type check          | 1         |
| Drop the URL opt-in               | 2         |
| Forward spam                      | 1         |
| Drop `extra_fields` from the body | 3         |

Restored, everything is green.

**Beliefs corrected on contact.**

- The brief's end-to-end proof says to submit each form type "in test mode on staging" and read the bodies at a request catcher. That cannot work. `testMode` returns before persist and before the whole fan-out (the synthetic-probe short-circuit in `ingest.ts`), so a test-mode submission never reaches any webhook. A real proof needs real submissions, which would email `info@gallerysonder.com`. It also needs a production write of Sonder's setting, and this session was refused even a read-only production Turso query. I took this to the operator as a question rather than work around it.
- The Dropbox CLI test (`tests/scripts/dropbox.test.ts`, "re-executes through HTTPS_PROXY") fails on untouched `main` in this container, because Node prints an EnvHttpProxyAgent warning to stderr. It is unrelated to this PR.

**Deploy.** The ingest is this repo's Netlify site and deploys on merge to `main`, and the migrations apply when the functions open the DB, so Sonder's forward needs no package release. The changeset only versions the exported `WebsiteRow` type for the fleet.

Usage: not readable
