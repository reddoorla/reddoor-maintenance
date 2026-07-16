# Runbook — enabling `Require Turnstile` on a fleet site

**Goal:** turn on the per-site hard Turnstile gate safely. When the `Require Turnstile` checkbox is checked on a site's Websites row, central ingest escalates any submission whose Turnstile token is **forged** (`invalid-input-response`), **entirely absent**, or **solved on a foreign hostname** straight to `spam_auto` — regardless of content score. That kills direct-POST bots dead, but it makes one precondition load-bearing:

> **A site whose deployed package does not forward a token from _every_ form will silently bucket 100% of its real leads.** No operator email, no autoresponder — the inbox just goes quiet. The form-e2e probe **cannot** detect this state (its `testMode` marker deliberately bypasses the gate), which is exactly why the cockpit guardrail below exists.

An expired/duplicate token stays fail-open (`"unverifiable"` — a real browser did render the widget), so slow humans are never caught. `spam_auto` is recoverable from `/submissions`, so even a misfire loses nothing permanently — but you have to notice it.

---

## Preconditions — verify ALL of these before checking the box

1. **The deployed site forwards the token from every form.** The flag is per-**site**; widgets are per-**form**. Every form that posts to central ingest (contact, newsletter, custom) must render the widget and post `cf-turnstile-response`, which the site package forwards as `_meta.turnstileToken`. A footer newsletter form without a widget = every signup bucketed.
2. **`PUBLIC_TURNSTILE_SITE_KEY` is set** in the site's Netlify env (and a deploy has run since).
3. **The site's `/health` reports `forms.turnstile: true`.** This is the deployed proof of (2). The nightly function-health sweep now writes it to the Websites row as **`Turnstile widget`** (`pass`/`fail`; freshness stamped by `Function health checked at`) — check the field or the site's `/health` directly.
4. **The site's hostname is in the Cloudflare Turnstile widget's allowlist** (Cloudflare dashboard → Turnstile → the widget). A hostname missing here means the widget won't solve on the live site — and central verification also compares the token's solved-hostname to the site's URL.
5. `TURNSTILE_SECRET_KEY` is set centrally (dashboard env). Already true fleet-wide; without it verification ships dark and the gate never fires.

## Rollout

1. Check **`Require Turnstile`** on the site's Websites row.
2. **Watch the site for at least a week**: `/submissions?site=<slug>&status=spam_auto` — the per-reason facet line and visible reason chips distinguish `turnstile-required-absent` / `turnstile-required-failed` / `turnstile-required-hostname` (the gate working) from content-classifier reasons. Confirm **zero real leads** land in the bucket.
3. The site's `/s/<slug>` page's spam panel shows an **Auto-filtered** row for the same period.

## The guardrail (what watches the watcher)

- **Red alarm (cannot be accept-muted):** `Require Turnstile` is ON and a fresh health sweep says `Turnstile widget = fail` → a critical cockpit/digest attention item. Fix: uncheck the flag OR fix the widget (preconditions 1–2), then let the nightly sweep re-verify.
- **Amber watch (acceptable):** the flag is ON but the widget state can't be verified (`Turnstile widget` empty — older site package whose `/health` has no `forms` block, or a stale sweep). Accept key: `turnstile-unverified`. Prefer upgrading the site package so `/health` reports the forms block.

## Rollback

Uncheck the box. The gate is evaluated at ingest time, so the effect is immediate on the next central deploy-free request. Recover any bucketed leads from `/submissions` (status filter `spam_auto`) — flipping a row back does **not** re-send the skipped notification email; hand-forward anything important.
