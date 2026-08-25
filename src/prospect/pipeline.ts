import { crawlSite, defaultCrawlDeps, type CrawlDeps } from "./crawl.js";
import { computeScores, runChecks } from "./checks.js";
import { analyzeSite, defaultAnalyzeDeps, type AnalyzeDeps } from "./analyze.js";
import {
  defaultEngines,
  runVisibilityProbes,
  type ProbeRunOptions,
  type VisibilityEngine,
} from "./probes.js";
import { runLighthouse } from "./lighthouse.js";
import type {
  AnalyzeResult,
  ChecksResult,
  CrawlResult,
  LighthouseScores,
  ProbesResult,
  ProspectAuditResult,
  StageResult,
} from "./types.js";

export type StageName = "crawl" | "checks" | "lighthouse" | "analyze" | "probes";

/** `opts.probes === false` (the CLI's `--no-probes`) and an attempted probe
 *  run that failed are both `{ok:false, error}` — only the message tells
 *  them apart. Exported so a consumer (the renderer) compares against this
 *  constant rather than retyping the string. */
export const PROBES_SKIPPED = "skipped (--no-probes)";

/** analyze never runs when checks itself failed — buildAnalyzeInput reads
 *  the ChecksResult, so there is nothing to build the prompt from. Exported
 *  for the same reason as PROBES_SKIPPED. */
export const ANALYZE_SKIPPED = "skipped — the checks stage failed";

export type PipelineDeps = {
  crawl?: CrawlDeps;
  /** Overrides runChecks (checks.ts) — pure and synchronous like the real
   *  thing. Exists mainly so a test can force the checks stage to fail
   *  without hand-crafting a CrawlResult that breaks it for real. */
  checks?: (crawl: CrawlResult) => ChecksResult;
  analyze?: AnalyzeDeps;
  engines?: VisibilityEngine[];
  lighthouse?: (url: string) => Promise<LighthouseScores>;
  /** Forwarded to probes.ts's ProbeRunOptions.delayMs — production runs want
   *  the real between-query pacing (a metered, rate-limited API); an offline
   *  test suite wants 0 so it never genuinely sleeps for it. */
  probeDelayMs?: number;
  /** Forwarded to ProbeRunOptions.sleep — the same injectable timer probes.ts
   *  already exposes for its own tests. */
  probeSleep?: (ms: number) => Promise<void>;
  onStage?: (name: StageName, status: "start" | "ok" | "fail", detail?: string) => void;
};

export type ProspectAuditOptions = {
  business?: string;
  competitors?: string[];
  /** false → tier 3 is skipped deliberately (`--no-probes`). */
  probes?: boolean;
};

async function stage<T>(
  name: StageName,
  deps: PipelineDeps,
  fn: () => Promise<T>,
): Promise<StageResult<T>> {
  deps.onStage?.(name, "start");
  try {
    const data = await fn();
    deps.onStage?.(name, "ok");
    return { ok: true, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.onStage?.(name, "fail", error);
    return { ok: false, error };
  }
}

/**
 * Run the full audit. The crawl is fatal — everything downstream reads it, so an
 * unreachable site throws and no report is written. Every other stage is
 * isolated: a failure becomes `{ok: false, error}` and its report section reads
 * "not measured".
 */
export async function runProspectAudit(
  url: string,
  opts: ProspectAuditOptions,
  deps: PipelineDeps = {},
): Promise<ProspectAuditResult> {
  const crawlDeps = deps.crawl ?? defaultCrawlDeps();
  deps.onStage?.("crawl", "start");
  let crawlData: CrawlResult;
  try {
    crawlData = await crawlSite(url, crawlDeps);
    deps.onStage?.("crawl", "ok");
  } catch (err) {
    deps.onStage?.("crawl", "fail", err instanceof Error ? err.message : String(err));
    throw err;
  }
  // The crawl throwing above is the ONLY way this function exits before a
  // full result is built, so the ok:false branch of StageResult can never
  // appear here — ProspectAuditResult.crawl is narrowed to this shape.
  const crawl: { ok: true; data: CrawlResult } = { ok: true, data: crawlData };

  const checksFn = deps.checks ?? runChecks;
  const checks: StageResult<ChecksResult> = await stage("checks", deps, async () =>
    checksFn(crawlData),
  );

  const lighthouse: StageResult<LighthouseScores> = await stage("lighthouse", deps, async () =>
    (deps.lighthouse ?? runLighthouse)(url),
  );

  const analyze: StageResult<AnalyzeResult> = checks.ok
    ? await stage("analyze", deps, async () =>
        analyzeSite(url, crawlData, checks.data, deps.analyze ?? defaultAnalyzeDeps()),
      )
    : { ok: false, error: ANALYZE_SKIPPED };

  // The searchable proper NOUN (AnalyzeResult.businessName), never the
  // model's one-or-two-sentence description (AnalyzeResult.business) — that
  // stays available to the renderer off analyze.data.business and is never
  // copied up here. The probes stage below reads this same resolved value,
  // so it too only ever queries the name.
  const business = opts.business?.trim() || (analyze.ok ? analyze.data.businessName : "") || null;

  const probeOpts: ProbeRunOptions = {
    ...(deps.probeDelayMs !== undefined ? { delayMs: deps.probeDelayMs } : {}),
    ...(deps.probeSleep !== undefined ? { sleep: deps.probeSleep } : {}),
  };

  let probes: StageResult<ProbesResult>;
  if (opts.probes === false) {
    probes = { ok: false, error: PROBES_SKIPPED };
  } else {
    probes = await stage("probes", deps, async () =>
      runVisibilityProbes(
        {
          url,
          business: business ?? "",
          buyerQuestions: analyze.ok ? analyze.data.buyerQuestions.map((q) => q.question) : [],
          competitors: opts.competitors ?? [],
        },
        deps.engines ?? defaultEngines(),
        probeOpts,
      ),
    );
  }

  return {
    url,
    business,
    generatedAt: new Date().toISOString(),
    scores: computeScores({
      checks: checks.ok ? checks.data : null,
      lighthouse: lighthouse.ok ? lighthouse.data : null,
      analyze: analyze.ok ? analyze.data : null,
      probes: probes.ok ? probes.data : null,
    }),
    crawl,
    checks,
    lighthouse,
    analyze,
    probes,
  };
}
