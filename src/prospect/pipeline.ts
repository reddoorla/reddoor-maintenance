import { crawlSite, defaultCrawlDeps, readCapped, USER_AGENT, type CrawlDeps } from "./crawl.js";
import { computeScores, runChecks } from "./checks.js";
import {
  analyzeSite,
  defaultAnalyzeDeps,
  reconcileFixes,
  type AnalyzeDeps,
} from "./analyze.js";
import {
  claudeCodeAccuracyRun,
  claudeCodeAnalyzeDeps,
  claudeCodeEngine,
  llmAuthMode,
} from "./claude-code.js";
import {
  apiAccuracyDeps,
  checkAccuracy,
  type AccuracyDeps,
  type AccuracyResult,
} from "./accuracy.js";
import { defaultOwnershipDeps } from "./ownership.js";
import {
  defaultEngines,
  runVisibilityProbes,
  type ProbeRunOptions,
  type VisibilityEngine,
} from "./probes.js";
import { runLighthouse } from "./lighthouse.js";
import { checkAssets, type AssetCheck, type AssetCheckDeps } from "./assets.js";
import { checkBasics, type BasicsCheck, type BasicsDeps, type BasicsProbe } from "./basics.js";
import { checkGoal, type GoalFit, type SiteGoal } from "./goals.js";
import type {
  AnalyzeResult,
  ChecksResult,
  CrawlResult,
  LighthouseScores,
  ProbesResult,
  ProspectAuditResult,
  StageResult,
} from "./types.js";

export type StageName =
  "crawl" | "checks" | "lighthouse" | "analyze" | "probes" | "assets" | "basics" | "accuracy";

/** The two ways an audit can pay for its model calls. Which one runs is
 *  decided here, once, off PROSPECT_LLM_AUTH (see claude-code.ts) — the
 *  production runner sets nothing and gets the metered API; a dev machine
 *  sets `subscription` and rides the Claude plan. Factories are injectable so
 *  a test can watch the selection without spawning anything. */
export function envAnalyzeDeps(
  factories: { api: () => AnalyzeDeps; subscription: () => AnalyzeDeps } = {
    api: defaultAnalyzeDeps,
    subscription: claudeCodeAnalyzeDeps,
  },
): AnalyzeDeps {
  return llmAuthMode() === "subscription" ? factories.subscription() : factories.api();
}

/** Same selection for the probe engines. In subscription mode the claude-code
 *  engine replaces the API's claude engine (its rows carry their own engine
 *  name — the two are different instruments); the Perplexity gate inside
 *  defaultEngines applies either way. */
/**
 * The accuracy stage's dependencies, chosen by the same env toggle as analyze.
 *
 * `apiAccuracyDeps` is deliberately not a default parameter, so the only
 * convenient way to call `checkAccuracy` is through here — which is what stops
 * the wiring silently billing the metered API under
 * `PROSPECT_LLM_AUTH=subscription`. This is the pipeline's largest prompt (up
 * to 14 untruncated pages) on Opus, so one forgotten argument is expensive.
 */
export function envAccuracyDeps(userAgent: string): AccuracyDeps {
  const api = apiAccuracyDeps();
  return llmAuthMode() === "subscription"
    ? { run: claudeCodeAccuracyRun(), ownership: defaultOwnershipDeps(userAgent) }
    : api;
}

export function envEngines(): VisibilityEngine[] {
  return llmAuthMode() === "subscription" ? defaultEngines(claudeCodeEngine()) : defaultEngines();
}

/** `opts.probes === false` (the CLI's `--no-probes`) and an attempted probe
 *  run that failed are both `{ok:false, error}` — only the message tells
 *  them apart. Exported so a consumer (the renderer) compares against this
 *  constant rather than retyping the string. */
export const PROBES_SKIPPED = "skipped (--no-probes)";

/** analyze never runs when checks itself failed — buildAnalyzeInput reads
 *  the ChecksResult, so there is nothing to build the prompt from. Exported
 *  for the same reason as PROBES_SKIPPED. */
export const ANALYZE_SKIPPED = "skipped — the checks stage failed";

