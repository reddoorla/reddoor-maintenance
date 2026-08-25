import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildQueries,
  resolveBusinessName,
  domainOf,
  runVisibilityProbes,
  perplexityEngine,
  claudeWebSearchEngine,
  type VisibilityEngine,
  type ClaudeMessageCreate,
} from "../../src/prospect/probes.js";

const engine = (
  name: string,
  reply: (q: string) => { answer: string; citedDomains: string[] },
): VisibilityEngine => ({
  name,
  ask: async (q) => reply(q),
});

describe("buildQueries", () => {
  it("asks the branded queries, then the category searches", () => {
    const queries = buildQueries({
      business: "Acme Roofing",
      url: "https://acme.example/",
      categoryQueries: [
        "how much does a roof repair cost",
        "flat roof contractors Boise",
        "emergency roof repair near me",
        "Extra",
      ],
      competitors: [],
    });
    expect(queries[0]).toEqual({ query: "who is Acme Roofing", kind: "branded" });
    expect(queries[1]).toEqual({ query: "Acme Roofing reviews", kind: "branded" });
    const byQuery = queries.map((q) => q.query);
    expect(byQuery).toContain("how much does a roof repair cost");
    expect(queries.find((q) => q.query === "how much does a roof repair cost")!.kind).toBe(
      "category",
    );
    expect(queries.length).toBeLessThanOrEqual(8);
  });

  // The production regression this field exists to prevent. Before it, the
  // category slots were fed AnalyzeResult.buyerQuestions verbatim — questions
  // written about the prospect's own site, which carry a pronoun or a bare
  // "this agency" and are meaningless as a standalone search. Two of the three
  // category probes in the first real audit came back "I don't have any context
  // about who 'they' refers to", scoring the prospect 0 on our own bad prompt.
  // buildQueries passes these through untouched, so nothing downstream can
  // repair a query that arrives broken: the guarantee has to hold here.
  it("passes category searches through verbatim, so they must stand alone", () => {
    const standalone = ["how much does a rebrand cost", "packaging design agency Los Angeles"];
    const queries = buildQueries({
      business: "Acme Roofing",
      url: "https://acme.example/",
      categoryQueries: standalone,
      competitors: [],
    });
    const category = queries.filter((q) => q.kind === "category").map((q) => q.query);
    expect(category).toEqual(standalone);
    for (const q of category) {
      expect(q).not.toMatch(/\b(they|them|this agency|this company|your|you)\b/i);
    }
  });

  it("adds comparison queries for each competitor", () => {
    const queries = buildQueries({
      business: "Acme Roofing",
      url: "https://acme.example/",
      categoryQueries: [],
      competitors: ["bestroofs.example", "toproof.example"],
    });
    const byQuery = queries.map((q) => q.query);
    expect(byQuery).toContain("Acme Roofing vs bestroofs.example");
    expect(byQuery).toContain("Acme Roofing vs toproof.example");
    expect(queries.find((q) => q.query === "Acme Roofing vs bestroofs.example")!.kind).toBe(
      "competitor",
    );
  });

  it("falls back to the domain when there is no business name", () => {
    const queries = buildQueries({
      business: "",
      url: "https://acme.example/",
      categoryQueries: [],
      competitors: [],
    });
    expect(queries[0]!.query).toBe("who is acme.example");
  });

  it("falls back to the domain when the business field is prose, not a name", () => {
    // The regression: AnalyzeResult.business (now businessName) can still come
    // back as a description if a model ignores the schema's field name — a
    // sentence-length "name" is unsearchable and must not reach the query.
    const queries = buildQueries({
      business:
        "A residential and commercial roofing contractor serving the Boise, Idaho metro area.",
      url: "https://acme.example/",
      categoryQueries: [],
      competitors: [],
    });
    expect(queries[0]!.query).toBe("who is acme.example");
  });
});

