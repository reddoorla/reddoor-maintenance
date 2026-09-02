import { describe, it, expect } from "vitest";
import type { GoalRequirement } from "../../src/prospect/goals.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  runProspectAudit,
  ASSETS_SKIPPED,
  PROBES_SKIPPED,
  ANALYZE_SKIPPED,
  envAccuracyDeps,
  type PipelineDeps,
} from "../../src/prospect/pipeline.js";
import type { CrawlDeps, FetchResponse } from "../../src/prospect/crawl.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

const HOME = "https://acme.example/";

const crawlDeps = (over: Partial<CrawlDeps> = {}): CrawlDeps => ({
  async fetchUrl(url): Promise<FetchResponse> {
    if (url === HOME) return { status: 200, body: fixture("rich.html"), headers: {} };
    if (url.endsWith("/services") || url.endsWith("/about"))
      return { status: 200, body: fixture("rich.html"), headers: {} };
    return { status: 404, body: "", headers: {} };
  },
  async renderPages(urls) {
    return new Map(urls.map((u) => [u, fixture("rich.html")]));
  },
  maxPages: 5,
  delayMs: 0,
  ...over,
});

// AnalyzeSchema requires 6-10 buyer questions (analyze.ts) — all "yes" here so
// scores.answers (checks.ts computeScores) lands on a deterministic 100.
const analyzeOutput = {
  businessName: "Acme Roofing",
  business: "Acme Roofing repairs and replaces commercial roofs in Boise, Idaho.",
  entityClarity: { score: 70, missing: [] },
  categoryQueries: [
    "commercial roofing contractor Boise",
    "how much does a commercial roof replacement cost",
    "flat roof repair Idaho",
  ],
  // Evidence must be a REAL substring of rich.html, not a placeholder. It used
  // to be "…", which verifyEvidence nulls — and now that an unsupported
  // positive verdict is downgraded to `no`, a placeholder would score this
  // "healthy run" at 0 instead of 100. The fixture was always dishonest; only
  // now does it matter.
  buyerQuestions: [
    {
      id: "cost",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "We repair flat commercial roofs across the Treasure Valley",
    },
    {
      id: "who-for",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "We repair flat commercial roofs across the Treasure Valley",
    },
    {
      id: "proof",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "We repair flat commercial roofs across the Treasure Valley",
    },
    {
      id: "who-does-it",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "We repair flat commercial roofs across the Treasure Valley",
    },
    {
      id: "where",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "We repair flat commercial roofs across the Treasure Valley",
    },
    {
      id: "next-step",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "We repair flat commercial roofs across the Treasure Valley",
    },
  ],
  fixes: [
    {
      title: "Add FAQ schema",
      why: "…",
      impact: "high" as const,
      effort: "low" as const,
      tier: "content" as const,
    },
  ],
  narrative: { findability: "a", readability: "b", answers: "c" },
};

const deps = (over: Partial<PipelineDeps> = {}): PipelineDeps => ({
  crawl: crawlDeps(),
  analyze: { run: async () => analyzeOutput },
  engines: [
    {
      name: "perplexity",
      ask: async () => ({ answer: "Acme Roofing", citedDomains: ["acme.example"] }),
    },
  ],
  lighthouse: async () => ({
    performance: 80,
    accessibility: 90,
    bestPractices: 70,
    seo: 100,
    summary: "lighthouse: all categories passing",
    status: "pass" as const,
  }),
  // The assets stage is the one check that fans out to real URLs. Stubbed here
  // with a probe that throws, so any test whose fixture grows an <a href> or an
  // <img src> cannot start quietly making network calls from the suite — it
  // records a transport failure instead, which the stage already handles.
  assets: {
    probe: async () => {
      throw new Error("network disabled in tests");
    },
    delayMs: 0,
    sleep: async () => {},
  },
  // Same reason, for the other stage that makes its own requests. Without this
  // the suite fires three real fetches per run at whatever hostname the fixture
  // happens to use, which is both slow and rude.
  basics: {
    probe: async () => {
      throw new Error("network disabled in tests");
    },
    // `probeAs` too, and not as belt-and-braces: pipeline.ts defaults it to the
    // live crawler-reachability probe, so stubbing only `probe` left this
    // offline suite firing real requests at whatever hostname the fixture
    // happened to use — one per named agent, per run. The tests passed whether
    // those succeeded, failed or hung, which means they asserted nothing about
    // this stage and the suite's result depended on the runner's DNS.
    probeAs: async () => {
      throw new Error("network disabled in tests");
    },
  },
  // Real ProbeRunOptions pacing (probes.ts's pacedEach) genuinely sleeps
  // between queries — 0 keeps this offline suite from spending seconds on it.
  probeDelayMs: 0,
  ...over,
});

