import { describe, expect, it } from "vitest";
import { analyzeSite, buildAnalyzeInput } from "../../src/prospect/analyze.js";
import { runChecks } from "../../src/prospect/checks.js";
import { extractPage } from "../../src/prospect/extract.js";
import { questionSetFor } from "../../src/prospect/questions.js";
import type { CrawlResult, PageCapture } from "../../src/prospect/types.js";

/**
 * The buyer questions are ours, not the model's.
 *
 * Every test here pins the same property from a different side: what the report
 * asks is decided before the call, so two audits of one site ask the same thing
 * and their Answers scores can honestly be compared. The model's job is reduced
 * to judging each answer, which is the part it is actually good at.
 */

function page(url: string, html: string): PageCapture {
  return { url, status: 200, raw: extractPage(html), rendered: extractPage(html), error: null };
}

function crawl(): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: "",
    agentAccess: [{ agent: "GPTBot", allowed: true, matchedRule: null }],
    sitemap: { present: true, urlCount: 1 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: [
      page(
        "https://acme.example/p0",
        "<html><head><title>Acme</title></head><body><h1>Acme</h1><p>Projects start at $12,000.</p></body></html>",
      ),
    ],
  };
}

const BASE = {
  businessName: "Acme",
  business: "Acme — a design studio",
  entityClarity: { score: 70, missing: [] },
  categoryQueries: [
    "design studio boise",
    "how much does a rebrand cost",
    "packaging design idaho",
  ],
  fixes: [],
  narrative: { findability: "a", readability: "b", answers: "c" },
};

/** Answer every question in a set the way the model is asked to. */
const answerAll = (
  goal: Parameters<typeof questionSetFor>[0],
  answered: "yes" | "partial" | "no" = "no",
) =>
  questionSetFor(goal).questions.map((q) => ({
    id: q.id,
    answered,
    quotable: false,
    page: null,
    evidence: null,
  }));

async function run(goal: Parameters<typeof questionSetFor>[0], buyerQuestions: unknown[]) {
  const c = crawl();
  const checks = runChecks(c);
  return analyzeSite(
    "https://acme.example",
    c,
    checks,
    { run: async () => ({ ...BASE, primaryGoal: goal, buyerQuestions }) },
    goal,
  );
}

describe("the question set is fixed before the call", () => {
  it("puts every question, with its id, into the prompt", async () => {
    const c = crawl();
    const checks = runChecks(c);
    const { user, system } = buildAnalyzeInput(
      "https://acme.example",
      c,
      checks,
      questionSetFor("enquire"),
    );
    const prompt = `${system}\n${user}`;
    for (const q of questionSetFor("enquire").questions) {
      expect(prompt, `prompt asks ${q.id}`).toContain(q.id);
      expect(prompt, `prompt carries the text of ${q.id}`).toContain(q.question);
    }
  });

  it("returns exactly the set, in set order, with our wording", async () => {
    const set = questionSetFor("book");
    const out = await run("book", answerAll("book"));
    expect(out.buyerQuestions.map((q) => q.id)).toEqual(set.questions.map((q) => q.id));
    expect(out.buyerQuestions.map((q) => q.question)).toEqual(set.questions.map((q) => q.question));
  });

  it("records which set was asked, so a later audit can tell if it is comparable", async () => {
    const out = await run("demo", answerAll("demo"));
    expect(out.questionSetId).toBe(questionSetFor("demo").id);
  });

  it("uses the operator's goal to choose the set", async () => {
    const out = await run("buy", answerAll("buy"));
    expect(out.buyerQuestions.map((q) => q.id)).toContain("returns");
    expect(out.buyerQuestions.map((q) => q.id)).not.toContain("demo-content");
  });
});

describe("what the model gets wrong about the set", () => {
  it("marks a question the model skipped as unknown, never as unanswered", async () => {
    // Our gap, not their defect. Scoring a question we failed to get an answer
    // for as "no" would report our own missing data as a finding about the
    // site — the single rule this report is built to never break.
    const partial = answerAll("enquire").filter((q) => q.id !== "cost");
    const out = await run("enquire", partial);
    const cost = out.buyerQuestions.find((q) => q.id === "cost");
    expect(cost?.answered).toBe("unknown");
    expect(out.buyerQuestions).toHaveLength(questionSetFor("enquire").questions.length);
  });

  it("drops a question the model invented", async () => {
    const withExtra = [
      ...answerAll("call"),
      { id: "made-up", answered: "yes" as const, quotable: true, page: null, evidence: null },
    ];
    const out = await run("call", withExtra);
    expect(out.buyerQuestions.map((q) => q.id)).not.toContain("made-up");
    expect(out.buyerQuestions).toHaveLength(questionSetFor("call").questions.length);
  });

  it("still downgrades an unevidenced yes to no", async () => {
    // The pre-existing guard must survive the rework: a verdict we cannot point
    // at a passage for is not a positive verdict.
    const out = await run("visit", answerAll("visit", "yes"));
    expect(out.buyerQuestions.every((q) => q.answered === "no")).toBe(true);
  });

  it("keeps an answer whose evidence really is on the page", async () => {
    const answers = answerAll("enquire").map((q) =>
      q.id === "cost"
        ? {
            ...q,
            answered: "yes" as const,
            quotable: true,
            page: "https://acme.example/p0",
            evidence: "Projects start at $12,000.",
          }
        : q,
    );
    const out = await run("enquire", answers);
    expect(out.buyerQuestions.find((q) => q.id === "cost")?.answered).toBe("yes");
  });
});
