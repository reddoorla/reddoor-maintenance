import { describe, it, expect } from "vitest";
import {
  analyzeSite,
  buildAnalyzeInput,
  AnalyzeSchema,
  KEY_TERMS,
} from "../../src/prospect/analyze.js";
import { ALL_GOALS, questionSetFor } from "../../src/prospect/questions.js";
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
  // Answers to the universal set (questions.ts), by id — analyzeSite defaults
  // to the "unknown" goal, whose set is exactly these six. The model no longer
  // supplies the wording; `conformToSet` fills it in from the set.
  buyerQuestions: [
    {
      id: "cost",
      answered: "partial" as const,
      quotable: false,
      page: "https://acme.example/p0",
      evidence: "Most repairs run between $1,200 and $8,000",
    },
    {
      id: "who-for",
      answered: "yes" as const,
      quotable: true,
      page: "https://acme.example/p0",
      evidence: "Commercial roofing in Boise, Idaho",
    },
    { id: "proof", answered: "no" as const, quotable: false, page: null, evidence: null },
    { id: "who-does-it", answered: "no" as const, quotable: false, page: null, evidence: null },
    { id: "where", answered: "no" as const, quotable: false, page: null, evidence: null },
    { id: "next-step", answered: "no" as const, quotable: false, page: null, evidence: null },
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

describe("buildAnalyzeInput", () => {
  it("puts the deterministic findings and each page's content in the prompt", () => {
    const c = crawl();
    const { system, user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
    expect(system).toContain("answer engine");
    expect(user).toContain("https://acme.example/p0");
    expect(user).toContain("Page 0");
    expect(user).toContain("Body copy number 0.");
    expect(user).toContain("GPTBot");
  });

  it("caps the page budget and the per-page text", () => {
    const c = crawl(20);
    c.pages[0]!.rendered!.text = "x".repeat(5000);
    const { user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
    expect(user).toContain("https://acme.example/p11");
    expect(user).not.toContain("https://acme.example/p12");
    expect(user).not.toContain("x".repeat(2000));
  });

  it("never ships raw HTML to the model", () => {
    const c = crawl();
    const { user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
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
    const { system, user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
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
    const { user: user1 } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
    const { user: user2 } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
    const fence1 = user1.match(/<([a-zA-Z0-9_]+)>/)![1]!;
    const fence2 = user2.match(/<([a-zA-Z0-9_]+)>/)![1]!;
    expect(fence1).not.toBe(fence2);
  });

  it("frames page content as data (not instructions) and requires verbatim evidence in the system prompt", () => {
    const c = crawl();
    const { system } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
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
    const { user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
    expect(user).toContain("…[truncated]");
  });

  it("does not mark text as truncated when it is under the per-page cap", () => {
    const c = crawl();
    const { user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
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

    const { user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );

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

    const { user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      checks,
      questionSetFor("unknown"),
    );

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
    const { user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
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

    const { user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      checks,
      questionSetFor("unknown"),
    );
    expect(user).not.toContain("sitemap.xml: missing");
    expect(user).toMatch(/sitemap\.xml: not measured/i);
  });

  it("still reports present/missing for a sidecar that WAS measured", () => {
    const c = crawl();
    const { user } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      runChecks(c),
      questionSetFor("unknown"),
    );
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
      const { user, system } = buildAnalyzeInput(
        "https://acme.example/",
        c,
        runChecks(c),
        questionSetFor("unknown"),
      );
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
    // and an unsupported positive verdict is then downgraded. This assertion
    // first read `partial` (a verdict survived the evidence that justified it
    // being thrown away), then `no`, which printed "your site does not answer
    // this" about a question the model said it did answer (W3, B-04). It is
    // `unknown` now: out of the score, and never an absence.
    expect(result.buyerQuestions[0]!.evidence).toBeNull();
    expect(result.buyerQuestions[0]!.answered).toBe("unknown");
  });

  it("rejects output that does not match the schema", async () => {
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => ({ ...validOutput, buyerQuestions: [{ id: "cost" }] }),
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
          id: "cost",
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
          id: "cost",
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
          id: "cost",
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
          id: "cost",
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
    const untouched = result.buyerQuestions.find((q) => q.id === "proof");
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
        buyerQuestions: [
          { ...validOutput.buyerQuestions[0]!, ...over },
          ...validOutput.buyerQuestions.slice(1),
        ],
      }),
    });
    return result.buyerQuestions[0]!;
  };

  // W3: these four read `no` until the audit-system review. A verdict we cannot
  // confirm is our gap, so it is `unknown`; `no` printed it as their absence.
  it("downgrades a `partial` with no evidence to `unknown`", async () => {
    const q = await ask({ answered: "partial", page: null, evidence: null });
    expect(q.answered).toBe("unknown");
  });

  it("downgrades a `yes` with no evidence to `unknown`", async () => {
    const q = await ask({ answered: "yes", page: null, evidence: null });
    expect(q.answered).toBe("unknown");
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
    expect(q.answered).toBe("unknown");
  });

  it("downgrades when the cited page was never crawled", async () => {
    const q = await ask({
      answered: "partial",
      page: "https://acme.example/never-crawled",
      evidence: "Body copy number 0.",
    });
    expect(q.answered).toBe("unknown");
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
    // The wording is ours now, so it is checked against the set, not the fixture.
    expect(q.question).toBe(questionSetFor("unknown").questions[0]!.question);
  });

  it("leaves an already-`no` verdict untouched", async () => {
    const q = await ask({ answered: "no", page: null, evidence: null });
    expect(q.answered).toBe("no");
  });
});

describe("fix rationales may not promise engine outcomes", () => {
  // Three of ten model fixes on a real run argued "nothing to cite" or "cannot
  // be cited", four screens after the report said nothing on the site reliably
  // moves what an engine cites. The prompt now says so in the fixes rule.
  it("the prompt forbids predicting what an engine will cite, repeat, rank or recommend", async () => {
    const c = crawl(1);
    const { system } = buildAnalyzeInput(
      "https://acme.example/",
      c,
      await runChecks(c),
      questionSetFor("enquire"),
    );
    expect(system).toMatch(
      /Never predict\s+what an answer engine will cite, repeat, rank or recommend/,
    );
  });
});

// W3, from the audit-system review (B-04): a `no` is the commonest headline and
// the one claim with no receipt. Before it stands, the question's key words are
// looked for in everything we crawled; a hit makes it `unknown`, naming the
// word and the page, so the report can say what it did not find, and where it
// looked, instead of asserting an absence.
describe("checkAbsence — a `no` is checked against everything we crawled", () => {
  const withPages = (texts: string[]): CrawlResult => ({
    ...crawl(0),
    pages: texts.map((t, i) => page(`https://acme.example/q${i}`, html(`Page ${i}`, t))),
  });
  const askNo = async (c: CrawlResult, id = "cost") =>
    (
      await analyzeSite("https://acme.example/", c, runChecks(c), {
        run: async () => ({
          ...validOutput,
          buyerQuestions: validOutput.buyerQuestions.map((q) =>
            q.id === id ? { ...q, answered: "no" as const, page: null, evidence: null } : q,
          ),
        }),
      })
    ).buyerQuestions.find((q) => q.id === id)!;

  it("makes a `no` unknown when the question's words are on a crawled page the model did not read, and names them", async () => {
    // W3 review round 1: only text past what the model was shown can overturn
    // its `no`, so the term sits past the 1,500 characters of page q1 that
    // were sent. The assertion is the one it always was.
    const after = `${"Filler sentence. ".repeat(120)}Our pricing starts with a free call.`;
    const q = await askNo(withPages(["Welcome.", after]));
    expect(q.answered).toBe("unknown");
    expect(q.notFound).toEqual({ term: "pricing", page: "https://acme.example/q1" });
  });

  it("leaves a `no` standing when the term is inside the text the model read (W3 review round 1)", async () => {
    const q = await askNo(withPages(["Welcome.", "Our pricing starts with a free call."]));
    expect(q.answered).toBe("no");
    expect(q.notFound).toBeUndefined();
  });

  it("leaves a `no` standing when only footer boilerplate matches (W3 review round 1)", async () => {
    // Words that every footer and form carries, past the window the model read.
    // None is a phrase the question's answer would use, so none may flip it.
    const footer = `${"Filler sentence. ".repeat(120)}Terms apply. Our address is listed. Reviews from our staff and owner. Cash welcome. Open hours on the sign. Free quote form. We'll get back to you.`;
    const q = await askNo(withPages([footer]), "where");
    expect(q.answered).toBe("no");
    expect(q.notFound).toBeUndefined();
    const who = await askNo(withPages([footer]), "who-does-it");
    expect(who.answered).toBe("no");
  });

  it("a chosen question needs two different words to flip a `no` (W3 review round 1)", async () => {
    // "Do you assemble your trellises in-house?" has the words assemble, trellises, house.
    const chosenNo = (c: CrawlResult) =>
      analyzeSite(
        "https://acme.example/",
        c,
        runChecks(c),
        {
          run: async () => ({
            ...validOutput,
            buyerQuestions: validOutput.buyerQuestions.map((q, i) =>
              i === 0
                ? { ...q, id: "chosen-1", answered: "no" as const, page: null, evidence: null }
                : q,
            ),
          }),
        },
        "unknown",
        null,
        { questions: ["Do you assemble your trellises in-house?"] },
      );
    const after = (text: string) => `${"Filler sentence. ".repeat(120)}${text}`;

    const one = await chosenNo(withPages(["Welcome.", after("Tenant house rules apply.")]));
    const oneQ = one.buyerQuestions.find((q) => q.id === "chosen-1")!;
    expect(oneQ.answered).toBe("no");
    expect(oneQ.notFound).toBeUndefined();

    const two = await chosenNo(withPages(["Welcome.", after("We assemble trellises here.")]));
    const twoQ = two.buyerQuestions.find((q) => q.id === "chosen-1")!;
    expect(twoQ.answered).toBe("unknown");
    expect(twoQ.notFound?.page).toBe("https://acme.example/q1");
  });

  it("flips a `no` on a page the model was never sent (W3 review round 1)", async () => {
    // Twelve pages go to the model; the thirteenth is not sent, so its text is
    // unseen and may overturn the `no`.
    const pages = Array.from({ length: 12 }, () => "Welcome.");
    pages.push("Our fees are listed below.");
    const q = await askNo(withPages(pages));
    expect(q.answered).toBe("unknown");
    expect(q.notFound).toEqual({ term: "fees", page: "https://acme.example/q12" });
  });

  it("leaves a `no` standing when none of the words is anywhere we read", async () => {
    const q = await askNo(withPages(["Welcome.", "We roof buildings."]));
    expect(q.answered).toBe("no");
    expect(q.notFound).toBeUndefined();
  });

  it("finds words past the 1,500 characters the model was shown", async () => {
    const long = `${"Filler sentence. ".repeat(120)}Our fees are listed below.`;
    expect(long.indexOf("fees")).toBeGreaterThan(1500);
    const q = await askNo(withPages([long]));
    expect(q.answered).toBe("unknown");
    expect(q.notFound?.term).toBe("fees");
  });
});

// W3 review round 2. Boilerplate and bare words must not flip a `no`.
describe("checkAbsence — boilerplate and bare words (W3 review round 2)", () => {
  const withPages = (texts: string[]): CrawlResult => ({
    ...crawl(0),
    pages: texts.map((t, i) => page(`https://acme.example/q${i}`, html(`Page ${i}`, t))),
  });
  const askNo = async (c: CrawlResult, id: string) =>
    (
      await analyzeSite("https://acme.example/", c, runChecks(c), {
        run: async () => ({
          ...validOutput,
          buyerQuestions: validOutput.buyerQuestions.map((q) =>
            q.id === id ? { ...q, answered: "no" as const, page: null, evidence: null } : q,
          ),
        }),
      })
    ).buyerQuestions.find((q) => q.id === id)!;
  const filler = "Filler sentence. ".repeat(120);

  it("MAJOR (6): a footer repeated on every page, with only genuine boilerplate, leaves a `no` standing", async () => {
    // The footer sits past the window the model read, on both pages. It is
    // genuine non-answering boilerplate: nothing in it is a who-for phrase.
    const footer = "Privacy policy · Cookie settings · © 2026 Example Co · Follow us";
    const q = await askNo(
      withPages([`${filler}Welcome. ${footer}`, `${filler}Our studio. ${footer}`]),
      "who-for",
    );
    expect(q.answered).toBe("no");
    expect(q.notFound).toBeUndefined();
  });

  it("MAJOR (6, round 3): a price repeated in the same footer on two pages past the window flips a `no` to unknown", async () => {
    // Removing repeated runs hid this: the same sentence on two pages is
    // exactly the text past the model's window that the check must search.
    const price = "Starter plan costs $49 per month and Growth plan costs $99 per month.";
    const q = await askNo(
      withPages([`${filler}Welcome. ${price}`, `${filler}Our studio. ${price}`]),
      "cost",
    );
    expect(q.answered).toBe("unknown");
    expect(q.notFound?.page).toBe("https://acme.example/q0");
  });

  it("MAJOR (6, round 3): a who-for footer repeated on three pages past the window flips a `no` to unknown", async () => {
    const footer = "We serve dental practices across the county.";
    const q = await askNo(
      withPages([
        `${filler}Welcome. ${footer}`,
        `${filler}Our studio. ${footer}`,
        `${filler}Contact. ${footer}`,
      ]),
      "who-for",
    );
    expect(q.answered).toBe("unknown");
    expect(q.notFound).toEqual({ term: "We serve", page: "https://acme.example/q0" });
  });

  it("MAJOR (6): a bare footer word such as Industries no longer flips a `no`", async () => {
    const q = await askNo(
      withPages([`${filler}Welcome. Industries Accredited 24/7 Directions`]),
      "who-for",
    );
    expect(q.answered).toBe("no");
    expect(q.notFound).toBeUndefined();
  });

  it("MAJOR (6) control: the same phrase on one page's body, past the window, still flips the `no`", async () => {
    const q = await askNo(
      withPages([`${filler}Welcome.`, `${filler}We work with Leeds businesses.`]),
      "who-for",
    );
    expect(q.answered).toBe("unknown");
    expect(q.notFound).toEqual({ term: "We work with", page: "https://acme.example/q1" });
  });
});

// W3 review round 4, finding 1. A key term must be a phrase an answer would use:
// a bare word is on pages that do not answer the question, and a hit past the
// model's window then flips a real `no`.
describe("checkAbsence — key terms are phrases, not bare words (W3 review round 4)", () => {
  const withPages = (texts: string[]): CrawlResult => ({
    ...crawl(0),
    pages: texts.map((t, i) => page(`https://acme.example/q${i}`, html(`Page ${i}`, t))),
  });
  const askNo = async (c: CrawlResult, id: string) => {
    const goal = ALL_GOALS.find((g) => questionSetFor(g).questions.some((q) => q.id === id))!;
    const set = questionSetFor(goal);
    return (
      await analyzeSite(
        "https://acme.example/",
        c,
        runChecks(c),
        {
          run: async () => ({
            ...validOutput,
            buyerQuestions: set.questions.map((q) => ({
              id: q.id,
              answered: "no" as const,
              quotable: false,
              page: null,
              evidence: null,
            })),
          }),
        },
        goal,
      )
    ).buyerQuestions.find((q) => q.id === id)!;
  };
  const filler = "Filler sentence. ".repeat(120);

  it("no key term matches a single bare word", () => {
    const bare = [
      "bring",
      "demo",
      "markets",
      "stage",
      "stages",
      "phases",
      "payment",
      "delivery",
      "accessible",
      "API",
      "tour",
      "tours",
      "regions",
      "exclusive",
      "discounts",
      "margins",
      "commissions",
      "training",
      "minimum",
      "facility",
      "amenities",
      "showroom",
      "bus",
      "parking",
      "transit",
      "insurance",
      "availability",
      "inventory",
      "compliance",
      "compliant",
      "hipaa",
      "rates",
      "fees",
      "pricing",
      "testimonials",
      "returns",
      "refunds",
      "shipping",
      "ships",
      "visa",
      "paypal",
      "elevator",
      "wheelchair",
      "ada",
      "urgent",
      "emergency",
      "timeline",
      "turnaround",
      "discovery",
      "walkthrough",
      "integration",
      "waitlist",
      "territory",
      "complimentary",
      "encrypted",
      "headquarters",
      "metro",
      "subway",
    ];
    for (const [id, re] of Object.entries(KEY_TERMS)) {
      for (const word of bare) {
        expect(re.test(word), `${id} matched the bare word "${word}"`).toBe(false);
      }
    }
  });

  it.each([
    ["my-input", "We bring twenty years of joinery know-how to every job."],
    ["demo-content", "Book a demo."],
    ["territory", "We are growing into new markets next year."],
    ["process", "We move through every stage with you."],
    ["payment", "Secure payment portal login is on the account page."],
    ["shipping", "Fast delivery of great service to every door."],
    ["accessibility", "Our team is accessible by phone all week."],
    ["integration", "Read our API docs for the full reference."],
    ["what-on-site", "Take a virtual tour from your sofa."],
  ])(
    "a bare word in a sentence on a page past the window does not flip a `no` (%s)",
    async (id, sentence) => {
      const q = await askNo(withPages([`${filler}${sentence}`]), id);
      expect(q.answered).toBe("no");
      expect(q.notFound).toBeUndefined();
    },
  );

  it.each([
    ["payment", "We accept insurance from most carriers."],
    ["shipping", "Shipping is free on every order."],
    ["getting-there", "Free parking is behind the building."],
    ["minimum", "Our minimum order is ten units."],
  ])(
    "a phrase an answer would use still flips a `no` past the window (%s)",
    async (id, sentence) => {
      const q = await askNo(withPages([`${filler}${sentence}`]), id);
      expect(q.answered).toBe("unknown");
      expect(q.notFound?.page).toBe("https://acme.example/q0");
    },
  );
});

// W3 review round 4, finding 2. Navigation text the model was sent is not
// evidence of anything unseen: a hit whose surroundings the model read is discarded.
describe("checkAbsence — text the model was sent does not overturn a `no` (W3 review round 4)", () => {
  const nav = "Home New Patients Services Contact";
  const same = (i: number, body: string) =>
    page(`https://acme.example/q${i}`, html("Acme Dental", body));
  const askFirstVisit = async (pages: PageCapture[]) => {
    const c: CrawlResult = { ...crawl(0), pages };
    const set = questionSetFor("book");
    return (
      await analyzeSite(
        "https://acme.example/",
        c,
        runChecks(c),
        {
          run: async () => ({
            ...validOutput,
            buyerQuestions: set.questions.map((q) => ({
              id: q.id,
              answered: "no" as const,
              quotable: false,
              page: null,
              evidence: null,
            })),
          }),
        },
        "book",
      )
    ).buyerQuestions.find((q) => q.id === "first-visit")!;
  };
  const filler = "Filler sentence. ".repeat(120);

  it("the same navigation on 13 pages, one of them not sent, leaves a `no` standing", async () => {
    const pages = Array.from({ length: 13 }, (_, i) => same(i, `${nav}. Welcome.`));
    const q = await askFirstVisit(pages);
    expect(q.answered).toBe("no");
    expect(q.notFound).toBeUndefined();
  });

  it("a hit whose surroundings the model was not sent still flips a `no`", async () => {
    const pages = Array.from({ length: 12 }, (_, i) => same(i, `${nav}. Welcome.`));
    pages.push(same(12, `${filler}Home New patients: our intake is online.`));
    const q = await askFirstVisit(pages);
    expect(q.answered).toBe("unknown");
    expect(q.notFound).toEqual({ term: "New patients", page: "https://acme.example/q12" });
  });
});
