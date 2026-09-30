import type { WebsiteRow } from "../fleet/site-row.js";
import { analyticsOptedOut } from "../fleet/opt-outs.js";
import {
  searchConsoleEvidence,
  searchConsolePasses,
  type SearchConsoleEvidence,
} from "../fleet/search-console-evidence.js";

export {
  NO_ANALYTICS,
  NO_SEARCH_CONSOLE,
  analyticsOptedOut,
  searchConsoleOptedOut,
} from "../fleet/opt-outs.js";

export type OnboardingStatus = {
  score: number;
  total: 6;
  checks: {
    firstAudit: boolean;
    recipients: boolean;
    schedule: boolean;
    poc: boolean;
    analytics: boolean;
    searchConsole: boolean;
  };
};

function isNonEmpty(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/** Six-point onboarding signal for the fleet card. A site is "fully onboarded"
 *  when it has been audited at least once, has a To-recipient for monthly
 *  reports, has a maintenance schedule that isn't "None", has a named POC, has
 *  a GA4 property on its row or an explicit "no analytics" opt-out, and has
 *  positive Search Console evidence (#943): a report draft's lookup queried a
 *  resolved property within the site's report cadence, or an explicit "no search
 *  console" opt-out. A recorded property alone is not evidence, and a soft-failed
 *  lookup reads as unknown, never as a pass. */
export function onboardingStatus(row: WebsiteRow, now: Date = new Date()): OnboardingStatus {
  const checks = {
    firstAudit: isNonEmpty(row.lastLighthouseAuditAt),
    recipients: isNonEmpty(row.reportRecipientsTo),
    schedule: row.maintenanceFreq !== "None",
    poc: isNonEmpty(row.pointOfContact),
    analytics: isNonEmpty(row.ga4PropertyId) || analyticsOptedOut(row),
    searchConsole: searchConsolePasses(searchConsoleEvidence(row, now)),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { score, total: 6, checks };
}

/** Human label for each onboarding check, in canonical check order. Used by the
 *  dashboards to spell out which signals a partially-onboarded site is missing
 *  (cockpit setup-chip tooltip + per-site setup line). */
export const ONBOARDING_LABELS: Record<keyof OnboardingStatus["checks"], string> = {
  firstAudit: "First audit",
  recipients: "Report recipients",
  schedule: "Maintenance schedule",
  poc: "Point of contact",
  analytics: 'GA4 property (or a "no analytics" opt-out)',
  searchConsole:
    'Search Console queried within the report cadence (or a "no search console" opt-out)',
};

/** The day part of a stored ISO stamp, for labels. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/** The host a no-match lookup searched for, as the card shows it. */
export function searchConsoleHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** What a site that fails the Search Console check is missing, from its evidence. */
export function searchConsoleMissingLabel(row: WebsiteRow, e: SearchConsoleEvidence): string {
  switch (e.state) {
    case "no-property":
      return `Search Console: no property matched ${searchConsoleHost(row.url)} (lookup ${day(e.checkedAt)})`;
    case "unknown":
      return `Search Console: unknown, the last lookup errored (${day(e.checkedAt) || "no date"})`;
    case "stale":
      return `Search Console: last resolved lookup ${day(e.checkedAt)}, older than ${e.freshDays} days`;
    default:
      return 'Search Console: no report lookup on record (or a "no search console" opt-out)';
  }
}

/** The labels of the onboarding checks this site has NOT satisfied, in check
 *  order. Empty array → fully onboarded. */
export function missingOnboarding(row: WebsiteRow, now: Date = new Date()): string[] {
  const { checks } = onboardingStatus(row, now);
  return (Object.keys(ONBOARDING_LABELS) as Array<keyof typeof ONBOARDING_LABELS>)
    .filter((key) => !checks[key])
    .map((key) =>
      key === "searchConsole"
        ? searchConsoleMissingLabel(row, searchConsoleEvidence(row, now))
        : ONBOARDING_LABELS[key],
    );
}
