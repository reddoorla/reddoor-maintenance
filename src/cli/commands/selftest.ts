import { selftestEmail, type SelftestEmailSiteResult } from "../../recipes/selftest-email.js";
import type { ReportType } from "../../reports/types.js";

export type SelftestCommandOptions = {
  type?: string;
  to?: string;
  all?: boolean;
  dryRun?: boolean;
  cwd?: string;
};

const TYPES: Record<string, ReportType> = {
  announcement: "Announcement",
  maintenance: "Maintenance",
  testing: "Testing",
  launch: "Launch",
};

function formatResult(r: SelftestEmailSiteResult): string {
  if (r.status === "skipped") return `[${r.site}] skipped — ${r.reason}`;
  if (r.status === "error") return `[${r.site}] error: ${r.message}`;
  return `[${r.site}] ${r.status} — "${r.subject}" → ${r.recipients.join(", ")}`;
}

/**
 * `selftest <kind> [site]` — operator self-tests. The only kind today is `email`: preview a
 * report email for one site (or `--all` maintenance sites) to the operator/`--to`, with no
 * Airtable side effects. Validates kind/type and the site-xor-all rule before doing any work.
 */
export async function runSelftestCommand(
  kind: string,
  site: string | undefined,
  opts: SelftestCommandOptions,
): Promise<{ output: string; code: number }> {
  if (kind !== "email") {
    return { output: `Unknown selftest kind '${kind}'. Supported: email`, code: 2 };
  }
  if (Boolean(site) === Boolean(opts.all)) {
    return { output: "Provide exactly one of <site> or --all.", code: 2 };
  }
  const typeKey = (opts.type ?? "announcement").toLowerCase();
  const type = TYPES[typeKey];
  if (!type) {
    return {
      output: `Unknown --type '${opts.type}'. Supported: ${Object.keys(TYPES).join(", ")}`,
      code: 2,
    };
  }

  try {
    const { results } = await selftestEmail({
      ...(site ? { site } : {}),
      ...(opts.all ? { all: true } : {}),
      type,
      ...(opts.to ? { to: opts.to } : {}),
      ...(opts.dryRun ? { dryRun: true } : {}),
    });
    const output =
      results.length === 0 ? "No matching sites." : results.map(formatResult).join("\n");
    const code = results.some((r) => r.status === "error") ? 1 : 0;
    return { output, code };
  } catch (err) {
    const e = err as { message?: string; exitCode?: number };
    return { output: e.message ?? String(err), code: e.exitCode ?? 1 };
  }
}
