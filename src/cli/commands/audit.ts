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
    const { listWebsites, updateScores, siteSlug } =
      await import("../../reports/airtable/websites.js");
    const { lighthouseScoresFromResult, resolveSlugFromCwd } =
      await import("../../audits/lighthouse-airtable.js");

    const slug =
      typeof opts.writeAirtable === "string" && opts.writeAirtable.length > 0
        ? opts.writeAirtable
        : await resolveSlugFromCwd(cwd);

    const lhResult = results.find((r) => r.audit === "lighthouse");
    if (!lhResult) {
      throw Object.assign(
        new Error(
          "--write-airtable requires a lighthouse result; did you pass --only without lighthouse?",
        ),
        { exitCode: 2 },
      );
    }
    if (lhResult.status === "fail") {
      throw Object.assign(
        new Error(
          `Lighthouse audit failed; refusing to write scores to Airtable. Summary: ${lhResult.summary}`,
        ),
        { exitCode: 1 },
      );
    }

    const base = openBase(readAirtableConfig());
    const websites = await listWebsites(base);
    const target = websites.find((w) => siteSlug(w.name) === slug);
    if (!target) {
      throw Object.assign(new Error(`No Websites row matched slug "${slug}"`), { exitCode: 2 });
    }

    const scores = lighthouseScoresFromResult(lhResult);
    await updateScores(base, target.id, scores);
    output += `\n\n→ wrote scores to Websites[${target.name}]: P=${scores.performance} A=${scores.accessibility} BP=${scores.bestPractices} SEO=${scores.seo}`;
  }

  return { output, code: exitCode(results) };
}
