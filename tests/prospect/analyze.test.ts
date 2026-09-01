import { describe, it, expect } from "vitest";
import { analyzeSite, buildAnalyzeInput, AnalyzeSchema } from "../../src/prospect/analyze.js";
import { runChecks } from "../../src/prospect/checks.js";
import { extractPage } from "../../src/prospect/extract.js";
import type { CrawlResult, PageCapture } from "../../src/prospect/types.js";

function page(url: string, html: string): PageCapture {
  return { url, status: 200, raw: extractPage(html), rendered: extractPage(html), error: null };
}

const html = (title: string, body: string): string =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;

function crawl(pageCount = 1): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: "User-agent: GPTBot\nDisallow: /",
    agentAccess: [
      { agent: "GPTBot", allowed: false, matchedRule: "User-agent: GPTBot → Disallow: /" },
      { agent: "ClaudeBot", allowed: true, matchedRule: null },
    ],
    sitemap: { present: true, urlCount: pageCount },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: Array.from({ length: pageCount }, (_, i) =>
      page(`https://acme.example/p${i}`, html(`Page ${i}`, `Body copy number ${i}.`)),
    ),
  };
}

// Exactly 6 — the schema's floor. Doubles as the fixture for the "valid output"
// tests and as the source for the min/max boundary tests below (.slice(0, 3) for
// the reject case, the full array for the accept-at-exactly-6 case).
const validOutput = {
  businessName: "Acme Roofing",
  business: "Acme Roofing — commercial roofing in Boise, Idaho",
  entityClarity: { score: 72, missing: ["service area"] },
  categoryQueries: [
    "commercial roofing contractor Boise",
    "how much does a commercial roof replacement cost",
    "flat roof repair Idaho",
  ],
  buyerQuestions: [
    {
      question: "What does a roof repair cost?",
      answered: "partial" as const,
      quotable: false,
      page: "https://acme.example/p0",
      evidence: "Most repairs run between $1,200 and $8,000",
    },
    {
      question: "Do you work on commercial buildings or just residential?",
      answered: "yes" as const,
      quotable: true,
      page: "https://acme.example/p0",
      evidence: "Commercial roofing in Boise, Idaho",
    },
    {
      question: "What areas do you service?",
      answered: "no" as const,
      quotable: false,
      page: null,
      evidence: null,
    },
    {
      question: "Are you licensed and insured?",
      answered: "no" as const,
      quotable: false,
      page: null,
      evidence: null,
    },
    {
      question: "Do you offer emergency repairs?",
      answered: "partial" as const,
      quotable: false,
      page: "https://acme.example/p0",
      evidence: "Call us for urgent issues",
    },
    {
      question: "What roofing materials do you install?",
      answered: "no" as const,
      quotable: false,
      page: null,
      evidence: null,
    },
  ],
  fixes: [
    {
      title: "Unblock GPTBot",
      why: "robots.txt blocks it site-wide",
      impact: "high" as const,
      effort: "low" as const,
      tier: "crawl" as const,
    },
  ],
  narrative: { findability: "…", readability: "…", answers: "…" },
};

/** N schema-shaped buyer questions with no page/evidence attached — for the
 *  min/max boundary tests, where the count is what's under test, not the
 *  content. */
function makeQuestions(n: number): (typeof validOutput)["buyerQuestions"] {
  return Array.from({ length: n }, (_, i) => ({
    question: `Question ${i}?`,
    answered: "no" as const,
    quotable: false,
    page: null,
    evidence: null,
  }));
}

describe("buildAnalyzeInput", () => {
  it("puts the deterministic findings and each page's content in the prompt", () => {
    const c = crawl();
    const { system, user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(system).toContain("answer engine");
    expect(user).toContain("https://acme.example/p0");
    expect(user).toContain("Page 0");
    expect(user).toContain("Body copy number 0.");
    expect(user).toContain("GPTBot");
  });

  it("caps the page budget and the per-page text", () => {
    const c = crawl(20);
    c.pages[0]!.rendered!.text = "x".repeat(5000);
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).toContain("https://acme.example/p11");
    expect(user).not.toContain("https://acme.example/p12");
    expect(user).not.toContain("x".repeat(2000));
  });

  it("never ships raw HTML to the model", () => {
    const c = crawl();
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).not.toContain("<html>");
    expect(user).not.toContain("<h1>");
  });
});

