# Fleet Activity Feed — "Recently" Design

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Scope:** A recorded fleet-event log + a cockpit "Recently" lane that makes the fleet's autonomy visible. New libSQL table, small instrumentation of the nightly producers, one new collapsed cockpit lane. Dashboard render changes ship on a `main` redeploy; the event-writing producers ship in `@reddoorla/maintenance` (npm) since the fleet workflows run the published CLI.

## Goal

Make the fleet's self-maintenance **visible**. Today the cockpit only ever shows problems and pending work; it never shows *"the fleet did X for you"* — so the autonomy (Renovate auto-merging, nightly audits, CI staying green) happens off-screen and the operator can't feel it working. This adds a recorded activity log and a calm "Recently" lane that answers *"what has the fleet been doing?"* — the reassurance counterpart to the verdict bar's *"is anything wrong?"*. This fixes incoherence #6 from the cockpit reorg ([2026-06-25 cockpit reorg spec](2026-06-25-cockpit-reorg-needs-you-feed-design.md)).

## Background

A code inventory confirmed **there is no event log anywhere** — everything is current-state snapshots: Airtable `Websites`/`Reports` overwrite in place; libSQL has only `submissions` + daily `spam_screenouts` aggregates. So "what the fleet did" must be **recorded as events by the producers** as they run (a derive-from-state summary can't attribute specific auto-merges, which is the whole payoff). Decision: a lightweight libSQL event log (chosen over derive-from-state and an Airtable/GitHub-only sweep).

## Decisions (locked with the operator)

- **Architecture:** a recorded libSQL event log (`fleet_events`), not derived-from-state.
- **Event streams recorded:** *Fixed* (`pr_automerged`, `vuln_cleared`), *Watched* (`fleet_swept` rollup), *Recoveries/milestones* (`ci_recovered`, `site_launched`, `cert_renewed`). **Reports-sent is excluded** (overlaps the approve flow).
- **Placement:** the lane sits after the Fleet panel, before the Inbox lane — `verdict → Needs-you → Fleet → 🔧 Recently → Inbox`. Collapsed by default (reassurance, not an alarm).
- **Storage:** libSQL, with **Turso credentials added to the nightly fleet workflows** (a one-time operator step) so the Actions-run producers can write events.
- **`cert_renewed` included** in this build.
- **Window:** store 30 days (prune older), render the last 7 days.

## Architecture

```text
nightly GitHub Actions producers ──recordFleetEvent()──▶ libSQL  fleet_events
  (fleet-security, github-signals,                          │
   fleet-lighthouse/domain, daily-reports)                  │ listFleetEvents(since=7d)
                                                            ▼
                              fleet-homepage.mts handler ──▶ renderCockpitHtml
                                                            ▼
                                          cockpit "🔧 Recently" collapsed lane
```

A new `fleet_events` table is written by the existing nightly producers (each a small append as it already iterates the fleet) and read by the cockpit handler, which already opens libSQL for submissions/spam. Pure-core `buildCockpitModel` gains a `recentEvents` input (mirroring `newSubmissions`/`spamTotals`); the renderer gains a `renderRecentlyLane`.

## Components

### 1. Schema — `0002_fleet_events` migration (`src/db/migrations.ts`)

```sql
CREATE TABLE IF NOT EXISTS fleet_events (
  id         TEXT PRIMARY KEY,   -- deterministic, for idempotent INSERT OR IGNORE (see below)
  ts         TEXT NOT NULL,      -- ISO8601 when the event occurred
  type       TEXT NOT NULL,      -- pr_automerged | vuln_cleared | ci_recovered | site_launched | fleet_swept | cert_renewed
  site_id    TEXT,               -- Websites record id; NULL for fleet-wide rollups
  site_name  TEXT,               -- denormalized so the render needs no join; NULL for rollups
  summary    TEXT NOT NULL,      -- human line, e.g. "auto-merged vite→7.3.5"
  data       TEXT,               -- optional JSON (e.g. {"url":"…","repo":"reddoorla/revogen","number":14})
  created_at TEXT NOT NULL       -- ISO when the row was inserted
);
CREATE INDEX IF NOT EXISTS idx_fleet_events_ts ON fleet_events (ts);
```

Idempotency is the crux — sweeps overlap and re-run, so **deterministic ids** + `INSERT OR IGNORE` guarantee no duplicates:
- `pr_automerged:<repo>#<number>` — once per merged PR, ever.
- `vuln_cleared:<site_id>:<YYYY-MM-DD>` · `ci_recovered:<site_id>:<YYYY-MM-DD>` · `cert_renewed:<site_id>:<YYYY-MM-DD>` — at most one per site per day.
- `site_launched:<site_id>` — once ever.
- `fleet_swept:<sweep>:<YYYY-MM-DD>` — one per sweep per day (`sweep` ∈ lighthouse | security | github-signals).

### 2. DB helpers (`src/db/fleet-events.ts`)

```ts
export type FleetEventType = "pr_automerged" | "vuln_cleared" | "ci_recovered" | "site_launched" | "fleet_swept" | "cert_renewed";
export type FleetEvent = { id: string; ts: string; type: FleetEventType; siteId: string | null; siteName: string | null; summary: string; data: unknown | null };

/** Idempotent append (INSERT OR IGNORE on the deterministic id). */
export async function recordFleetEvent(db, e: { id; ts; type; siteId?; siteName?; summary; data? }): Promise<void>;
/** Recent events, newest-first. */
export async function listFleetEvents(db, opts: { sinceIso: string; limit: number }): Promise<FleetEvent[]>;
/** Retention prune. */
export async function pruneFleetEvents(db, beforeIso: string): Promise<void>;
```

### 3. Producer instrumentation (each small; all run in Actions and need libSQL creds)

- **`pr_automerged`** *(extend `github-signals`)* — it already queries GitHub per repo. Add: list PRs with head `renovate/*`, `state=closed`, `merged_at != null`, merged since the per-site watermark (prior `GitHub Signals At`, or a 24h fallback on first run). Per PR → `recordFleetEvent({ id:"pr_automerged:"+repo+"#"+n, ts:mergedAt, type, siteId, siteName, summary: cleanTitle(pr.title), data:{url, repo, number} })`. `cleanTitle` strips the `chore(deps): update dependency ` prefix → "vite to v7.3.5 [security]" → "auto-merged vite→7.3.5".
- **`ci_recovered`** *(in `github-signals`)* — it has the existing row's old `Default Branch CI` and computes the new one. When `old === "failing" && new === "passing"` → event "CI recovered".
- **`vuln_cleared`** *(in the `fleet-security` writer, `src/audits/security-airtable.ts`)* — read-before-write: when the site's prior `critical+high` count was `>0` and the new count is `0` → event "cleared N vuln(s)".
- **`cert_renewed`** *(in the domain-audit writer, `src/audits/domain-airtable.ts`)* — when prior `Cert days remaining` was `< 30` (or null) and the new value is `> 60` → event "TLS cert renewed".
- **`site_launched`** *(in the launch/send path where `Launched at` is set)* — when it transitions null→set → event "launched 🚀".
- **`fleet_swept`** *(at the end of the `--fleet` CLI path)* — one rollup per sweep with the processed count → "re-audited N sites" / "security swept N sites".

All producers also call `pruneFleetEvents(db, now-30d)` once per run.

### 4. Cockpit render (`src/dashboard/fleet-render.ts` + handler)

- `fleet-homepage.mts`: `const recentEvents = await listFleetEvents(db, { sinceIso: now-7d, limit: 20 })`, passed into `buildCockpitModel(... , recentEvents)`.
- `buildCockpitModel`: add `recentEvents: FleetEvent[] = []` param → `model.recentEvents`.
- `renderRecentlyLane(model)`: a collapsed `<details class="recently">` (mirrors `renderInboxLane`), rendered between `renderFleetBrowsePanel` and `renderInboxLane`. Returns `""` when empty. Each row: a type icon (🔧 merged · 🛡 vuln cleared · ✅ CI recovered · 🚀 launched · 🔒 cert · 🔄 swept), the summary, the site name, a relative time, and an optional link (PR `data.url` for `pr_automerged`, else `/s/<slug>` when `siteId`). Summary header: `🔧 Recently (N)`.

### Data flow

Producers (Actions CLI) → `recordFleetEvent` → `fleet_events`. Handler → `listFleetEvents(7d)` → `buildCockpitModel(recentEvents)` → `renderRecentlyLane`.

### Operator dependency (required to activate)

⚠️ The nightly producers run in **GitHub Actions** and today carry only Airtable creds. Add the existing **libSQL/Turso credentials** (the same env `openDb` reads — confirm exact names in `src/db`) to: `fleet-security.yml`, `fleet-lighthouse.yml` (incl. the `github-signals` step), and `daily-reports.yml`. Until added, producers no-op on event writes (must fail safe — a missing-creds write must not break the sweep). The feed ships **dark** until creds are present, exactly like the auto-fix-exhausted counter shipped dark.

## File structure

- `src/db/migrations.ts` — add `0002_fleet_events`.
- `src/db/fleet-events.ts` — **new**: `FleetEvent`/`FleetEventType`, `recordFleetEvent`, `listFleetEvents`, `pruneFleetEvents`.
- `src/audits/github-signals.ts` (+ its writer) — `pr_automerged` + `ci_recovered`.
- `src/audits/security-airtable.ts` — `vuln_cleared`.
- `src/audits/domain-airtable.ts` — `cert_renewed`.
- launch/send path (the module that sets `Launched at`) — `site_launched`.
- the `--fleet` CLI path (`src/cli/commands/audit.ts` / `github-signals.ts`) — `fleet_swept` rollup + prune.
- `src/dashboard/fleet-cockpit.ts` — `recentEvents` on `CockpitModel` + `buildCockpitModel`.
- `src/dashboard/fleet-render.ts` — `renderRecentlyLane` + wire into `renderCockpitHtml`.
- `netlify/functions/fleet-homepage.mts` — fetch + pass `recentEvents`.
- `.github/workflows/{fleet-security,fleet-lighthouse,daily-reports}.yml` — add Turso env.

## Testing

- **`recordFleetEvent`/`listFleetEvents`/`pruneFleetEvents`** (in-memory libSQL `:memory:`): insert, idempotent re-insert (same id → one row), `sinceIso` filter + newest-first order + limit, prune cutoff.
- **Delta logic** (pure helpers, table-driven): `vuln_cleared` only on `>0→0` (not `5→2`, not `0→0`); `ci_recovered` only on `failing→passing`; `cert_renewed` only on `<30→>60`.
- **`cleanTitle`** for merged-PR summaries.
- **Merged-PR selection** — given a list of PRs, picks only `renovate/*` merged after the watermark; respects the 24h first-run fallback.
- **`renderRecentlyLane`** (render-string): collapsed `<details class="recently">`, correct icons per type, PR link vs `/s/<slug>` link, empty→"", placed between Fleet and Inbox; submissions/verdict untouched.
- Existing handler/producer tests stay green; producer event-writes are best-effort (a throwing/absent db must not fail the sweep — test the fail-safe).

## Out of scope (YAGNI)

- No "since last visit" / last-seen marker (the 7-day window suffices; catch-up is a clean follow-on on this foundation).
- Reports-sent events.
- No per-site activity history on `/s/<slug>` (cockpit-only for now).
- No backfill of historical events — the log starts accumulating from deploy.

## Release

Two changesets or one: the producer/CLI + db changes are an npm **minor** (the fleet workflows run the published CLI); the dashboard render is live-on-redeploy. One **minor** changeset covers both. Feed ships **dark** until the Turso creds are added to the workflows (operator step).
