# Cockpit accepted Watch conditions — Design

> **Status:** approved 2026-06-29, ready for implementation plan.
> **Scope:** maintenance repo cockpit only. Pure functions + one Airtable read field + one CSS chip. No new endpoint.

## Problem

Seven fleet sites embed a Vimeo background hero video. Vimeo's `player.vimeo.com` iframe sets two **Cloudflare** cookies (`__cf_bm`, `_cfuvid`) that fail Lighthouse's binary `third-party-cookies` audit (weight 5), pinning Best Practices at ~78. This is a reviewed, **accepted** cosmetic deduction — the cookies are Cloudflare infra, not tracking, and `dnt=1` cannot remove them; the only fix needs a Vimeo plan tier the fleet doesn't have. A BP of 78 lands each site in the cockpit's amber **Watch** band ([fleet-cockpit.ts `assignTier`](../../../src/dashboard/fleet-cockpit.ts), Lighthouse category in [75,85)), so those seven sites would sit in the Needs-you Watch lane **forever** for a condition the operator has already decided to live with — drowning out real watch signals.

## Goal

Let the operator mark a specific watch condition on a specific site as **accepted**, so it drops out of the amber Watch feed and the verdict count — while anything _worse_ still re-alarms, and the accepted condition stays visible (muted, not hidden).

## The model

A new Airtable Websites field **`Accepted Watch Conditions`** (Airtable `multipleSelects`) holds the conditions the operator has reviewed and accepted for that site. Option values map 1:1 to the watch conditions `assignTier` can raise:

| Option value       | Suppresses the watch reason from…           |
| ------------------ | ------------------------------------------- |
| `Performance`      | a `pScore` in [75,85)                       |
| `Accessibility`    | an `rScore` in [75,85)                      |
| `Best Practices`   | a `bpScore` in [75,85)                      |
| `SEO`              | a `seoScore` in [75,85)                     |
| `stale repo`       | last commit > 30 days                       |
| `no custom domain` | a maintenance site still on `*.netlify.app` |

`assignTier` reads the site's accepted set and, instead of pushing an accepted condition onto `watchReasons`, routes it to a new `acceptedReasons` list. A site whose **only** watch reasons are all accepted therefore returns `tier: "healthy"` — it disappears from the Watch feed, the verdict's `watch` count, and the Watch band entirely, with no change needed in `buildNeedsYouFeed` or `verdictBar` (they already key off tier + watchReasons).

## Two guardrails (honest, not a rug-sweep)

1. **Worsening still alarms.** Acceptance suppresses only the **watch-level** signal. A sub-floor Lighthouse score (< 75) never flows through `assignTier`'s watch loop — it arrives as an `AttentionItem` from `collectLighthouseAlerts` and tiers the site **attention/broken** regardless of acceptance. So accepting "Best Practices 78" silences the amber nudge but a drop to "Best Practices 72" re-alarms red. (`stale`/`no custom domain` have no broken counterpart, so accepting them fully suppresses — by design.)
2. **Not invisible.** Each actively-suppressed condition renders as a muted **`✓ accepted: <reason>`** chip on the site's Fleet-browse card (e.g. `✓ accepted: Best Practices 78`). The condition stays on the record; it just leaves the alarm lane.

The chip shows **only when the condition is currently active** — `acceptedReasons` is populated inside the same generation branches that would have raised the watch reason, so a site with `Best Practices` accepted but a healthy `bpScore` of 95 shows no chip (no noise).

## Data flow & touch points

- **`WebsiteRow`** ([websites.ts](../../../src/reports/airtable/websites.ts)) gains `acceptedWatchConditions: string[]`, mapped from `f["Accepted Watch Conditions"]` (`?? []`). The test helper `makeWebsiteRow` defaults it to `[]`.
- **`assignTier`** ([fleet-cockpit.ts](../../../src/dashboard/fleet-cockpit.ts)) signature return type gains `acceptedReasons: string[]`. It builds a lowercased accepted-set from `site.acceptedWatchConditions`; each watch-reason generation branch checks it and routes to `acceptedReasons` instead of `watchReasons`/`watchSignals` when accepted. Both early returns (attention items present; failed deploy) return `acceptedReasons: []`.
- **`SiteCard`** gains `acceptedReasons: string[]`; `buildCockpitModel` spreads it from the `assignTier` result.
- **`chips()`** ([fleet-browse-render.ts](../../../src/dashboard/fleet-browse-render.ts)) appends one `<span class="chip accepted">✓ accepted: …</span>` per `c.acceptedReasons` entry, after the watch-reason chips. New CSS `.chip.accepted` (muted: low-contrast text/border, no alarm color).