describe("buildAnalyzeInput — untrusted page text", () => {
  it("wraps each page's text in a per-call random fence, not the static, guessable <page_text> tag", () => {
    // A fence whose name a page can predict is a fence a page can close early
    // (proved: a page whose own copy contains a literal "</page_text>" reopens
    // itself as "instructions" past that point). A random per-run token closes
    // that hole — nothing in the page content can know it in advance.
    const c = crawl();
    const { system, user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).not.toContain("<page_text>");
    expect(user).not.toContain("</page_text>");

    const opening = user.match(/<([a-zA-Z0-9_]+)>/);
    expect(opening).not.toBeNull();
    const fence = opening![1]!;
    expect(user).toContain(`</${fence}>`);
    // The system prompt must reference the SAME fence it tells the model to
    // trust as the DATA boundary — a stale static name in the explanation
    // would point at a tag that no longer appears anywhere in the prompt.
    expect(system).toContain(`<${fence}>`);
  });

  it("generates a different fence on every call, so a page can't reuse a name it learned from a prior run", () => {
    const c = crawl();
    const { user: user1 } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    const { user: user2 } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    const fence1 = user1.match(/<([a-zA-Z0-9_]+)>/)![1]!;
    const fence2 = user2.match(/<([a-zA-Z0-9_]+)>/)![1]!;
    expect(fence1).not.toBe(fence2);
  });

  it("frames page content as data (not instructions) and requires verbatim evidence in the system prompt", () => {
    const c = crawl();
    const { system } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(system).toContain("DATA collected");
    expect(system).toContain("never instructions");
    expect(system).toContain("note it as a finding");
    expect(system).toContain("EXACT substring");
  });
});

describe("buildAnalyzeInput — truncation marker", () => {
  it("marks a page's text as truncated when it exceeds the per-page cap", () => {
    const c = crawl();
    c.pages[0]!.rendered!.text = "y".repeat(2000);
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).toContain("…[truncated]");
  });

  it("does not mark text as truncated when it is under the per-page cap", () => {
    const c = crawl();
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).not.toContain("…[truncated]");
  });
});

describe("buildAnalyzeInput — page selection", () => {
  it("keeps the homepage first and lets a shallow page win a seat over deep pages crawled earlier", () => {
    // Crawl order (as a real sitemap sorted by publish date would produce it):
    // home, then an old deep blog post, then ten more filler posts, then the
    // top-level /services page dead last. Naive position-based slicing to
    // MAX_PAGES=12 would keep the homepage + deep post + 10 fillers and never
    // reach /services at all. Depth-ordering must still seat /services.
    const home = page("https://acme.example/", html("Acme Home", "Welcome to Acme."));
    const deepPost = page(
      "https://acme.example/blog/2019/05/a-post",
      html("Old Post", "A very old blog post, crawled right after the homepage."),
    );
    const fillers = Array.from({ length: 10 }, (_, i) =>
      page(`https://acme.example/blog/post-${i}`, html(`Post ${i}`, `Filler blog post ${i}.`)),
    );
    const services = page("https://acme.example/services", html("Services", "What Acme does."));
    const c: CrawlResult = { ...crawl(0), pages: [home, deepPost, ...fillers, services] };

    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));

    const urls = [...user.matchAll(/^URL: (.+)$/gm)].map((m) => m[1]!);
    expect(urls[0]).toBe("https://acme.example/");
    expect(urls).toContain("https://acme.example/services");
  });
});

