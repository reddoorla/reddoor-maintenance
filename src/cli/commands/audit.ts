import { resolve } from "node:path";
import { runAuditsAcross, ALL_AUDIT_NAMES } from "../../audits/index.js";
import type { AuditName, AuditResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";

export type AuditCommandOptions = {
  only?: string;
  json?: boolean;
  fleet?: string;
  workdir?: string;
  cwd?: string;
  /**
   * After running, push the lighthouse scores to the matching Websites row
   * in Airtable. `true` (no value) = derive slug from cwd/package.json#name;
   * string = explicit slug (e.g. "med-solutions-of-texas").
   */
  writeAirtable?: string | boolean;
};

function parseOnly(value: string | undefined): AuditName[] | undefined {
  if (!value) return undefined;
  const names = value.split(",").map((s) => s.trim());
  for (const n of names) {
    if (!ALL_AUDIT_NAMES.includes(n as AuditName)) {
      throw Object.assign(new Error(`unknown audit in --only: ${n}`), { exitCode: 2 });
    }
  }
  return names as AuditName[];
}

function formatTable(results: AuditResult[]): string {
  return results
    .map((r) => `${r.audit.padEnd(12)} ${r.status.padEnd(5)} ${r.site}\n  ${r.summary}`)
    .join("\n");
}

function exitCode(results: AuditResult[]): number {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

export async function runAuditCommand(
  site: string | undefined,
  opts: AuditCommandOptions,
): Promise<{ output: string; code: number }> {
  const which = parseOnly(opts.only);
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  // Run sites in parallel via runAuditsAcross — for a fleet of 30 this is the
  // difference between minutes and ~max(per-site) seconds.
  const results: AuditResult[] = await runAuditsAcross(sites, which);

  let output = opts.json ? JSON.stringify(results, null, 2) : formatTable(results);

  if (opts.writeAirtable !== undefined) {
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { listWebsites } = await import("../../reports/airtable/websites.js");
    const { resolveSlugFromCwd } = await import("../../audits/lighthouse-airtable.js");
    const { writeAuditsToAirtable } = await import("../../audits/write-audits-to-airtable.js");

    const slug =
      typeof opts.writeAirtable === "string" && opts.writeAirtable.length > 0
        ? opts.writeAirtable
        : await resolveSlugFromCwd(cwd);

    const base = openBase(readAirtableConfig());
    const websites = await listWebsites(base);
    const summary = await writeAuditsToAirtable({ base, websites, slug, results });

    const lines = summary.writes.map((w) => {
      if (w.audit === "lighthouse") {
        const s = w.counts as { performance: number; accessibility: number; bestPractices: number; seo: number };
        return `  lighthouse: P=${s.performance} A=${s.accessibility} BP=${s.bestPractices} SEO=${s.seo}`;
      }
      if (w.audit === "a11y") {
        return `  a11y: ${(w.counts as { violations: number }).violations} violations`;
      }
      if (w.audit === "deps") {
        const c = w.counts as { drifted: number; majorBehind: number };
        return `  deps: ${c.drifted} drifted (${c.majorBehind} major)`;
      }
      const c = w.counts as { critical: number; high: number; moderate: number; low: number };
      return `  security: ${c.critical}C/${c.high}H/${c.moderate}M/${c.low}L`;
    });
    output += `\n\n→ wrote to Websites[${summary.siteName}]:\n${lines.join("\n")}`;
  }

  return { output, code: exitCode(results) };
}
