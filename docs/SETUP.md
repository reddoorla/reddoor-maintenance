# Setting up the whole system — from scratch

This is the end-to-end operations walkthrough: how to stand up the fleet-maintenance system so the daily loop, the dashboard, the audits, and launches all work. For per-command reference see the [README](../README.md); this doc is the "wire it all together" guide.

## What you're standing up

```text
                    ┌──────────────────────────────────────────────────┐
                    │  Turso / libSQL  (the source of truth)           │
                    │  sites · site_health · site_schedule · reports   │
                    │  digest_state · submissions · fleet_events · …   │
                    └──────▲──────────────────▲─────────────────▲──────┘
   local CLI (you)         │                  │                 │
   reddoor-maint ──────────┤                  │                 │
   (ensure-site / audit /  │    reads+writes  │                 │ reads+writes
    launch / report)       │                  │                 │
                           │       ┌──────────┴────────┐  ┌─────┴────────────────┐
                           │       │ GitHub Actions    │  │ Netlify console      │
                           │       │ crons             │  │ (cockpit, site       │
                           │       │ • daily-reports   │  │ pages, approve,      │
                           │       │ • fleet-* sweeps  │  │ forms, webhook)      │
                           │       └──────────┬────────┘  └───────────┬──────────┘
                           │                  │ sends email           ▲
                           │             ┌────▼─────┐                 │ Resend delivery
                           └─────────────┤  Resend  ├─────────────────┘ webhooks
                                         └──────────┘
                            (client report/launch emails + operator digest)
```

Four moving parts, each needing its own credentials: **Turso** (the libSQL database — the only store), the **local CLI** (you, onboarding/launching), the **Netlify console** (your daily approve surface, the per-site details editor, the forms endpoint and the Resend webhook), and the **GitHub Actions crons** (the unattended draft/send/audit loop).

---

## Phase 0 — Prerequisites

- **Node ≥ 20** and **pnpm** (`corepack enable`).
- **`gh` CLI**, authenticated (`gh auth login`) — the recipes (`init`, `self-updating`, `launch`) shell out to it.
- **`turso` CLI**, logged in (`turso auth login`, a browser OAuth login on the Turso org) — to create the database and mint its token.
- Accounts/access: a **GitHub org** for the fleet repos (this fleet uses `reddoorla`), a **Turso** org, a **Resend** account (+ a verified sending domain), a **Netlify** site for the dashboard, and a **Google Cloud** service account if you want GA4 + Search Console enrichment in reports.

---

## Phase 1 — Accounts & tokens (collect these once)