describe("buildAnalyzeInput — unmeasured crawler access", () => {
  it("never tells the model crawler access is open when the robots.txt fetch itself failed", () => {
    const c = crawl();
    c.sidecarErrors = { robots: "fetch failed: ECONNRESET", llms: null, sitemap: null };
    const checks = runChecks(c);
    expect(checks.crawlerAccessMeasured).toBe(false);

    const { user } = buildAnalyzeInput("https://acme.example/", c, checks);

    // The bug this guards against: crawlerAccessMeasured correctly gates
    // computeScores, but summarizeFindings used to read the (empty,
    // out-of-ignorance) crawlerAccess lists directly and print "none" — a
    // positive claim about the prospect's site we never actually checked.
    expect(user).not.toContain("Blocked AI crawlers: none");
    expect(user).not.toContain("Blocked classical crawlers: none");
    expect(user).toMatch(/Blocked AI crawlers:.*not measured/i);
    expect(user).toMatch(/Blocked classical crawlers:.*not measured/i);
  });

  it("still reports the real blocked-crawler lists when the fetch succeeded", () => {
    const c = crawl();
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).toContain("Blocked AI crawlers: GPTBot");
  });
});

describe("buildAnalyzeInput — unmeasured sidecars", () => {
  it("distinguishes an unmeasured sitemap from a confirmed absence", () => {
    const c = crawl();
    c.sidecarErrors = {
      robots: null,
      llms: "fetch failed: ETIMEDOUT",
      sitemap: "fetch failed: ENOTFOUND",
    };
    const checks = runChecks(c);
    expect(checks.sitemapMeasured).toBe(false);

    const { user } = buildAnalyzeInput("https://acme.example/", c, checks);
    expect(user).not.toContain("sitemap.xml: missing");
    expect(user).toMatch(/sitemap\.xml: not measured/i);
  });

  it("still reports present/missing for a sidecar that WAS measured", () => {
    const c = crawl();
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).toMatch(/sitemap\.xml: present/);
  });

  // llms.txt reaches the model in NO form — not "present", not "missing", not
  // "not measured". A model handed a file described as missing proposes adding
  // it, and that recommendation is the exact thing removing it from the score
  // was meant to stop. Dropping it from the score while leaving it in the
  // prompt would have changed the grade and kept the advice.
  it("never mentions llms.txt to the model, in any state", () => {
    const present = crawl();
    present.llmsTxt = { present: true, firstLine: "# Acme" };
    const absent = crawl();
    const unmeasured = crawl();
    unmeasured.sidecarErrors = { robots: null, llms: "fetch failed: ETIMEDOUT", sitemap: null };

    for (const c of [present, absent, unmeasured]) {
      const { user, system } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
      expect(user.toLowerCase()).not.toContain("llms");
      expect(system.toLowerCase()).not.toContain("llms");
    }
  });
});

