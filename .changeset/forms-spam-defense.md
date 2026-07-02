---
"@reddoorla/maintenance": minor
---

Forms spam defense: restore the content-based spam filtering that was lost when the fleet moved off Netlify Forms (which ran Akismet) to the central token-gated ingest. Two free, complementary tiers now sit on top of the existing honeypot/timing screen:

- **Heuristic classifier (central).** A pure `classifySpam` scorer folds content signals (link count, link markup, spam keywords, non-Latin script, disposable-email domains, URL-in-name, degenerate/all-caps content — scanned across `message` and site-specific free-text `extraFields`) plus the Turnstile verdict into a `spam_score`. Above `SPAM_THRESHOLD` the submission is stored as a distinct `spam_auto` status with `spam_score`/`spam_reason` recorded for tuning.
- **Cloudflare Turnstile (edge, verified centrally).** Each site forwards a widget token in a stripped `_meta` envelope; `form-ingest.mts` verifies it against a single `TURNSTILE_SECRET_KEY`, so no per-site secret is needed. A per-site `Require Turnstile` Airtable flag hard-flags a genuine challenge failure.

Auto-spam is a **recoverable** row, not a drop: it suppresses both the operator notification and the submitter autoresponder and skips newsletter fan-out, is hidden from the per-site lead strip, and is reviewable on `/submissions` (with a provenance badge and a "Not spam → new" button) plus a cockpit "auto-filtered" affordance. The operator-marked `spam` metric is untouched (distinct status).

Everything fails open — a Turnstile timeout, unset secret, absent token, or a classifier throw never 502s an accepted lead; bots get no signal (`{ ok: true }`, no notify-status echo). Visitor IP/UA are used only transiently (Turnstile `remoteip` + scoring) and never persisted; the `_meta` token/IP/UA can never leak into stored lead data.

Ships dark and useful: the classifier bites spam immediately with zero per-site changes; Turnstile activates per site as `reddoor-starter` rolls out the widget. Operator prerequisites before activation: set `TURNSTILE_SECRET_KEY` (dashboard env) + `PUBLIC_TURNSTILE_SITE_KEY` (per site), and add the `Require Turnstile` boolean column to the Airtable Websites table.