| Token / secret          | From where                                                                                                                                                                         | Used by                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `TURSO_DATABASE_URL`    | `turso db show <db> --url` — the `libsql://<db>-<org>.turso.io` url of the fleet database you create in Phase 2                                                                    | CLI, dashboard, crons                   |
| `TURSO_AUTH_TOKEN`      | `turso db tokens create <db>` — a database-level token for that url (not needed for a local `file:` url)                                                                           | CLI, dashboard, crons                   |
| `RESEND_API_KEY`        | Resend → API Keys                                                                                                                                                                  | CLI (`report --send-ready`), crons      |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks → (the signing secret of the endpoint you add in Phase 5)                                                                                                        | dashboard webhook only                  |
| `DASHBOARD_PASSWORD`    | A strong random string YOU choose (`openssl rand -hex 24`) — the single operator password                                                                                          | dashboard only                          |
| `GH_TOKEN`              | `gh auth token` (or a PAT with repo write) — for `self-updating`/`launch` repo mutations; on the dashboard, a token with `actions:write` for its dispatch buttons                  | local CLI, dashboard                    |
| `GITHUB_TOKEN`          | **Leave it out.** The recipes (`self-updating`, `prismic-ci`, the security audit) fall back to `gh auth token` when it is unset (#665); a set-but-dead value overrides the keyring | local CLI (optional)                    |
| `BACKUP_PASSPHRASE`     | A strong random string YOU choose — the nightly backup encrypts its dump with it, and it is the only way to decrypt one, so keep a copy outside GitHub                             | `fleet-db-backup` cron                  |
| `TURSO_FLEET_USAGE`     | `turso auth api-tokens mint` — an account-level Platform API token; the database-level token cannot read plan quota                                                                | `fleet-db-backup` quota job, `db usage` |
| GA service-account JSON | Google Cloud → a service account with **domain-wide delegation**; share GA4 + Search Console with it                                                                               | CLI/cron reports (optional enrichment)  |

> Keep these out of the repo. The CLI reads them from `~/.config/reddoor-maint/credentials.env` (Phase 3); the dashboard and crons get them from Netlify/GitHub settings (Phases 5–6).

---

## Phase 2 — The Turso database

One libSQL database holds everything. Create it and mint its token:

```bash
turso db create <db>
turso db show <db> --url      # → TURSO_DATABASE_URL
turso db tokens create <db>   # → TURSO_AUTH_TOKEN
```

With both values in `credentials.env` (Phase 3), create the tables:

```bash
reddoor-maint db migrate      # "Applied migrations: 0001_init, …" — or "Already up to date."
```

Every connection also applies any pending migration when it opens, so this is idempotent; running it once by hand proves the url and token before anything else depends on them.

### The tables (`src/db/schema.ts`)

- **`sites`** — one row per site, the operator-owned config: `name`, `slug`, `url`, `status`, point of contact, git repo, report recipients (To/CC), maintenance/testing cadence and their anchor days, GA4 property, search query, Search Console property, the per-site copy overrides, form routing (notify routing, Require Turnstile, newsletter webhook, Mailchimp), `launched_at`, and the report header plate (`header_image*`).
- **`site_health`** — one row per site, **written by the audits and sweeps** (don't hand-edit): Lighthouse scores + `lighthouse_at`, a11y violations, dependency drift, security vulns, domain/deploy/function-health, browser, smoke and form-e2e results, the GitHub signals, and the Prismic models verdict.
- **`site_schedule`** — each site's next maintenance/testing due date, written by `report --due`.
- **`reports`** — one row per (site, report type, period): `report_type` (`Maintenance` · `Testing` · `Launch` · `Announcement`), the period, snapshotted scores, GA/search figures, commentary, `draft_ready` / `approved_to_send` / `sent_at`, the approve and override stamps, `delivery_status`, the Resend message id, and the rendered HTML the console previews.
- **`digest_state`** — one row: the daily digest's prior-run snapshot, so it can badge NEW/WORSE. The digest writes it; the cockpit reads it.
- **`submissions`**, **`spam_screenouts`**, **`submission_deadletter`** — form leads and their spam/dead-letter handling; **`fleet_events`** — the cockpit's "Recently" feed; **`prospect_audits`** — prospect audit runs; **`_migrations`** — which migrations have run.

A new site's three rows (`sites`, `site_health`, `site_schedule`) are created together by `ensure-site` (Phase 4), with a minted `site_<ULID>` id.

### Where the site fields are edited

A site's Status is one of `building` · `launching` · `maintained` · `hosted-only` · `external` · `archived`. `report_type` is a plain text column, so there is no select option to add before the first `launch`.

- **The console's site details.** The per-site page `/s/<slug>` (Phase 5) has a **Site details** editor for exactly the fields in `EDITABLE_SITE_FIELDS` (`src/dashboard/site-details.ts`): Status, maintenance and testing cadence (`None` · `Monthly` · `Quarterly` · `Yearly`), site URL, report recipients (To/CC), point of contact, GA4 property, search query, Search Console property, git repo, Netlify ID, newsletter webhook, Mailchimp audience ID and API key, last maintenance/testing day (the schedule anchors), notify routing (JSON), Require Turnstile, accepted watch conditions, and Copy — Intro / Contact / Footer (blank = the shared default). Each save writes straight to `sites`.
- **`reddoor-maint ensure-site <slug> --name "…"`** — the site's display name, used verbatim in client-facing copy. A rename never changes the slug.
- **`reddoor-maint header-image <slug> --write-back`** — the report header plate.
- Everything in `site_health` and `site_schedule` is written by the tooling, not by hand.

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
TURSO_DATABASE_URL=libsql://<db>-<org>.turso.io
TURSO_AUTH_TOKEN=xxx
RESEND_API_KEY=re_xxx
# where the digest and other internal mail goes when you run them from this machine
OPERATOR_EMAIL=you@yourdomain.com
# optional GA4 + Search Console enrichment (domain-wide-delegation SA):
GA_SA_KEY_PATH=/Users/you/.config/reddoor-maint/ga-sa.json
# comma-separated impersonation subjects, tried in order (failover); one address is fine
GA_SUBJECT=reports@yourdomain.com,you@yourdomain.com
# optional: where fleet checkouts are cloned (default ~/.reddoor-maint/sites)
# REDDOOR_FLEET_WORKDIR=/path/to/workdir
# do NOT add GITHUB_TOKEN — the recipes read `gh auth token` from the gh keyring,
# and a stale file value would override it (#665)
EOF
chmod 600 ~/.config/reddoor-maint/credentials.env
```

(Honors `$XDG_CONFIG_HOME` if set. **Never** put these in a repo `.env` — the CLI only reads this file.)

---

## Phase 4 — Onboard a site into the fleet

For each repo:

```bash
reddoor-maint init <path-to-site>          # convert-to-pnpm → onboard → sync-configs → svelte-codemods → a11y-fixtures → audit
reddoor-maint self-updating <path-to-site> # adds CI + Renovate, branch protection (required check `ci / ci`), no per-repo token (Renovate authenticates as the org-installed `reddoor-renovate` App); DISABLES GitHub platform auto-merge
```

Each recipe is branch-isolated + idempotent (re-running on a done site is a `noop`), and creates a `maint/*` branch to PR. Then put the site in the fleet database:

```bash
reddoor-maint ensure-site <slug> --name "<Display Name>" --url https://<site>.netlify.app --contact client@example.com
# add --git-repo <owner/repo> when the repo is not reddoorla/<slug>
```

`ensure-site` creates the site's `sites`, `site_health` and `site_schedule` rows in one transaction, with a new `site_<ULID>` id and Status `building`. It is safe to re-run: it finds the site by slug, fills only blank fields, and names any value that differs instead of overwriting it (change those in the site details). `--name` is the one exception — it renames, and must slugify to the same slug. Without `--name` the name is set to the slug, and the command tells you to re-run with `--name` before forms or announcements go live.

Then generate the report header plate from the live homepage — review it locally, then store it:

```bash
reddoor-maint header-image <slug>               # writes the JPEG under reports/ for review
reddoor-maint header-image <slug> --write-back  # stores it as the site's plate in Turso
```

A send for a site with no plate fails by name, so do this before its first report. (Every real draft also refreshes the plate from the live homepage.)

Finally, open the site's page in the console (`/s/<slug>`) and fill in its **Site details**: report recipients (a blank To sends to the point of contact), maintenance/testing cadence, and the GA4 property / search query / Search Console property if it gets analytics.

What makes the site show up where:

- **The cockpit (`/`)** gives a site a card only while its Status is `maintained` or `launching` (`isDashboardVisible`, `src/fleet/site-row.ts`). A new `building` site is listed on `/fleet` and has its `/s/<slug>` page; it reaches the cockpit when you set it to `launching`, or when its Launch email sends (Phase 8) and sets it to `maintained`.
- **Scheduled reports** (`report --due`) draft only for `maintained` and `hosted-only` sites with a cadence other than `None`. A site with no sent report of that type and no anchor day is due on the next run.
- **The nightly sweeps** (`--fleet turso`) cover `maintained` sites.

> Fleet-wide commands take `--fleet turso` (read the fleet roster from the database) — e.g. `reddoor-maint audit --fleet turso --only lighthouse --write-back`.

---

## Phase 5 — Deploy the dashboard (Netlify)

The cockpit, the per-site pages and their editors, the approve endpoint, the forms endpoint and the Resend webhook are Netlify Functions in `netlify/functions/`. Connect this repo to a Netlify site and set these **site environment variables** (Site settings → Environment):

| Netlify env var         | Value                             | Used by                                                             |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `TURSO_DATABASE_URL`    | the fleet database url            | every function that reads or writes the store (they 500 without it) |
| `TURSO_AUTH_TOKEN`      | its token                         | the same functions                                                  |
| `DASHBOARD_PASSWORD`    | your chosen operator password     | `/`, `/s/:slug`, approve POST                                       |
| `DASHBOARD_BASE_URL`    | `https://<your-site>.netlify.app` | `/` (builds the `/s/<slug>` links)                                  |
| `RESEND_WEBHOOK_SECRET` | the Resend webhook signing secret | the webhook function                                                |

The forms endpoint, Turnstile, prospect-report editing and the dashboard's GitHub buttons need more (`FORMS_INGEST_TOKEN`, `TURNSTILE_SECRET_KEY*`, `PROSPECT_EDIT_TOKEN`, `GH_TOKEN`) — the full list with purposes is the table in the README's [Site deployment](../README.md#site-deployment-netlify--resend) section.

Routes that go live: `/` (the cockpit — health tiers + the "Needs you" feed, Basic-Auth gated + rate-limited), `/s/<slug>` (per-site page: pending approvals, report previews, site details), `/fleet` (every site, whatever its status), `POST /api/reports/:id/approve` (the one-click approve), and the Resend webhook. Then in **Resend → Webhooks**, add an endpoint pointing at the deployed webhook function, subscribe to delivery/bounce/complaint events, and copy its signing secret into `RESEND_WEBHOOK_SECRET`.

To log in: visit `/`, the browser prompts for Basic Auth — any username, the `DASHBOARD_PASSWORD` you set.

---

## Phase 6 — Wire the crons (GitHub Actions)

The scheduled workflows in `.github/workflows/` do the unattended work. Set their inputs in this repo's **Settings → Secrets and variables → Actions**:

**Secrets:** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `RESEND_API_KEY`, `BACKUP_PASSPHRASE`, `TURSO_FLEET_USAGE`, `RENOVATE_APP_PRIVATE_KEY` (the `reddoor-renovate` GitHub App's key — an **org** secret, visible to all repos). Optional: `GA_SUBJECT` + `GA_SA_KEY_JSON` (analytics enrichment, below), `NETLIFY_PAT` (the deploy audit skips itself without it), and one `PRISMIC_TOKEN_*` per Prismic repository for the drift sweep (`reddoor-maint prismic-models <site> --tokens` names them).
**Variables:** `RENOVATE_APP_ID` (**org** variable, same App). The nightlies mint a short-lived installation token from the pair and hand it to the CLI as `GH_TOKEN`; there is no long-lived fleet PAT. `OPERATOR_EMAIL` (where the daily digest goes — unset, it falls back to the operator inbox hard-coded in `src/util/operator.ts`), `DASHBOARD_BASE_URL` (so digest links point at your dashboard).

| Workflow                      | Schedule (UTC) | Runs                                                                                                                                  | Needs                                                                                                                                             |
| ----------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fleet-db-backup.yml`         | `30 4 * * *`   | `db dump` → `db verify-dump` → encrypt, re-verify, upload; then `db usage` (plan-quota headroom)                                      | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BACKUP_PASSPHRASE`, `TURSO_FLEET_USAGE`                                                                |
| `fleet-prismic-drift.yml`     | `0 5 * * *`    | `prismic-models --fleet turso --write-back`                                                                                           | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, the `PRISMIC_TOKEN_*` secrets                                                                           |
| `fleet-security.yml`          | `0 6 * * *`    | security + deps audit (`--write-back`) → `renovate-dispatch --fleet` → `protection-audit --org reddoorla`                             | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `RENOVATE_APP_PRIVATE_KEY`; var `RENOVATE_APP_ID`                                                       |
| `fleet-lighthouse.yml`        | `0 8 * * *`    | fleet Lighthouse + domain + browser + netlify-deploy + function-health audit (`--write-back`) + `github-signals --fleet --write-back` | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `RENOVATE_APP_PRIVATE_KEY`, optional `NETLIFY_PAT`; var `RENOVATE_APP_ID`                               |
| `daily-reports.yml`           | `23 9 * * *`   | `report --due` → `report --send-ready` → `report --digest`                                                                            | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `RESEND_API_KEY`, optional `GA_SUBJECT` + `GA_SA_KEY_JSON`; vars `OPERATOR_EMAIL`, `DASHBOARD_BASE_URL` |
| `fleet-smoke.yml`             | `0 10 * * *`   | smoke audit (`--write-back`)                                                                                                          | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`                                                                                                          |
| `fleet-form-e2e.yml`          | `15 10 * * *`  | form-e2e audit (`--write-back`)                                                                                                       | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`                                                                                                          |
| `forms-deadletter-replay.yml` | `47 */6 * * *` | `db replay-deadletters`                                                                                                               | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `RESEND_API_KEY`; var `OPERATOR_EMAIL`                                                                  |

`report-rerender.yml` (dispatched by the console's "refresh preview" button) needs `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` too. `renovate.yml`, `release-health.yml` and `time-travel.yml` need no store credentials. (`ci.yml` is the reusable per-repo CI the self-updating sites call; `release.yml` publishes the npm package via changesets + GitHub's `GITHUB_TOKEN` / npm OIDC.)

---

## Phase 7 — The daily operator loop (how it runs once set up)

1. **09:23 UTC** the cron drafts any reports that are **due** (idempotent on the site, report type and period) — each lands in Turso with its rendered HTML, marked `draft_ready`, unapproved.
2. You open the **dashboard** (`/`). Each site with a draft is in the **"Needs you"** feed under **Waiting on your yes**; **Open ▸** takes you to its page (`/s/<slug>`), where **Pending your yes** lists each draft with a preflight chip, the resolved recipients, a **draft preview ▸** link, a commentary box (Maintenance/Testing), **refresh preview**, and the **Approve** button.
3. One click (`POST /api/reports/:id/approve`) sets `approved_to_send` (+ stamps who/when) — it does **not** send. It refuses, with the reasons, a report whose send would fail (no resolvable recipient, no header plate, no scores) or whose health gate is not clear; a health-red report offers **Send anyway…**, which needs a written reason and is logged as an override.
4. The **next** cron run sends the approved-∧-unsent reports via Resend, then emails you the **digest**: what got sent, what's **pending your yes**, and a **"Needs attention"** section (current critical/high vulns, delivery bounces/complaints, Renovate PRs failing CI, sub-75 Lighthouse) badged NEW/WORSE since yesterday.
5. The **08:00 UTC** Lighthouse + GitHub-signals cron keeps the cockpit's per-site signals fresh (zero GitHub calls happen in the page request — the page reads Turso).

You never touch the database by hand in the happy path; the dashboard click is your only action. A value that needs correcting is a field in the site's details (Phase 2), not a SQL edit.

---

## Phase 8 — Launching a new site (M6b)

```bash
reddoor-maint launch <path-to-site>
```

This runs the chain — **bootstrap (`self-updating`) → first audit → draft a purpose-built launch email** — and stops at a `draft_ready` Launch report in your approve queue (it never sends directly). Approve it on the site's dashboard page; the next run sends the go-live email and **flips the site's Status to `maintained`** with a `launched_at` stamp. The launch email reuses the per-site Copy — Contact / Copy — Footer overrides from the site details.

> Requires the site's row in Turso with its deployed `url` (Phase 4): `launch` finds the site by name, checks its dev guard against that url, and stops with `no site row matched` when there is no row. The send also needs the site's header plate (`header-image <slug> --write-back`).

---

## Phase 9 — Outstanding follow-ups (do these once)

- [ ] Confirm the `reddoor-renovate` App's `RENOVATE_APP_ID` (org variable) and `RENOVATE_APP_PRIVATE_KEY` (org secret) are visible to all repos, so both the nightly sweep and every repo's Renovate can mint a token (`docs/runbooks/renovate-app-identity.md`).
- [ ] Set the `OPERATOR_EMAIL` + `DASHBOARD_BASE_URL` Actions **variables** so the digest reaches you with working links.
- [ ] (Optional) Manually trigger `fleet-lighthouse.yml` once (`gh workflow run fleet-lighthouse.yml`) to populate the cockpit's GitHub signals immediately instead of waiting for the first nightly run.

---

## Quick reference — where each secret lives

| Secret                     | `~/.config/reddoor-maint/credentials.env` (CLI) | Netlify env (dashboard) | GitHub Actions secret (crons) | Actions variable |
| -------------------------- | :---------------------------------------------: | :---------------------: | :---------------------------: | :--------------: |
| `TURSO_DATABASE_URL`       |                        ✓                        |            ✓            |               ✓               |                  |
| `TURSO_AUTH_TOKEN`         |                        ✓                        |            ✓            |               ✓               |                  |
| `RESEND_API_KEY`           |                        ✓                        |                         |               ✓               |                  |
| `RESEND_WEBHOOK_SECRET`    |                                                 |            ✓            |                               |                  |
| `DASHBOARD_PASSWORD`       |                                                 |            ✓            |                               |                  |
| `DASHBOARD_BASE_URL`       |                                                 |            ✓            |                               |        ✓         |
| `BACKUP_PASSPHRASE`        |             ✓ (to decrypt a backup)             |                         |               ✓               |                  |
| `TURSO_FLEET_USAGE`        |               ✓ (for `db usage`)                |                         |               ✓               |                  |
| `RENOVATE_APP_PRIVATE_KEY` |                                                 |                         |            ✓ (org)            |                  |
| `RENOVATE_APP_ID`          |                                                 |                         |                               |     ✓ (org)      |
| `GH_TOKEN`                 |                ✓ (or `gh auth`)                 |            ✓            |                               |                  |
| `GITHUB_TOKEN`             |      omit — falls back to `gh auth token`       |                         |                               |                  |
| `OPERATOR_EMAIL`           |                        ✓                        |                         |                               |        ✓         |
| `GA_SUBJECT`               |                        ✓                        |                         |               ✓               |                  |
| `GA_SA_KEY_JSON`           |         ✓ (as a file, `GA_SA_KEY_PATH`)         |                         |               ✓               |                  |

### GA / Search Console in the daily cron

`daily-reports.yml` drafts reports, and GA + Search Console enrichment happens **at draft
time** — so both secrets must exist on the repo or the drafting step silently skips them.
`readGaConfig()` returns `null` when `GA_SUBJECT` is unset, and `fetchGaUsers`/`fetchSearch`
then take their not-configured early return: reports still draft, but with **no ANALYTICS
section** and a `Maint: Google Indexed` row that reads "Search Console not configured in the
environment that drafted this report".

Locally the service-account key is a file (`GA_SA_KEY_PATH`). In Actions there is no file, so
store the key's **contents** as `GA_SA_KEY_JSON`; the workflow writes it to `$RUNNER_TEMP` and
points `GA_SA_KEY_PATH` at it.

```bash
gh secret set GA_SUBJECT --repo reddoorla/reddoor-maintenance --body 'you@yourdomain.com'
gh secret set GA_SA_KEY_JSON --repo reddoorla/reddoor-maintenance \
  < ~/.config/reddoor-maint/ga-service-account.json
```

The service account needs domain-wide delegation for the `webmasters.readonly` scope, and the
impersonated subject must have access to the Search Console property (`sites.list` only returns
properties that subject can see — a subject that lost access reports "no property", not an
auth error).
