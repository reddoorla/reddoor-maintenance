// src/retest/site-retest.ts
//
// P1-88: re-test one failing site during the day, so a red on the cockpit can clear
// without a fleet-wide run (workspace briefs/2026-11-01-p1-88-per-site-retest.md; the
// operator's answers are decisions/2026-11-01-1646-p1-88-per-site-retest-shape.md).
//
// A re-test runs ONLY the audits behind the site's current reasons, read from the same
// item list the /s/<slug> page shows (`buildSiteAlarmContext`). A pass clears at once:
// every collector reads the row's verdict beside its stamp, so the fresh write is all a
// reason needs to go.
//
// Never re-tested: `security` and `deps` (the fleet-security path is the one that fires
// `renovate-dispatch` in client repos, backlog P0-1), `a11y` (a weekly, heavy run), and
// the rest of the checkout audits. The set below is closed: `parseRetestOnly` refuses
// anything outside it, so no command line or button can widen it.
import type { AuditName } from "../types.js";
import type { AttentionItem } from "../alerts/attention.js";
import type { WebsiteRow } from "../fleet/site-row.js";
import type { FleetWriteResult } from "../audits/write-audits.js";
import { selectFleetSites } from "../inventory/select.js";

/** The audits a re-test may run, in the order it runs them. Every one is checkout-free
 *  (deployed URL or API only), as in fleet-lighthouse's own pass. */
export const RETESTABLE_AUDITS = [
  "browser",
  "domain",
  "function-health",
  "netlify-deploy",
  "lighthouse",
] as const satisfies readonly AuditName[];

export type RetestableAudit = (typeof RETESTABLE_AUDITS)[number];

/** Which audit wrote the verdict behind each cockpit reason, by the item key's prefix
 *  (`<prefix>:<siteId>[:…]`). A reason whose prefix is absent here is not re-testable. */
export const RETEST_AUDIT_BY_PREFIX: Readonly<Record<string, RetestableAudit>> = {
  uptime: "browser",
  render: "browser",
  links: "browser",
  titles: "browser",
  domain: "domain",
  cert: "domain",
  "cert-expiring": "domain",
  "function-health": "function-health",
  cms: "function-health",
  deploy: "netlify-deploy",
  lighthouse: "lighthouse",
};

export type RetestReason = { key: string; title: string; audit: RetestableAudit };

export type RetestPlan = {
  /** The audits to run, deduplicated, in `RETESTABLE_AUDITS` order. Empty: nothing to do. */
  audits: RetestableAudit[];
  /** The reasons a re-test can clear, each with the audit behind it. */
  reasons: RetestReason[];
  /** The site's other reasons, which a re-test leaves as they are. */
  untouched: string[];
};

function prefixOf(key: string): string {
  const i = key.indexOf(":");
  return i === -1 ? key : key.slice(0, i);
}

/** The plan for one site's items (the /s/<slug> page's list). PURE. */
export function retestPlanFromItems(items: readonly AttentionItem[]): RetestPlan {
  const reasons: RetestReason[] = [];
  const untouched: string[] = [];
  for (const it of items) {
    const audit = Object.hasOwn(RETEST_AUDIT_BY_PREFIX, prefixOf(it.key))
      ? RETEST_AUDIT_BY_PREFIX[prefixOf(it.key)]!
      : undefined;
    if (audit) reasons.push({ key: it.key, title: it.title, audit });
    else untouched.push(it.title);
  }
  const wanted = new Set(reasons.map((r) => r.audit));
  return { audits: RETESTABLE_AUDITS.filter((a) => wanted.has(a)), reasons, untouched };
}

/**
 * The plan for one roster row: `retestPlanFromItems`, narrowed to what the run can
 * measure for this site. The run audits through the fleet roster (`selectFleetSites`),
 * so a site that selection drops (launching, archived, no http(s) url) has nothing to
 * re-test, and every re-testable audit is checkout-free only with a deployed url,
 * netlify-deploy only with a Netlify id. A reason the run could not measure moves to
 * `untouched`, so the button never offers a run that would refuse it or skip it. PURE.
 */
export function retestPlanForRow(row: WebsiteRow, items: readonly AttentionItem[]): RetestPlan {
  const plan = retestPlanFromItems(items);
  const site = selectFleetSites([row], "/retest")[0];
  const can = (a: RetestableAudit): boolean =>
    site !== undefined &&
    site.deployedUrl !== undefined &&
    (a !== "netlify-deploy" || site.netlifyId !== undefined);
  const reasons = plan.reasons.filter((r) => can(r.audit));
  const untouched = [
    ...plan.untouched,
    ...plan.reasons.filter((r) => !can(r.audit)).map((r) => r.title),
  ];
  const wanted = new Set(reasons.map((r) => r.audit));
  return { audits: RETESTABLE_AUDITS.filter((a) => wanted.has(a)), reasons, untouched };
}

/** Did the write-back measure `audit` for `slug`? False when the site failed to write,
 *  kept its row, never reached write-back, or the audit measured nothing or said it did
 *  not apply: in each case the row still holds the old verdict, so the reason was not
 *  re-tested at all, and the run must not read as a clean re-test. PURE. */
export function retestMeasured(write: FleetWriteResult, slug: string, audit: string): boolean {
  if (write.failed.some((f) => f.slug === slug)) return false;
  if ((write.kept ?? []).some((k) => k.slug === slug)) return false;
  if ((write.missing ?? []).includes(slug)) return false;
  if ((write.notApplicable ?? []).includes(slug)) return false;
  if ((write.notApplicableAudits?.[audit as AuditName] ?? []).includes(slug)) return false;
  for (const [key, slugs] of Object.entries(write.unmeasuredAudits ?? {})) {
    if ((key === audit || key.startsWith(`${audit}.`)) && (slugs ?? []).includes(slug))
      return false;
  }
  return true;
}

/** `--only` for a re-test: a comma list drawn from `RETESTABLE_AUDITS` alone. Blank or
 *  absent is null (use the plan). Anything else throws with exit code 2. */
export function parseRetestOnly(only: string | undefined): RetestableAudit[] | null {
  if (only === undefined || only.trim() === "") return null;
  const names = only
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const bad = names.filter((n) => !(RETESTABLE_AUDITS as readonly string[]).includes(n));
  if (bad.length > 0) {
    throw Object.assign(
      new Error(`a re-test runs only ${RETESTABLE_AUDITS.join(", ")}; refused: ${bad.join(", ")}`),
      { exitCode: 2 },
    );
  }
  const wanted = new Set(names);
  return RETESTABLE_AUDITS.filter((a) => wanted.has(a));
}

/** A site slug as the roster derives it (`siteSlug`): lowercase words joined by single
 *  hyphens. Anything else is refused before it reaches a query or a dispatch input. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertRetestSlug(slug: string | undefined): string {
  if (slug === undefined || !SLUG_PATTERN.test(slug)) {
    throw Object.assign(new Error(`not a site slug: ${JSON.stringify(slug ?? "")}`), {
      exitCode: 2,
    });
  }
  return slug;
}

/** The workflow a re-test runs in, on the central repo. Its file is pinned by
 *  tests/build/site-retest-workflow.test.ts: no Renovate, no App token, no writes but
 *  Turso's. */
export const SITE_RETEST_WORKFLOW = "site-retest.yml";
