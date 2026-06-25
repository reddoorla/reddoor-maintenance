import type { WebsiteRow, SecurityCounts, DomainResult } from "../reports/airtable/websites.js";
import type { GitHubSignalsRow } from "./github-signals.js";
import type { FleetEvent } from "../db/fleet-events.js";

/** YYYY-MM-DD slice of an ISO timestamp, for per-site-per-day deterministic ids. */
function ymd(iso: string): string {
  return iso.slice(0, 10);
}

/** Compact a verbose Renovate PR title to "<pkg>→<version> [tags]".
 *  "chore(deps): update dependency vite to v7.3.5 [security]" → "vite→7.3.5 [security]".
 *  A grouped/no-version title ("update all non-major dependencies") is left readable. */
export function cleanRenovateTitle(title: string): string {
  let t = title.trim();
  t = t.replace(/^[a-z]+(\([^)]*\))?:\s*/i, ""); // strip "chore(deps): "
  t = t.replace(/^update dependency\s+/i, "");
  t = t.replace(/^update\s+/i, "");
  t = t.replace(/^pin dependencies?\s+/i, "");
  t = t.replace(/\s+to\s+v?/i, "→"); // " to v7.3.5" → "→7.3.5"
  return t.trim();
}

/** vuln_cleared (critical+high >0 → 0) and cert_renewed (<30 → >60) from a single
 *  site's prior WebsiteRow vs the freshly-audited values. PURE. A null prior count
 *  reads as 0 (vuln) or "not a renewal" (cert) — both fire only on a real transition. */
export function detectAuditEvents(
  prev: WebsiteRow,
  audits: { security?: SecurityCounts; domain?: DomainResult },
  at: string,
): FleetEvent[] {
  const events: FleetEvent[] = [];

  if (audits.security) {
    const prevCH = (prev.securityVulnsCritical ?? 0) + (prev.securityVulnsHigh ?? 0);
    const newCH = audits.security.critical + audits.security.high;
    if (prevCH > 0 && newCH === 0) {
      events.push({
        id: `vuln_cleared:${prev.id}:${ymd(at)}`,
        ts: at,
        type: "vuln_cleared",
        siteId: prev.id,
        siteName: prev.name,
        summary: `cleared ${prevCH} critical/high vuln${prevCH === 1 ? "" : "s"}`,
        data: { from: prevCH },
      });
    }
  }

  if (audits.domain) {
    const prevDays = prev.certDaysRemaining;
    const newDays = audits.domain.certDaysRemaining;
    // Null prior = never measured / unresolved → first measurement, not a renewal.
    if (prevDays !== null && prevDays < 30 && newDays !== null && newDays > 60) {
      events.push({
        id: `cert_renewed:${prev.id}:${ymd(at)}`,
        ts: at,
        type: "cert_renewed",
        siteId: prev.id,
        siteName: prev.name,
        summary: `TLS cert renewed (${newDays}d remaining)`,
        data: { days: newDays },
      });
    }
  }

  return events;
}

/** pr_automerged (one per merged Renovate PR) + ci_recovered (failing → passing)
 *  from a site's prior WebsiteRow, its fresh signals row, and the merged-PR list
 *  found since the watermark. PURE. */
export function detectSignalEvents(
  prev: WebsiteRow,
  row: GitHubSignalsRow,
  mergedPRs: Array<{ number: number; title: string; url: string; mergedAt: string }>,
  at: string,
): FleetEvent[] {
  const events: FleetEvent[] = [];

  for (const pr of mergedPRs) {
    events.push({
      id: `pr_automerged:${row.repo}#${pr.number}`,
      ts: pr.mergedAt,
      type: "pr_automerged",
      siteId: prev.id,
      siteName: prev.name,
      summary: `auto-merged ${cleanRenovateTitle(pr.title)}`,
      data: { url: pr.url, repo: row.repo, number: pr.number },
    });
  }

  if (prev.defaultBranchCi === "failing" && row.ciState === "passing") {
    events.push({
      id: `ci_recovered:${prev.id}:${ymd(at)}`,
      ts: at,
      type: "ci_recovered",
      siteId: prev.id,
      siteName: prev.name,
      summary: "CI recovered (default branch green)",
      data: null,
    });
  }

  return events;
}

/** A fleet-wide rollup event: one per sweep per day. */
export function fleetSweptEvent(
  sweep: "lighthouse" | "security" | "github-signals",
  count: number,
  at: string,
): FleetEvent {
  const verb =
    sweep === "security"
      ? "security-swept"
      : sweep === "github-signals"
        ? "signals-swept"
        : "re-audited";
  return {
    id: `fleet_swept:${sweep}:${ymd(at)}`,
    ts: at,
    type: "fleet_swept",
    siteId: null,
    siteName: null,
    summary: `${verb} ${count} site${count === 1 ? "" : "s"}`,
    data: { sweep, count },
  };
}
