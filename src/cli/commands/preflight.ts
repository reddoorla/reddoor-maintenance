import {
  preflight,
  type PreflightSiteResult,
  type PreflightFinding,
} from "../../reports/preflight.js";
import type { ReportType } from "../../reports/types.js";
import type { Db } from "../../db/client.js";

export type PreflightCommandOptions = {
  type?: string;
  all?: boolean;
  cwd?: string;
};

const TYPES: Record<string, ReportType> = {
  announcement: "Announcement",
  maintenance: "Maintenance",
  testing: "Testing",
};

const MARK: Record<PreflightFinding["level"], string> = { fail: "✗", warn: "⚠", info: "ℹ" };

function formatSite(r: PreflightSiteResult): string {
  if (r.findings.length === 0) return `[${r.site}] ✓ clean`;
  return r.findings.map((f) => `[${r.site}] ${MARK[f.level]} ${f.check}: ${f.message}`).join("\n");
}

/**
 * `preflight [site]` — read-only pre-send checks over the live fleet rows: everything
 * that would make a report send fail, reach the wrong inbox, or surprise the operator.
 * Exit 0 = safe (warnings allowed, printed), 1 = at least one hard failure, 2 = bad args.
 */
/** One lazily-opened, once-closed libSQL connection for this command's reads
 *  (#646 step 4). Lazy for the same reason as `report --digest`'s: a run that
 *  returns before any read must not need `TURSO_DATABASE_URL`. */
function lazyFleetDb(): { get: () => Promise<Db>; close: () => Promise<void> } {
  let db: Db | null = null;
  return {
    get: async () => {
      if (!db) {
        const { openDb, readDbConfig } = await import("../../db/client.js");
        db = await openDb(readDbConfig());
      }
      return db;
    },
    close: async () => {
      if (db) await db.destroy();
    },
  };
}

export async function runPreflightCommand(
  site: string | undefined,
  opts: PreflightCommandOptions,
): Promise<{ output: string; code: number }> {
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

  // #646 step 4: the rows come from Turso. ONE connection for both reads, opened
  // lazily on the first read and closed when the checks are done — a run that
  // returns before reading (bad args, an injected preflight) needs no database.
  const { listSites, listAllReports } = await import("../../db/fleet-state.js");
  const fleetDb = lazyFleetDb();
  try {
    const { results, fleet } = await preflight({
      roster: async () => listSites(await fleetDb.get()),
      allReports: async () => listAllReports(await fleetDb.get()),
      ...(site ? { site } : {}),
      ...(opts.all ? { all: true } : {}),
      type,
    });
    if (results.length === 0) return { output: "No matching sites.", code: 1 };

    const lines = results.map(formatSite);
    for (const f of fleet) lines.push(`[fleet] ${MARK[f.level]} ${f.check}: ${f.message}`);

    const all = [...results.flatMap((r) => r.findings), ...fleet];
    const fails = all.filter((f) => f.level === "fail").length;
    const warns = all.filter((f) => f.level === "warn").length;
    lines.push(
      `Preflight: ${results.length} site(s) — ${fails} fail, ${warns} warn. ${
        fails > 0 ? "NOT safe to send." : "Safe to send (review warnings)."
      }`,
    );
    return { output: lines.join("\n"), code: fails > 0 ? 1 : 0 };
  } catch (err) {
    const e = err as { message?: string; exitCode?: number };
    return { output: e.message ?? String(err), code: e.exitCode ?? 1 };
  } finally {
    await fleetDb.close();
  }
}
