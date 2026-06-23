// src/alerts/attention.ts
//
// The dependency-free attention/digest CONTRACT. These were defined in
// `src/reports/digest.ts` (a renderer/IO module that itself imports from
// `src/alerts/*`), while `digest-collectors.ts` and `digest-state.ts` imported
// `AttentionItem` back from `digest.ts` — an import cycle. Lifting the pure type
// definitions here (this module imports only the leaf `ReportType`) lets both the
// digest renderer AND the alerts collectors depend on the contract, not on each
// other. Types-only — no runtime, no output change.
import type { ReportType } from "../reports/types.js";

/** One report awaiting the operator's "yes" — site, type, period, and a link to its
 *  dashboard page (the digest LINKS to the dashboard; it never carries the approve action,
 *  because email scanners pre-fetch links and would trip accidental approvals). */
export type ReadyItem = {
  siteName: string;
  reportType: ReportType;
  /** "YYYY-MM" — the Period key from the Reports row. */
  period: string;
  /** Absolute URL to /s/<slug> on the dashboard. */
  dashboardUrl: string;
};

/** Severity of a "Needs attention" entry. `critical` sorts above `warning`. */
export type AttentionSeverity = "critical" | "warning";

/** Set by `diffAttention` before render: how this item changed since the prior digest. */
export type AttentionStatus = "new" | "worse" | "standing";

/**
 * One "Needs attention" entry. The M5 SEAM, now carrying the fields the hybrid
 * snapshot needs: a stable `key` for diffing, a `metric` for NEW/WORSE comparison,
 * a `severity` for ordering, and `siteName` for the (component-3) grouped render.
 * For now `attentionSection` still renders each item flat by `title`/`url`.
 */
export type AttentionItem = {
  /** Stable identity for diffing: `vuln:<siteId>`, `delivery:<reportId>`. */
  key: string;
  kind: "vuln" | "delivery" | "renovate" | "lighthouse" | "ci" | "analytics";
  /** Grouping key in the (component-3) render. */
  siteName: string;
  title: string;
  /** Optional URL rendered as a hyperlink on the title. */
  url?: string;
  severity: AttentionSeverity;
  /** Comparable magnitude for NEW/WORSE (vuln count; 1 for binary events). */
  metric: number;
  /** Set by `diffAttention` before render. */
  status?: AttentionStatus;
};

/** Input shape for `renderDigestHtml`. Both arrays are required; callers pass `[]` for
 *  empty sections — the renderer handles the empty-state copy. */
export type DigestSections = {
  readyForYourYes: ReadyItem[];
  needsAttention: AttentionItem[];
};