/** The asset check reads the same page extracts the checks stage does, so it
 *  has nothing to work from when that stage failed. Exported for the same
 *  reason as the constants above: consumers compare, they do not retype. */
export const ASSETS_SKIPPED = "skipped — the checks stage failed";

/** No branded answers to check, because the probes did not run or were turned
 *  off. An absence of input, never a finding: the report must read "not
 *  measured" here and never "the engine said nothing wrong about you". */
export const ACCURACY_SKIPPED = "skipped — no branded answers to check";

/** No goal was supplied and the analyze stage did not infer one — so the goal
 *  section reads "not measured". Distinct from a goal of `unknown`, which IS a
 *  measurement: it means we looked and the site does not push toward any single
 *  action, which is a finding about the site rather than a gap in the audit. */
export const GOAL_UNRESOLVED = "no goal supplied and none could be inferred";

/** HEAD first, GET on anything that refuses it.
 *
 *  Plenty of servers answer HEAD with 405 or 501 while serving the same URL
 *  perfectly well over GET, and reporting those as broken links would fill a
 *  prospect's report with defects that do not exist. The GET is made with a
 *  Range header asking for the first byte, so a heavy asset is not pulled in
 *  whole just to learn its status. */
/**
 * What a browser tells an image host it can accept.
 *
 * Without this the probe sent no Accept at all, so every content-negotiating
 * host — imgix, Cloudinary, Cloudflare Images, and Prismic, which is most of
 * our own fleet — fell back to the original JPEG and we published its size as
 * the site's image weight. On reddoorla.com we reported 1,760 KB for a hero a
 * real desktop browser receives as a 543 KB AVIF: three times over, in the
 * direction that makes our own finding look worse than the truth.
 *
 * The trailing wildcard is not decoration. A host serving a format we did not
 * name could otherwise answer 406, and an image we failed to ask for properly
 * would be reported to the client as a broken one.
 */
export const ASSET_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

