# Runbook — enabling `Require Turnstile` on a fleet site

**Goal:** turn on the per-site hard Turnstile gate safely. When the `Require Turnstile` checkbox is checked on a site's Websites row, central ingest escalates any submission whose Turnstile token is **forged** (`invalid-input-response`), **entirely absent**, or **solved on a foreign hostname** straight to `spam_auto` — regardless of content score. That kills direct-POST bots dead, but it makes one precondition load-bearing:

> **A site whose deployed package does not forward a token from _every_ form will silently bucket 100% of its real leads.** No operator email, no autoresponder — the inbox just goes quiet. The form-e2e probe **cannot** detect this state (its `testMode` marker deliberately bypasses the gate), which is exactly why the cockpit guardrail below exists.

An expired/duplicate token stays fail-open (`"unverifiable"` — a real browser did render the widget), so slow humans are never caught. `spam_auto` is recoverable from `/submissions`, so even a misfire loses nothing permanently — but you have to notice it.

---

## Preconditions — verify ALL of these before checking the box

1. **The deployed site forwards the token from every form.** The flag is per-**site**; widgets are per-**form**. Every form that posts to central ingest (contact, newsletter, custom) must render the widget and post `cf-turnstile-response`, which the site package forwards as `_meta.turnstileToken`. A footer newsletter form without a widget = every signup bucketed.
2. **`PUBLIC_TURNSTILE_SITE_KEY` is set** in the site's Netlify env (and a deploy has run since).
3. **The site's `/health` reports `forms.turnstile: true`.** This is the deployed proof of (2) — and **only** of (2). It is a truthiness check on the env var; it never contacts Cloudflare, so it cannot tell a working widget from a broken one. Accordingly the nightly sweep writes **`Turnstile widget = fail`** when the var is missing and leaves the cell **empty** when it is set: unverified, not confirmed. A `pass` in that column is only ever earned by a browser.
4. **The site's hostname is in the Cloudflare Turnstile widget's allowlist**, and you have **seen the widget mint a token on the live site**. This is the precondition that actually bites: a sitekey served from a hostname the widget does not list throws `110200`, renders nothing, and forwards no token — indistinguishable from (2) being unset as far as every automated check is concerned, and fatal once the box below is checked. Load the live form and confirm `input[name="cf-turnstile-response"]` is non-empty. See [turnstile-widgets.md](turnstile-widgets.md) — **including the note that widget "Forms 1" is full**, so a sitekey copied from `.env` lands you in exactly this state.
5. **The verifying secret for that widget is set centrally** (`TURNSTILE_SECRET_KEY`, `_2`, `_3`, … — `form-ingest.mts` tries each in turn). Without the one matching the site's widget, every token is `invalid-input-secret` → `"unverifiable"` → fail-open, and the gate never fires even though everything above is green.

## Rollout

1. Check **`Require Turnstile`** on the site's Websites row.
2. **Watch the site for at least a week**: `/submissions?site=<slug>&status=spam_auto` — the per-reason facet line and visible reason chips distinguish `turnstile-required-absent` / `turnstile-required-failed` / `turnstile-required-hostname` (the gate working) from content-classifier reasons. Confirm **zero real leads** land in the bucket.
3. The site's `/s/<slug>` page's spam panel shows an **Auto-filtered** row for the same period.

## The guardrail (what watches the watcher)

- **Red alarm (cannot be accept-muted):** `Require Turnstile` is ON and a fresh health sweep says `Turnstile widget = fail` → a critical cockpit/digest attention item. That means `PUBLIC_TURNSTILE_SITE_KEY` is not set on the deployed site at all. Fix: uncheck the flag OR set the key (preconditions 1–2), then let the nightly sweep re-verify.
- **Amber watch (acceptable):** the flag is ON but the widget has not been positively confirmed (`Turnstile widget` empty). Accept key: `turnstile-unverified`. This is the **normal** state for a site whose key is set, because /health cannot confirm a widget — so the watch is a standing nag to check precondition 4 by hand, not a sign anything is broken. It also covers an older site package whose `/health` has no `forms` block, and a stale sweep.

  Note what the two states no longer mean: an empty cell is **not** "the key is missing" and a `fail` is **not** "the widget is broken". Before 2026-09-04 a set-but-unusable key wrote `pass` here and satisfied both halves of this guardrail at once ([#689](https://github.com/reddoorla/reddoor-maintenance/issues/689)).

## Rollback

Uncheck the box. The gate is evaluated at ingest time, so the effect is immediate on the next central deploy-free request. Recover any bucketed leads from `/submissions` (status filter `spam_auto`) — flipping a row back does **not** re-send the skipped notification email; hand-forward anything important.
