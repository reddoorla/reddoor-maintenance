import type { Site } from "../types.js";
import { crawlSite, defaultCrawlDeps, type CrawlDeps } from "./crawl.js";
import { computeScores, runChecks } from "./checks.js";
import { analyzeSite, defaultAnalyzeDeps, type AnalyzeDeps } from "./analyze.js";
import { defaultEngines, runVisibilityProbes, type VisibilityEngine } from "./probes.js";
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

export type PipelineDeps = {
  crawl?: CrawlDeps;
  analyze?: AnalyzeDeps;
  engines?: VisibilityEngine[];
  lighthouse?: (url: string) => Promise<LighthouseScores>;
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

/** Reuse the fleet Lighthouse audit's deployed-URL path: with `deployedUrl` set
 *  it runs lhci against the live URL with no checkout and no dev server. */
async function defaultLighthouse(url: string): Promise<LighthouseScores> {
  const { lighthouseAudit } = await import("../audits/lighthouse.js");
  const site: Site = { path: "", name: new URL(url).hostname, deployedUrl: url };
  const result = await lighthouseAudit({ site });
  const summary =
    (result.details as { summary?: Record<string, number> } | undefined)?.summary ?? {};
  const score = (key: string): number | null =>
    typeof summary[key] === "number" ? Math.round(summary[key] * 100) : null;
  return {
    performance: score("performance"),
    accessibility: score("accessibility"),
    bestPractices: score("best-practices"),
    seo: score("seo"),
    summary: result.summary,
    status: result.status,
  };
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
  const crawl: StageResult<CrawlResult> = { ok: true, data: crawlData };

  const checks: StageResult<ChecksResult> = await stage("checks", deps, async () =>
    runChecks(crawlData),
  );

  const lighthouse: StageResult<LighthouseScores> = await stage("lighthouse", deps, async () =>
    (deps.lighthouse ?? defaultLighthouse)(url),
  );

  const analyze: StageResult<AnalyzeResult> = checks.ok
    ? await stage("analyze", deps, async () =>
        analyzeSite(url, crawlData, checks.data, deps.analyze ?? defaultAnalyzeDeps()),
      )
    : { ok: false, error: "skipped — the checks stage failed" };

  // The searchable proper NOUN (AnalyzeResult.businessName), never the model's
  // one-or-two-sentence description (AnalyzeResult.business) — that stays
  // available to the renderer off analyze.data.business and is never copied
  // up here. The probes stage below reads this same resolved value, so it too
  // only ever queries the name.
  const business = opts.business?.trim() || (analyze.ok ? analyze.data.businessName : "") || null;

  let probes: StageResult<ProbesResult>;
  if (opts.probes === false) {
    probes = { ok: false, error: "skipped (--no-probes)" };
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
