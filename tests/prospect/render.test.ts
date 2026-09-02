import { describe, it, expect } from "vitest";
import { renderProspectReport } from "../../src/prospect/render.js";
import { PROBES_SKIPPED, ANALYZE_SKIPPED } from "../../src/prospect/pipeline.js";
import type {
  AnalyzeResult,
  ChecksResult,
  CrawlResult,
  LighthouseScores,
  ProbesResult,
  ProspectAuditResult,
} from "../../src/prospect/types.js";

function crawlData(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: "User-agent: GPTBot\nDisallow: /",
    agentAccess: [
      { agent: "GPTBot", allowed: false, matchedRule: "User-agent: GPTBot → Disallow: /" },
    ],
    sitemap: { present: true, urlCount: 12 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: [],
    ...over,
  };
}

function checksData(over: Partial<ChecksResult> = {}): ChecksResult {
  return {
    crawlerAccessMeasured: true,
    crawlerAccess: { blockedAi: ["GPTBot"], allowedAi: ["ClaudeBot"], blockedClassical: [] },
    jsDependence: {
      avgMissing: 0.82,
      perPage: [{ url: "https://acme.example/", missing: 0.82, renderedWords: 420 }],
    },
    schema: { typesFound: ["LocalBusiness"], missingExpected: ["FAQPage"], invalidBlocks: 0 },
    meta: {
      pageCount: 4,
      missingTitle: 0,
      missingDescription: 2,
      missingCanonical: 1,
      missingSocial: 3,
      pagesWithoutExtract: 0,
    },
    headings: { pagesWithoutH1: 1, pagesWithLevelSkips: 0 },
    securityHeaders: { present: ["x-frame-options"], missing: ["content-security-policy"] },
    sitemapMeasured: true,
    sitemapPresent: true,
    llmsTxtMeasured: true,
    llmsTxtPresent: false,
    viewportOk: true,
    ...over,
  };
}

function lighthouseData(over: Partial<LighthouseScores> = {}): LighthouseScores {
  return {
    performance: 44,
    accessibility: 88,
    bestPractices: 75,
    seo: 92,
    summary: "lighthouse: 2 assertion(s) failed",
    status: "warn",
    ...over,
  };
}

function analyzeData(over: Partial<AnalyzeResult> = {}): AnalyzeResult {
  return {
    businessName: "Acme Roofing",
    business:
      "A Boise-based roofing contractor offering repair, replacement, and inspection services for residential customers.",
    entityClarity: { score: 55, missing: ["service area"] },
    categoryQueries: ["roof repair contractor Boise", "how much does a roof replacement cost"],
    buyerQuestions: [
      {
        question: "What does a repair cost?",
        answered: "partial",
        quotable: false,
        page: "https://acme.example/",
        evidence: "$1,200-$8,000",
      },
      {
        question: "Do you do flat roofs?",
        answered: "no",
        quotable: false,
        page: null,
        evidence: null,
      },
    ],
    fixes: [
      {
        title: "Unblock GPTBot in robots.txt",
        why: "It cannot read a single page today.",
        impact: "high",
        effort: "low",
        tier: "crawl",
      },
      {
        title: "Add FAQ schema",
        why: "Answer engines quote FAQ blocks.",
        impact: "medium",
        effort: "medium",
        tier: "content",
      },
    ],
    narrative: {
      findability: "Two of six AI crawlers are blocked.",
      readability: "Most copy needs JavaScript.",
      answers: "Half the buyer questions go unanswered.",
    },
    ...over,
  };
}

function probesData(over: Partial<ProbesResult> = {}): ProbesResult {
  return {
    answers: [
      {
        engine: "perplexity",
        query: "who is Acme Roofing",
        kind: "branded",
        domainCited: true,
        brandMentioned: true,
        citedDomains: ["acme.example"],
        snippet: "Acme Roofing is a Boise contractor.",
        truncated: false,
        askedAt: "2026-08-25T16:00:00.000Z",
      },
      {
        engine: "perplexity",
        query: "best roofer in Boise",
        kind: "category",
        domainCited: false,
        brandMentioned: false,
        citedDomains: ["bestroofs.example"],
        snippet: "BestRoofs is frequently recommended.",
        truncated: false,
        askedAt: "2026-08-25T16:05:00.000Z",
      },
    ],
    visibilityScore: 33,
    brandedRecognized: true,
    competitorsSeen: [{ domain: "bestroofs.example", count: 4 }],
    ...over,
  };
}

