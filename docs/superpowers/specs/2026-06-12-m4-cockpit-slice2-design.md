# M4 Cockpit — Slice 2: GitHub-sourced signals (design)

**Date:** 2026-06-12
**Status:** Design — approved at the architecture level (Tucker, 2026-06-12: staleness = GitHub last-commit). Ready for an implementation plan.
**Milestone:** M4 slice 2 of [the fleet-scale roadmap](2026-06-02-fleet-scale-roadmap.md) (§M4). Extends [slice 1](2026-06-11-m4-operator-cockpit-design.md) (§11 sketched this).

> Goal: light up the cockpit's three GitHub-sourced signals — **Renovate update PRs failing CI**, **default-branch CI red**, and **deploy staleness** — without ever calling GitHub in the page request path. A nightly job persists them per-site to Airtable; the cockpit reads them like every other signal.

---

## 1. The constraint that shapes everything

The cockpit renders from already-persisted Airtable state (slice 1, §4) — hitting GitHub for ~200 repos on every page load is a non-starter. So slice 2 is **two decoupled halves**:

- **② Producer (nightly → Airtable):** a fleet sweep queries GitHub per repo and writes three new Websites fields. Runs in CI on a cron with the fleet-read token.
- **② Consumer (cockpit reads Airtable):** new pure collectors turn those persisted fields into the same `AttentionItem` / tier machinery slice 1 built. No GitHub in the request path.

They ship as **separate PRs**: **2a = producer**, **2b = consumer**. 2a lands + runs (populating Airtable) before 2b surfaces real data, but 2b is built/tested against fixtures so it doesn't block on a live sweep.

## 2. Decisions locked

| Fork                         | Decision                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Staleness source**         | **GitHub last-commit-to-default-branch** (Tucker, 2026-06-12). The fleet auto-deploys `main` on push (Netlify GitHub App), so last-commit-to-`main` is an accurate, zero-new-infra proxy for last-deploy. Reuses the token already plumbed. (Netlify deploy-time rejected: needs a token + per-site site-ids.)                                      |
| **Producer shape**           | A **dedicated thin command** (`github-signals --fleet --write-airtable`), NOT an `audit --only` type — `writeAuditsToAirtable` hard-requires a Lighthouse result, and these are per-repo GitHub queries, not a per-URL audit. Reuses only the fleet-iterate-serial-write _pattern_.                                                                 |
| **Cron home**                | A new step in the existing nightly **`fleet-lighthouse.yml`** (already iterates the fleet + writes Airtable nightly), staggered after the Lighthouse write, with `RENOVATE_TOKEN` in env. (A standalone `fleet-github-signals.yml` is the alternative; the plan picks one — default: a step in the existing cron to avoid a new keepalive surface.) |
| **Tier mapping**             | Renovate-failing (count > 0) and CI-red → 🔴 **attention** (any attention item → red, per slice 1). Deploy-stale > 30d → 🟡 **watch**. Severity **warning** for both new attention kinds (maintenance signals, not production-down — tunable later).                                                                                                |
| **Staleness replaces proxy** | The real `lastCommitAt` replaces slice 1's `lastLighthouseAuditAt`-age Watch proxy. A null `lastCommitAt` (no repo / not yet swept) is NOT stale.                                                                                                                                                                                                   |

## 3. Producer (2a)

### 3.1 GitHub client — one new method

`src/github/gh.ts` gains one method on `GitHub`, mirroring `openPullRequests` (single `gh api graphql` call):

```ts
/** Default branch's latest-commit date + CI rollup, in one query. */
defaultBranchStatus: (repo: string) => Promise<{ ciState: CiState; lastCommitAt: string | null }>;
```

GraphQL: `repository.defaultBranchRef.target { ... on Commit { committedDate statusCheckRollup { state } } }`. `ciState` via the existing `mapRollupState`; `lastCommitAt` = `committedDate` (null when no default branch / empty repo).

### 3.2 The sweep (pure) + writer

