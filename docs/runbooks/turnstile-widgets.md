# Runbook — Turnstile widgets, hostnames, and capacity

**Read this before putting `PUBLIC_TURNSTILE_SITE_KEY` on a new site.** A
Turnstile sitekey is bound to a list of hostnames, and a sitekey served from a
hostname that is not on its widget's list does not degrade — it throws
`TurnstileError: [Cloudflare Turnstile] Error: 110200`, renders no iframe, and
mints **no token at all**. On a site with `Require Turnstile` on, that buckets
100% of real leads (see
[require-turnstile-rollout.md](require-turnstile-rollout.md)).

Nothing in this repo touches the Cloudflare allowlist, and no automated check
can see the failure from the outside — `/health` only knows whether the env var
is a non-empty string. **Allowlisting the hostname is a manual step, and it is
the step that gets skipped.**

## Why you cannot just copy a sitekey from `.env`

A widget holds **10 hostnames** on the free tier (20 widgets, so 200 total).
`.env`'s `TURNSTILE_SITE_KEY_1` is widget **"Forms 1"**, which has been **full
since before this runbook existed**. Copying it into a new site produces exactly
the silent-110200 state above, and did on 2026-09-04
([#689](https://github.com/reddoorla/reddoor-maintenance/issues/689)). Treat the
`.env` values as the _secrets for verification_, never as a source of a sitekey
for a new site.

Get the sitekey from the widget that actually has room. Every apex + `www` pair
is **two** hostnames, and a `*.netlify.app` staging host is a third — a site
that will later move to a custom domain therefore wants two slots reserved.
Deploy-preview hosts (`deploy-preview-N--site.netlify.app`) are siblings, not
subdomains, so they are **not** covered by the staging host and previews render
no widget. That is expected.

## Adding a site

1. **List the widgets and their spare capacity** (read-only):

   ```bash
   node -e '
   const a=process.env.CLOUDFLARE_ACCOUNT_ID,t=process.env.CLOUDFLARE_PAT;
   fetch(`https://api.cloudflare.com/client/v4/accounts/${a}/challenges/widgets?per_page=50`,
     {headers:{Authorization:`Bearer ${t}`}}).then(r=>r.json()).then(d=>{
       for (const w of d.result)
         console.log(w.name.padEnd(16), w.sitekey, `${(w.domains||[]).length}/10`,
                     (w.domains||[]).join(" "));
     })'
   ```

2. **Pick a widget with at least two free slots**, or create a new one if none
   has room. A new widget is only useful once central can verify its tokens:
   `netlify/functions/form-ingest.mts` reads a fixed list
   (`TURNSTILE_SECRET_KEY`, `_2`, `_3`, …), so a new widget means **a new env
   var on the central Netlify site AND a line in that array, in the same
   change**. Miss the code half and every token from that widget is
   `invalid-input-secret` against all known secrets → `"unverifiable"` →
   fail-open: no leads lost, but the gate is silently off for that site.

3. **Add the hostnames** (apex, `www`, and the `*.netlify.app` staging host if
   the site is still pre-launch).

4. Set `PUBLIC_TURNSTILE_SITE_KEY` on the site's Netlify env and redeploy.

5. **Prove it from a browser — this is the only real check.** `/health` cannot
   do it and neither can a sitekey-only inspection; Cloudflare exposes no API to
   validate a sitekey against a hostname (`siteverify` takes tokens, not
   sitekeys). Load the live form in an ORDINARY browser and confirm one thing:

   > `input[name="cf-turnstile-response"]` has a **non-empty** value.

   That is the whole test. A token is ~770 characters and appears a second or
   two after load.

   **Do not check for an iframe.** The fleet's widgets are `invisible` mode,
   which solves without leaving one: a healthy VLF widget was measured with
   **zero** iframes under `.cf-turnstile` and a valid 773-character token in the
   same instant. An iframe count is not a health signal in either direction.

   **A driven browser cannot do this for you.** Cloudflare answers an automated
   Chromium with error **600010** — challenge failed — even when the
   configuration is perfect. Measured 2026-09-04 across three harnesses: the
   known-good `reddoorla.com` canary reported 600010, Playwright's Chromium
   reported it headed and headless alike, and the same page in an ordinary Chrome
   window minted a token that `siteverify` accepted. **600010 from automation
   tells you nothing.** That is also why `form-e2e` swaps in Cloudflare's
   always-pass test sitekey (`form-e2e.ts:11,187`) — it exercises the form, never
   the real widget, so do not read a green form-e2e as proof of this step.

   What automation CAN prove is the negative, and it is the one that matters:

   > **110200 is never ambiguous — it means the hostname is not on the widget.**

   Unlike 600010 it does not depend on the browser being human, so the smoke
   suite fails on it: an uncaught `TurnstileError` is not allowlisted, only
   console telemetry is (`src/recipes/smoke-suite/template.ts`). A green smoke
   run rules out the wrong-hostname state; it does not establish the widget
   solves. Only step 5 does that.

## At launch (custom domain)

Moving a site from `*.netlify.app` to its real domain **breaks Turnstile until
the new hostname is added**, in exactly the silent way described above. Add the
apex and `www` to the widget as part of the domain cutover, before or alongside
the DNS change, and re-run step 5 against the new host.

## Current allocation

| widget         | env var (central)        | notes                                     |
| -------------- | ------------------------ | ----------------------------------------- |
| `Forms 1`      | `TURNSTILE_SECRET_KEY`   | **full** — never take a sitekey from here |
| `Site Forms 2` | `TURNSTILE_SECRET_KEY_2` | near full                                 |
| `Site Forms 3` | `TURNSTILE_SECRET_KEY_3` | created 2026-09-04, room to grow          |

Run the command in step 1 for the live counts; this table goes stale.