describe("runProspectAudit", () => {
  it("returns every stage populated on a healthy run", async () => {
    const result = await runProspectAudit(HOME, {}, deps());
    expect(result.url).toBe(HOME);
    expect(result.businessName).toBe("Acme Roofing");
    expect(result.crawl.ok).toBe(true);
    expect(result.checks.ok).toBe(true);
    expect(result.lighthouse.ok).toBe(true);
    expect(result.analyze.ok).toBe(true);
    expect(result.probes.ok).toBe(true);
    expect(result.scores.findability).toBeGreaterThan(0);
    expect(result.scores.answers).toBe(100);
    expect(result.scores.aiVisibility).toBe(100);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("prefers the operator's business name over the model's", async () => {
    const result = await runProspectAudit(HOME, { business: "Acme Roofing LLC" }, deps());
    expect(result.businessName).toBe("Acme Roofing LLC");
  });

  it("degrades the analyze section and its score, keeping the rest", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        analyze: {
          run: async () => {
            throw new Error("529 overloaded");
          },
        },
      }),
    );
    expect(result.analyze).toEqual({ ok: false, error: "529 overloaded" });
    expect(result.scores.answers).toBeNull();
    expect(result.checks.ok).toBe(true);
    expect(result.scores.readability).not.toBeNull();
  });

  it("degrades lighthouse without touching the other scores", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        lighthouse: async () => {
          throw new Error("npx unavailable");
        },
      }),
    );
    expect(result.lighthouse.ok).toBe(false);
    expect(result.scores.findability).not.toBeNull();
  });

  it("skips probes entirely when asked", async () => {
    const result = await runProspectAudit(HOME, { probes: false }, deps());
    expect(result.probes).toEqual({ ok: false, error: PROBES_SKIPPED });
    expect(result.scores.aiVisibility).toBeNull();
  });

  it("runs the asset check off the crawl and reports what it probed", async () => {
    const asked: string[] = [];
    const result = await runProspectAudit(
      HOME,
      { probes: false },
      deps({
        assets: {
          delayMs: 0,
          sleep: async () => {},
          probe: async (url) => {
            asked.push(url);
            return { status: 404, headers: {} };
          },
        },
      }),
    );
    expect(result.assets?.ok).toBe(true);
    if (result.assets?.ok) {
      // Whatever the fixture links to, the stage reported on it rather than
      // silently doing nothing — the failure mode that would make this check
      // look green on every site forever. Links AND images: one probe budget
      // covers both, and `asked` counts every request the stage made.
      const { linksChecked, imagesChecked, brokenLinks } = result.assets.data;
      expect(linksChecked + imagesChecked).toBe(asked.length);
      expect(linksChecked).toBeGreaterThan(0);
      // Everything answered 404, so every link probed is reported broken.
      expect(brokenLinks).toHaveLength(linksChecked);
    }
  });

  // Without an extract there are no links or images to probe, and firing
  // requests at a stranger's server to discover that would be rude as well as
  // pointless.
  it("skips the asset check when the checks stage failed", async () => {
    const result = await runProspectAudit(
      HOME,
      { probes: false },
      deps({
        checks: () => {
          throw new Error("checks exploded");
        },
      }),
    );
    expect(result.assets).toEqual({ ok: false, error: ASSETS_SKIPPED });
  });

  it("still runs probes when the analyze stage failed", async () => {
    const result = await runProspectAudit(
      HOME,
      { business: "Acme Roofing" },
      deps({
        analyze: {
          run: async () => {
            throw new Error("529 overloaded");
          },
        },
      }),
    );
    expect(result.probes.ok).toBe(true);
  });

  it("throws when the site is unreachable — nothing to persist", async () => {
    await expect(
      runProspectAudit(
        HOME,
        {},
        deps({
          crawl: crawlDeps({ fetchUrl: async () => ({ status: 500, body: "", headers: {} }) }),
        }),
      ),
    ).rejects.toThrow(/500/);
  });

  it("reports stage progress to the caller", async () => {
    const seen: string[] = [];
    await runProspectAudit(
      HOME,
      {},
      { ...deps(), onStage: (name, status) => seen.push(`${name}:${status}`) },
    );
    expect(seen).toContain("crawl:ok");
    expect(seen).toContain("probes:ok");
  });

  it("degrades checks — and the cascading analyze skip — while probes still run", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        checks: () => {
          throw new Error("checks blew up");
        },
      }),
    );
    expect(result.checks).toEqual({ ok: false, error: "checks blew up" });
    expect(result.analyze).toEqual({ ok: false, error: ANALYZE_SKIPPED });
    expect(result.probes.ok).toBe(true);
    // findability/readability need a successful checks stage; answers needs
    // buyer questions, which only a successful analyze stage supplies — all
    // three are structurally null here. aiVisibility depends only on probes,
    // which ran, but with zero buyer questions probes.ts's buildQueries never
    // produces a "category" query (only "branded"/"competitor"), so
    // visibilityScore — and this score — are null too: nothing here actually
    // measured discoverability for a real buyer question.
    expect(result.scores.findability).toBeNull();
    expect(result.scores.readability).toBeNull();
    expect(result.scores.answers).toBeNull();
    expect(result.scores.aiVisibility).toBeNull();
  });

  it("falls back to the domain when the model returns no business name", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        analyze: { run: async () => ({ ...analyzeOutput, businessName: "" }) },
      }),
    );
    // An empty businessName is itself a finding (AnalyzeSchema allows it) —
    // the operator supplied no override either, so there is no name to report.
    expect(result.businessName).toBeNull();
    expect(result.probes.ok).toBe(true);
    if (result.probes.ok) {
      // resolveBusinessName (probes.ts) falls back to domainOf(url) rather
      // than querying an empty string.
      expect(result.probes.data.answers.some((a) => a.query.includes("acme.example"))).toBe(true);
      expect(result.probes.data.answers.some((a) => a.query.includes("Acme Roofing"))).toBe(false);
    }
  });
});