- **`src/audits/github-signals.ts` (new)** — `collectGitHubSignals(sites, deps): Promise<GitHubSignalsRow[]>`, pure over an injected `{ openPullRequests, defaultBranchStatus }`. Per site with a `gitRepo`: `renovateFailingCis` = count of its open PRs matching `isFailingRenovatePR` (reuses `src/alerts/renovate.ts`); `{ ciState, lastCommitAt }` from `defaultBranchStatus`. A repo whose probe throws is recorded in `skipped` (never sinks the sweep), exactly like `collectRenovateFailures`. Sites without `gitRepo` are skipped.
- **`updateGitHubSignals(base, recordId, signals)`** in `src/reports/airtable/websites.ts` — writes the four fields (§3.3). A null sub-value is omitted (don't clobber a prior good value with a not-determined-this-run null), matching `updateDepsCounts`'s pattern.

### 3.3 Airtable — four new Websites fields (created live via MCP before 2a merges)

| Field                  | Type             | Meaning                                                       |
| ---------------------- | ---------------- | ------------------------------------------------------------- |
| `Renovate Failing CIs` | Number (integer) | Count of open Renovate PRs failing CI. null = not swept.      |
| `Default Branch CI`    | Single line text | `passing` / `failing` / `pending` / `none`. null = not swept. |
| `Last Commit At`       | Date (with time) | ISO timestamp of the last commit to the default branch.       |
| `GitHub Signals At`    | Date (with time) | When the sweep last wrote this row (freshness/debugging).     |

`WebsiteRow` + `mapRow` gain `renovateFailingCis`, `defaultBranchCi`, `lastCommitAt`, `githubSignalsAt`.

### 3.4 Command + cron

- **`github-signals --fleet --write-airtable`** (new CLI command): reads `listWebsites`, builds the GitHub client from `RENOVATE_TOKEN`→`GH_TOKEN` (reuse `buildRenovateProbe`'s token logic), runs `collectGitHubSignals`, writes each row serially (Airtable ~5 req/sec), and emits a `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` line for the workflow gate (mirroring `formatFleetWriteSummary`). No token → exits cleanly with a skip notice (local runs).
- **Cron:** a new step in `.github/workflows/fleet-lighthouse.yml` after the Lighthouse write, `RENOVATE_TOKEN: ${{ secrets.RENOVATE_TOKEN }}` in env.

## 4. Consumer (2b)

### 4.1 New attention kinds + collectors (pure, read persisted fields)

- `AttentionItem["kind"]` gains **`"ci"`** (it already has `"renovate"`). `src/reports/digest.ts`.
- **`collectRenovateAlerts(sites, baseUrl)`** — per site with `renovateFailingCis > 0`: one item, `key: renovate:<siteId>`, kind `renovate`, severity `warning`, `metric` = count, title `N Renovate PR(s) failing CI`. (Reads the PERSISTED count — distinct from the live-sweep `renovateFindingsToAttention` the digest uses.)
- **`collectCiAlerts(sites, baseUrl)`** — per site with `defaultBranchCi === "failing"`: one item, `key: ci:<siteId>`, kind `ci`, severity `warning`, `metric` 1, title `Default-branch CI failing`.
- Both live in `src/alerts/digest-collectors.ts` alongside the slice-1 collectors, pure + unit-tested.

### 4.2 `buildCockpitModel` + `assignTier`

- `buildCockpitModel` adds `collectRenovateAlerts` + `collectCiAlerts` to the `rawItems` union → they tier as 🔴 attention and badge NEW/WORSE via the same `diffAttention`. (These also flow into the digest later; out of scope here.)
- `assignTier`'s Watch staleness switches from `lastLighthouseAuditAt`-age to **`lastCommitAt`-age > 30d** (`watchSignals` keeps `"stale"`). Null `lastCommitAt` → not stale.
- `CockpitSummary` gains `renovateFailing` and `ciRed` counts; the headline line shows them.

### 4.3 Renderer

- Card chips render automatically from the new items' titles (slice-1 `chips()`); a `renovate`/`ci` item gets the existing chip treatment, NEW/WORSE badged.
- `FILTERS` gains **`prs`** (matches the `renovate` signal) and **`ci`**; `signalsAttr` maps kind `renovate`→`prs`, `ci`→`ci`. The slice-1 `pending` short-circuit and structured `watchSignals` are unchanged.
- Summary bar shows the two new counts.

## 5. Error handling

- **Producer:** per-repo probe failure → `skipped` (never sinks the sweep); a write failure → collected in `FleetWriteResult.failed` (one bad site never aborts the batch), surfaced in `FLEET_WRITE_SUMMARY`. No-token → clean skip.
- **Consumer:** the collectors are pure and individually wrapped by the existing `runCollector` isolation; a null/missing field reads as "no signal" (never throws). A stale/empty sweep just yields no new items — the page still renders.

## 6. Out of scope

- Feeding the new persisted signals into the **email digest** (the digest keeps its live Renovate sweep for now) — a later unification.
- **Netlify deploy-time** staleness (rejected, §2).
- **Per-PR drill-down** on the cockpit (the chip count links to the site page, not individual PRs).

## 7. Slice breakdown

- **2a — producer** (its own plan, full TDD): `defaultBranchStatus` GH method · `collectGitHubSignals` + `updateGitHubSignals` · the four Airtable fields (live) · the `github-signals --fleet --write-airtable` command · the cron step. Live-verify: one real sweep populates the fields.
- **2b — consumer** (its own plan, full TDD): `"ci"` kind · `collectRenovateAlerts` + `collectCiAlerts` · `buildCockpitModel`/`assignTier`/summary wiring · the `prs`/`ci` filters + chips. Live-verify: the cockpit shows the real signals 2a persisted.

## 8. Success criteria

After 2a runs nightly, each repo-backed Websites row carries a fresh Renovate-failing count, default-branch CI state, and last-commit timestamp. After 2b, the cockpit's 🔴 tier includes sites with a failing Renovate PR or a red `main`, each card shows the `⬆ N PRs failing` / `CI red` chip (NEW/WORSE badged), the 🟡 Watch tier flags real deploy-staleness, and the `prs`/`ci` filters narrow to them — all with zero GitHub calls in the page request.