function result(over: Partial<ProspectAuditResult> = {}): ProspectAuditResult {
  return {
    url: "https://acme.example/",
    businessName: "Acme Roofing",
    llmAuth: "api",
    generatedAt: "2026-08-25T17:00:00.000Z",
    scores: { findability: 62, readability: 41, answers: 50, aiVisibility: 33 },
    crawl: { ok: true, data: crawlData() },
    checks: { ok: true, data: checksData() },
    lighthouse: { ok: true, data: lighthouseData() },
    analyze: { ok: true, data: analyzeData() },
    probes: { ok: true, data: probesData() },
    ...over,
  };
}

describe("renderProspectReport", () => {
  const html = renderProspectReport(result());

  it("is a self-contained, noindex HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).not.toMatch(/<script\s+src=/);
  });

  it("names the business and the audited URL", () => {
    expect(html).toContain("Acme Roofing");
    expect(html).toContain("https://acme.example/");
  });

  it("shows the three site scores, and never an AI Visibility score card", () => {
    for (const label of ["Findability", "Readability", "Answers"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("62");
    // The fourth card was removed on purpose (mirroring the web report's
    // control split): visibility is measured and reported with receipts in
    // "What the AI engines said about you", never presented as a score that
    // reads like ours to move.
    expect(html).not.toContain("AI Visibility");
  });

  it("leads with the probe receipts", () => {
    expect(html).toContain("What the AI engines said about you");
    expect(html).toContain("who is Acme Roofing");
    expect(html).toContain("BestRoofs is frequently recommended.");
    expect(html).toContain("bestroofs.example");
    expect(html.indexOf("What the AI engines said about you")).toBeLessThan(
      html.indexOf("What to fix first"),
    );
  });

  it("renders the findings and the fix list in impact order", () => {
    expect(html).toContain("GPTBot");
    expect(html).toContain("82%");
    expect(html).toContain("What does a repair cost?");
    expect(html.indexOf("Unblock GPTBot in robots.txt")).toBeLessThan(
      html.indexOf("Add FAQ schema"),
    );
  });

  it("degrades a failed stage to 'Not measured' without throwing", () => {
    const degraded = renderProspectReport(
      result({
        probes: { ok: false, error: "no visibility engine returned an answer" },
        analyze: { ok: false, error: "529 overloaded" },
        scores: { findability: 62, readability: 41, answers: null, aiVisibility: null },
      }),
    );
    expect(degraded).toContain("Not measured");
    // Fix 3: this assertion used to check that the raw stage error string
    // ("no visibility engine returned an answer") appeared verbatim on the
    // page — that is precisely the defect being fixed here (internal error
    // strings reaching a stranger read as broken software, not a
    // diagnostic). The real error stays in the persisted JSON/CLI output for
    // operators; the client-facing page now gets a client-safe phrase.
    expect(degraded).not.toContain("no visibility engine returned an answer");
    expect(degraded).not.toContain("529 overloaded");
    expect(degraded).toContain("What the AI engines said about you");
  });

  it("escapes content that came from the prospect's site", () => {
    const evil = renderProspectReport(result({ businessName: '<script>alert("x")</script>' }));
    expect(evil).not.toContain('<script>alert("x")</script>');
    expect(evil).toContain("&lt;script&gt;");
  });

  it("degrades cleanly when every stage but the crawl fails", () => {
    const allFailed = renderProspectReport(
      result({
        checks: { ok: false, error: "crawl produced no comparable pages" },
        lighthouse: { ok: false, error: "lighthouse: no report produced" },
        analyze: { ok: false, error: ANALYZE_SKIPPED },
        probes: { ok: false, error: "no visibility engine returned an answer" },
        scores: { findability: null, readability: null, answers: null, aiVisibility: null },
      }),
    );
    expect(() => allFailed).not.toThrow();
    expect(allFailed.startsWith("<!doctype html>")).toBe(true);
    // Fix 3: same correction as above — raw stage errors (status codes,
    // internal diagnostic text) must never reach the client, only a
    // client-safe phrase does. These three lines used to assert the raw
    // messages appeared verbatim; now they assert the opposite.
    expect(allFailed).not.toContain("crawl produced no comparable pages");
    expect(allFailed).not.toContain("lighthouse: no report produced");
    expect(allFailed).not.toContain("no visibility engine returned an answer");
    expect(allFailed).toMatch(/could not complete/i);
    // analyze's error here is the SKIP constant, so it must read as a skip,
    // not a generic "Not measured" for that section.
    expect(allFailed).toMatch(/checks stage failed|skipped/i);
    // Every score card falls back to "Not measured" — four of them.
    expect(allFailed.match(/Not measured/g)?.length).toBeGreaterThanOrEqual(4);
  });

  // --- Corrections 1-6 (plan predates these contract changes) ---

  // Correction 1: business is a NAME (possibly empty), fall back to hostname,
  // never present an empty name as a verified fact. The DESCRIPTION
  // (analyze.data.business) is prose in the body, not the title.
  it("falls back to the hostname when the business name is null or empty", () => {
    const nullName = renderProspectReport(result({ businessName: null }));
    expect(nullName).toContain("acme.example");

    const emptyName = renderProspectReport(result({ businessName: "" }));
    expect(emptyName).toContain("acme.example");
  });

  it("uses the analyze description as body prose, not as the report's name", () => {
    const description =
      "A Boise-based roofing contractor offering repair, replacement, and inspection services for residential customers.";
    expect(html).toContain(description);
    // The <h1> carries the NAME, not the (much longer) description sentence.
    const h1 = /<h1>(.*?)<\/h1>/s.exec(html);
    expect(h1).not.toBeNull();
    expect(h1![1]).not.toContain(description);
    expect(h1![1]).toContain("Acme Roofing");
  });

  // Correction 2 (amended by the score removal): the receipts section still
  // frames visibility around buyer/category questions, and brandedRecognized
  // is still reported in words — just no longer next to a score card.
  it("keeps buyer-question framing and worded brand recognition in the receipts", () => {
    expect(html).toMatch(/buyer question/i);
    expect(html).toMatch(/recognized/i);
  });

  it("reports brandedRecognized as false in words when the engines never recognized the brand", () => {
    const notRecognized = renderProspectReport(
      result({
        probes: {
          ok: true,
          data: probesData({
            answers: [
              {
                engine: "perplexity",
                query: "who is Acme Roofing",
                kind: "branded",
                domainCited: false,
                brandMentioned: false,
                citedDomains: [],
                snippet: "I don't have information about that business.",
                truncated: false,
                askedAt: "2026-08-25T16:00:00.000Z",
              },
            ],
            visibilityScore: null,
            brandedRecognized: false,
            competitorsSeen: [],
          }),
        },
      }),
    );
    expect(notRecognized).toMatch(/did not recognize|was not recognized|no recognition/i);
  });

  // Correction 3: group receipts by kind; state when each was asked.
  it("groups probe receipts by kind and states when each was asked", () => {
    expect(html).toMatch(/branded/i);
    expect(html).toMatch(/category|buyer/i);
    // askedAt (2026-08-25) must be rendered somewhere human-readable.
    expect(html).toMatch(/August 25, 2026|2026-08-25/);
  });

  // Correction 4: crawlerAccessMeasured false → "not measured", never a
  // universal-access claim manufactured from our own missing data.
  it("says crawler access was not measured when the robots.txt fetch failed, and never claims universal access", () => {
    const degraded = renderProspectReport(
      result({
        crawl: {
          ok: true,
          data: crawlData({
            sidecarErrors: { robots: "fetch failed: ECONNRESET", llms: null, sitemap: null },
          }),
        },
        checks: {
          ok: true,
          data: checksData({
            crawlerAccessMeasured: false,
            crawlerAccess: { blockedAi: [], allowedAi: [], blockedClassical: [] },
          }),
        },
      }),
    );
    expect(degraded).toMatch(/not measured/i);
    expect(degraded).not.toContain("Every AI crawler we checked can reach the site.");
  });

  // Correction 5: avgMissing null → "not measured", never "0%". Surface
  // pagesWithoutExtract so a partial audit can't read as a complete one.
  it("says readability is not measured (not 0%) when avgMissing is null", () => {
    const degraded = renderProspectReport(
      result({
        checks: { ok: true, data: checksData({ jsDependence: { avgMissing: null, perPage: [] } }) },
      }),
    );
    expect(degraded).toMatch(/not measured/i);
    expect(degraded).not.toContain("0% of the words");
  });

  it("surfaces pages that produced no extract at all", () => {
    const withMissingPages = renderProspectReport(
      result({
        checks: {
          ok: true,
          data: checksData({ meta: { ...checksData().meta, pagesWithoutExtract: 2 } }),
        },
      }),
    );
    expect(withMissingPages).toMatch(
      /2[^%]*(pages?|page).{0,40}(no extract|failed|produced nothing)/i,
    );
  });

  // Correction 6: a requested skip must read differently from an attempted
  // failure — compared against the pipeline's exported constants, never a
  // retyped string literal.
  //
  // Fix 1: the old wording here ("You asked us to skip...") addressed the
  // READER as the person who requested the skip. That's wrong for a cold
  // email — the recipient asked us for nothing; only the operator who passed
  // --no-probes did. The regex below used to match that "you asked" phrasing
  // directly; it's updated to assert the corrected, third-person wording
  // instead (and to confirm the old address-the-reader phrasing is gone).
  it("reads a requested probes skip differently from an attempted probes failure", () => {
    const skipped = renderProspectReport(result({ probes: { ok: false, error: PROBES_SKIPPED } }));
    expect(skipped).toMatch(/did not run|skipped/i);
    expect(skipped).not.toMatch(/you asked/i);
    expect(skipped).not.toContain("Not measured");
  });

  it("reads a requested analyze skip differently from an attempted analyze failure", () => {
    const skipped = renderProspectReport(
      result({ analyze: { ok: false, error: ANALYZE_SKIPPED } }),
    );
    expect(skipped).toMatch(/checks stage failed|couldn't be analyzed|skipped/i);
  });

  // --- Code-review follow-up: safeUrl no longer round-trips the raw string,
  // real Lighthouse numbers must survive an unrelated stage failure, and a
  // branded-only probe run must not read as a positive discoverability finding ---

  it("keeps the measured Lighthouse numbers even when the checks stage failed", () => {
    const rendered = renderProspectReport(
      result({ checks: { ok: false, error: "crawl produced no comparable pages" } }),
    );
    expect(rendered).toContain("performance 44");
    expect(rendered).toContain("SEO 92");
    expect(rendered).toContain("accessibility 88");
  });

  it("qualifies a branded-only probe run as not indicating buyer discoverability", () => {
    const brandedOnly = renderProspectReport(
      result({
        probes: {
          ok: true,
          data: probesData({
            answers: [
              {
                engine: "perplexity",
                query: "who is Acme Roofing",
                kind: "branded",
                domainCited: true,
                brandMentioned: true,
                citedDomains: ["acme.example"],
                snippet: "Acme Roofing is a Boise contractor.",
                truncated: false,
                askedAt: "2026-08-25T16:00:00.000Z",
              },
            ],
            visibilityScore: null,
          }),
        },
      }),
    );
    expect(brandedOnly).toMatch(/no buyer-question|only name-recognition/i);
    // The default fixture DOES include a category question, so it must not
    // carry the same caveat — proving this is conditional, not boilerplate.
    expect(html).not.toMatch(/no buyer-question \(category\) query was tested/i);
  });

  // A question the model skipped comes back answered:"unknown", evidence:null —
  // OUR measurement gap, not a fact about their site. The web report already
  // says so ("Not measured", excluded from the meter); this renderer printed the
  // raw token beside "no passage on the site", which is a claim about their site
  // for a question we never got a verdict on. It is the exact inversion the
  // "unknown" state was introduced to prevent, and email.ts attaches this HTML.
  describe("an unmeasured question is reported as ours, not theirs", () => {
    const unmeasured = () =>
      renderProspectReport(
        result({
          analyze: {
            ok: true,
            data: analyzeData({
              buyerQuestions: [
                {
                  question: "Do you do flat roofs?",
                  answered: "unknown",
                  quotable: false,
                  page: null,
                  evidence: null,
                },
              ],
            }),
          },
        }),
      );

    it("never blames the site for a passage we did not look for", () => {
      expect(unmeasured()).not.toContain("no passage on the site");
    });

    it("says we did not measure it, in words rather than a raw enum token", () => {
      const html = unmeasured();
      expect(html).toMatch(/not measured/i);
      expect(html).not.toMatch(/<span class="tag unknown">unknown<\/span>/);
    });

    it("styles the unknown tag, so it cannot read as a measured verdict", () => {
      expect(unmeasured()).toMatch(/\.unknown\s*\{/);
    });

    // The three real verdicts must keep saying exactly what they said.
    it("leaves a genuinely unanswered question alone", () => {
      const html = renderProspectReport(result());
      expect(html).toContain("no passage on the site");
      expect(html).toMatch(/<span class="tag no">no<\/span>/);
    });
  });

  // --- Adversarial escaping: business/description was already covered
  // above; every other prospect-controlled sink gets its own hostile fixture.
  describe("escapes hostile content at every prospect-controlled sink", () => {
    const scriptPayload = "<script>alert(1)</script>";
    const escapedScript = "&lt;script&gt;alert(1)&lt;/script&gt;";

    it("evidence quote and its source-page link", () => {
      const evil = renderProspectReport(
        result({
          analyze: {
            ok: true,
            data: analyzeData({
              buyerQuestions: [
                {
                  question: "What does a repair cost?",
                  answered: "partial",
                  quotable: false,
                  page: 'https://acme.example/"><script>alert(2)</script>',
                  evidence: scriptPayload,
                },
              ],
            }),
          },
        }),
      );
      expect(evil).not.toContain(scriptPayload);
      expect(evil).toContain(escapedScript);
      // The evidence link's href must be percent-encoded by safeUrl, not the
      // raw quote-breakout string.
      expect(evil).not.toContain('"><script>alert(2)</script>');
    });

    it("probe snippet and cited domains", () => {
      const evil = renderProspectReport(
        result({
          probes: {
            ok: true,
            data: probesData({
              answers: [
                {
                  engine: "perplexity",
                  query: "who is Acme Roofing",
                  kind: "category",
                  domainCited: true,
                  brandMentioned: true,
                  citedDomains: [scriptPayload],
                  snippet: scriptPayload,
                  truncated: false,
                  askedAt: "2026-08-25T16:00:00.000Z",
                },
              ],
            }),
          },
        }),
      );
      expect(evil).not.toContain(scriptPayload);
      expect(evil).toContain(escapedScript);
    });

    it("fix title and why", () => {
      const evil = renderProspectReport(
        result({
          analyze: {
            ok: true,
            data: analyzeData({
              fixes: [
                {
                  title: scriptPayload,
                  why: scriptPayload,
                  impact: "high",
                  effort: "low",
                  tier: "crawl",
                },
              ],
            }),
          },
        }),
      );
      expect(evil).not.toContain(scriptPayload);
      expect(evil).toContain(escapedScript);
    });

    it("the audited URL itself, in both its href and its visible text", () => {
      const evil = renderProspectReport(
        result({ url: 'https://acme.example/"><script>alert(3)</script>' }),
      );
      expect(evil).not.toContain('"><script>alert(3)</script>');
      // safeUrl now returns the percent-encoded href (never the raw string),
      // so the quote/bracket breakout cannot reach the href attribute
      // literally — this is the live-injection fix.
      expect(evil).not.toContain('href="https://acme.example/">');
      expect(evil).toMatch(/href="https:\/\/acme\.example\/%22/);
    });
  });

  // --- Fixes 1-8: a reviewer read the rendered report as the recipient (a
  // stranger who did not ask for it and can check every claim against their
  // own site) and found it unfit to send as-is. Each block below covers one
  // finding. ---

  // Fix 1: "You asked us to skip..." was written for the operator who passed
  // --no-probes, not for a stranger who requested nothing. See the updated
  // Correction-6 tests above for the corrected wording; this block covers
  // the case that wasn't already exercised there.
  describe("Fix 1: the probes-skip note never addresses the reader as the requester", () => {
    it("never says 'you asked' anywhere in the skip note, and states what the audit did instead", () => {
      const skipped = renderProspectReport(
        result({ probes: { ok: false, error: PROBES_SKIPPED } }),
      );
      expect(skipped).not.toMatch(/you asked/i);
      expect(skipped).toMatch(/did not run the ai-visibility probes/i);
    });
  });

  // Fix 2: sitemapMeasured/llmsTxtMeasured false means the fetch itself
  // failed — the report must say "not measured", never "missing" (a claim
  // about the prospect's site we have not earned). Mirrors how the
  // crawler-access block already handles crawlerAccessMeasured.
  describe("Fix 2: unmeasured sidecars read as 'not measured', never 'missing'", () => {
    it("says sitemap.xml was not checked when its fetch failed", () => {
      const degraded = renderProspectReport(
        result({
          crawl: {
            ok: true,
            data: crawlData({
              sidecarErrors: {
                robots: null,
                llms: "fetch failed: ETIMEDOUT",
                sitemap: "fetch failed: 404",
              },
            }),
          },
          checks: {
            ok: true,
            data: checksData({ sitemapMeasured: false, llmsTxtMeasured: false }),
          },
        }),
      );
      expect(degraded).toMatch(/sitemap\.xml.*not measured/i);
      expect(degraded).not.toContain("sitemap.xml: missing");
    });

    it("still reports a confirmed absence as 'missing' when the fetch succeeded", () => {
      // sitemapMeasured true (the default fixture) plus sitemapPresent false
      // must still say "missing" — Fix 2 only changes the unmeasured case, not
      // a real, confirmed absence.
      const absent = renderProspectReport(
        result({ checks: { ok: true, data: checksData({ sitemapPresent: false }) } }),
      );
      expect(absent).toContain("sitemap.xml: missing");
    });
  });

  // llms.txt is deliberately not a finding any more. It was a `<li>` beside
  // sitemap.xml, which put a 2024 proposal no answer engine has committed to
  // reading on the same footing as a file search crawlers demonstrably consume
  // — and "missing" in a checklist reads as a job. It survives only as a
  // footnote that says outright we do not score it and will not recommend it.
  describe("llms.txt is a footnote, not a finding", () => {
    const withLlms = (over = {}) =>
      renderProspectReport(result({ checks: { ok: true, data: checksData(over) } }));

    it("never lists llms.txt as missing", () => {
      expect(withLlms({ llmsTxtPresent: false })).not.toContain("llms.txt: missing");
    });

    it("never tells a prospect to add one, in any state", () => {
      for (const state of [
        { llmsTxtMeasured: true, llmsTxtPresent: true },
        { llmsTxtMeasured: true, llmsTxtPresent: false },
        { llmsTxtMeasured: false, llmsTxtPresent: false },
      ]) {
        const out = withLlms(state);
        expect(out).toContain("A note on llms.txt");
        expect(out).toContain("we do not score it");
        // The whole point of the footnote: no version of it is a recommendation.
        expect(out).not.toMatch(/add (an|a) llms\.txt/i);
      }
    });

    it("keeps the footnote free of raw fetch errors when the check could not run", () => {
      const degraded = renderProspectReport(
        result({
          crawl: {
            ok: true,
            data: crawlData({
              sidecarErrors: { robots: null, llms: "fetch failed: ETIMEDOUT", sitemap: null },
            }),
          },
          checks: { ok: true, data: checksData({ llmsTxtMeasured: false }) },
        }),
      );
      expect(degraded).toContain("could not be checked");
      expect(degraded).not.toContain("ETIMEDOUT");
    });
  });

  // Item 1 (post-review follow-up): the "not measured" sidecar lines above
  // were client-safe about MISSING vs NOT MEASURED, but still interpolated
  // the raw fetch error — status codes and transport vocabulary a small-
  // business owner would read as "your audit is broken software", not a
  // diagnostic. Same client-safe mapping stage failures already get.
  describe("Item 1: the sidecar 'not measured' lines never print the raw fetch error", () => {
    it("keeps 'sitemap.xml: not measured' and 'llms.txt: not measured' free of the raw error text", () => {
      const degraded = renderProspectReport(
        result({
          crawl: {
            ok: true,
            data: crawlData({
              sidecarErrors: {
                robots: null,
                llms: "fetch failed: ETIMEDOUT",
                sitemap: "fetch failed: 503 Service Unavailable",
              },
            }),
          },
          checks: {
            ok: true,
            data: checksData({ sitemapMeasured: false, llmsTxtMeasured: false }),
          },
        }),
      );
      expect(degraded).toMatch(/sitemap\.xml.*not measured/i);
      expect(degraded).not.toContain("503 Service Unavailable");
      expect(degraded).not.toContain("ETIMEDOUT");
      expect(degraded).not.toContain("fetch failed");
    });

    it("keeps the crawler-access 'not measured' line free of the raw robots.txt fetch error", () => {
      const degraded = renderProspectReport(
        result({
          crawl: {
            ok: true,
            data: crawlData({
              sidecarErrors: {
                robots: "fetch failed: 503 Service Unavailable",
                llms: null,
                sitemap: null,
              },
            }),
          },
          checks: {
            ok: true,
            data: checksData({
              crawlerAccessMeasured: false,
              crawlerAccess: { blockedAi: [], allowedAi: [], blockedClassical: [] },
            }),
          },
        }),
      );
      expect(degraded).toMatch(/crawler access.*not measured/i);
      expect(degraded).not.toContain("503 Service Unavailable");
      expect(degraded).not.toContain("fetch failed");
    });
  });

  // Fix 3: internal error strings ("529 overloaded", retry counts, timeouts)
  // are operator vocabulary — to a stranger they read as broken software.
  // The renderer must map every genuine stage failure to one client-safe
  // phrase and never print the raw message; the real error still lives in
  // the persisted JSON and CLI output for operators.
  describe("Fix 3: internal stage errors never reach the client", () => {
    it("replaces a technical stage error with a client-safe phrase", () => {
      const rendered = renderProspectReport(
        result({
          checks: { ok: false, error: "529 overloaded" },
          lighthouse: { ok: false, error: "the model timed out after 3 retries (60s)" },
        }),
      );
      expect(rendered).not.toContain("529 overloaded");
      expect(rendered).not.toContain("timed out after 3 retries");
      expect(rendered).toMatch(/could not complete/i);
    });

    it("keeps the skip/failure distinction after the client-safe mapping", () => {
      const skipped = renderProspectReport(
        result({ probes: { ok: false, error: PROBES_SKIPPED } }),
      );
      const failed = renderProspectReport(
        result({ probes: { ok: false, error: "no visibility engine returned an answer" } }),
      );
      expect(skipped).not.toMatch(/could not complete/i);
      expect(failed).toMatch(/could not complete/i);
    });
  });

  // Fix 4: .cta is white text on a red background; browsers default "print
  // background graphics" off, which drops the red and leaves white-on-white
  // — the only ask in the document becomes invisible when printed.
  describe("Fix 4: the call to action survives printing with backgrounds off", () => {
    it("gives .cta dark text, no background, and a visible border under @media print", () => {
      const printStart = html.indexOf("@media print");
      expect(printStart).toBeGreaterThan(-1);
      const printBlock = html.slice(printStart, html.indexOf("</style>", printStart));
      expect(printBlock).toMatch(/\.cta\s*\{[^}]*background:\s*none/);
      expect(printBlock).toMatch(/\.cta\s*\{[^}]*color:\s*#1a1a1a/);
      expect(printBlock).toMatch(/\.cta\s*\{[^}]*border/);
    });
  });

  // Fix 5 (amended by the score removal): three cards now, each hinted, on a
  // stated 0-100 scale.
  describe("Fix 5: every score card states what it measures, on a stated 0-100 scale", () => {
    it("gives all three score cards a hint", () => {
      const hints = html.match(/class="hint"/g) ?? [];
      expect(hints.length).toBe(3);
    });

    it("states the scale is 0-100, not a percentage", () => {
      expect(html).toMatch(/0[–-]100/);
    });

    it("keeps the Answers hint about the site's own content, not what engines say", () => {
      // Worded so a reader cannot mistake the on-page Answers measurement for
      // the engine-side visibility receipts below it.
      expect(html).toMatch(/site.{0,20}own (content|pages)/i);
    });
  });

  // Fix 6: "...even with the name handed to them" is false when businessName
  // was empty and no name was ever given to any engine.
  describe("Fix 6: the 'name handed to them' claim is gated on a name actually being used", () => {
    it("drops that phrasing when no business name was ever resolved", () => {
      const noName = renderProspectReport(
        result({
          businessName: null,
          probes: {
            ok: true,
            data: probesData({
              answers: [
                {
                  engine: "perplexity",
                  query: "who is this business",
                  kind: "branded",
                  domainCited: false,
                  brandMentioned: false,
                  citedDomains: [],
                  snippet: "I don't have information about that business.",
                  truncated: false,
                  askedAt: "2026-08-25T16:00:00.000Z",
                },
              ],
              visibilityScore: null,
              brandedRecognized: false,
            }),
          },
        }),
      );
      expect(noName).not.toContain("even with the name handed to them");
    });

    it("keeps the phrasing when a real business name was used and not recognized", () => {
      // Default fixture: business "Acme Roofing" is resolved and handed to
      // the engines. Reuse the existing "not recognized" fixture shape.
      const notRecognized = renderProspectReport(
        result({
          probes: {
            ok: true,
            data: probesData({
              answers: [
                {
                  engine: "perplexity",
                  query: "who is Acme Roofing",
                  kind: "branded",
                  domainCited: false,
                  brandMentioned: false,
                  citedDomains: [],
                  snippet: "I don't have information about that business.",
                  truncated: false,
                  askedAt: "2026-08-25T16:00:00.000Z",
                },
              ],
              visibilityScore: null,
              brandedRecognized: false,
              competitorsSeen: [],
            }),
          },
        }),
      );
      expect(notRecognized).toContain("even with the name handed to them");
    });
  });

  // Fix 7: two consistency items.
  describe("Fix 7: consistency — 'not measured' wording, and a real sentence for zero fixes", () => {
    it("renders a null Lighthouse sub-score as 'not measured', not 'n/a'", () => {
      const rendered = renderProspectReport(
        result({
          lighthouse: {
            ok: true,
            data: lighthouseData({ performance: null, accessibility: null, seo: null }),
          },
        }),
      );
      expect(rendered).not.toMatch(/\bn\/a\b/);
      expect(rendered).toMatch(/not measured/i);
    });

    it("renders a sentence — not a bare empty list — when fixes is empty, and still pitches Reddoor", () => {
      const rendered = renderProspectReport(
        result({ analyze: { ok: true, data: analyzeData({ fixes: [] }) } }),
      );
      expect(rendered).not.toContain("<ol></ol>");
      expect(rendered).not.toMatch(/<ol>\s*<\/ol>/);
      const whatToFix = rendered.indexOf("What to fix first");
      expect(whatToFix).toBeGreaterThan(-1);
      const afterHeading = rendered.slice(whatToFix, whatToFix + 500);
      expect(afterHeading).toMatch(/[a-z]/); // an actual sentence follows the heading
      expect(afterHeading.toLowerCase()).toContain("reddoor");
    });
  });

  // Fix 8: GPTBot/OAI-SearchBot/ClaudeBot/PerplexityBot/Google-Extended/CCBot
  // mean nothing to a small-business owner without a product name attached.
  describe("Fix 8: blocked AI crawlers are labelled with the product they feed", () => {
    it("names the product each blocked crawler feeds", () => {
      expect(html).toMatch(/GPTBot \(feeds ChatGPT\)/);
    });

    it("labels every crawler in AI_AGENTS when all six are blocked", () => {
      const allBlocked = renderProspectReport(
        result({
          checks: {
            ok: true,
            data: checksData({
              crawlerAccess: {
                blockedAi: [
                  "GPTBot",
                  "OAI-SearchBot",
                  "ClaudeBot",
                  "PerplexityBot",
                  "Google-Extended",
                  "CCBot",
                ],
                allowedAi: [],
                blockedClassical: [],
              },
            }),
          },
        }),
      );
      for (const agent of [
        "GPTBot",
        "OAI-SearchBot",
        "ClaudeBot",
        "PerplexityBot",
        "Google-Extended",
        "CCBot",
      ]) {
        expect(allBlocked).toMatch(new RegExp(`${agent} \\(feeds [^)]+\\)`));
      }
    });
  });

  // Item 4b: the renderer used to print an ellipsis based on
  // `snippet.length >= 300` — a re-derivation of probes.ts's private
  // SNIPPET_CHARS that would silently drift if that constant were ever
  // tuned. It now reads the explicit `truncated` flag ProbeAnswer carries.
  describe("Item 4b: the receipt ellipsis follows ProbeAnswer.truncated, not a re-derived length check", () => {
    it("shows an ellipsis for a short snippet marked truncated: true", () => {
      const rendered = renderProspectReport(
        result({
          probes: {
            ok: true,
            data: probesData({
              answers: [
                {
                  engine: "perplexity",
                  query: "who is Acme Roofing",
                  kind: "branded",
                  domainCited: true,
                  brandMentioned: true,
                  citedDomains: ["acme.example"],
                  snippet: "short",
                  truncated: true,
                  askedAt: "2026-08-25T16:00:00.000Z",
                },
              ],
            }),
          },
        }),
      );
      expect(rendered).toContain("short…");
    });

    it("shows no ellipsis for a 300-char snippet marked truncated: false", () => {
      const longButNotTruncated = "x".repeat(300);
      const rendered = renderProspectReport(
        result({
          probes: {
            ok: true,
            data: probesData({
              answers: [
                {
                  engine: "perplexity",
                  query: "who is Acme Roofing",
                  kind: "branded",
                  domainCited: true,
                  brandMentioned: true,
                  citedDomains: ["acme.example"],
                  snippet: longButNotTruncated,
                  truncated: false,
                  askedAt: "2026-08-25T16:00:00.000Z",
                },
              ],
            }),
          },
        }),
      );
      expect(rendered).not.toContain(`${longButNotTruncated}…`);
    });
  });
});
