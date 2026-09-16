# Secret-scanning sweep — 2026-09-12

Run by the orchestrating session, not by a survey agent. Every line below is
`gh api` output taken today. **No secret value appears in this file**; leaked
values are identified only by the first 12 hex characters of their SHA-256, which
is enough to prove two repos hold the _same_ secret without disclosing it.

## Finding

**Five open secret-scanning alerts across the `reddoorla` org. None has ever been
triaged — every one has `resolution: null`.** Ages range from 11 to 99 days.

| repo                   | type                            | created    | age at sweep | path(s)                                                                             | sha256[0:12]   |
| ---------------------- | ------------------------------- | ---------- | ------------ | ----------------------------------------------------------------------------------- | -------------- |
| `reddoor-maintenance`  | `stripe_webhook_signing_secret` | 2026-06-09 | **95 d**     | `tests/webhook/resend-webhook.test.ts`                                              | `96ad2ccd8146` |
| `gallerysonder`        | `google_api_key`                | 2026-06-05 | **99 d**     | `.netlify/server/chunks/index3.js`, `src/lib/slices/ContentWidthMedia/index.svelte` | `9b70e75de5eb` |
| `reddoor-starter`      | `google_api_key`                | 2026-07-24 | 50 d         | `src/routes/dev/blux-frozen/the-pointe.html`                                        | `530de1c69475` |
| `beachfront-dentistry` | `google_api_key`                | 2026-08-06 | 37 d         | `matching/SPEC.md`, `matching/spec-sections/contact.md`                             | `0ce943544da2` |
| `reddoor-starter-blux` | `google_api_key`                | 2026-09-01 | 11 d         | `src/routes/dev/blux-frozen/the-pointe.html`                                        | `530de1c69475` |

All five repositories are **PUBLIC**. 28 of the org's repos are public, including
`reddoor-maintenance` itself.

That is **four distinct secrets**, not one leak seen five times — three different
Google API keys plus one Stripe webhook signing secret.

## The propagation, proven

`reddoor-starter` and `reddoor-starter-blux` hold **the same key**
(`530de1c69475`) at **the same path**, `src/routes/dev/blux-frozen/the-pointe.html`.

That is the signature of the starter track split. `reddoor-starter-blux` is a
full-history snapshot of the native starter taken at `82d93b0`; the snapshot
carried the already-leaked key with it, and GitHub raised a second alert against
the new repo on 2026-09-01 — the day the split landed.

Two things follow:

1. The leaked value is **a client's key** (the-pointe's), sitting in a frozen
   Blux render fixture, in the **public repository that every new client site is
   cloned from**. `/new-site` uses `reddoor-starter` as its template.
2. Any site bootstrapped from that template since 2026-07-24 may carry the same
   fixture forward. This was not checked in this sweep — see Not established.

## Redaction is not remediation here

The `beachfront-dentistry` case shows the trap clearly. The key was redacted at
HEAD in `e30c756` ("redact live's Maps key…"), and the contemporaneous note was
honest about it:

> "the tip is clean but **HISTORY IS NOT**, and the repo is public, so
> rotation/referrer-restriction of that key is the only real remediation."

`git log --all -S` confirms the value is still reachable from `c10a05b`. The
alert remained open for the 37 days since. For a public repository, removing a
secret from the working tree changes nothing about its exposure: the object is
still fetchable, and the alert is still open because GitHub agrees.

## Two aggravating details

**`gallerysonder`'s key is in a committed build artifact** —
`.netlify/server/chunks/index3.js` — as well as in source. Build output under
`.netlify/` being tracked at all is its own question; it means a secret inlined
at build time gets committed even when the source is later cleaned.

**`reddoor-maintenance`'s alert is on a test fixture** —
`tests/webhook/resend-webhook.test.ts`. Whether the value is real or a
plausible-looking fake was NOT determined here. It matters, and this fleet has a
documented precedent of a _real_ endpoint sitting in a committed fixture (it
failed every Netlify deploy with `'building site': exit code 2`). A fixture is
not automatically safe.

## Nothing is watching this

Secret scanning is **disabled** on several public repos, including
`29-navy`, `vida-legacy-foundation` and `the-pointe`, so those are not being
checked at all and the true count may be higher than five.

More importantly: this sweep had to be run by hand today. No nightly job, no
cockpit band, and no audit check reports open secret-scanning alerts. The fleet
has instruments for dependency vulnerabilities, Lighthouse scores, form
deliverability, Prismic drift and branch protection — and none for this. The
oldest alert sat open for 99 days without surfacing anywhere.

## What is established, and what is not

**Measured today:** the five alerts, their states, types, creation dates, paths,
and the hash equality between the two starter repos. The public visibility of all
five repos. The disabled state of scanning on three others. The persistence of
the beachfront value in history.

**Also measured today — the working trees are clean.** A sweep of all 41
checkouts found:

- **No tracked file at HEAD in any repository matches a Google API key pattern**
  (`git grep -l 'AIza[0-9A-Za-z_-]\{30,\}' HEAD`, run per repo — zero hits
  anywhere).
- **No repository tracks `.netlify/` build output** today, so the `gallerysonder`
  artifact path has since been cleaned at HEAD as well.
- The `blux-frozen/the-pointe.html` fixture _did_ propagate — it is present at
  HEAD in `beachfront-dentistry`, `reddoor-starter-blux` and `the-tower-burbank`
  — but **it carries no key in any of them**. The fixture travelled; the secret
  did not travel with it.

This sharpens the finding rather than dissolving it. **Nothing is leaking from
any working tree right now. Four secrets are permanently published in the git
history of five public repositories, and not one has been rotated or triaged.**
That is precisely the exposure redaction cannot touch, and it is why all five
alerts are still open.

**Not established — needs checking before any claim is made:**

- Whether any of the four keys is still _valid_. An alert is about disclosure,
  not about whether the credential still works. **Deliberately not tested here:**
  exercising a client's live credential, even read-only, is an action on their
  production system and is the operator's call. A referrer-restricted key would
  also fail a curl probe regardless of validity, so the test would be ambiguous.
- Whether the `reddoor-maintenance` Stripe fixture value is real or fake.
- Whether the Google keys carry HTTP-referrer restrictions, which would sharply
  reduce the practical exposure of a leaked browser key. **This is the single
  most important unknown**, because an unrestricted Maps key is billable by
  anyone who finds it, while a referrer-restricted one is close to inert. It can
  only be answered from the Google Cloud console.

## Why this is the operator's call, not an agent's

Rotating a live Google Maps key breaks map rendering on the client's production
site until the new key is deployed, and two of these keys belong to **clients**
(the-pointe, and live's own on beachfront) rather than to Reddoor. Restricting by
HTTP referrer is the lower-risk first move and is usually reversible, but it can
also break a site that calls the API from an unexpected origin.

The sequencing question — restrict first, then rotate, versus rotate
immediately — depends on facts (current restriction state, current billing
exposure) that were not gathered here.
