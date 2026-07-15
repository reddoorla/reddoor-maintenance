# Runbook — move GA/Search off a personal subject to a role account

**Goal:** eliminate the single-point-of-failure where one _personal_ Google Workspace user backs every site's Analytics + Search Console enrichment. Move the impersonated **subject** to a role account (`reports@reddoorla.com`, already the report/digest `From:` identity) so that offboarding any individual never blanks the whole fleet's analytics.

> **You run this, not the CLI.** Steps 1–4 are Google Workspace / GA / Search Console console work, and step 6 is a secret change — neither is something the maintenance tooling can do for you. This runbook is the exact ordered procedure.

---

## Why this matters

`@reddoorla/maintenance` reads GA4 "Users" and Search Console presence via **one** service account that uses **domain-wide delegation (DWD)** to _impersonate a Workspace user_ — the **subject**:

- **`GA_SUBJECT`** — a **comma-separated failover list** of impersonated Workspace users, tried in order (e.g. `reports@reddoorla.com,person@reddoorla.com`; a single address is still valid). Read by [`readGaConfig()`](../../src/reports/ga/config.ts) and used by **both** the GA Data API client ([`src/reports/ga/client.ts`](../../src/reports/ga/client.ts)) **and** the Search Console client ([`src/reports/search/client.ts`](../../src/reports/search/client.ts)). When a subject fails auth, the clients fall through to the next one and log a greppable `subject failover` warning ([`src/reports/ga/failover.ts`](../../src/reports/ga/failover.ts)) — a dying primary is visible **before** it becomes a total outage. The list only helps if the backup subject actually has property access, so this cutover is still required.
- **`GA_SA_KEY_PATH`** — path to the service-account JSON key (defaults to `ga-service-account.json` beside `~/.config/reddoor-maint/credentials.env`).

If that subject is a personal account and the person is offboarded (or loses GA/Search access), **every** site's GA + Search enrichment fails at once. The failure is _soft_: drafting never throws — reports still send, but **with blank analytics** ([`fetchGaUsers`/`fetchSearch`](../../src/reports/draft.ts) return `softFailed: true`, the numbers go blank, the operator can still hand-enter them). So the outage is **silent** unless you're watching the cron log line `⚠ N site(s) had GA/Search enrichment fail — drafted with blank analytics` (and, now, the fleet-wide alert email + the per-site cockpit/digest signal this feature adds).