describe("analyzeSite", () => {
  it("returns the validated model output", async () => {
    const result = await analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
      run: async () => validOutput,
    });
    expect(result.business).toContain("Acme Roofing");
    // The fixture's first question is `partial` citing a price range that does
    // not appear on the crawled page. Evidence verification nulls the quote,
    // and an unsupported positive verdict is then downgraded — so `no`, not
    // `partial`. This assertion used to read `partial`, which was the bug: a
    // verdict survived the evidence that justified it being thrown away.
    expect(result.buyerQuestions[0]!.evidence).toBeNull();
    expect(result.buyerQuestions[0]!.answered).toBe("no");
  });

  it("rejects output that does not match the schema", async () => {
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => ({ ...validOutput, buyerQuestions: [{ question: "q" }] }),
      }),
    ).rejects.toThrow();
  });

  it("propagates a model failure so the stage degrades", async () => {
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => {
          throw new Error("529 overloaded");
        },
      }),
    ).rejects.toThrow(/529/);
  });

  it("exports a schema that accepts the documented shape", () => {
    expect(() => AnalyzeSchema.parse(validOutput)).not.toThrow();
  });

  it("rejects a model response with fewer than 6 buyer questions", async () => {
    const thin = { ...validOutput, buyerQuestions: validOutput.buyerQuestions.slice(0, 3) };
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => thin,
      }),
    ).rejects.toThrow();
  });

  it("accepts a model response with exactly 6 buyer questions", async () => {
    const result = await analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
      run: async () => validOutput,
    });
    expect(result.buyerQuestions).toHaveLength(6);
  });

  // categoryQueries is what the probe stage searches on. An empty or thin array
  // does not fail that stage loudly — it silently drops the category probes to
  // one or none and the visibility score reads 0, which is indistinguishable
  // from a prospect who genuinely never surfaces. It has to fail here instead.
  it("rejects a model response with fewer than 3 category queries", async () => {
    const thin = { ...validOutput, categoryQueries: validOutput.categoryQueries.slice(0, 2) };
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => thin,
      }),
    ).rejects.toThrow();
  });

  it("rejects a model response with more than 5 category queries", async () => {
    const tooMany = {
      ...validOutput,
      categoryQueries: Array.from({ length: 6 }, (_, i) => `q${i}`),
    };
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => tooMany,
      }),
    ).rejects.toThrow();
  });

  it("carries the category queries through to the result for the probe stage", async () => {
    const result = await analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
      run: async () => validOutput,
    });
    expect(result.categoryQueries).toEqual(validOutput.categoryQueries);
  });

  it("rejects an entityClarity.score outside 0-100", async () => {
    const bad = { ...validOutput, entityClarity: { score: 140, missing: [] } };
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => bad,
      }),
    ).rejects.toThrow();
  });

  it("rejects a model response with 11 buyer questions", async () => {
    const eleven = { ...validOutput, buyerQuestions: makeQuestions(11) };
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => eleven,
      }),
    ).rejects.toThrow();
  });

  it("accepts a model response with exactly 10 buyer questions", async () => {
    const ten = { ...validOutput, buyerQuestions: makeQuestions(10) };
    const result = await analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
      run: async () => ten,
    });
    expect(result.buyerQuestions).toHaveLength(10);
  });

  it("rejects a model response with 11 fixes", async () => {
    const tooManyFixes = {
      ...validOutput,
      fixes: Array.from({ length: 11 }, (_, i) => ({
        ...validOutput.fixes[0]!,
        title: `Fix ${i}`,
      })),
    };
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => tooManyFixes,
      }),
    ).rejects.toThrow();
  });
});

describe("analyzeSite — evidence verification", () => {
  it("keeps evidence that is a verbatim quote from the page it's attributed to", async () => {
    const c = crawl(1);
    const output = {
      ...validOutput,
      buyerQuestions: [
        {
          question: "What does the page say?",
          answered: "yes" as const,
          quotable: true,
          page: "https://acme.example/p0",
          evidence: "Body copy number 0.",
        },
        ...validOutput.buyerQuestions.slice(1),
      ],
    };
    const result = await analyzeSite("https://acme.example/", c, runChecks(c), {
      run: async () => output,
    });
    expect(result.buyerQuestions[0]!.evidence).toBe("Body copy number 0.");
    expect(result.buyerQuestions[0]!.page).toBe("https://acme.example/p0");
  });

  it("nulls out evidence that is not an actual verbatim quote from the attributed page", async () => {
    const c = crawl(1);
    const output = {
      ...validOutput,
      buyerQuestions: [
        {
          question: "What does the page say?",
          answered: "yes" as const,
          quotable: true,
          page: "https://acme.example/p0",
          evidence: "This exact sentence was never written on the page.",
        },
        ...validOutput.buyerQuestions.slice(1),
      ],
    };
    const result = await analyzeSite("https://acme.example/", c, runChecks(c), {
      run: async () => output,
    });
    expect(result.buyerQuestions[0]!.evidence).toBeNull();
    // The page citation itself was real — only the fabricated quote is
    // discarded, not the whole finding.
    expect(result.buyerQuestions[0]!.page).toBe("https://acme.example/p0");
  });

  it("nulls both page and evidence when the cited page was never actually crawled", async () => {
    const c = crawl(1);
    const output = {
      ...validOutput,
      buyerQuestions: [
        {
          question: "What does the page say?",
          answered: "yes" as const,
          quotable: true,
          page: "https://acme.example/never-crawled",
          evidence: "Body copy number 0.",
        },
        ...validOutput.buyerQuestions.slice(1),
      ],
    };
    const result = await analyzeSite("https://acme.example/", c, runChecks(c), {
      run: async () => output,
    });
    expect(result.buyerQuestions[0]!.page).toBeNull();
    expect(result.buyerQuestions[0]!.evidence).toBeNull();
  });

  it("tolerates a harmless whitespace reflow between the quote and the page text", async () => {
    const c = crawl(1);
    const output = {
      ...validOutput,
      buyerQuestions: [
        {
          question: "What does the page say?",
          answered: "yes" as const,
          quotable: true,
          page: "https://acme.example/p0",
          evidence: "Body   copy\nnumber 0.",
        },
        ...validOutput.buyerQuestions.slice(1),
      ],
    };
    const result = await analyzeSite("https://acme.example/", c, runChecks(c), {
      run: async () => output,
    });
    expect(result.buyerQuestions[0]!.evidence).toBe("Body   copy\nnumber 0.");
  });

  it("leaves an already-null evidence/page pair untouched", async () => {
    const c = crawl(1);
    const result = await analyzeSite("https://acme.example/", c, runChecks(c), {
      run: async () => validOutput,
    });
    // validOutput's 3rd/4th/6th questions carry page: null, evidence: null.
    const untouched = result.buyerQuestions.find(
      (q) => q.question === "What areas do you service?",
    );
    expect(untouched?.page).toBeNull();
    expect(untouched?.evidence).toBeNull();
  });
});

