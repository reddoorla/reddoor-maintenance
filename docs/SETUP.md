# Setting up the whole system — from scratch

This is the end-to-end operations walkthrough: how to stand up the fleet-maintenance system so the daily loop, the dashboard, the audits, and launches all work. For per-command reference see the [README](../README.md); this doc is the "wire it all together" guide.

## What you're standing up

```text
                    ┌─────────────────────────────────────────────┐
                    │  Airtable  (the source of truth)            │
                    │  Websites · Reports · Digest State          │
                    └───────▲───────────────▲──────────────▲──────┘
   local CLI (you)         │                │              │
   reddoor-maint ──────────┤                │              │
   (onboard / audit /      │  reads+writes  │              │ reads+writes
    launch / report)       │                │              │
                           │        ┌───────┴──────┐  ┌─────┴────────────┐
                           │        │ GitHub Actions│  │ Netlify          │
                           │        │ crons         │  │ dashboard (cockpit│
                           │        │ • daily-reports│ │ + approve + webhook)│
                           │        │ • fleet-lighthouse│└──────────────────┘
                           │        └──────┬────────┘          ▲
                           │               │ sends email        │ Resend
                           │          ┌────▼─────┐              │ delivery
                           └──────────┤  Resend  ├──────────────┘ webhooks
                                      └──────────┘
                            (client report/launch emails + operator digest)
```

Four moving parts, each needing its own credentials: **Airtable** (data), the **local CLI** (you, onboarding/launching), the **Netlify dashboard** (your daily approve surface + the Resend webhook), and the **GitHub Actions crons** (the unattended draft/send/audit loop).

---

## Phase 0 — Prerequisites

- **Node ≥ 20** and **pnpm** (`corepack enable`).
- **`gh` CLI**, authenticated (`gh auth login`) — the recipes (`init`, `self-updating`, `launch`) shell out to it.
- Accounts/access: a **GitHub org** for the fleet repos (this fleet uses `reddoorla`), an **Airtable** base, a **Resend** account (+ a verified sending domain), a **Netlify** site for the dashboard, and a **Google Cloud** service account if you want GA4 + Search Console enrichment in reports.

---

## Phase 1 — Accounts & tokens (collect these once)

| Token / secret          | From where                                                                                                               | Used by                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `AIRTABLE_PAT`          | Airtable → Builder Hub → Personal access tokens (scopes: `data.records:read/write`, `schema.bases:read`; grant the base) | CLI, dashboard, crons                        |
| `AIRTABLE_BASE_ID`      | The base URL (`https://airtable.com/<appXXXX>/…`) — this fleet's is `appHG8nLOzULzXOER`                                  | CLI, dashboard, crons                        |
| `RESEND_API_KEY`        | Resend → API Keys                                                                                                        | CLI (`report --send-ready`), crons           |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks → (the signing secret of the endpoint you add in Phase 5)                                              | dashboard webhook only                       |
| `DASHBOARD_PASSWORD`    | A strong random string YOU choose (`openssl rand -hex 24`) — the single operator password                                | dashboard only                               |
| `RENOVATE_TOKEN`        | A GitHub PAT (or fine-grained token) with **read** access to all fleet repos                                             | crons (Renovate-failing + last-commit sweep) |
| `GH_TOKEN`              | `gh auth token` (or a PAT with repo write) — for `self-updating`/`launch` repo mutations                                 | local CLI                                    |
| GA service-account JSON | Google Cloud → a service account with **domain-wide delegation**; share GA4 + Search Console with it                     | CLI/cron reports (optional enrichment)       |

> Keep these out of the repo. The CLI reads them from `~/.config/reddoor-maint/credentials.env` (Phase 3); the dashboard and crons get them from Netlify/GitHub settings (Phases 5–6).

---

## Phase 2 — The Airtable base

The base has **three tables**. Most fields already exist on this fleet's base; if you're rebuilding from scratch, create them as below.

### `Websites` (one row per site — the fleet inventory)