export async function defaultAssetProbe(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; headers: Record<string, string> }> {
  const headersOf = (res: Response): Record<string, string> =>
    Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));

  const head = await fetchImpl(url, {
    method: "HEAD",
    headers: { "user-agent": USER_AGENT, accept: ASSET_ACCEPT },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (head.status !== 405 && head.status !== 501) {
    return { status: head.status, headers: headersOf(head) };
  }

  const get = await fetchImpl(url, {
    method: "GET",
    headers: { "user-agent": USER_AGENT, accept: ASSET_ACCEPT, range: "bytes=0-0" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  // Release the socket: nothing here reads the body, and an unconsumed one
  // keeps the connection alive until GC.
  await get.body?.cancel();
  return { status: get.status, headers: headersOf(get) };
}

/** Every one of these wants the body — a HEAD tells us nothing about whether a
 *  404 page has a way back into the site. Redirects are followed because the
 *  whole point of two of these checks is where you land. */
async function defaultBasicsProbe(url: string, userAgent = USER_AGENT): Promise<BasicsProbe> {
  const res = await fetch(url, {
    headers: { "user-agent": userAgent, accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, finalUrl: res.url || url, body: await readCapped(res, url) };
}

export type PipelineDeps = {
  crawl?: CrawlDeps;
  /** Overrides runChecks (checks.ts) — pure and synchronous like the real
   *  thing. Exists mainly so a test can force the checks stage to fail
   *  without hand-crafting a CrawlResult that breaks it for real. */
  checks?: (crawl: CrawlResult) => ChecksResult;
  analyze?: AnalyzeDeps;
  engines?: VisibilityEngine[];
  lighthouse?: (url: string) => Promise<LighthouseScores>;
  /** Overrides the asset check's request budget and pacing. The defaults are
   *  deliberately modest: this is the only stage that fans out to many URLs on
   *  someone else's server, and a courteous audit is worth more than an
   *  exhaustive one. A test passes its own `probe` to avoid a network. */
  assets?: Partial<AssetCheckDeps>;
  /** Overrides the accuracy stage's model call and domain-ownership probes. */
  accuracy?: Partial<AccuracyDeps>;
  /**
   * Overrides the reachability probes. A test passes its own to avoid a
   * network: three reachability requests, plus one or two per named crawler
   * agent for the served-differently check.
   *
   * Passing `probe` alone is enough — `probeAs` inherits it (see the wiring
   * below). It used to fall back to the live network instead, so the offline
   * suites stubbed `probe`, believed they were closed systems, and fired real
   * requests at a fixture hostname on every run.
   */
  basics?: Partial<BasicsDeps>;
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
  /** What this site is for, when we already know. Overrides the analyze stage's
   *  inference — supply it when the prospect has told us, leave it out for a
   *  cold audit and let the site speak for itself. */
  goal?: SiteGoal;
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
  // Resolved once, up front, for two reasons: a typo'd PROSPECT_LLM_AUTH must
  // fail HERE — before crawl and Lighthouse spend, and before a hollow report
  // could persist and email — and the mode is stamped on the result below,
  // because which instrument produced an audit is part of the measurement.
  const llmAuth = llmAuthMode();
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

  // Runs off the crawl, so it is independent of everything below and can fail
  // without touching them. Skipped entirely when checks failed: without an
  // extract there are no links or images to probe, and firing requests at a
  // prospect's server to discover that would be rude as well as pointless.
  const assets: StageResult<AssetCheck> = checks.ok
    ? await stage("assets", deps, async () =>
        checkAssets(crawlData.pages, crawlData.origin, {
          probe: defaultAssetProbe,
          maxLinks: 60,
          maxImages: 40,
          delayMs: 150,
          ...deps.assets,
        }),
      )
    : { ok: false, error: ASSETS_SKIPPED };

  // Unlike every other stage below, this one reads only `crawl` — never
  // `checks` — so it still runs when the checks stage failed. That is the
  // point: "does the address work, and what happens on a missing page" is
  // answerable about a site whose markup defeated everything else.
  const basics: StageResult<BasicsCheck> = await stage("basics", deps, async () =>
    checkBasics(crawlData, {
      probe: defaultBasicsProbe,
      ...deps.basics,
      // Inherit `probe` when only that was overridden. Both defaults are the
      // same function, so this changes nothing in production — but it means a
      // caller who stubs the network cannot stub HALF of it by accident, which
      // is exactly what the offline suites had been doing.
      probeAs:
        deps.basics?.probeAs ??
        (deps.basics?.probe ? (url) => deps.basics!.probe!(url) : defaultBasicsProbe),
    }),
  );

  const lighthouse: StageResult<LighthouseScores> = await stage("lighthouse", deps, async () =>
    (deps.lighthouse ?? runLighthouse)(url),
  );

  // When the operator told us what the site is for, the goal checklist is a
  // pure function of the crawl and the checks — so it can be computed BEFORE
  // the model runs and handed to it, which is the only way the fix list can be
  // stopped from recommending work the report says is already done. Without an
  // operator goal we do not yet know which checklist applies, and the model
  // gets nothing; reconcileFixes still runs as the backstop either way.
  const operatorFit: GoalFit | null =
    opts.goal !== undefined && opts.goal !== null
      ? checkGoal(opts.goal, "operator", crawlData, checks.ok ? checks.data : null)
      : null;

  const analyze: StageResult<AnalyzeResult> = checks.ok
    ? await stage("analyze", deps, async () =>
        // The operator's goal, when we have one, decides which fixed question
        // set gets asked — so it must reach this stage rather than being
        // applied after it. Without one we ask the universal set; the model
        // still infers `primaryGoal` for the goal-fit section either way.
        analyzeSite(
          url,
          crawlData,
          checks.data,
          deps.analyze ?? envAnalyzeDeps(),
          opts.goal ?? "unknown",
          operatorFit,
        ),
      )
    : { ok: false, error: ANALYZE_SKIPPED };

  // The searchable proper NOUN (AnalyzeResult.businessName), never the
  // model's one-or-two-sentence description (AnalyzeResult.business) — that
  // stays available to the renderer off analyze.data.business and is never
  // copied up here. The probes stage below reads this same resolved value,
  // so it too only ever queries the name.
  const businessName =
    opts.business?.trim() || (analyze.ok ? analyze.data.businessName : "") || null;

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
          business: businessName ?? "",
          categoryQueries: analyze.ok ? analyze.data.categoryQueries : [],
          competitors: opts.competitors ?? [],
        },
        deps.engines ?? envEngines(),
        probeOpts,
      ),
    );
  }

  // Pure and synchronous over data already gathered, so it cannot fail in a way
  // worth isolating — but it is still a StageResult, because a report stored
  // before this existed must read as "not measured" rather than as an empty
  // checklist, and only the wrapper carries that distinction.
  //
  // The operator's goal wins over the model's. `unknown` from the model is a
  // real answer and is left alone: see the schema note in analyze.ts.
  const resolvedGoal: SiteGoal | null =
    opts.goal ?? (analyze.ok ? (analyze.data.primaryGoal ?? null) : null);
  const goalFit: StageResult<GoalFit> =
    resolvedGoal === null
      ? { ok: false, error: GOAL_UNRESOLVED }
      : {
          ok: true,
          // Reuse the checklist the model was shown rather than recomputing an
          // identical one. Same inputs either way, but sharing the object makes
          // it structurally impossible for the fix list to have been reconciled
          // against a different checklist from the one the report prints.
          data:
            operatorFit ??
            checkGoal(
              resolvedGoal,
              opts.goal ? "operator" : "inferred",
              crawlData,
              checks.ok ? checks.data : null,
            ),
        };

  // Reconcile the fix list against the checklist the REPORT prints. On an
  // ordinary audit that checklist is only known HERE — the goal came from the
  // model, so it did not exist when analyze ran and the backstop inside
  // analyzeSite had nothing to compare against. Without this, a report can
  // print "Yes — a phone number they can tap" and, three sections later, tell
  // them to add one.
  //
  // On the operator path this is the same checklist analyze was already shown
  // and already filtered against; the filter is idempotent, so one call covers
  // both paths rather than two rules that can drift apart.
  const reconciled: StageResult<AnalyzeResult> =
    analyze.ok && goalFit.ok
      ? {
          ok: true,
          data: { ...analyze.data, fixes: reconcileFixes(analyze.data.fixes, goalFit.data) },
        }
      : analyze;

  // When an engine describes this business, where is it getting that from?
  //
  // Runs last because it needs the most: the branded answers from probes, the
  // whole crawl to check each claim against, and the site's own phone numbers
  // from checks so a wrong number is read as a contradiction rather than an
  // absence. Cheap to place here and impossible to place earlier.
  //
  // Skipped rather than failed when there are no branded answers. "We had
  // nothing to check" and "the engine said nothing wrong about you" are
  // opposite claims, and only one of them is ours to make.
  const brandedAnswers = probes.ok ? probes.data.answers.filter((a) => a.kind === "branded") : [];
  const accuracy: StageResult<AccuracyResult> =
    brandedAnswers.length === 0
      ? { ok: false, error: ACCURACY_SKIPPED }
      : await stage("accuracy", deps, async () => {
          const env = envAccuracyDeps(USER_AGENT);
          return checkAccuracy(
            url,
            crawlData,
            probes.ok ? probes.data.answers : [],
            // The site's own numbers, so a wrong one in an answer reads as a
            // contradiction rather than as something the site never mentions.
            // `consistency` is optional on older shapes; an empty list makes
            // every phone claim an ordinary absence, which is the safe default.
            checks.ok ? (checks.data.consistency?.phones ?? []).map((p) => p.normalized) : [],
            {
              run: deps.accuracy?.run ?? env.run,
              ownership: deps.accuracy?.ownership ?? env.ownership,
            },
          );
        });

  return {
    url,
    businessName,
    llmAuth,
    generatedAt: new Date().toISOString(),
    scores: computeScores({
      checks: checks.ok ? checks.data : null,
      lighthouse: lighthouse.ok ? lighthouse.data : null,
      analyze: reconciled.ok ? reconciled.data : null,
      probes: probes.ok ? probes.data : null,
    }),
    crawl,
    checks,
    lighthouse,
    analyze: reconciled,
    probes,
    assets,
    basics,
    goalFit,
    accuracy,
  };
}
