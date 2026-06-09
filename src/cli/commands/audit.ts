import { resolve } from "node:path";
import { Listr } from "listr2";
import { runOneAudit, ALL_AUDIT_NAMES } from "../../audits/index.js";
import type { AuditName, AuditResult, Site } from "../../types.js";
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
  /** Exit non-zero if any a11y violations are found (overrides warn). For CI gates. */
  failOnViolations?: boolean;
  /** Audit this deployed URL directly (lighthouse only; single-site). */
  url?: string;
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

export function auditExitCode(results: AuditResult[], failOnViolations: boolean): number {
  if (results.some((r) => r.status === "fail")) return 1;
  if (failOnViolations) {
    const a11yViolations = results
      .filter((r) => r.audit === "a11y")
      .reduce(
        (n, r) =>
          n + ((r.details as { totalViolations?: number } | undefined)?.totalViolations ?? 0),
        0,
      );
    if (a11yViolations > 0) return 1;
  }
  return 0;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

type Renderer = "default" | "silent";

/** Build the audit-progress task list. Single-site → each audit is a sibling
 *  task. Fleet → each site is a task whose `output` shows X/N audits done as
 *  they complete (audits-per-site still run in parallel). Results are pushed
 *  into the shared `results` array; tasks throw on `fail` status so listr2
 *  paints them red, but `exitOnError: false` keeps other tasks running. */
function buildAuditTasks(
  sites: Site[],
  which: AuditName[],
  results: AuditResult[],
  renderer: Renderer,
) {
  const singleSite = sites.length === 1;

  if (singleSite) {
    const site = sites[0]!;
    return new Listr(
      which.map((name) => ({
        title: name,
        task: async (_ctx, task) => {
          const start = Date.now();
          const result = await runOneAudit(site, name);
          results.push(result);
          const elapsed = formatDuration(Date.now() - start);
          task.title = `${name}: ${result.summary} (${elapsed})`;
          if (result.status === "fail") throw new Error(result.summary);
        },
      })),
      { concurrent: true, exitOnError: false, renderer },
    );
  }

  return new Listr(
    sites.map((site) => {
      const label = site.name ?? site.path;
      return {
        title: label,
        task: async (_ctx, task) => {
          const start = Date.now();
          let done = 0;
          task.output = `0/${which.length} audits`;
          const settled = await Promise.all(
            which.map(async (name) => {
              const r = await runOneAudit(site, name);
              results.push(r);
              done += 1;
              task.output = `${done}/${which.length} audits`;
              return r;
            }),
          );
          const elapsed = formatDuration(Date.now() - start);
          const failed = settled.filter((r) => r.status === "fail").length;
          const warned = settled.filter((r) => r.status === "warn").length;
          const note =
            failed > 0
              ? `${failed} failed`
              : warned > 0
                ? `${warned} warning${warned === 1 ? "" : "s"}`
                : "all green";
          task.title = `${label}: ${note} (${elapsed})`;
          if (failed > 0) throw new Error(`${label}: ${failed} audit(s) failed`);
        },
      };
    }),
    { concurrent: true, exitOnError: false, renderer },
  );
}

type WriteSummary = Awaited<
  ReturnType<typeof import("../../audits/write-audits-to-airtable.js").writeAuditsToAirtable>
>;

function formatWriteSummary(summary: WriteSummary): string {
  const lines = summary.writes.map((w) => {
    if (w.audit === "lighthouse") {
      const s = w.counts as {
        performance: number;
        accessibility: number;
        bestPractices: number;
        seo: number;
      };
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
  return `→ wrote to Websites[${summary.siteName}]:\n${lines.join("\n")}`;
}

/** Listr renderer choice. `--json` → silent so stdout stays clean for piping.
 *  Otherwise listr's `default` renderer auto-falls back to `simple` in
 *  non-TTY contexts (CI, log capture, our own integration tests). */
function rendererFor(json: boolean | undefined): Renderer {
  return json ? "silent" : "default";
}

/** Apply a single-site `--url` to the resolved sites. Returns the input
 *  untouched when no url is given; otherwise requires exactly one site and
 *  stamps `deployedUrl` on it so the lighthouse audit takes its deployed path. */
export function applyDeployedUrl(sites: Site[], url: string | undefined): Site[] {
  if (url === undefined) return sites;
  if (sites.length !== 1) {
    throw Object.assign(
      new Error(`--url expects exactly one site, but ${sites.length} resolved.`),
      { exitCode: 2 },
    );
  }
  return [{ ...sites[0]!, deployedUrl: url }];
}

export async function runAuditCommand(
  site: string | undefined,
  opts: AuditCommandOptions,
): Promise<{ output: string; code: number }> {
  const which = parseOnly(opts.only) ?? ALL_AUDIT_NAMES;
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  // --write-airtable is single-site only. With --fleet, results pool across
  // sites and the cwd-derived slug would silently overwrite one site's
  // dashboard row with another's pooled results — dashboard-wrong, not
  // crash-loud. Refuse fast before running any audits so the operator
  // doesn't burn 5+ minutes per site to discover the misuse.
  if (opts.writeAirtable !== undefined && opts.fleet !== undefined) {
    throw Object.assign(
      new Error(
        "--write-airtable is not supported with --fleet. " +
          "Each site has its own Airtable row; run per-site instead: " +
          "`cd <site>/ && reddoor-maint audit --write-airtable`.",
      ),
      { exitCode: 2 },
    );
  }

  if (opts.url !== undefined && opts.fleet !== undefined) {
    throw Object.assign(
      new Error("--url is single-site only and cannot be combined with --fleet."),
      { exitCode: 2 },
    );
  }

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });

  sites = applyDeployedUrl(sites, opts.url);

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  const results: AuditResult[] = [];
  const renderer = rendererFor(opts.json);
  await buildAuditTasks(sites, which, results, renderer).run();

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

    let writeSummary: WriteSummary | null = null;
    await new Listr(
      [
        {
          title: `Write to Airtable[${slug}]`,
          task: async (_ctx, task) => {
            const base = openBase(readAirtableConfig());
            task.output = "loading Websites…";
            const websites = await listWebsites(base);
            task.output = "writing scores…";
            writeSummary = await writeAuditsToAirtable({ base, websites, slug, results });
            task.title = `Wrote to Websites[${writeSummary.siteName}] (${writeSummary.writes.length} audit type${writeSummary.writes.length === 1 ? "" : "s"})`;
          },
        },
      ],
      { renderer },
    ).run();

    if (writeSummary) output += `\n\n${formatWriteSummary(writeSummary)}`;
  }

  return { output, code: auditExitCode(results, opts.failOnViolations === true) };
}
