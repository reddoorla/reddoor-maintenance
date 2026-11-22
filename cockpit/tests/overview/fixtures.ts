import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";
import type { OverviewNight } from "../../../src/fleet-daily/read.js";
import type { ReportRow } from "../../../src/reports/report-row.js";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import type { FleetEvent } from "../../../src/db/fleet-events.js";
import { NIGHTLIES } from "../../../scripts/nightly-conductor.mjs";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { trafficWindows } from "../../../src/fleet-daily/traffic.js";

/** P1-78g: the overview's fixture rows, shared by the model's tests and the page's. */

export const NOW = new Date("2026-10-27T18:00:00.000Z");
export const FRESH = "2026-10-27T06:30:00.000Z";
export const STALE = "2026-10-20T06:30:00.000Z";

/** A maintained site whose every check passed last night. */
export function healthy(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    status: "maintained",
    urlResolves: "pass",
    urlCheckedAt: FRESH,
    reachableOk: "pass",
    browserCheckedAt: FRESH,
    certDaysRemaining: 60,
    domainCheckedAt: FRESH,
    deployStatus: "ready",
    lastDeployAt: "2026-10-25T18:00:00.000Z",
    formE2eOk: "pass",
    formE2eCheckedAt: FRESH,
    deployCheckedAt: FRESH,
    // Freshly audited with none open, so "Open now" lists only what a test puts there
    // (review round 4, C2: a site with no fresh audit is listed).
    lastSecurityAuditAt: FRESH,
    securityVulnsCritical: 0,
    securityVulnsHigh: 0,
    ...over,
  });
}

export function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP",
    reportId: "REP-1",
    siteId: "recA",
    reportType: "Maintenance",
    period: "2026-09",
    periodStart: null,
    periodEnd: null,
    completedOn: null,
    lighthouse: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: true,
    sentAt: "2026-09-02T16:07:00.000Z",
    approvedAt: "2026-09-01T20:00:00.000Z",
    approvedBy: "op@example.com",
    deliveryStatus: "delivered",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    checklist: {},
    autoEvidence: null,
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
    sendStartedAt: null,
    unapprovedBy: null,
    unapprovedAt: null,
    dueOn: null,
    ...over,
  };
}

export function night(date: string, over: Partial<OverviewNight["counts"]> = {}): OverviewNight {
  // The night of `date` starts that evening, Pacific time: the 06:07Z run the next
  // day (by `nightOf`, src/fleet-daily/core.ts), never `date`'s own 06:07Z, which
  // belongs to the night before (review round 4, fixture note).
  const runAt = `${new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}T06:07:00Z`;
  return {
    night: date,
    counts: {
      schema: 1,
      ladderVersion: 2,
      run: {
        id: 1,
        attempt: 1,
        event: "workflow_dispatch",
        createdAt: runAt,
        startedAt: runAt,
        conclusion: "success",
      },
      steps: Object.fromEntries(
        NIGHTLIES.map((n: { file: string }) => [
          n.file,
          { outcome: "completed", runId: 1, conclusion: "success" },
        ]),
      ),
      merges: [],
      sites: { value: { cards: 2, tiers: {}, preLaunch: 0, setup: 0 } },
      signals: { value: {} },
      coverage: {
        value: {
          security_audit_at: { value: 2 },
          lighthouse_at: { value: 2 },
          form_e2e_checked_at: { value: 1 },
        },
      },
      deps: { value: { behind: 5, sitesRead: 2 } },
      leads: { value: { new: 0, read: 0, archived: 0, spamAuto: 0, spam: 0, notified: 0 } },
      screenouts: { value: { honeypot: 240, tooFast: 8 } },
      reportsSent: { value: 3 },
      events: { value: { pr_automerged: 100, vuln_cleared: 10 } },
      prsMerged: { value: 600 },
      traffic: { value: null, reason: "not in this row" },
      ...over,
    },
  };
}

/** P1-87 PR 4: one recorded fleet event, for the Lately feed. */
export function event(over: Partial<FleetEvent> = {}): FleetEvent {
  return {
    id: "evt-1",
    ts: "2026-10-27T10:00:00.000Z",
    type: "pr_automerged",
    siteId: "recA",
    siteName: "Acme",
    summary: "auto-merged Bump foo",
    data: null,
    ...over,
  };
}

export function snapshot(over: Partial<CockpitSnapshot> = {}): CockpitSnapshot {
  return {
    takenAt: NOW.toISOString(),
    version: 0,
    baseUrl: "https://dash.example",
    gaps: [],
    sites: [healthy({ id: "recA", name: "Acme" }), healthy({ id: "recR", name: "Rsvp Site" })],
    slugById: new Map(),
    reports: [],
    digest: {},
    rollup: null,
    recentEvents: [],
    feedEvents: [],
    feedDeploys: [],
    deadLetters: new Map(),
    deadLetterOldest: new Map(),
    submissions: [],
    rawSubmissionEnums: new Map(),
    screenOuts: [],
    audits: [],
    deps: null,
    nights: [],
    ...over,
  };
}

/** P1-87 PR 7a: `total` spread over `n` days, oldest first: each day `floor(total / n)`, the
 *  first `total % n` days one more. The probe's 1,542 over 30 days is 52 for 12 days, then 51. */
export function spread(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** The calendar dates from `start` for `n` days, oldest first (UTC, so no DST shift). */
export function datesFrom(start: string, n: number): string[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/** P1-87 PR 7a: a night's `traffic` block, valid for `night`'s windows (`trafficWindows`).
 *  Defaults are the probe's: visits 1,674 over the 30 days, 1,542 over the 30 before, 16 of
 *  16 sites; search 12,521 impressions and 623 clicks over 28 days, 16 of 18 sites. `over`
 *  replaces a half whole when it holds `value`, else merges its fields into the half's value. */
export function trafficBlock(
  night: string,
  over: {
    visits?: Record<string, unknown>;
    search?: Record<string, unknown>;
    sites?: unknown;
  } = {},
): Record<string, unknown> {
  const w = trafficWindows(night);
  const visitDates = datesFrom(w.previous.startDate, 60);
  const prevDays = spread(1542, 30);
  const curDays = spread(1674, 30);
  const visitsDaily = visitDates.map((date, i) => ({
    date,
    visits: i < 30 ? prevDays[i]! : curDays[i - 30]!,
  }));
  const searchDates = datesFrom(w.search.startDate, 28);
  const clicks = spread(623, 28);
  const impressions = spread(12521, 28);
  const visitsValue = {
    current: 1674,
    previous: 1542,
    currentWindow: { ...w.current },
    previousWindow: { ...w.previous },
    sitesRead: 16,
    sitesWithProperty: 16,
    daily: visitsDaily,
  };
  const searchValue = {
    clicks: 623,
    impressions: 12521,
    window: { ...w.search },
    sitesRead: 16,
    sitesWithProperty: 18,
    daily: searchDates.map((date, i) => ({
      date,
      clicks: clicks[i]!,
      impressions: impressions[i]!,
    })),
  };
  const half = (
    base: Record<string, unknown>,
    o: Record<string, unknown> | undefined,
  ): Record<string, unknown> =>
    o === undefined
      ? base
      : "value" in o
        ? o
        : { value: { ...(base.value as Record<string, unknown>), ...o } };
  return {
    visits: half({ value: visitsValue }, over.visits),
    search: half({ value: searchValue }, over.search),
    sites: over.sites ?? [],
  };
}
