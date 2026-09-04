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
   tells you nothing** — do not read it as a defect, and do not read a green
   `form-e2e` as proof of this step either.

   What automation CAN prove is the negative, and it is the one that matters:

   > **110200 is never ambiguous — it means the hostname is not on the widget.**

   Unlike 600010 it does not depend on the browser being human: it is a
   domain-binding rejection, emitted before any challenge is attempted. **Nothing
   in the fleet asserts on it today**, which is the open gap — see below.

## What is NOT watching this (corrected 2026-09-04)

Two claims written into this runbook and into
[#689](https://github.com/reddoorla/reddoor-maintenance/issues/689) the same day
were **wrong**. Both overstated the coverage, which is the dangerous direction,
so they are corrected here rather than quietly edited away.

**1. `form-e2e` does NOT swap the sitekey.** The earlier text said it "swaps in
Cloudflare's always-pass test sitekey … it exercises the form, never the real
widget". Read the code: `CF_TEST_SITEKEY` (`form-e2e.ts:11`) reaches exactly one
expression — `` const tokenValue = `testmode-${testSitekey}` `` (`:444`) — which
is injected at `:460` as the **value** of a hidden `cf-turnstile-response` input.
Nothing writes `data-sitekey`, nothing calls `page.route` or `addInitScript`.
**The site's real widget renders with its real key on every nightly run**, which
the code's own comment at `:501` already knew: "the Turnstile widget inserts its
OWN input with that name while it renders (an erroring widget included)".

So the nightly probe is already generating the evidence and discarding it. It
launches a browser against 6 sites' live contact forms (the audited fleet is 13;
7 refuse at the `forms.testMode` preflight, `form-e2e.ts:413`). Wiring the 110200
observation into a verdict is the open work.

**2. The smoke suite's 110200 guard cannot fire in the fleet run.**
`src/recipes/smoke-suite/template.ts` really does keep an uncaught
`TurnstileError` out of its allowlist — but `fleet-smoke` is **clone-based**: it
clones each site and runs the site's own `pnpm test:smoke` against a local dev
server (`.github/workflows/fleet-smoke.yml:3-8`). `PUBLIC_TURNSTILE_SITE_KEY` is
a Netlify env var and is not in the clone, so the starter's `TurnstileWidget`
renders nothing, no widget initialises, and no `TurnstileError` is ever thrown.
The guard is correct and, as the fleet is configured, **inert**. It defends a
site's own CI only where that key is present.

**So the honest coverage today is: nothing automated observes a production
Turnstile widget on its production hostname.** `/health` sees an env var; the
smoke suite sees a keyless local build; `form-e2e` sees the real widget and
ignores it. Step 5 above — a human, once, in an ordinary browser — is the whole
of it.

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
