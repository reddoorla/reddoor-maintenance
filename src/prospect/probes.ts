import type Anthropic from "@anthropic-ai/sdk";
import { pacedEach, sleep } from "./crawl.js";
import type { ProbeAnswer, ProbesResult } from "./types.js";

/** One answer engine. Adding OpenAI or Gemini later means one more of these. */
export type VisibilityEngine = {
  name: string;
  ask: (query: string) => Promise<{ answer: string; citedDomains: string[] }>;
};

const MAX_QUERIES = 8;
const SNIPPET_CHARS = 300;

/**
 * The model behind the Claude visibility probe — deliberately NOT the Opus 5
 * the analyze pass uses.
 *
 * The probe is a search harness, not a judgement: it sends one query, lets the
 * `web_search` server tool run, and the number that reaches `visibilityScore`
 * is extracted mechanically from citation URLs (`web_search_tool_result` blocks
 * and `web_search_result_location` citations). Nothing here is schema-
 * constrained or reasoned about, and the citations come from the same search
 * index whichever model drives the tool.
 *
 * It is also where the money is: seven probe calls per audit against the
 * analyze pass's one, so this single constant is roughly half the cost of an
 * audit. Opus here buys prose quality in `answer`, which only ever appears as a
 * 300-character snippet.
 *
 * The one field where model size could plausibly move the result is
 * `brandedRecognized` — a smaller model may hedge harder on an obscure
 * business. Worth a side-by-side on a real prospect if that number ever looks
 * wrong.
 */
export const PROBE_MODEL = "claude-sonnet-5";

export function domainOf(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.replace(/^www\./i, "").toLowerCase();
  }
}

/** True when `cited` and `prospect` are the same site — an exact match, or
 *  either is a subdomain of the other. A cited "blog.acme.example" (prospect
 *  "acme.example") and an engine citing the apex "acme.example" when the
 *  crawl itself ran on a subdomain (prospect "shop.acme.example") must both
 *  read as the prospect's own property, never as a competitor. Both arguments
 *  are already bare hostnames out of `domainOf`. */
function isSameSite(cited: string, prospect: string): boolean {
  return cited === prospect || cited.endsWith(`.${prospect}`) || prospect.endsWith(`.${cited}`);
}

const MAX_NAME_CHARS = 60;

/** A defensive floor under a model that still returns prose despite the schema
 *  asking for a bare name (`AnalyzeResult.businessName`): a real business name
 *  is short and is not a multi-sentence description. Anything longer than a
 *  name has any business being, or that contains a sentence break, is treated
 *  as unusable — we fall back to the domain rather than querying, or
 *  brand-matching against, a paragraph. */
export function resolveBusinessName(business: string, url: string): string {
  const trimmed = business.trim();
  if (!trimmed || trimmed.length > MAX_NAME_CHARS || /\.\s/.test(trimmed)) {
    return domainOf(url);
  }
  return trimmed;
}

export type ProbeInput = {
  url: string;
  /** The business's searchable NAME — "Acme Roofing", not a description of it
   *  (`AnalyzeResult.businessName`, typically). Guarded by `resolveBusinessName`
   *  against a model that returns prose anyway; empty falls back to the domain. */
  business: string;
  /** Standalone category searches (`AnalyzeResult.categoryQueries`) — sent to
   *  the engines verbatim, so each must make sense with no context beside it.
   *  Not `buyerQuestions`: those are written about the prospect's own site and
   *  as cold searches they have no antecedent. */
  categoryQueries: string[];
  competitors: string[];
};

export type ProbeQuery = { query: string; kind: ProbeAnswer["kind"] };

/** Branded queries first (they are the ones the prospect will check, but they
 *  echo the name back even when the engine knows nothing real — see `kind` on
 *  `ProbeAnswer`), then the category questions the analyze pass surfaced, then
 *  competitor comparisons. */