Nothing in `buildNeedsYouFeed`, `verdictBar`, or the client filter changes — the suppression happens upstream at tiering, so the three-band machinery sees an accepted-only site as plain healthy.

## Edge cases

- **All watch reasons accepted** → `tier: "healthy"`, `watchReasons: []`, `acceptedReasons` populated. Out of the feed; muted chip on the browse card.
- **Mixed** (BP accepted + stale not accepted) → `tier: "watch"`, `watchReasons: ["last commit …"]`, `acceptedReasons: ["Best Practices 78"]`. Still in Watch for the stale; shows both a normal stale chip and the muted accepted chip.
- **Accepted condition not currently active** (BP accepted but score 95) → not raised, not in `acceptedReasons`, no chip.
- **Site is broken** (any attention item / failed deploy) → `assignTier` early-returns attention with `acceptedReasons: []`; acceptance is moot while the site is red.
- **Empty/absent field** → `acceptedWatchConditions: []` → today's behavior exactly (no suppression).
- **Unknown option value** in the field → simply never matches a generated reason; harmless no-op.

## Testing

Pure-function unit tests (Vitest), extending the existing `assignTier` / `fleet-cockpit` suites:

- `assignTier`:
  - `bpScore: 78` + accepted `["Best Practices"]` → `tier: "healthy"`, `watchReasons: []`, `acceptedReasons: ["Best Practices 78"]`.
  - same but accepted `[]` → `tier: "watch"`, `watchReasons: ["Best Practices 78"]`, `acceptedReasons: []` (regression guard).
  - `bpScore: 78` + `lastCommitAt` stale, accepted `["Best Practices"]` only → `tier: "watch"`, `watchReasons: ["last commit …"]`, `acceptedReasons: ["Best Practices 78"]`.
  - accepted `["stale repo"]` + stale commit → stale suppressed to `acceptedReasons`.
  - accepted `["no custom domain"]` + `*.netlify.app` maintenance site → suppressed.
  - case-insensitive: accepted `["best practices"]` still suppresses.
  - `bpScore: 95` + accepted `["Best Practices"]` → no watch reason, **empty** `acceptedReasons` (not active).
  - attention item present + accepted set → `tier: "attention"`, `acceptedReasons: []`.
- Integration (`renderCockpitHtml` or `buildCockpitModel`): an accepted-only BP-78 site is **absent** from the Needs-you Watch feed and renders a `chip accepted` on its browse card.

## Rollout (controller steps, after the code ships)

1. Create the `Accepted Watch Conditions` Airtable Websites field (`multipleSelects`, the six options above) — via the Meta API if the PAT has `schema.bases:write`, else the Airtable UI.
2. Set `Accepted Watch Conditions = ["Best Practices"]` on the seven Vimeo sites (Data Dynamiq, Espada, Alamo Anatomy, MSOT, ERP, Vineyard, Revogen).
3. The cockpit ships dark until the field exists — `?? []` keeps it a no-op beforehand.

## Non-goals

- **Dashboard-editor toggle.** Surfacing the field in the `/s/<slug>` details editor needs a new multi-select editor kind (the current editor is single-value `text`/`enum` only). Deferred as a fast-follow; v1 sets the field in Airtable, matching how the fleet's other config toggles ship.
- **The site-repo `dnt=1` cleanup.** Deleting the dead `dnt=1` work on the ERP/Vineyard branches is a separate task in those repos (with active WIP) — not part of this cockpit change.
- No change to the watch thresholds, the three-band verdict, or what counts as broken.
