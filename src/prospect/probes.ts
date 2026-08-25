import type Anthropic from "@anthropic-ai/sdk";
import type { ProbeAnswer, ProbesResult } from "./types.js";

/** One answer engine. Adding OpenAI or Gemini later means one more of these. */
export type VisibilityEngine = {
  name: string;
  ask: (query: string) => Promise<{ answer: string; citedDomains: string[] }>;
};

const MAX_QUERIES = 8;
const SNIPPET_CHARS = 300;

export function domainOf(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.replace(/^www\./i, "").toLowerCase();
  }
}

export type ProbeInput = {
  url: string;
  business: string;
  buyerQuestions: string[];
  competitors: string[];
};

/** Branded questions first (they are the ones the prospect will check), then the
 *  category questions the analyze pass surfaced, then competitor comparisons. */
export function buildQueries(input: ProbeInput): string[] {
  const name = input.business.trim() || domainOf(input.url);
  const queries = [
    `who is ${name}`,
    `${name} reviews`,
    ...input.buyerQuestions.slice(0, 3),
    ...input.competitors.slice(0, 2).map((c) => `${name} vs ${c}`),
  ];
  return [...new Set(queries)].slice(0, MAX_QUERIES);
}

/** Ask every engine every query. An engine that throws is skipped for that query;
 *  only a total wipeout fails the stage. */
export async function runVisibilityProbes(
  input: ProbeInput,
  engines: VisibilityEngine[],
): Promise<ProbesResult> {
  const queries = buildQueries(input);
  const prospect = domainOf(input.url);
  const brand = input.business.trim().toLowerCase();
  const answers: ProbeAnswer[] = [];
  const competitorCounts = new Map<string, number>();

  for (const engine of engines) {
    for (const query of queries) {
      let reply: { answer: string; citedDomains: string[] };
      try {
        reply = await engine.ask(query);
      } catch {
        continue;
      }
      const citedDomains = reply.citedDomains.map(domainOf);
      const domainCited = citedDomains.includes(prospect);
      const brandMentioned = brand.length > 0 && reply.answer.toLowerCase().includes(brand);
      for (const d of citedDomains) {
        if (d === prospect) continue;
        competitorCounts.set(d, (competitorCounts.get(d) ?? 0) + 1);
      }
      answers.push({
        engine: engine.name,
        query,
        domainCited,
        brandMentioned,
        citedDomains,
        snippet: reply.answer.slice(0, SNIPPET_CHARS),
      });
    }
  }

  if (answers.length === 0) {
    throw new Error("no visibility engine returned an answer");
  }

  const visible = answers.filter((a) => a.domainCited || a.brandMentioned).length;
  return {
    answers,
    visibilityScore: Math.round((visible / answers.length) * 100),
    competitorsSeen: [...competitorCounts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}

type SonarResponse = {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
  search_results?: { url?: string }[];
};

/** Perplexity Sonar — citations come back with the answer, which is the whole
 *  reason it is the first engine. */
export function perplexityEngine(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): VisibilityEngine {
  return {
    name: "perplexity",
    async ask(query) {
      const res = await fetchImpl("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: query }],
        }),
      });
      if (!res.ok) throw new Error(`perplexity: HTTP ${res.status}`);
      const data = (await res.json()) as SonarResponse;
      const answer = data.choices?.[0]?.message?.content ?? "";
      const cited =
        data.citations ??
        (data.search_results ?? []).map((r) => r.url).filter((u): u is string => Boolean(u));
      return { answer, citedDomains: cited.map(domainOf) };
    },
  };
}

/** Claude with the web-search server tool. `pause_turn` is resumed explicitly —
 *  the SDK does not do it for you, and an unresumed pause silently truncates.
 *
 *  Typed against the real `@anthropic-ai/sdk` response shapes (verified against
 *  the installed 0.120.0 `.d.ts`, no casts): `Message.content` (the response) and
 *  `MessageParam.content` (the request) are structurally compatible, so the
 *  paused assistant turn is pushed back as-is with no `as never`/`as unknown`
 *  escape hatch. `WebSearchToolResultBlock.content` is a discriminated union
 *  (`WebSearchToolResultError | WebSearchResultBlock[]`), so it is narrowed with
 *  `Array.isArray` rather than assumed to always be an array. */
export function claudeWebSearchEngine(): VisibilityEngine {
  return {
    name: "claude",
    async ask(query) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: query }];
      const collected: Anthropic.ContentBlock[] = [];
      for (let turn = 0; turn < 4; turn++) {
        const res = await client.messages.create({
          model: "claude-opus-5",
          max_tokens: 4000,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
          messages,
        });
        collected.push(...res.content);
        if (res.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: res.content });
      }

      const answer = collected
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      const citedDomains: string[] = [];
      for (const block of collected) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) citedDomains.push(domainOf(r.url));
        }
        if (block.type === "text" && block.citations) {
          for (const c of block.citations) {
            if (c.type === "web_search_result_location") citedDomains.push(domainOf(c.url));
          }
        }
      }
      return { answer, citedDomains };
    },
  };
}

/** Engines available from the current environment. Perplexity needs its key;
 *  Claude rides the same credential chain the analyze pass uses. */
export function defaultEngines(): VisibilityEngine[] {
  const engines: VisibilityEngine[] = [];
  const key = process.env.PERPLEXITY_API_KEY?.trim();
  if (key) engines.push(perplexityEngine(key));
  engines.push(claudeWebSearchEngine());
  return engines;
}