describe("llm auth mode in the pipeline", () => {
  /** The api-mode accuracy deps, read with the toggle explicitly off. */
  const withApiMode = async () => {
    const saved = process.env.PROSPECT_LLM_AUTH;
    delete process.env.PROSPECT_LLM_AUTH;
    try {
      return envAccuracyDeps("test-agent");
    } finally {
      if (saved !== undefined) process.env.PROSPECT_LLM_AUTH = saved;
    }
  };

  const withEnv = async (value: string | undefined, fn: () => Promise<void>) => {
    const saved = process.env.PROSPECT_LLM_AUTH;
    if (value === undefined) delete process.env.PROSPECT_LLM_AUTH;
    else process.env.PROSPECT_LLM_AUTH = value;
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.PROSPECT_LLM_AUTH;
      else process.env.PROSPECT_LLM_AUTH = saved;
    }
  };

  it("routes the accuracy stage through the subscription path when the toggle says so", () =>
    withEnv("subscription", async () => {
      // accuracy is the pipeline's largest prompt, on Opus, and it is the one
      // model stage with no default deps — because the only possible default
      // is the metered API client, which would bill regardless of this
      // toggle. Everything reaches it through here instead.
      const subscription = envAccuracyDeps("test-agent");
      const api = await withApiMode();
      expect(subscription.run).not.toBe(api.run);
    }));

  it("uses the metered API client for accuracy when the toggle is unset", () =>
    withEnv(undefined, async () => {
      const chosen = envAccuracyDeps("test-agent");
      expect(typeof chosen.run).toBe("function");
      expect(typeof chosen.ownership.fetchPage).toBe("function");
    }));

  it("stamps llmAuth on the result — an audit must say which instrument produced it", () =>
    withEnv(undefined, async () => {
      const result = await runProspectAudit(HOME, {}, deps());
      expect(result.llmAuth).toBe("api");
    }));

  it("stamps subscription mode even when every model stage is injected", () =>
    withEnv("subscription", async () => {
      // Injected deps mean no subprocess ever spawns — the stamp records the
      // MODE the audit ran under, which --no-probes or a failed stage must
      // not erase.
      const result = await runProspectAudit(HOME, {}, deps());
      expect(result.llmAuth).toBe("subscription");
    }));

  it("fails fast on a typo'd toggle, before any crawl or Lighthouse spend", () =>
    withEnv("subscripton", async () => {
      let crawled = false;
      const d = deps({
        crawl: crawlDeps({
          async fetchUrl(_url): Promise<FetchResponse> {
            crawled = true;
            return { status: 200, body: fixture("rich.html"), headers: {} };
          },
        }),
      });
      await expect(runProspectAudit(HOME, {}, d)).rejects.toThrow(/PROSPECT_LLM_AUTH/);
      // Without the early check this typo produced a complete-looking report
      // whose analyze/probes sections carried the config error — and could be
      // emailed. A misconfiguration should cost nothing and publish nothing.
      expect(crawled).toBe(false);
    }));
});