describe("resolveBusinessName", () => {
  it("keeps a short proper-noun name", () => {
    expect(resolveBusinessName("Acme Roofing", "https://acme.example/")).toBe("Acme Roofing");
  });

  it("falls back to the domain for a long description", () => {
    const description =
      "A residential and commercial roofing contractor serving the Boise, Idaho metro area.";
    expect(resolveBusinessName(description, "https://acme.example/")).toBe("acme.example");
  });

  it("falls back to the domain for a short multi-sentence description", () => {
    expect(resolveBusinessName("Acme Roofing. We serve Boise.", "https://acme.example/")).toBe(
      "acme.example",
    );
  });

  it("falls back to the domain when the name is empty", () => {
    expect(resolveBusinessName("", "https://acme.example/")).toBe("acme.example");
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
    categoryQueries: ["how much does a roof repair cost"],
    competitors: [],
  };

  it("scores a category answer, but treats a branded echo as a different signal (brandedRecognized)", async () => {
    const engines = [
      engine("perplexity", (q) =>
        q.startsWith("who is")
          ? { answer: "Acme Roofing is a Boise contractor.", citedDomains: ["acme.example"] }
          : { answer: "Several contractors serve Boise.", citedDomains: ["bestroofs.example"] },
      ),
    ];
    const result = await runVisibilityProbes(args, engines, { delayMs: 0 });
    expect(result.answers).toHaveLength(3);
    const branded = result.answers.find((a) => a.query === "who is Acme Roofing")!;
    expect(branded.kind).toBe("branded");
    expect(branded.domainCited).toBe(true);
    expect(branded.brandMentioned).toBe(true);
    const category = result.answers.find((a) => a.kind === "category")!;
    expect(category.domainCited).toBe(false);
    expect(category.brandMentioned).toBe(false);
    // The branded "who is" query got a real citation, but the one real buyer
    // question got nothing back — the score reflects that. A name-echo-based
    // score would have read 1-of-3 = 33% here.
    expect(result.visibilityScore).toBe(0);
    expect(result.brandedRecognized).toBe(true);
  });

  it("counts the competitors the engines cited instead", async () => {
    const engines = [
      engine("perplexity", () => ({
        answer: "Try BestRoofs.",
        citedDomains: ["bestroofs.example", "www.bestroofs.example", "toproof.example"],
      })),
    ];
    const result = await runVisibilityProbes(args, engines, { delayMs: 0 });
    expect(result.competitorsSeen[0]).toEqual({ domain: "bestroofs.example", count: 6 });
    expect(result.visibilityScore).toBe(0);
    expect(result.brandedRecognized).toBe(false);
  });

  it("keeps the answers of a working engine when another one fails", async () => {
    const sleepCalls: number[] = [];
    const engines = [
      engine("perplexity", () => ({ answer: "Acme Roofing.", citedDomains: ["acme.example"] })),
      {
        name: "claude",
        ask: async () => {
          throw new Error("401 no key");
        },
      },
    ];
    const result = await runVisibilityProbes(args, engines, {
      delayMs: 0,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });
    expect(result.answers.every((a) => a.engine === "perplexity")).toBe(true);
    expect(result.visibilityScore).toBe(100);
    expect(result.brandedRecognized).toBe(true);
    // 401 is not a rate limit — it must not trigger the retry pause.
    expect(sleepCalls).not.toContain(2000);
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
    await expect(runVisibilityProbes(args, engines, { delayMs: 0 })).rejects.toThrow(
      /no visibility engine/i,
    );
  });

  it("truncates the receipt snippet and stamps when it was asked", async () => {
    const engines = [engine("perplexity", () => ({ answer: "z".repeat(900), citedDomains: [] }))];
    const result = await runVisibilityProbes(args, engines, { delayMs: 0 });
    expect(result.answers[0]!.snippet.length).toBeLessThanOrEqual(300);
    expect(result.answers[0]!.askedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // Item 4b: SNIPPET_CHARS is private to this module, and the renderer used
  // to re-derive "was this truncated?" from `snippet.length >= 300` — a
  // second copy of the same threshold that would silently drift if
  // SNIPPET_CHARS were ever tuned. Carry the boolean explicitly, set exactly
  // where the truncation happens, so there is only one source of truth.
  it("sets truncated: true only when the answer actually exceeded the snippet cap", async () => {
    const engines = [engine("perplexity", () => ({ answer: "z".repeat(900), citedDomains: [] }))];
    const result = await runVisibilityProbes(args, engines, { delayMs: 0 });
    expect(result.answers[0]!.truncated).toBe(true);
  });

  it("sets truncated: false when the answer is under the snippet cap", async () => {
    const engines = [engine("perplexity", () => ({ answer: "a short answer", citedDomains: [] }))];
    const result = await runVisibilityProbes(args, engines, { delayMs: 0 });
    expect(result.answers.every((a) => a.truncated === false)).toBe(true);
  });

  it("treats the prospect's own apex as the same site when the crawl ran on www", async () => {
    const wwwArgs = {
      url: "https://www.acme.example/",
      business: "Acme Roofing",
      categoryQueries: ["emergency roof repair Boise"],
      competitors: [],
    };
    const engines = [
      engine("perplexity", () => ({
        answer: "Yes — see the emergency page.",
        citedDomains: ["https://acme.example/emergency"],
      })),
    ];
    const result = await runVisibilityProbes(wwwArgs, engines, { delayMs: 0 });
    const category = result.answers.find((a) => a.kind === "category")!;
    expect(category.domainCited).toBe(true);
    expect(result.competitorsSeen).toHaveLength(0);
  });

  it("treats an engine-cited subdomain of the prospect as the prospect's own, not a competitor", async () => {
    const engines = [
      engine("perplexity", () => ({
        answer: "Check their blog for pricing.",
        citedDomains: ["https://blog.acme.example/pricing"],
      })),
    ];
    const result = await runVisibilityProbes(args, engines, { delayMs: 0 });
    const category = result.answers.find((a) => a.kind === "category")!;
    expect(category.domainCited).toBe(true);
    expect(result.competitorsSeen).toHaveLength(0);
  });

  it("treats a cited parent apex as the prospect's own when the crawl itself ran on a subdomain", async () => {
    const subdomainArgs = {
      url: "https://shop.acme.example/",
      business: "Acme Roofing",
      categoryQueries: ["how much does a roof repair cost"],
      competitors: [],
    };
    const engines = [
      engine("perplexity", () => ({
        answer: "Acme Roofing handles most repairs.",
        citedDomains: ["https://acme.example/"],
      })),
    ];
    const result = await runVisibilityProbes(subdomainArgs, engines, { delayMs: 0 });
    const category = result.answers.find((a) => a.kind === "category")!;
    expect(category.domainCited).toBe(true);
    expect(result.competitorsSeen).toHaveLength(0);
  });

  it("paces successive asks to the same engine using the injected delay", async () => {
    const sleepCalls: number[] = [];
    const fakeSleep = async (ms: number) => {
      sleepCalls.push(ms);
    };
    const engines = [engine("perplexity", () => ({ answer: "ok", citedDomains: [] }))];
    // args has 3 queries (2 branded + 1 category) — 2 gaps between them.
    await runVisibilityProbes(args, engines, { delayMs: 10, sleep: fakeSleep });
    expect(sleepCalls.filter((ms) => ms === 10)).toHaveLength(2);
  });

  it("retries once after a longer pause on a 429, keeping the answer if the retry succeeds", async () => {
    const sleepCalls: number[] = [];
    const fakeSleep = async (ms: number) => {
      sleepCalls.push(ms);
    };
    let attempt = 0;
    const flaky: VisibilityEngine = {
      name: "perplexity",
      ask: async (q) => {
        if (!q.startsWith("who is")) return { answer: "ok", citedDomains: [] };
        attempt++;
        if (attempt === 1) throw new Error("429 Too Many Requests");
        return { answer: "Acme Roofing.", citedDomains: ["acme.example"] };
      },
    };
    const result = await runVisibilityProbes(args, [flaky], { delayMs: 0, sleep: fakeSleep });
    expect(sleepCalls).toContain(2000);
    const branded = result.answers.find((a) => a.query === "who is Acme Roofing");
    expect(branded).toBeDefined();
    expect(branded!.domainCited).toBe(true);
  });

  it("does not retry, and records nothing, when the retry also fails", async () => {
    const engines: VisibilityEngine[] = [
      {
        name: "perplexity",
        ask: async (q) => {
          if (q.startsWith("who is")) throw new Error("529 overloaded");
          return { answer: "ok", citedDomains: [] };
        },
      },
    ];
    const result = await runVisibilityProbes(args, engines, {
      delayMs: 0,
      sleep: async () => {},
    });
    expect(result.answers.some((a) => a.query === "who is Acme Roofing")).toBe(false);
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

describe("claudeWebSearchEngine", () => {
  const usage: Anthropic.Usage = {
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    input_tokens: 10,
    output_tokens: 10,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
  };

  function claudeMessage(
    content: Anthropic.ContentBlock[],
    stop_reason: Anthropic.StopReason,
  ): Anthropic.Message {
    return {
      id: "msg_test",
      container: null,
      content,
      model: "claude-opus-5",
      role: "assistant",
      stop_details: null,
      stop_reason,
      stop_sequence: null,
      type: "message",
      usage,
    };
  }

  function textBlock(
    text: string,
    citations: Anthropic.TextCitation[] | null = null,
  ): Anthropic.TextBlock {
    return { type: "text", text, citations };
  }

  function searchResultBlock(url: string): Anthropic.WebSearchResultBlock {
    return {
      type: "web_search_result",
      url,
      title: "result",
      encrypted_content: "x",
      page_age: null,
    };
  }

  function toolResultBlock(
    content: Anthropic.WebSearchToolResultBlockContent,
  ): Anthropic.WebSearchToolResultBlock {
    return {
      type: "web_search_tool_result",
      tool_use_id: "tu_1",
      caller: { type: "direct" },
      content,
    };
  }

  it("accumulates text across a pause_turn resume", async () => {
    const callMessageCounts: number[] = [];
    const createMessage: ClaudeMessageCreate = async (params) => {
      callMessageCounts.push(params.messages.length);
      return callMessageCounts.length === 1
        ? claudeMessage([textBlock("Part one.")], "pause_turn")
        : claudeMessage([textBlock("Part two.")], "end_turn");
    };
    const out = await claudeWebSearchEngine(createMessage).ask("who is Acme Roofing");
    expect(out.answer).toBe("Part one.\nPart two.");
    // First call carries just the user turn; the second carries the pushed-back
    // assistant turn too — proof the pause was actually resumed, not dropped.
    expect(callMessageCounts).toEqual([1, 2]);
  });

  it("collects citations from tool-result blocks and from text citations", async () => {
    const citation: Anthropic.CitationsWebSearchResultLocation = {
      type: "web_search_result_location",
      url: "https://acme.example/",
      title: "Acme",
      cited_text: "Acme Roofing",
      encrypted_index: "enc",
    };
    const createMessage: ClaudeMessageCreate = async () =>
      claudeMessage(
        [
          textBlock("Acme Roofing is in Boise.", [citation]),
          toolResultBlock([searchResultBlock("https://bestroofs.example/")]),
        ],
        "end_turn",
      );
    const out = await claudeWebSearchEngine(createMessage).ask("who is Acme Roofing");
    expect([...out.citedDomains].sort()).toEqual(["acme.example", "bestroofs.example"]);
  });

  it("does not throw when a web-search tool result is the error variant", async () => {
    const createMessage: ClaudeMessageCreate = async () =>
      claudeMessage(
        [
          textBlock("No results found."),
          toolResultBlock({ type: "web_search_tool_result_error", error_code: "unavailable" }),
        ],
        "end_turn",
      );
    const out = await claudeWebSearchEngine(createMessage).ask("who is Acme Roofing");
    expect(out.citedDomains).toEqual([]);
    expect(out.answer).toBe("No results found.");
  });

  it("stops at its turn bound when every turn pauses", async () => {
    let calls = 0;
    const createMessage: ClaudeMessageCreate = async () => {
      calls++;
      return claudeMessage([textBlock(`Turn ${calls}.`)], "pause_turn");
    };
    const out = await claudeWebSearchEngine(createMessage).ask("who is Acme Roofing");
    expect(calls).toBe(4);
    expect(out.answer.split("\n")).toHaveLength(4);
  });
});
