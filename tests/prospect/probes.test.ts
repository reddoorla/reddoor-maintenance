import { describe, it, expect } from "vitest";
import {
  buildQueries,
  domainOf,
  runVisibilityProbes,
  perplexityEngine,
  type VisibilityEngine,
} from "../../src/prospect/probes.js";

const engine = (
  name: string,
  reply: (q: string) => { answer: string; citedDomains: string[] },
): VisibilityEngine => ({
  name,
  ask: async (q) => reply(q),
});

describe("buildQueries", () => {
  it("asks the branded questions, then the buyer questions", () => {
    const queries = buildQueries({
      business: "Acme Roofing",
      url: "https://acme.example/",
      buyerQuestions: [
        "What does a roof repair cost?",
        "Do you work on flat roofs?",
        "How fast?",
        "Extra",
      ],
      competitors: [],
    });
    expect(queries[0]).toBe("who is Acme Roofing");
    expect(queries[1]).toBe("Acme Roofing reviews");
    expect(queries).toContain("What does a roof repair cost?");
    expect(queries.length).toBeLessThanOrEqual(8);
  });

  it("adds comparison queries for each competitor", () => {
    const queries = buildQueries({
      business: "Acme Roofing",
      url: "https://acme.example/",
      buyerQuestions: [],
      competitors: ["bestroofs.example", "toproof.example"],
    });
    expect(queries).toContain("Acme Roofing vs bestroofs.example");
    expect(queries).toContain("Acme Roofing vs toproof.example");
  });

  it("falls back to the domain when there is no business name", () => {
    const queries = buildQueries({
      business: "",
      url: "https://acme.example/",
      buyerQuestions: [],
      competitors: [],
    });
    expect(queries[0]).toBe("who is acme.example");
  });
});

describe("domainOf", () => {
  it("strips the scheme, www and path", () => {
    expect(domainOf("https://www.acme.example/services")).toBe("acme.example");
    expect(domainOf("acme.example")).toBe("acme.example");
  });
});

describe("runVisibilityProbes", () => {
  const args = {
    url: "https://acme.example/",
    business: "Acme Roofing",
    buyerQuestions: ["What does a roof repair cost?"],
    competitors: [],
  };

  it("scores a citation or a brand mention as visible", async () => {
    const engines = [
      engine("perplexity", (q) =>
        q.startsWith("who is")
          ? { answer: "Acme Roofing is a Boise contractor.", citedDomains: ["acme.example"] }
          : { answer: "Several contractors serve Boise.", citedDomains: ["bestroofs.example"] },
      ),
    ];
    const result = await runVisibilityProbes(args, engines);
    expect(result.answers).toHaveLength(3);
    const branded = result.answers.find((a) => a.query === "who is Acme Roofing")!;
    expect(branded.domainCited).toBe(true);
    expect(branded.brandMentioned).toBe(true);
    expect(result.visibilityScore).toBe(33);
  });

  it("counts the competitors the engines cited instead", async () => {
    const engines = [
      engine("perplexity", () => ({
        answer: "Try BestRoofs.",
        citedDomains: ["bestroofs.example", "www.bestroofs.example", "toproof.example"],
      })),
    ];
    const result = await runVisibilityProbes(args, engines);
    expect(result.competitorsSeen[0]).toEqual({ domain: "bestroofs.example", count: 6 });
    expect(result.visibilityScore).toBe(0);
  });

  it("keeps the answers of a working engine when another one fails", async () => {
    const engines = [
      engine("perplexity", () => ({ answer: "Acme Roofing.", citedDomains: ["acme.example"] })),
      {
        name: "claude",
        ask: async () => {
          throw new Error("401 no key");
        },
      },
    ];
    const result = await runVisibilityProbes(args, engines);
    expect(result.answers.every((a) => a.engine === "perplexity")).toBe(true);
    expect(result.visibilityScore).toBe(100);
  });

  it("throws when every engine fails, so the stage degrades", async () => {
    const engines = [
      {
        name: "claude",
        ask: async () => {
          throw new Error("401 no key");
        },
      },
    ];
    await expect(runVisibilityProbes(args, engines)).rejects.toThrow(/no visibility engine/i);
  });

  it("truncates the receipt snippet", async () => {
    const engines = [engine("perplexity", () => ({ answer: "z".repeat(900), citedDomains: [] }))];
    const result = await runVisibilityProbes(args, engines);
    expect(result.answers[0]!.snippet.length).toBeLessThanOrEqual(300);
  });
});

describe("perplexityEngine", () => {
  it("reads the answer and citations out of a Sonar response", async () => {
    const stub = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Acme Roofing is in Boise." } }],
          citations: ["https://acme.example/", "https://bestroofs.example/x"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const out = await perplexityEngine("pk-test", stub).ask("who is Acme Roofing");
    expect(out.answer).toContain("Boise");
    expect(out.citedDomains).toEqual(["acme.example", "bestroofs.example"]);
  });

  it("reads the newer search_results shape", async () => {
    const stub = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "x" } }],
          search_results: [{ url: "https://acme.example/" }],
        }),
        { status: 200 },
      );
    const out = await perplexityEngine("pk-test", stub).ask("q");
    expect(out.citedDomains).toEqual(["acme.example"]);
  });

  it("throws on a non-2xx so the engine degrades", async () => {
    const stub = async () => new Response("rate limited", { status: 429 });
    await expect(perplexityEngine("pk-test", stub).ask("q")).rejects.toThrow(/429/);
  });
});
