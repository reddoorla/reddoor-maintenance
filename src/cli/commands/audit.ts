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
import { siteLabel } from "../../util/site.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { recordFleetEventsBestEffort } from "../../audits/fleet-events-writer.js";
import { fleetSweptEvent } from "../../audits/fleet-event-detectors.js";
import type { FleetRoster } from "../../fleet/roster.js";
import type { HealthMirror } from "../../audits/health-mirror.js";
import type { FleetEvent } from "../../db/fleet-events.js";
import {
  auditFields,
  type A11yCounts,
  type BrowserAuditFields,
  type DepsCounts,
  type DomainResult,
  type FormE2eResult,
  type FunctionHealthResult,
  type NetlifyDeployResult,
  type SecurityCounts,
  type SmokeResult,
} from "../../fleet/site-fields.js";
import type { LighthouseScoreWriteback } from "../../reports/types.js";

export type AuditCommandOptions = {
  only?: string;
  json?: boolean;
  fleet?: string;
  workdir?: string;
  cwd?: string;
  /**
   * After running, push the lighthouse scores to the matching Websites row.
   * `true` (no value) = derive slug from cwd/package.json#name;
   * string = explicit slug (e.g. "med-solutions-of-texas").
   */
  writeBack?: string | boolean;
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
  ReturnType<typeof import("../../audits/write-audits.js").writeBackOneSite>
>;

type Write = WriteSummary["writes"][number];

/** A form-e2e run with no form verdict and no Turnstile opinion (its /health was
 *  unreadable) builds no field, so it kept the row's verdicts (#1716). Asked of the
 *  writer's own field builder, so the two cannot disagree. Every other audit's entry
 *  is pushed only when it carries a value to write. */
function keptVerdicts(w: Write): boolean {
  return (
    w.audit === "form-e2e" &&
    Object.keys(auditFields({ formE2e: w.counts as FormE2eResult })).length === 0
  );
}

/** The line for a write that built no field, by the fleet's own classification
 *  (`emptyWriteOutcome`), or null when something was written. A summary with no
 *  `empty` (any other WriteSummary producer) is read as written. */
function nothingWritten(summary: WriteSummary): string | null {
  const e = summary.empty;
  if (!e) return null;
  if (e.kind === "kept") return "nothing to write (verdicts kept)";
  if (e.kind === "not-applicable") return "not applicable, nothing to write";
  return `nothing measured: ${e.reason}`;
}

const verdict = (v: string | null | undefined): string => v ?? "n/a";

/** One line per audit, read off that audit's own result shape (#1716). */
function writeLine(w: Write): string {
  switch (w.audit) {
    case "lighthouse": {
      const s = w.counts as LighthouseScoreWriteback;
      // A category the run could not score (NO_LCP nulls performance) is null.
      const n = (v: number | null) => (v === null ? "n/a" : String(v));
      return `lighthouse: P=${n(s.performance)} A=${n(s.accessibility)} BP=${n(s.bestPractices)} SEO=${n(s.seo)}`;
    }
    case "a11y":
      return `a11y: ${(w.counts as A11yCounts).violations} violations`;
    case "deps": {
      const c = w.counts as DepsCounts;
      return `deps: ${c.drifted} drifted (${c.majorBehind} major)`;
    }
    case "security": {
      const c = w.counts as SecurityCounts;
      return `security: ${c.critical}C/${c.high}H/${c.moderate}M/${c.low}L`;
    }
    case "domain": {
      const d = (w.counts as DomainResult).certDaysRemaining;
      return `domain: certificate ${d === null ? "unknown" : `${d} days left`}`;
    }
    case "browser": {
      const b = w.counts as BrowserAuditFields;
      const pf = (ok: boolean) => (ok ? "pass" : "fail");
      return `browser: desktop ${pf(b.desktopOk)}, mobile ${pf(b.mobileOk)}, links ${pf(b.linksOk)}, reachable ${pf(b.reachableOk)}, title/meta ${pf(b.titleMetaOk)}, ${b.brokenLinks} broken link(s)`;
    }
    case "netlify-deploy":
      return `netlify-deploy: ${(w.counts as NetlifyDeployResult).state ?? "no deploy"}`;
    case "function-health": {
      const f = w.counts as FunctionHealthResult;
      return `function-health: ${f.functionHealth}, cms ${verdict(f.cmsReachable)}, turnstile ${verdict(f.turnstileWidget)}`;
    }
    case "smoke":
      return `smoke: ${(w.counts as SmokeResult).ok}`;
    case "form-e2e": {
      if (keptVerdicts(w)) return "form-e2e: no form verdict this run (kept)";
      const f = w.counts as FormE2eResult;
      const form = f.ok === undefined ? "no form verdict" : f.ok === null ? "n/a (no form)" : f.ok;
      return `form-e2e: ${form}${f.turnstileWidget !== undefined ? `, turnstile ${verdict(f.turnstileWidget)}` : ""}`;
    }
    default:
      // github-signals and prismic-models report through their own commands; name the
      // audit rather than guess at a shape this function does not know.
      return `${w.audit}: written`;
  }
}

export function formatWriteSummary(summary: WriteSummary): string {
  const nothing = nothingWritten(summary);
  if (nothing) return `→ Websites[${summary.siteName}]: ${nothing}`;
  const lines = summary.writes.map((w) => `  ${writeLine(w)}`);
  return `→ wrote to Websites[${summary.siteName}]:\n${lines.join("\n")}`;
}

export function writeBackTitle(summary: WriteSummary): string {
  const nothing = nothingWritten(summary);
  if (nothing) return `Websites[${summary.siteName}]: ${nothing}`;
  const n = summary.writes.filter((w) => !keptVerdicts(w)).length;
  return `Wrote to Websites[${summary.siteName}] (${n} audit type${n === 1 ? "" : "s"})`;
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

/** Audits that need no repo checkout — they probe an external resource. lighthouse hits the
 *  live URL; domain probes DNS/TLS of the URL's host; browser drives the deployed URL;
 *  netlify-deploy queries the Netlify API by site id; function-health fetches the deployed
 *  `/health` endpoint. */
const CHECKOUT_FREE_AUDITS: ReadonlySet<AuditName> = new Set<AuditName>([
  "lighthouse",
  "domain",
  "browser",
  "netlify-deploy",
  "function-health",
  "form-e2e",
]);

/** Audits whose checkout-free run is keyed off `site.netlifyId` (the Netlify API) rather than
 *  the deployed URL. Everything else in CHECKOUT_FREE_AUDITS reads `site.deployedUrl`. */
const NETLIFY_ID_AUDITS: ReadonlySet<AuditName> = new Set<AuditName>(["netlify-deploy"]);

/** A fleet site needs a local checkout unless every requested audit is checkout-free AND the site
 *  has the external resource each one runs against (`deployedUrl` for lighthouse/domain/browser,
 *  `netlifyId` for netlify-deploy). */
export function auditNeedsCheckout(site: Site, which: AuditName[]): boolean {
  const deployedCapable = which.every((n) => {
    if (!CHECKOUT_FREE_AUDITS.has(n)) return false;
    return NETLIFY_ID_AUDITS.has(n) ? site.netlifyId !== undefined : site.deployedUrl !== undefined;
  });
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

  // A literal --write-back=<slug> is single-site (the slug names one row).
  // Boolean --write-back + --fleet is fine: each site's slug comes from the
  // inventory, so there's no cwd-derived-slug ambiguity.
  if (typeof opts.writeBack === "string" && opts.fleet !== undefined) {
    throw Object.assign(
      new Error(
        "--write-back=<slug> is single-site; with --fleet each site's slug comes from the inventory. Use --write-back (no slug) + --fleet.",
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

  // Every site the run owes a result, counted BEFORE prep can drop any (#1605). The write
  // gate checks its total against this, not against whatever survived to write-back.
  const expectedSites = sites.map(siteLabel);

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

  // "Did every site actually get measured?" — emitted for any fleet sweep that ran
  // `smoke`, independent of --write-back, because it is a statement about the
  // RUN, not about persistence. Deliberately not folded into FLEET_WRITE_SUMMARY.
  // An unmeasured site used to count as written there, which is what hid four
  // nights of timeouts; since #1605 the write gate files it as failed too, but this
  // line still names the cause.
  if (opts.fleet !== undefined && which.includes("smoke") && !opts.json) {
    const { formatUnmeasuredSmokeSummary } = await import("../../audits/smoke.js");
    output += `\n\n${formatUnmeasuredSmokeSummary(results)}`;
  }

  if (which.includes("lighthouse") && !opts.json) {
    const { formatLighthouseFailureLines } = await import("../../audits/lighthouse-fields.js");
    const lines = formatLighthouseFailureLines(results);
    if (lines) output += `\n\n${lines}`;
  }

  // Did any site fail to write back? The fleet writer collects
  // per-site failures instead of throwing, so without this the command would
  // exit 0 while rows silently failed to persist — automation keying on `$?`
  // would see a clean run. (The single-site writer throws on failure, so it's
  // already non-zero via the propagated error.)
  let writeBackFailed = false;
  if (opts.writeBack !== undefined) {
    if (opts.fleet !== undefined) {
      const wb = await runFleetWriteBack({ results, which, expectedSites });
      if (wb.anyFailed) writeBackFailed = true;
      // Gate on !json: the write-summary is human text; appending it after the
      // results array would corrupt `--json` output (the other notices already
      // guard this way). The write itself still happens regardless of --json.
      if (!opts.json) output += `\n\n${wb.summary}`;
    } else {
      const { resolveSlugFromCwd } = await import("../../audits/lighthouse-fields.js");
      const { writeBackOneSite } = await import("../../audits/write-audits.js");
      const slug =
        typeof opts.writeBack === "string" && opts.writeBack.length > 0
          ? opts.writeBack
          : await resolveSlugFromCwd(cwd);
      let writeSummary: WriteSummary | null = null;
      await new Listr(
        [
          {
            title: `Write back[${slug}]`,
            task: async (_ctx, task) => {
              task.output = "loading the fleet roster…";
              const { readFleetRoster } = await import("../../fleet/roster.js");
              const websites = await readFleetRoster();
              task.output = "writing scores…";
              const { makeSiteMirror } = await import("../../db/site-mirror.js");
              const siteMirror = await makeSiteMirror();
              const summary = await writeBackOneSite({
                websites,
                slug,
                results,
                mirrorHealth: (siteId, fields) => siteMirror.health(siteId, fields),
              });
              writeSummary = summary;
              task.title = writeBackTitle(summary);
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

/** The fleet `--write-back` step: write every site's audits back to its
 *  Websites row in Turso (#539 Phase 3), and record fleet-activity events.
 *  Extracted from runAuditCommand so the mirror WIRING itself is pinned by
 *  test — the mutation this seam kills is dropping the
 *  `...(mirror ? { mirror } : {})` pass-through, which would silently stop all
 *  five nightly sweeps from mirroring while every sweep stayed green
 *  (adversarial review of #566, finding 6). Deps default to the real fleet
 *  wiring; dynamic imports keep the no-write paths from loading db clients. */
export async function runFleetWriteBack(args: {
  results: AuditResult[];
  which: AuditName[];
  /** The site labels resolved before prep (#1605); omitted, `missing` is not computed. */
  expectedSites?: string[];
  deps?: {
    /** #646 step 4: the rows results are matched against. Defaults to Turso
     *  (`readFleetRoster`); tests inject. */
    roster?: FleetRoster;
    makeMirror?: () => Promise<HealthMirror | null>;
    recordEvents?: (events: FleetEvent[], now: Date) => Promise<void>;
  };
}): Promise<{ summary: string; anyFailed: boolean }> {
  const { results, which, deps = {} } = args;
  const { writeFleetAudits, formatFleetWriteSummary, fleetWriteFailed } =
    await import("../../audits/write-audits.js");
  const roster =
    deps.roster ??
    (async () => {
      const { readFleetRoster } = await import("../../fleet/roster.js");
      return readFleetRoster();
    });
  const websites = await roster();
  const makeMirror =
    deps.makeMirror ??
    (async () => {
      const { makeHealthMirror } = await import("../../audits/health-mirror.js");
      return makeHealthMirror();
    });
  const mirror = await makeMirror();
  const fleetWrite = await writeFleetAudits({
    websites,
    results,
    ...(mirror ? { mirror } : {}),
    ...(args.expectedSites ? { expectedSites: args.expectedSites } : {}),
  });
  // Record fleet-activity events (vuln_cleared / cert_renewed rode along on each
  // WriteSummary) plus a per-sweep rollup. Best-effort: a missing Turso cred no-ops.
  const sweep = which.includes("security") ? "security" : "lighthouse";
  const now = new Date();
  const auditEvents = fleetWrite.events ?? fleetWrite.written.flatMap((w) => w.events ?? []);
  await (deps.recordEvents ?? recordFleetEventsBestEffort)(
    [...auditEvents, fleetSweptEvent(sweep, fleetWrite.written.length, now.toISOString())],
    now,
  );
  // #612: a mirror failure, a missed row, or an absent mirror are all fatal —
  // nothing converges them, so a sweep that wrote nothing into the only store
  // would otherwise finish green.
  return {
    summary: formatFleetWriteSummary(fleetWrite),
    anyFailed: fleetWriteFailed(fleetWrite),
  };
}