export function buildQueries(input: ProbeInput): ProbeQuery[] {
  const name = resolveBusinessName(input.business, input.url);
  const candidates: ProbeQuery[] = [
    { query: `who is ${name}`, kind: "branded" },
    { query: `${name} reviews`, kind: "branded" },
    ...input.categoryQueries.slice(0, 3).map((query): ProbeQuery => ({ query, kind: "category" })),
    ...input.competitors
      .slice(0, 2)
      .map((c): ProbeQuery => ({ query: `${name} vs ${c}`, kind: "competitor" })),
  ];
  const seen = new Set<string>();
  const deduped: ProbeQuery[] = [];
  for (const c of candidates) {
    if (seen.has(c.query)) continue;
    seen.add(c.query);
    deduped.push(c);
  }
  return deduped.slice(0, MAX_QUERIES);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does the answer name the brand as a WORD, rather than merely containing its
 *  letters? A plain `includes()` scored "Ace" on every "surface", "placement"
 *  and "spacer" in an engine's prose. Both sides are already lowercased by the
 *  caller; the boundaries are explicit rather than `\b` because a domain
 *  fallback ("acme.example") ends in a character class `\b` treats
 *  inconsistently. */
export function mentionsBrand(answer: string, brand: string): boolean {
  if (!brand) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(brand)}($|[^a-z0-9])`, "i").test(answer);
}

/** Is this name distinctive enough that an unprompted mention means anything on
 *  its own?
 *
 *  A multi-word name ("Reddoor Creative") or a domain ("acme.example") cannot
 *  turn up in an engine's prose by accident. A single bare word can: a prospect
 *  called Summit, Apex, Bloom, Grove or Anchor is a common noun, and an answer
 *  about their own industry will use it in the ordinary way. Word boundaries do
 *  not help — "the summit of the roofline" is a clean word match.
 *
 *  So a single-token name is not scored on a mention alone; it needs the domain
 *  citation to corroborate it. That under-credits a genuinely distinctive
 *  one-word brand, which is the error worth making: this number goes in front
 *  of the prospect, and "you were mentioned here" has to survive them reading
 *  the snippet underneath it. `brandMentioned` is still recorded truthfully
 *  either way — this governs only what the score counts. */
export function isDistinctiveName(brand: string): boolean {
  return /\s/.test(brand) || brand.includes(".");
}

/** A rate-limit response is worth one retry after a longer pause; anything else
 *  is a real failure and is left alone. */
function isRateLimited(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /429|529/.test(message);
}

export type ProbeRunOptions = {
  /** Delay between successive asks to the SAME engine, paced with crawl.ts's
   *  `pacedEach` so a metered, rate-limited API doesn't get hit back-to-back.
   *  Defaults to a modest pacing interval; pass 0 to run instantly (tests). */
  delayMs?: number;
  /** Injectable timer. Both the between-query pacing and the one retry's pause
   *  use this, so a test can assert on both without a real wait. */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_DELAY_MS = 250;
const RETRY_DELAY_MS = 2000;

/** Ask every engine every query, paced and with one retry on a rate limit. An
 *  engine that still fails after its retry is skipped for that query — nothing
 *  false is ever recorded for it — and only a total wipeout fails the stage. */
export async function runVisibilityProbes(
  input: ProbeInput,
  engines: VisibilityEngine[],
  opts: ProbeRunOptions = {},
): Promise<ProbesResult> {
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
  const sleepFn = opts.sleep ?? sleep;
  const queries = buildQueries(input);
  const prospect = domainOf(input.url);
  const brand = resolveBusinessName(input.business, input.url).toLowerCase();
  const answers: ProbeAnswer[] = [];
  const competitorCounts = new Map<string, number>();

  for (const engine of engines) {
    await pacedEach(
      queries,
      delayMs,
      async ({ query, kind }) => {
        let reply: { answer: string; citedDomains: string[] };
        try {
          reply = await engine.ask(query);
        } catch (err) {
          if (!isRateLimited(err)) return;
          await sleepFn(RETRY_DELAY_MS);
          try {
            reply = await engine.ask(query);
          } catch {
            return;
          }
        }
        const citedDomains = reply.citedDomains.map(domainOf);
        const domainCited = citedDomains.some((d) => isSameSite(d, prospect));
        const brandMentioned = mentionsBrand(reply.answer.toLowerCase(), brand);
        for (const d of citedDomains) {
          if (isSameSite(d, prospect)) continue;
          competitorCounts.set(d, (competitorCounts.get(d) ?? 0) + 1);
        }
        answers.push({
          engine: engine.name,
          query,
          kind,
          domainCited,
          brandMentioned,
          citedDomains,
          snippet: reply.answer.slice(0, SNIPPET_CHARS),
          truncated: reply.answer.length > SNIPPET_CHARS,
          askedAt: new Date().toISOString(),
        });
      },
      sleepFn,
    );
  }

  if (answers.length === 0) {
    throw new Error("no visibility engine returned an answer");
  }

  // See ProbesResult.visibilityScore / brandedRecognized in types.ts for why
  // these are two separate numbers: a branded query ("who is X") echoes the
  // name back even when the engine knows nothing real, so it cannot carry the
  // discoverability score — only a real domain citation on a branded query
  // counts toward brandedRecognized. The score is null, not 0, when no category
  // query ran at all.
  //
  // On a CATEGORY query the engine was never given the name, so mentioning it
  // unprompted is real recall — stronger evidence than a citation, and it counts.
  // But only for a name a mention can't be a coincidence for; see
  // isDistinctiveName for why a one-word brand needs the citation too.
  const categoryAnswers = answers.filter((a) => a.kind === "category");
  const nameIsDistinctive = isDistinctiveName(brand);
  const visibleCategory = categoryAnswers.filter(
    (a) => a.domainCited || (a.brandMentioned && nameIsDistinctive),
  ).length;
  const visibilityScore =
    categoryAnswers.length === 0
      ? null
      : Math.round((visibleCategory / categoryAnswers.length) * 100);
  const brandedRecognized = answers.some((a) => a.kind === "branded" && a.domainCited);

  return {
    answers,
    visibilityScore,
    brandedRecognized,
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

/** The seam over `client.messages.create` — narrowed to the non-streaming
 *  overload, since that's the only shape this engine ever asks for. Typed
 *  against the real `@anthropic-ai/sdk` request/response types so a test can
 *  inject a stub with no cast, the same way `perplexityEngine` injects `fetch`. */
export type ClaudeMessageCreate = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

async function defaultClaudeMessageCreate(): Promise<ClaudeMessageCreate> {
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
  const client = new AnthropicClient();
  return (params) => client.messages.create(params);
}

const MAX_CLAUDE_TURNS = 4;

/** Claude with the web-search server tool. `pause_turn` is resumed explicitly —
 *  the SDK does not do it for you, and an unresumed pause silently truncates.
 *
 *  Typed against the real `@anthropic-ai/sdk` 0.120.0 response shapes, verified
 *  against the installed `.d.ts` (no casts): `Message.content` (the response)
 *  and `MessageParam.content` (the request) are structurally compatible, so the
 *  paused assistant turn is pushed back as-is. `WebSearchToolResultBlock.content`
 *  is a discriminated union (`WebSearchToolResultError | WebSearchResultBlock[]`),
 *  so it is narrowed with `Array.isArray` rather than assumed to always be an
 *  array — an error variant must not throw, it simply contributes no citations. */
export function claudeWebSearchEngine(createMessage?: ClaudeMessageCreate): VisibilityEngine {
  return {
    name: "claude",
    async ask(query) {
      const create = createMessage ?? (await defaultClaudeMessageCreate());
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: query }];
      const collected: Anthropic.ContentBlock[] = [];
      for (let turn = 0; turn < MAX_CLAUDE_TURNS; turn++) {
        const res = await create({
          model: PROBE_MODEL,
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