Moving the subject to `reports@reddoorla.com` (a role account nobody's offboarding tears down) removes the personal SPOF.

---

## Prerequisite (one-time, already true)

The service account's client ID is authorized for the GA + Search Console **read scopes** under **Workspace Admin → Security → API controls → Domain-wide delegation**. DWD lets the SA impersonate _any_ user in the domain, so there is **no per-user delegation step** — but the subject must be a **real Workspace user in the `reddoorla.com` domain**, and that user must have been **granted access to each GA/Search property** (steps 2–3 below). Confirm `reports@reddoorla.com` exists as a Workspace user before starting.

---

## The cutover — ORDER IS LOAD-BEARING

> ⚠️ **Grant access BEFORE flipping the subject.** Keeping the old subject in the list (step 6) means a premature flip degrades to a per-run `subject failover` warning instead of blanking every site — but don't lean on the safety net: do steps 2–3 fully, verify (step 5), flip (step 6), and only drop the old subject (step 8) after production is verified.

### 1. Confirm the role account

`reports@reddoorla.com` is already the `From:` identity for report + digest emails, so the mailbox exists. Confirm it's a **Workspace user** (not just a send-as alias) under **Admin → Directory → Users**. If it's only an alias/group, create it as a user — DWD impersonation needs a real user.

### 2. Grant it Viewer on every GA4 property

Enumerate the GA4 properties in use: the Airtable **Websites** table, column **`GA4 property ID`** (every non-empty value is a property backing a site's report).

For each property: **GA Admin → Property → Property Access Management → `+` → add `reports@reddoorla.com` as `Viewer`** (Viewer is sufficient — the tooling only reads).

### 3. Grant it access to every Search Console property

Enumerate from the Websites columns **`Search Console property`** (explicit property) and **`Search query`** (sites with search enrichment; the property defaults from the site URL when `Search Console property` is blank).

For each: **Search Console → Settings → Users and permissions → Add user → `reports@reddoorla.com`**, permission **`Full`** (or at least `Restricted` — read is enough).

### 4. Re-confirm DWD scope (sanity check)

Under **Admin → Security → API controls → Domain-wide delegation**, confirm the SA's client ID lists the GA Data API + Search Console read scopes. (No change expected — this is unchanged by the subject swap; just verify nothing regressed.)

### 5. Verify impersonation BEFORE touching production

Without changing the production secret, dry-run against the new subject locally. In a throwaway shell (do **not** persist this):

```bash
GA_SUBJECT=reports@reddoorla.com reddoor-maint report <slug> --preview
```

Open `reports/<slug>/draft.html` and confirm the GA Users + Search lines are **populated** (not blank). Try 2–3 sites spanning different GA4 properties. If any blanks, the property in step 2/3 wasn't granted yet — fix before proceeding.

### 6. Flip the subject (the actual cutover — zero-downtime)

Set `GA_SUBJECT=reports@reddoorla.com,<current-subject>` in **both** places the tooling reads it — the role account becomes the primary and the old subject stays on as the failover safety net, so a missed grant degrades to a logged warning instead of blank analytics:

- **Local CLI:** `~/.config/reddoor-maint/credentials.env` (the only file the CLI reads — never the repo `.env`).
- **The report cron:** the GitHub Actions secret/variable wherever `report --due` / `--send-ready` / `--digest` run.

### 7. Verify in production

On the next `reddoor-maint report --due` run, confirm:

- **No** `⚠ N site(s) had GA/Search enrichment fail` line in the run output.
- **No** `subject failover` warning line that points at THIS runbook — one means `reports@` failed auth (or its `sites.list` saw no property) and the OLD subject carried the run; finish the step-2/3 grants before step 8. A `subject failover: … (transient quota/rate-limit, not an access loss)` line is benign — a per-user rate-limit blip that failed over to spread load, **not** a grant problem, so it needs no action.
- A freshly drafted Reports row has **GA users (period)** populated.

A botched flip surfaces immediately as a **fleet-wide analytics-failure alert email** (and the per-site cockpit/digest signal) instead of a silent blanking — so you'll know within one cron run if a grant was missed. Make sure `OPERATOR_EMAIL` is set in the report cron's environment so that alert reaches you (not the `info@` fallback).

### 8. Drop the old subject

After step 7 is clean on a nightly run, set `GA_SUBJECT=reports@reddoorla.com` (drop the old subject from the list) in both places. Offboarding the person now can't touch analytics.

---

## Rollback

Put the previous subject FIRST in the `GA_SUBJECT` list (or revert to it alone) in both places. Analytics is restored on the next run **provided the old user still has property access** — so don't offboard the old subject until the new one is verified in production (steps 5 + 7 both green).

---

## Related

- Single config point: [`src/reports/ga/config.ts`](../../src/reports/ga/config.ts) (`GA_SUBJECT` / `GA_SA_KEY_PATH`).
- Subject failover (list order, auth-shaped error detection, the `subject failover` warning): [`src/reports/ga/failover.ts`](../../src/reports/ga/failover.ts).
- Soft-fail behavior: [`fetchGaUsers` / `fetchSearch`](../../src/reports/draft.ts) (`softFailed`), aggregated as `softFailedSites` in [`draftDueReports`](../../src/cli/commands/report.ts).
- Fleet-wide failure alert (catches a botched cutover or a future offboarding): see the analytics alert wired into the report cron / digest.