The load-bearing columns the tool reads/writes (exact names matter — they're magic strings in `mapRow`):

- **Identity & contact:** `Name`, `url`, `Status` (single-select: `in development` · `launch period` · `maintenance` · `hosting` · `deprecated` · `legacy`), `point of contact`, `Git repo` (`owner/repo`), `Report recipients (To)`, `Report recipients (CC)`, `Header image` (attachment — used inline in emails).
- **Scheduling:** `maintenence freq` / `testing freq` (single-select: `None`/`Monthly`/`Quarterly`/`Yearly`).
- **Dashboard visibility:** `Dashboard Token` — any non-empty value opts the site into the cockpit at `/`; blank hides it. (Per-site secret tokens were retired; this is just a visibility flag now.)
- **Enrichment config (optional):** `GA4 property ID`, `Search query`, `Search Console property`.
- **Written by the audits/sweeps** (don't hand-edit): `pScore`/`rScore`/`bpScore`/`seoScore` + `Last lighthouse audit at`, `A11y Violations`, `Deps Drifted`/`Deps Major Behind`/`Deps Outdated`, `Security Vulns Critical/High/Moderate/Low`, `Renovate Failing CIs`, `Default Branch CI`, `Last Commit At`, `GitHub Signals At`, `Launched at`.
- **Per-site copy overrides (optional):** `Copy — Intro`, `Copy — Contact`, `Copy — Footer` (blank = shared default).

### `Reports` (one row per (site, period) report)

`Report type` (single-select: `Maintenance` · `Testing` · **`Launch`** — see ⚠️ below), `Period` (`YYYY-MM` idempotency key), `Period start`/`end`, `Completed on`, `Lighthouse — Performance/Accessibility/Best Practices/SEO`, `Draft ready`, `Approved to send`, `Sent at`, `Approved At`/`Approved By`, `Delivery status` (single-select: `pending`/`delivered`/`bounced`/`complained`), `Rendered HTML` (attachment preview), `Resend message ID`, `Commentary`, GA + search fields.

> ⚠️ **Operator follow-up:** the `Launch` option on `Report type` must be added in the Airtable UI (Airtable's API can't create select options). Without it, `launch <site>` will fail when it drafts. The other report types and all the fields above are already in place.

### `Digest State` (one singleton row)

`Snapshot` (long text — JSON) + `Updated At` (dateTime). The daily digest writes the prior-run snapshot here so it can badge NEW/WORSE; the cockpit reads it read-only. Just create the table with those two fields and leave the row to the tool (it get-or-creates it).

---

## Phase 3 — Local CLI + credentials

```bash
pnpm add -D @reddoorla/maintenance      # in a site repo, or clone this repo and pnpm i
pnpm reddoor-maint --help
```

Create the credentials file (the CLI loads it automatically; `process.env` wins over it, and `export KEY=val` lines are fine):

```bash
mkdir -p ~/.config/reddoor-maint
cat > ~/.config/reddoor-maint/credentials.env <<'EOF'
AIRTABLE_PAT=pat_xxx
AIRTABLE_BASE_ID=appHG8nLOzULzXOER
RESEND_API_KEY=re_xxx
# optional GA4 + Search Console enrichment (domain-wide-delegation SA):
GA_SA_KEY_PATH=/Users/you/.config/reddoor-maint/ga-sa.json
# comma-separated impersonation subjects, tried in order (failover); one address is fine
GA_SUBJECT=reports@yourdomain.com,you@yourdomain.com
# optional: where fleet checkouts are cloned (default ~/.reddoor-maint/sites)
# REDDOOR_FLEET_WORKDIR=/path/to/workdir
EOF
chmod 600 ~/.config/reddoor-maint/credentials.env
```

(Honors `$XDG_CONFIG_HOME` if set. **Never** put these in a repo `.env` — the CLI only reads this file.)

---

## Phase 4 — Onboard a site into the fleet

For each repo:

```bash
reddoor-maint init <path-to-site>          # convert-to-pnpm → onboard → sync-configs → svelte-codemods → a11y-fixtures → audit
reddoor-maint self-updating <path-to-site> # adds CI + Renovate, branch protection (required check `ci / ci`), auto-merge, RENOVATE_TOKEN secret
```

Each recipe is branch-isolated + idempotent (re-running on a done site is a `noop`), and creates a `maint/*` branch to PR. Then add the site's row to the Airtable `Websites` table: `Name`, `url`, `Git repo`, `Report recipients (To)`, a `maintenence freq`, a `Header image`, and a `Dashboard Token` value (to make it appear on the cockpit). The site is now in the loop.

> Fleet-wide commands take `--fleet airtable` (read the inventory from Airtable) — e.g. `reddoor-maint audit --fleet airtable --only lighthouse --write-airtable`.

---

## Phase 5 — Deploy the dashboard (Netlify)

The cockpit + approve endpoint + Resend webhook are Netlify Functions in `netlify/functions/`. Connect this repo to a Netlify site and set these **site environment variables** (Site settings → Environment):

| Netlify env var         | Value                             | Used by                            |
| ----------------------- | --------------------------------- | ---------------------------------- |
| `AIRTABLE_PAT`          | your PAT                          | all four functions                 |
| `AIRTABLE_BASE_ID`      | `appHG8nLOzULzXOER`               | all four functions                 |
| `DASHBOARD_PASSWORD`    | your chosen operator password     | `/`, `/s/:slug`, approve POST      |
| `DASHBOARD_BASE_URL`    | `https://<your-site>.netlify.app` | `/` (builds the `/s/<slug>` links) |
| `RESEND_WEBHOOK_SECRET` | the Resend webhook signing secret | the webhook function               |

Routes that go live: `/` (the cockpit — health tiers + the approve queue, Basic-Auth gated + rate-limited), `/s/<slug>` (per-site page), `POST /api/reports/:id/approve` (the one-click approve), and the Resend webhook. Then in **Resend → Webhooks**, add an endpoint pointing at the deployed webhook function, subscribe to delivery/bounce/complaint events, and copy its signing secret into `RESEND_WEBHOOK_SECRET`.

To log in: visit `/`, the browser prompts for Basic Auth — any username, the `DASHBOARD_PASSWORD` you set.

---

## Phase 6 — Wire the crons (GitHub Actions)

Two scheduled workflows in `.github/workflows/` do the unattended work. Set their inputs in this repo's **Settings → Secrets and variables → Actions**:

**Secrets:** `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY`, `RENOVATE_TOKEN` (the fleet-read token — best as an **org** secret so every repo's CI can use it).
**Variables:** `OPERATOR_EMAIL` (where the daily digest goes — set this or the digest falls back to `info@reddoorla.com`), `DASHBOARD_BASE_URL` (so digest links point at your dashboard).

| Workflow               | Schedule (UTC) | Runs                                                                                    | Needs                                                                                             |
| ---------------------- | -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `daily-reports.yml`    | `23 9 * * *`   | `report --due` → `report --send-ready` → `report --digest`                              | `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY`; vars `OPERATOR_EMAIL`, `DASHBOARD_BASE_URL` |
| `fleet-lighthouse.yml` | `0 8 * * *`    | fleet Lighthouse audit (`--write-airtable`) + `github-signals --fleet --write-airtable` | `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RENOVATE_TOKEN`                                              |

(`ci.yml` is the reusable per-repo CI the self-updating sites call; `release.yml` publishes the npm package via changesets + GitHub's `GITHUB_TOKEN` / npm OIDC.)

---

## Phase 7 — The daily operator loop (how it runs once set up)

1. **09:23 UTC** the cron drafts any reports that are **due** (idempotent on the `Period` key) — they land as `Draft ready`, unapproved.
2. You open the **dashboard** (`/`). The banner shows **"N pending your yes"**; each due report has an **Approve** button.
3. One click flips `Approved to send` (+ stamps who/when) — it does **not** send.
4. The **next** cron run sends the approved-∧-unsent reports via Resend, then emails you the **digest**: what got sent, what's **pending your yes**, and a **"Needs attention"** section (current critical/high vulns, delivery bounces/complaints, Renovate PRs failing CI, sub-75 Lighthouse) badged NEW/WORSE since yesterday.
5. The **08:00 UTC** Lighthouse + GitHub-signals cron keeps the cockpit's per-site signals fresh (zero GitHub calls happen in the page request — the page reads Airtable).

You never touch Airtable in the happy path; the dashboard click is your only action.

---

## Phase 8 — Launching a new site (M6b)

```bash
reddoor-maint launch <path-to-site>
```

This runs the chain — **bootstrap (`self-updating`) → first audit → draft a purpose-built launch email** — and stops at a `Draft ready` Launch report in your approve queue (it never sends directly). Approve it on the dashboard; the next run sends the go-live email and **flips the site `Status` → `maintenance`** with a `Launched at` stamp. The launch email reuses the per-site `Copy — Contact`/`Copy — Footer` overrides.

> Requires the **`Launch`** option on the Reports `Report type` field (Phase 2 ⚠️).

---

## Phase 9 — Outstanding follow-ups (do these once)

- [ ] Add the **`Launch`** option to the Reports `Report type` single-select in the Airtable UI (Airtable's API can't add select options) — needed before the first `launch`.
- [ ] Set the `RENOVATE_TOKEN` **org** secret (fleet-read) so both the nightly sweep and every repo's Renovate can use it.
- [ ] Set the `OPERATOR_EMAIL` + `DASHBOARD_BASE_URL` Actions **variables** so the digest reaches you with working links.
- [ ] (Optional) Manually trigger `fleet-lighthouse.yml` once (`gh workflow run fleet-lighthouse.yml`) to populate the cockpit's GitHub signals immediately instead of waiting for the first nightly run.

---

## Quick reference — where each secret lives

| Secret                                | `~/.config/reddoor-maint/credentials.env` (CLI) | Netlify env (dashboard) | GitHub Actions secret (crons) | Actions variable |
| ------------------------------------- | :---------------------------------------------: | :---------------------: | :---------------------------: | :--------------: |
| `AIRTABLE_PAT`                        |                        ✓                        |            ✓            |               ✓               |                  |
| `AIRTABLE_BASE_ID`                    |                        ✓                        |            ✓            |               ✓               |                  |
| `RESEND_API_KEY`                      |                        ✓                        |                         |               ✓               |                  |
| `RESEND_WEBHOOK_SECRET`               |                                                 |            ✓            |                               |                  |
| `DASHBOARD_PASSWORD`                  |                                                 |            ✓            |                               |                  |
| `DASHBOARD_BASE_URL`                  |                                                 |            ✓            |                               |        ✓         |
| `RENOVATE_TOKEN`                      |                                                 |                         |            ✓ (org)            |                  |
| `GH_TOKEN`                            |                ✓ (or `gh auth`)                 |                         |                               |                  |
| `OPERATOR_EMAIL`                      |                                                 |                         |                               |        ✓         |
| GA SA (`GA_SA_KEY_PATH`/`GA_SUBJECT`) |                        ✓                        |                         | (if cron does GA enrichment)  |                  |
