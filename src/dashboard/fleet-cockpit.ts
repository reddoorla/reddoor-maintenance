// src/dashboard/fleet-cockpit.ts
import type { WebsiteRow } from "../reports/airtable/websites.js";
import type { AttentionItem } from "../reports/digest.js";
import { relativeTimeFromNow } from "./relative-time.js";

export type Tier = "attention" | "watch" | "healthy";

/** Watch-tier thresholds (the soft band beneath the M5 alert floor). */
const LIGHTHOUSE_FLOOR = 75; // mirrors collectLighthouseAlerts — at/above is not an attention item
const LIGHTHOUSE_WATCH_HIGH = 85; // [75,85) = "near the floor" → watch
const AUDIT_STALE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WATCH_CATEGORIES: ReadonlyArray<{
  field: "pScore" | "rScore" | "bpScore" | "seoScore";
  label: string;
}> = [
  { field: "pScore", label: "Performance" },
  { field: "rScore", label: "Accessibility" },
  { field: "bpScore", label: "Best Practices" },
  { field: "seoScore", label: "SEO" },
];

/**
 * Tier a single site from its attention items + soft watch rules. PURE; `now` is
 * injected for testability. Any attention item → 🔴 attention (items already encode
 * the M5 thresholds, so a sub-75 Lighthouse score arrives here as an item and never
 * needs the watch band). Otherwise 🟡 watch when a Lighthouse category sits in
 * [75,85) or the last audit is older than 30 days (a NULL audit is NOT stale — it's
 * an onboarding gap, surfaced by the Setup score, not a regression). Else 🟢 healthy.
 */
export function assignTier(
  site: WebsiteRow,
  items: AttentionItem[],
  now: Date,
): { tier: Tier; watchReasons: string[] } {
  if (items.length > 0) return { tier: "attention", watchReasons: [] };

  const watchReasons: string[] = [];
  for (const cat of WATCH_CATEGORIES) {
    const score = site[cat.field];
    if (score !== null && score >= LIGHTHOUSE_FLOOR && score < LIGHTHOUSE_WATCH_HIGH) {
      watchReasons.push(`${cat.label} ${score}`);
    }
  }
  if (site.lastLighthouseAuditAt !== null) {
    const ageMs = now.getTime() - Date.parse(site.lastLighthouseAuditAt);
    if (Number.isFinite(ageMs) && ageMs > AUDIT_STALE_DAYS * MS_PER_DAY) {
      watchReasons.push(`audited ${relativeTimeFromNow(site.lastLighthouseAuditAt, now)}`);
    }
  }
  return watchReasons.length > 0
    ? { tier: "watch", watchReasons }
    : { tier: "healthy", watchReasons: [] };
}
