# M5 — Alerting: the digest's "Needs attention" (design)

**Date:** 2026-06-11
**Status:** Design — approved at the architecture level (Tucker, 2026-06-11). Ready for an implementation plan.
**Milestone:** M5 of [the fleet-scale roadmap](2026-06-02-fleet-scale-roadmap.md) (§M5; locked decision §9.4 = email digest, no SMS). Builds directly on M3's digest ([M3 design](2026-06-11-m3-scheduled-recurrence-design.md)).

> Goal: make the M3 daily digest's **"Needs attention"** section — the typed `AttentionItem[]` seam, currently hard-coded `[]` — surface what's broken across the fleet, as a **daily snapshot that badges what's new or worse** since yesterday.

---

## 1. The reframe: signals split by cost; no history exists yet

A code read (2026-06-11) found the digest seam ready and the four roadmap signals split cleanly:

- **Free today (already in Airtable):** **delivery** bounces/complaints (the Resend webhook writes `deliveryStatus` ∈ {delivered, bounced, complained, pending} per Reports row); **current critical/high vulns** (the security audit writes `Security Vulns Critical/High/...` per Website row).
- **Built, needs a token:** **Renovate-PRs-failing-CI** — `collectRenovateFailures` ([src/alerts/renovate.ts](../../../src/alerts/renovate.ts), #156) exists; it needs a fleet-read GH token in the cron's digest step.
- **Needs new infra:** anything **delta**-shaped. Airtable stores only _current_ vuln counts and _current_ Lighthouse scores — **no baseline/history**. So "**new** vuln" / "Lighthouse **regression**" require persisting a prior snapshot.

The chosen **hybrid** ("snapshot now, mark what's new") needs that prior-state store — so M5 builds it, minimally.

## 2. Decisions locked in this brainstorm (2026-06-11)

| Fork                  | Decision                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Snapshot vs delta** | **Hybrid.** Render the full current snapshot every day (never silently drop a standing problem); **badge items that are NEW or WORSE** since the last digest.                                                                                                                                                                                                                                             |
| **Prior-state store** | **(A) A single Airtable "Digest State" record holding a JSON snapshot** `{ key → {metric, firstFlaggedAt} }`. One read + one write per run; no per-entity schema sprawl; survives the stateless runner. (B — a dedicated per-item table enabling snooze/history — is the noted future upgrade; C — a committed state file — rejected, it'd add a daily bot commit against the no-dummy-commit keepalive.) |
| **Slice scope**       | **Slice 1 = the hybrid framework + the two zero-infra signals** (delivery, vulns). **Slice 2 = Renovate** (token). **Slice 3 (later) = Lighthouse regression.**                                                                                                                                                                                                                                           |
| **Thresholds**        | Vulns: **critical + high only** (medium/low omitted). Delivery: any bounce/complaint, **complaint ranked above bounce**.                                                                                                                                                                                                                                                                                  |

## 3. Architecture (slice 1)

```text
runDigest()  (daily, in the cron — extends M3's digest)
  1. collectAttention(deps) → AttentionItem[]      each with a stable `key` + `metric` + `severity`
       • delivery:  Reports where deliveryStatus ∈ {bounced, complained}   [listAllReports — free]
       • vulns:     Websites where critical+high > 0                        [listWebsites — free]
       (each collector is isolated: one failing collector never blanks the others)
  2. read prior snapshot  ← Digest State record
  3. diffAttention(items, prior, today)  → tag each NEW / WORSE / STANDING, compute next snapshot
  4. renderDigestHtml(): group items BY SITE, severity-ordered, NEW/WORSE badged at top
  5. send (existing M3 path: no-noise skip if Ready+Attention both empty; digest-<date> idempotency)
  6. write next snapshot  → Digest State record  (so tomorrow can diff)
```

## 4. Components

### 4.1 The extended `AttentionItem`

`src/reports/digest.ts` — the seam grows the fields the hybrid needs (internal type; only the digest consumes it):

```ts
export type AttentionSeverity = "critical" | "warning";
export type AttentionStatus = "new" | "worse" | "standing";
export type AttentionItem = {
  key: string; // stable identity for diffing: `vuln:<siteId>`, `delivery:<reportId>`
  kind: "vuln" | "delivery" | "renovate" | "lighthouse";
  siteName: string; // grouping key in the render
  title: string;
  url?: string;
  severity: AttentionSeverity;
  metric: number; // comparable magnitude for NEW/WORSE (vuln count; 1 for binary events)
  status?: AttentionStatus; // set by diffAttention before render
};
```

### 4.2 Collectors (pure)

`src/alerts/digest-collectors.ts` (new) — each takes already-fetched data, returns `AttentionItem[]`, pure + unit-tested:

- **`collectVulnAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[]`** — for each site with `(securityVulnsCritical ?? 0) + (securityVulnsHigh ?? 0) > 0`: one item, `key: vuln:<siteId>`, `siteName` = site.name, `metric` = critical+high count, `severity` = `critical` if any critical else `warning`, `url` = `${baseUrl}/s/${siteSlug(site.name)}` (the same dashboard link the M3 ready-section builds).
- **`collectDeliveryFailures(reports: ReportRow[], sitesById: Map<string, WebsiteRow>, baseUrl: string): AttentionItem[]`** — for each report with `deliveryStatus ∈ {bounced, complained}`, resolve its `siteId` → site (skip the orphan if absent, as the ready-section does): one item, `key: delivery:<reportId>`, `siteName` = site.name, `metric` = 1, `severity` = `critical` for complained / `warning` for bounced, `url` = the site's dashboard page.

`collectAttention(deps)` (IO wrapper, sibling to `runDigest`) fetches `listAllReports`/`listWebsites` once, builds the `sitesById` map, and runs the collectors — each wrapped so a thrown collector logs + contributes `[]` (the digest still goes out with the signals that worked). `baseUrl` is the same value `runDigest` already threads from `DASHBOARD_BASE_URL`.

### 4.3 The state store + pure diff

`src/alerts/digest-state.ts` (new):

- **`type DigestSnapshot = Record<string, { metric: number; firstFlaggedAt: string }>`**
- **`diffAttention(items, prior, today): { tagged: AttentionItem[]; next: DigestSnapshot }`** — **pure, the testable core.** For each item: absent from `prior` → **NEW** (`firstFlaggedAt = today`); present and `metric > prior.metric` → **WORSE** (keep original `firstFlaggedAt`); else → **STANDING**. `next` contains exactly the current items' keys (resolved keys drop out, so a fixed-then-recurring problem re-news correctly).
- **`readDigestState(base): Promise<DigestSnapshot>`** / **`writeDigestState(base, snap): Promise<void>`** — thin IO over the single "Digest State" row (get-or-create the singleton; JSON in a long-text field). A read miss/parse error → `{}` (everything reads as NEW once — safe degradation). A write failure is caught + logged (the digest already sent; next run re-news at worst).

### 4.4 Renderer (grouping + badging)

`renderDigestHtml`'s `attentionSection` (existing) changes from a flat list to **grouped by `siteName`**, items within a site **severity-ordered** (critical first), each line prefixed with a **`NEW`/`WORSE`** badge when `status` says so. Empty list → the existing "all clear" line. Email-client-safe table layout (the M3 invariants — charset/tables/anchors/https — stay test-pinned).

## 5. Airtable schema change

One new table, **`Digest State`** (created live via MCP before slice 1 merges): a single row with `Snapshot` (long text, JSON) + `Updated At` (dateTime). The module get-or-creates the row. Additive; nothing else changes.

## 6. Error handling

- **Per-collector isolation:** each collector is wrapped; a failure logs and yields `[]` so other signals still render. (Contrast M3's whole-`runDigest` catch, which stays as the outer net.)
- **State read miss** → `{}` (re-news once, never crashes). **State write failure** → caught + logged after the send.
- **No-noise** (M3): if Ready + Attention are both empty, skip the send entirely — unchanged.

## 7. Research basis (vendor-verified, 2026-06-11)

- **Delivery:** report from our own stored `deliveryStatus` — Resend has **no list-suppression endpoint** to reconcile against, and **auto-suppresses re-sends** itself, so no reconciliation step is needed. Optionally map the new `email.suppressed` event later. ([Resend webhooks](https://resend.com/docs/dashboard/webhooks/event-types), [suppression visibility](https://resend.com/changelog/email-suppression-visibility))
- **Alert fatigue:** for a single operator, hybrid snapshot (never drop a standing problem) + **group by site** + flag **NEW/WORSE** is the recommended low-complexity pattern; "new/worse" needs a persisted prior snapshot. (Google SRE "novel + actionable"; Alertmanager dedup/grouping.)
- **Thresholds:** vulns **critical+high** (CVSS ≥ 7, Snyk bands) — tools surface all severities but expect humans to prioritize high+. Lighthouse (slice 3): absolute floor `minScore 0.9` is the LHCI default, but start the floor ~80 (fleet ≈ 78) and pair with a **≥5-pt regression delta**, ratcheting toward 90. ([LHCI config](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md))

## 8. Out of scope (explicit)

- **Slice 2 — Renovate-failing** (`collectRenovateFailures` + the `RENOVATE_TOKEN`/scoped-read token in the digest step). Its own PR.
- **Slice 3 — Lighthouse regression** (the floor + ≥5-pt delta on the same state store). Its own PR.
- **Snooze/ack** — the Approach-B dedicated-table upgrade; revisit only if the snapshot proves noisy.
- **An urgent/immediate path** — everything rides the daily digest (locked §9.4); no same-hour paging.
- **Medium/low vuln enumeration** — omitted (at most a future rolled-up count).

## 9. Slice 1 PR breakdown (for the plan)

Dependency-ordered; each TDD + 3-lens, its own PR:

1. **The pure core** — extended `AttentionItem` + `collectVulnAlerts` + `collectDeliveryFailures` + `diffAttention`. All pure, fully unit-tested; nothing wired yet.
2. **The state store** — `Digest State` table (live) + `readDigestState`/`writeDigestState` (thin IO, the singleton get-or-create).
3. **Wire + render** — `collectAttention` IO wrapper + `runDigest` integration (collect → read → diff → render → write back) + the `attentionSection` grouping/badging. End-to-end; the digest now surfaces delivery + vulns with NEW/WORSE.

(May land as one PR if small; the plan decides. Slices 2 and 3 are separate PRs after.)

## 10. Success criteria

A daily digest whose "Needs attention" lists every site currently carrying a critical/high vuln and every report that bounced/complained, **grouped by site, severity-ordered, with NEW/WORSE badges** that correctly reflect the change since the prior run (a freshly-appeared vuln shows NEW; a count that climbed shows WORSE; an unchanged one shows neither; a fixed-then-recurring one re-shows NEW). No new signal silently drops; the operator's daily glance now answers "what's broken?" as well as "what's ready to send?".
