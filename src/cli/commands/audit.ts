import { resolve } from "node:path";
import { Listr } from "listr2";
import { runOneAudit, ALL_AUDIT_NAMES } from "../../audits/index.js";
import type { AuditName, AuditResult, Site } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import {
  prepareFleetSites,
  formatSkippedNotice,
  type SkippedSite,
} from "../fleet/prepare-sites.js";
import { isHttpUrl } from "../../util/url.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

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
  /** Max sites to audit in parallel (fleet mode). Unset = all at once;
   *  `1` = sequential (used by the nightly CI workflow). */
  concurrency?: string;
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

/** Parse the `--concurrency <n>` flag into a Listr `concurrent` value. Unset →
 *  `true` (all sites in parallel, the interactive default). A positive integer
 *  bounds how many sites audit at once — `--concurrency 1` runs sequentially,
 *  which is what the nightly CI workflow uses so ~10 deployed-Lighthouse runs
 *  don't saturate a 2-core runner (one flaked locally at full parallelism). */
export function parseConcurrency(value: string | undefined): boolean | number {
  if (value === undefined) return true;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw Object.assign(new Error(`--concurrency must be a positive integer, got "${value}"`), {
      exitCode: 2,
    });
  }
  return n;
}

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
  concurrency: boolean | number,
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
      const label = site.name || site.path; // `||`: empty slug must fall back to path, not blank
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
    { concurrent: concurrency, exitOnError: false, renderer },
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

/** When `--url` is set but audits other than lighthouse also ran (those use the
 *  local checkout, not the deployed URL), return a one-line operator notice;
 *  null when there's nothing to warn about. Keeps the mixed-provenance result
 *  table from silently confusing the operator. */
export function deployedUrlNotice(
  which: AuditName[],
  url: string | undefined,
  cwd: string,
): string | null {
  if (url === undefined) return null;
  const others = which.filter((n) => n !== "lighthouse");
  if (others.length === 0) return null;
  return `note: --url only affects lighthouse; ${others.join(", ")} ran against the local checkout at ${cwd}`;
}

/** Audits that run against the deployed URL only — no repo checkout needed. lighthouse hits the
 *  live URL; domain probes DNS/TLS of the URL's host. */
const CHECKOUT_FREE_AUDITS: ReadonlySet<AuditName> = new Set<AuditName>(["lighthouse", "domain"]);

/** A fleet site needs a local checkout unless every requested audit is checkout-free AND the site
 *  has a `deployedUrl` for them to run against. */
export function auditNeedsCheckout(site: Site, which: AuditName[]): boolean {
  const deployedCapable =
    site.deployedUrl !== undefined && which.every((n) => CHECKOUT_FREE_AUDITS.has(n));
  return !deployedCapable;
}

/** Apply a single-site `--url` to the resolved sites. Returns the input
 *  untouched when no url is given; otherwise requires exactly one site and
 *  stamps `deployedUrl` on it so the lighthouse audit takes its deployed path.
 *  The `--url`+`--fleet` combination is rejected earlier in `runAuditCommand`;
 *  this length guard also covers any future multi-site single-run resolver. */
export function applyDeployedUrl(sites: Site[], url: string | undefined): Site[] {
  if (url === undefined) return sites;
  if (sites.length !== 1) {
    throw Object.assign(
      new Error(`--url expects exactly one site, but ${sites.length} resolved.`),
      { exitCode: 2 },
    );
  }
  // Scheme-allowlist: the URL is handed straight to Chrome/lhci, so only
  // http(s) is safe (a file:///gopher:// value would be a local-file read /
  // SSRF). Same predicate the inventory paths use.
  if (!isHttpUrl(url)) {
    throw Object.assign(new Error(`--url must be an http(s) URL (got: ${JSON.stringify(url)})`), {
      exitCode: 2,
    });
  }
  return [{ ...sites[0]!, deployedUrl: url }];
}

export async function runAuditCommand(
  site: string | undefined,
  opts: AuditCommandOptions,
): Promise<{ output: string; code: number }> {
  const which = parseOnly(opts.only) ?? ALL_AUDIT_NAMES;
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  // A literal --write-airtable=<slug> is single-site (the slug names one row).
  // Boolean --write-airtable + --fleet is fine: each site's slug comes from the
  // inventory, so there's no cwd-derived-slug ambiguity.
  if (typeof opts.writeAirtable === "string" && opts.fleet !== undefined) {
    throw Object.assign(
      new Error(
        "--write-airtable=<slug> is single-site; with --fleet each site's slug comes from the inventory. Use --write-airtable (no slug) + --fleet.",
      ),
      { exitCode: 2 },
    );
  }

  if (opts.url !== undefined && opts.fleet !== undefined) {
    throw Object.assign(
      new Error(
        "--url is single-site only and cannot be combined with --fleet. Audit a single site instead.",
      ),
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

  let skippedPrep: SkippedSite[] = [];
  if (opts.fleet) {
    const workdir = opts.workdir ?? fleetWorkdir();
    const prep = await prepareFleetSites(sites, {
      workdir,
      needsCheckout: (s) => auditNeedsCheckout(s, which),
    });
    sites = prep.prepared;
    skippedPrep = prep.skipped;
  }

  const results: AuditResult[] = [];
  const renderer = rendererFor(opts.json);
  await buildAuditTasks(sites, which, results, renderer, parseConcurrency(opts.concurrency)).run();

  let output = opts.json ? JSON.stringify(results, null, 2) : formatTable(results);

  // Surface any site that couldn't be prepared (no auditable target, clone
  // failure) — visibly, but without reding the run. One misconfigured inventory
  // row is an operator fix, not an outage; the other sites still audited and
  // wrote back. "No silent caps": a dropped site is never invisible.
  const skipNotice = formatSkippedNotice(skippedPrep);
  if (skipNotice && !opts.json) output += `\n\n${skipNotice}`;

  // Did any site fail to write back to Airtable? The fleet writer collects
  // per-site failures instead of throwing, so without this the command would
  // exit 0 while rows silently failed to persist — automation keying on `$?`
  // would see a clean run. (The single-site writer throws on failure, so it's
  // already non-zero via the propagated error.)
  let writeBackFailed = false;
  if (opts.writeAirtable !== undefined) {
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { listWebsites } = await import("../../reports/airtable/websites.js");

    if (opts.fleet !== undefined) {
      const { writeFleetAuditsToAirtable, formatFleetWriteSummary } =
        await import("../../audits/write-audits-to-airtable.js");
      const base = openBase(readAirtableConfig());
      const websites = await listWebsites(base);
      const fleetWrite = await writeFleetAuditsToAirtable({ base, websites, results });
      if (fleetWrite.failed.length > 0) writeBackFailed = true;
      // Gate on !json: the write-summary is human text; appending it after the
      // results array would corrupt `--json` output (the other notices already
      // guard this way). The write itself still happens regardless of --json.
      if (!opts.json) output += `\n\n${formatFleetWriteSummary(fleetWrite)}`;
    } else {
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
      if (writeSummary && !opts.json) output += `\n\n${formatWriteSummary(writeSummary)}`;
    }
  }

  const notice = deployedUrlNotice(which, opts.url, cwd);
  if (notice && !opts.json) output += `\n\n${notice}`;

  const code = Math.max(
    auditExitCode(results, opts.failOnViolations === true),
    writeBackFailed ? 1 : 0,
  );
  return { output, code };
}
