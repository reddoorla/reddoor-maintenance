import { safeUrl } from "../../../../src/util/html.js";
import { relativeTimeFromNow } from "../../../../src/dashboard/relative-time.js";
import type { ProspectAuditListItem } from "../../../../src/db/prospect-audits.js";
import { hasNoReport, isValidToken } from "../../../../src/prospect/audit-status.js";
import { isStaleRunning } from "../../../../src/prospect/daily-cap.js";

/**
 * One row of `/audits`, decided on the server (#582). The rules are
 * prospect-audits-render.ts's, unchanged; they read `node:crypto`-backed
 * modules, so they run in `+page.server.ts` and the page gets plain data.
 * `/audits` is frozen (operator, 2026-10-20): this is a port, not a rework.
 */
export type AuditRowView = {
  id: string;
  /** Null renders "(no business name)". */
  business: string | null;
  url: string;
  /** The audited url as a link; null when `safeUrl` refuses it. */
  urlHref: string | null;
  pill: { cls: string; label: string };
  when: string;
  chosenTerms: boolean;
  edited: string | null;
  opened: string | null;
  /** The one edit state worth flagging: the prospect read it after the last edit. */
  readSinceEdit: boolean;
  report: { kind: "link"; href: string } | { kind: "note"; text: string };
};

/** #907: a `running` row past the stale window is a run that never will finish;
 *  P1-16: a `failed` row threw after it paid. */
function pill(a: ProspectAuditListItem, now: Date): AuditRowView["pill"] {
  if (a.status === "failed") return { cls: "failed", label: "Failed" };
  if (a.status === "running") {
    return isStaleRunning(a, now)
      ? { cls: "unfinished", label: "Did not finish" }
      : { cls: "running", label: "Running" };
  }
  return a.status === "complete"
    ? { cls: "complete", label: "Complete" }
    : { cls: "partial", label: "Partial" };
}

/** A running row has no report behind its token yet (#907) and a failed one
 *  never will (P1-16); a token of the wrong shape is never trusted as a link. */
function report(a: ProspectAuditListItem): AuditRowView["report"] {
  if (a.status === "running") return { kind: "note", text: "No report yet" };
  if (hasNoReport(a.status)) return { kind: "note", text: "No report" };
  if (isValidToken(a.token)) return { kind: "link", href: `/r/${a.token}` };
  return { kind: "note", text: "Report unavailable" };
}

function auditRowView(a: ProspectAuditListItem, now: Date): AuditRowView {
  const href = safeUrl(a.url);
  return {
    id: a.id,
    business: a.business ? a.business : null,
    url: a.url,
    urlHref: href === "#" ? null : href,
    pill: pill(a, now),
    when: relativeTimeFromNow(a.created_at, now),
    chosenTerms: !!a.chosen_terms,
    edited: a.edited_at ? relativeTimeFromNow(a.edited_at, now) : null,
    opened: a.opened_at ? relativeTimeFromNow(a.opened_at, now) : null,
    // ISO-8601 UTC from toISOString(): fixed width, so string order is time order.
    readSinceEdit: !!(a.edited_at && a.opened_at && a.opened_at > a.edited_at),
    report: report(a),
  };
}

export function auditsPageView(audits: ProspectAuditListItem[], now: Date) {
  return { audits: audits.map((a) => auditRowView(a, now)) };
}
