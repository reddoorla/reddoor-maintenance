import type { WebsiteRow } from "../reports/airtable/websites.js";

export type OnboardingStatus = {
  score: number;
  total: 5;
  checks: {
    firstAudit: boolean;
    recipients: boolean;
    schedule: boolean;
    poc: boolean;
    analytics: boolean;
  };
};

export const NO_ANALYTICS = "no analytics";

function isNonEmpty(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

export function analyticsOptedOut(row: WebsiteRow): boolean {
  return row.acceptedWatchConditions.some((c) => c.trim().toLowerCase() === NO_ANALYTICS);
}

/** Five-point onboarding signal for the fleet card. A site is "fully onboarded"
 *  when it has been audited at least once, has a To-recipient for monthly
 *  reports, has a maintenance schedule that isn't "None", has a named POC, and
 *  has a GA4 property on its row or an explicit "no analytics" opt-out. */
export function onboardingStatus(row: WebsiteRow): OnboardingStatus {
  const checks = {
    firstAudit: isNonEmpty(row.lastLighthouseAuditAt),
    recipients: isNonEmpty(row.reportRecipientsTo),
    schedule: row.maintenanceFreq !== "None",
    poc: isNonEmpty(row.pointOfContact),
    analytics: isNonEmpty(row.ga4PropertyId) || analyticsOptedOut(row),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { score, total: 5, checks };
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
};

/** The labels of the onboarding checks this site has NOT satisfied, in check
 *  order. Empty array → fully onboarded. */
export function missingOnboarding(row: WebsiteRow): string[] {
  const { checks } = onboardingStatus(row);
  return (Object.keys(ONBOARDING_LABELS) as Array<keyof typeof ONBOARDING_LABELS>)
    .filter((key) => !checks[key])
    .map((key) => ONBOARDING_LABELS[key]);
}