describe("runProspectAudit — the fix list is checked against the checklist", () => {
  /** Capture what the analyze stage was actually shown. */
  function spyDeps(fixes: unknown[]) {
    let seen: { system: string; user: string } | null = null;
    return {
      deps: {
        ...deps(),
        analyze: {
          run: async (input: { system: string; user: string }) => {
            seen = input;
            return { ...analyzeOutput, fixes };
          },
        },
      },
      prompt: () => seen,
    };
  }

  it("shows the model what we already measured, when the operator set the goal", async () => {
    const { deps: d, prompt } = spyDeps([]);
    await runProspectAudit(HOME, { goal: "enquire" }, d);
    const user = prompt()!.user;
    expect(user).toContain("What we have already measured");
    expect(user).toContain("price-signal");
    expect(user).toContain("ALREADY DONE");
  });

  it("drops a fix for something the checklist says is already done", async () => {
    // The failure this prevents: the goal section prints "Yes — a phone number
    // they can tap" and the fix list, three sections later, says to add one.
    // The shared fixture has no tel: link, so this test serves one that does —
    // the point is a requirement that genuinely measures as met, not a stub.
    const withPhone = fixture("rich.html").replace(
      "</body>",
      '<a href="tel:+12085551234">Call us</a></body>',
    );
    const { deps: d } = spyDeps([
      {
        title: "Make the phone number tappable",
        why: "w",
        impact: "high",
        effort: "low",
        tier: "technical",
        addresses: "tappable-phone",
      },
      {
        title: "Compress the hero image",
        why: "w",
        impact: "medium",
        effort: "low",
        tier: "technical",
        addresses: null,
      },
    ]);
    const result = await runProspectAudit(
      HOME,
      { goal: "enquire" },
      {
        ...d,
        crawl: crawlDeps({
          async fetchUrl(url) {
            return url === HOME || url.endsWith("/services") || url.endsWith("/about")
              ? { status: 200, body: withPhone, headers: {} }
              : { status: 404, body: "", headers: {} };
          },
          async renderPages(urls) {
            return new Map(urls.map((u) => [u, withPhone]));
          },
        }),
      },
    );
    const gf = result.goalFit;
    if (!gf?.ok) throw new Error("the goal check did not run");
    const met = gf.data.requirements
      .filter((r: GoalRequirement) => r.status === "met")
      .map((r: GoalRequirement) => r.key);
    expect(met, "the fixture site really does have a tappable phone").toContain("tappable-phone");
    const an = result.analyze;
    if (!an?.ok) throw new Error("the analyze stage did not run");
    expect(an.data.fixes.map((f) => f.title)).toEqual(["Compress the hero image"]);
  });

  it("tells the model nothing about the checklist when no goal was given", async () => {
    // We do not know which checklist applies yet, and inventing one would grade
    // the site against our own guess before the model has even read it.
    const { deps: d, prompt } = spyDeps([]);
    await runProspectAudit(HOME, {}, d);
    expect(prompt()!.user).not.toContain("What we have already measured");
  });
});
