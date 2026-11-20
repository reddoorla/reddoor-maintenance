import type { WebsiteRow, SecurityCounts, DomainResult } from "../fleet/site-fields.js";
import type { GitHubSignalsRow } from "./github-signals.js";
import type { FleetEvent } from "../db/fleet-events.js";
import type { NetlifyDeployResult } from "../fleet/site-fields.js";
import { isReadyState } from "./netlify-deploy.js";

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

/** backup_verified: the night's restore rehearsal passed, read from the one
 *  `DUMP_VERIFY` machine line `db verify-dump` prints. PURE. Null unless the text
 *  holds exactly one such line, it says `loaded=true` and `mismatches=0`, and its
 *  `tables` and `rows` are integers: a failed, partial or ambiguous rehearsal
 *  records nothing. */
export function backupEventFromVerify(text: string, at: string): FleetEvent | null {
  const lines = text.split("\n").filter((l) => l.startsWith("DUMP_VERIFY "));
  if (lines.length !== 1) return null;
  const fields = new Map<string, string>();
  for (const token of lines[0]!.slice("DUMP_VERIFY ".length).split(" ")) {
    const eq = token.indexOf("=");
    if (eq <= 0) continue;
    fields.set(token.slice(0, eq), token.slice(eq + 1));
  }
  if (fields.get("loaded") !== "true" || fields.get("mismatches") !== "0") return null;
  const tables = fields.get("tables") ?? "";
  const rows = fields.get("rows") ?? "";
  if (!/^\d+$/.test(tables) || !/^\d+$/.test(rows)) return null;
  const t = Number(tables);
  const r = Number(rows);
  return {
    id: `backup_verified:${ymd(at)}`,
    ts: at,
    type: "backup_verified",
    siteId: null,
    siteName: null,
    summary: `Backup restored in rehearsal: ${t} tables, ${groupThousands(r)} rows`,
    data: { tables: t, rows: r },
  };
}

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** vuln_cleared (critical+high >0 → 0) and cert_renewed (<30 → >60) from a single
 *  site's prior WebsiteRow vs the freshly-audited values. PURE. A null prior count
 *  reads as 0 (vuln) or "not a renewal" (cert) — both fire only on a real transition. */
export function detectAuditEvents(
  prev: WebsiteRow,
  audits: {
    security?: SecurityCounts;
    domain?: DomainResult;
    netlifyDeploy?: NetlifyDeployResult;
  },
  at: string,
): FleetEvent[] {
  const events: FleetEvent[] = [];

  // site_deployed: a new `ready` production deploy, stamped with its own publish time
  // (not the audit time), so the feed says when it went live. A first-ever reading
  // (no prior deployedAt) and an unchanged deployedAt record nothing.
  if (audits.netlifyDeploy) {
    const d = audits.netlifyDeploy;
    const deployedAt = d.deployedAt;
    if (
      isReadyState(d.state) &&
      deployedAt !== null &&
      !Number.isNaN(Date.parse(deployedAt)) &&
      prev.lastDeployAt != null &&
      prev.lastDeployAt !== deployedAt
    ) {
      events.push({
        id: `site_deployed:${prev.id}:${deployedAt}`,
        ts: deployedAt,
        type: "site_deployed",
        siteId: prev.id,
        siteName: prev.name,
        summary: "Deploy published",
        data: null,
      });
    }
  }

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