// The regression this exists for, observed in production: the same site, the
// same question, the same null evidence — graded `no` on 25 Aug and `partial`
// on 26 Aug. checks.ts weights `partial` at 0.5, so two of those moved the
// Answers score 10 points, and the report then scored pricing as answered while
// its own fix list told the prospect to publish pricing.
describe("verifyEvidence — a positive verdict must be supported", () => {
  // Typed explicitly: inferring from validOutput yields a union that narrows
  // `page` to `string`, and every case here is about a null one.
  const ask = async (over: {
    answered: "yes" | "partial" | "no";
    page: string | null;
    evidence: string | null;
  }) => {
    const c = crawl();
    const result = await analyzeSite("https://acme.example/", c, runChecks(c), {
      run: async () => ({
        ...validOutput,
        buyerQuestions: [{ ...validOutput.buyerQuestions[0]!, ...over }, ...makeQuestions(5)],
      }),
    });
    return result.buyerQuestions[0]!;
  };

  it("downgrades a `partial` with no evidence to `no`", async () => {
    const q = await ask({ answered: "partial", page: null, evidence: null });
    expect(q.answered).toBe("no");
  });

  it("downgrades a `yes` with no evidence to `no`", async () => {
    const q = await ask({ answered: "yes", page: null, evidence: null });
    expect(q.answered).toBe("no");
  });

  // The evidence was nulled out because it wasn't a real quote — so the verdict
  // it was supporting has to go too, or the fabrication just moves.
  it("downgrades when the evidence is dropped for not being a verbatim quote", async () => {
    const q = await ask({
      answered: "yes",
      page: "https://acme.example/p0",
      evidence: "a sentence that appears nowhere on the page",
    });
    expect(q.evidence).toBeNull();
    expect(q.answered).toBe("no");
  });

  it("downgrades when the cited page was never crawled", async () => {
    const q = await ask({
      answered: "partial",
      page: "https://acme.example/never-crawled",
      evidence: "Body copy number 0.",
    });
    expect(q.answered).toBe("no");
  });

  it("leaves a genuinely supported verdict alone", async () => {
    const q = await ask({
      answered: "yes",
      page: "https://acme.example/p0",
      evidence: "Body copy number 0.",
    });
    expect(q.answered).toBe("yes");
    expect(q.evidence).toBe("Body copy number 0.");
  });

  // The question stays in the table — it just stops scoring. Dropping it would
  // hide a gap the prospect should see.
  it("keeps the question visible rather than removing it", async () => {
    const q = await ask({ answered: "yes", page: null, evidence: null });
    expect(q.question).toBe(validOutput.buyerQuestions[0]!.question);
  });

  it("leaves an already-`no` verdict untouched", async () => {
    const q = await ask({ answered: "no", page: null, evidence: null });
    expect(q.answered).toBe("no");
  });
});
