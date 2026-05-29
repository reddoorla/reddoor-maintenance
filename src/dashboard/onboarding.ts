import type { WebsiteRow } from "../reports/airtable/websites.js";

export type OnboardingStatus = {
  score: number;
  total: 4;
  checks: {
    firstAudit: boolean;
    recipients: boolean;
    schedule: boolean;
    poc: boolean;
  };
};

function isNonEmpty(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/** Four-point onboarding signal for the fleet card. A site is "fully onboarded"
 *  when it has been audited at least once, has a To-recipient for monthly
 *  reports, has a maintenance schedule that isn't "None", and has a named POC. */
export function onboardingStatus(row: WebsiteRow): OnboardingStatus {
  const checks = {
    firstAudit: isNonEmpty(row.lastLighthouseAuditAt),
    recipients: isNonEmpty(row.reportRecipientsTo),
    schedule: row.maintenanceFreq !== "None",
    poc: isNonEmpty(row.pointOfContact),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { score, total: 4, checks };
}
