import { describe, it, expect } from "vitest";
import { analyzeSite } from "../../src/prospect/analyze.js";
import {
  questionSetFor,
  questionSetFromChosen,
  sameQuestionSet,
  QUESTION_SET_VERSION,
} from "../../src/prospect/questions.js";
import { runChecks } from "../../src/prospect/checks.js";
import { extractPage } from "../../src/prospect/extract.js";
import type { CrawlResult, PageCapture } from "../../src/prospect/types.js";

/**
 * #676. The "Where you stand" section is only as good as the five searches
 * behind it, and today those are chosen entirely by the analyze stage from what
 * it read on the site. For a client we know we can write better ones in two
 * minutes — and for a comparison over time the terms have to stay FIXED.
 *
 * Blank still means generate, exactly as now. That is the property most of
 * these tests exist to protect: this must be an override, not a new
 * requirement.
 */

function page(url: string, html: string): PageCapture {
  return { url, status: 200, raw: extractPage(html), rendered: extractPage(html), error: null };
}

function crawl(): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: "",
    agentAccess: [],
    sitemap: { present: true, urlCount: 1 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: [
      page(
        "https://acme.example/p0",
        "<html><head><title>Acme</title></head><body><h1>Acme</h1><p>Commercial roofing in Boise. Most repairs run between $1,200 and $8,000.</p></body></html>",
      ),
    ],
  };
}

/** A schema-valid model response. `conformToSet` fills in any question the
 *  model did not answer, so one entry is enough. */
const modelOutput = {
  businessName: "Acme Roofing",
  business: "Acme Roofing — commercial roofing in Boise, Idaho",
  entityClarity: { score: 72, missing: [] },
  categoryQueries: [
    "commercial roofing contractor Boise",
    "how much does a commercial roof replacement cost",
    "flat roof repair Idaho",
  ],
  buyerQuestions: [
    {
      id: "cost",
      answered: "partial" as const,
      quotable: false,
      page: "https://acme.example/p0",
      evidence: "Most repairs run between $1,200 and $8,000",
    },
  ],
  fixes: [],
  narrative: { findability: "a", readability: "b", answers: "c" },
};

const deps = { run: async () => modelOutput };

const CHOSEN_TERMS = [
  "commercial roof replacement cost San Antonio",
  "TPO roofing contractor for warehouses",
  "emergency flat roof repair near me",
];

describe("questionSetFromChosen — hand-written questions get their own key", () => {
  it("is identified separately from every goal set, so comparisons cannot mix them", () => {
    // The issue's own requirement. `sameQuestionSet` compares ids, so a chosen
    // set sharing an id with a goal set would let the report claim a
    // before/after across two different tests.
    const chosen = questionSetFromChosen(["Do you work weekends?", "What does it cost?"]);
    for (const goal of ["book", "enquire", "unknown"] as const) {
      expect(chosen.id).not.toBe(questionSetFor(goal).id);
    }
    expect(chosen.id).toContain(`v${QUESTION_SET_VERSION}`);
  });

  it("gives the SAME id to the same questions, so two audits stay comparable", () => {
    // The whole point of choosing them by hand is a fixed instrument. Re-running
    // with the same list has to compare.
    const a = questionSetFromChosen(["Do you work weekends?", "What does it cost?"]);
    const b = questionSetFromChosen(["Do you work weekends?", "What does it cost?"]);
    expect(a.id).toBe(b.id);
    expect(sameQuestionSet(a.id, b.id)).toBe(true);
  });

  it("gives a DIFFERENT id to a different list, so an edit breaks comparability loudly", () => {
    const a = questionSetFromChosen(["Do you work weekends?"]);
    const b = questionSetFromChosen(["Do you work weekends?", "What does it cost?"]);
    expect(sameQuestionSet(a.id, b.id)).toBe(false);
  });

  it("keeps the operator's wording and order verbatim", () => {
    const set = questionSetFromChosen(["Second?", "First?"]);
    expect(set.questions.map((q) => q.question)).toEqual(["Second?", "First?"]);
    expect(new Set(set.questions.map((q) => q.id)).size).toBe(2);
  });

  it("ignores blank entries rather than asking an empty question", () => {
    const set = questionSetFromChosen(["Real question?", "   ", ""]);
    expect(set.questions).toHaveLength(1);
  });
});

describe("analyzeSite honours chosen terms and questions", () => {
  it("uses the operator's search terms instead of the ones the model wrote", async () => {
    const result = await analyzeSite(
      "https://acme.example/",
      crawl(),
      runChecks(crawl()),
      deps,
      "unknown",
      null,
      { terms: CHOSEN_TERMS },
    );
    expect(result.categoryQueries).toEqual(CHOSEN_TERMS);
    expect(result.termsSource).toBe("chosen");
  });

  it("GENERATES when the terms are blank — the default path is untouched", async () => {
    // The grant side, and the one that matters most: this is an override, not a
    // new requirement, and a cold audit must behave exactly as it does today.
    const result = await analyzeSite(
      "https://acme.example/",
      crawl(),
      runChecks(crawl()),
      deps,
      "unknown",
      null,
    );
    expect(result.categoryQueries).toEqual(modelOutput.categoryQueries);
    expect(result.termsSource).toBe("generated");
  });

  it("treats an EMPTY chosen list as blank, not as 'ask nothing'", async () => {
    const result = await analyzeSite(
      "https://acme.example/",
      crawl(),
      runChecks(crawl()),
      deps,
      "unknown",
      null,
      { terms: [] },
    );
    expect(result.categoryQueries).toEqual(modelOutput.categoryQueries);
    expect(result.termsSource).toBe("generated");
  });

  it("asks the operator's questions, keyed to their own set id", async () => {
    const chosen = ["Do you service my postcode?", "How fast can you come out?"];
    const result = await analyzeSite(
      "https://acme.example/",
      crawl(),
      runChecks(crawl()),
      deps,
      "unknown",
      null,
      { questions: chosen },
    );
    expect(result.buyerQuestions.map((q) => q.question)).toEqual(chosen);
    expect(result.questionSetId).toBe(questionSetFromChosen(chosen).id);
    expect(result.questionsSource).toBe("chosen");
  });

  it("falls back to the goal's fixed set when no questions were chosen", async () => {
    const result = await analyzeSite(
      "https://acme.example/",
      crawl(),
      runChecks(crawl()),
      deps,
      "book",
      null,
    );
    expect(result.questionSetId).toBe(questionSetFor("book").id);
    expect(result.questionsSource).toBe("generated");
  });

  it("takes chosen TERMS and generated QUESTIONS independently", async () => {
    // They are two separate decisions in the issue, and an operator who writes
    // searches has not thereby chosen the buyer questions.
    const result = await analyzeSite(
      "https://acme.example/",
      crawl(),
      runChecks(crawl()),
      deps,
      "book",
      null,
      { terms: CHOSEN_TERMS },
    );
    expect(result.termsSource).toBe("chosen");
    expect(result.questionsSource).toBe("generated");
    expect(result.questionSetId).toBe(questionSetFor("book").id);
  });
});
