import { parse, HTMLElement, NodeType } from "node-html-parser";
import type { CrawlResult, PageCapture, RobotsAgentAccess } from "./types.js";
import { extractPage, UNRENDERED_TAGS } from "./extract.js";

/** The answer-engine crawlers the report scores. */
export const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
] as const;

/** The classical baseline — a prospect blocking these has a bigger problem than AEO. */
export const CLASSICAL_AGENTS = ["Googlebot", "Bingbot"] as const;

export const ALL_AGENTS: string[] = [...AI_AGENTS, ...CLASSICAL_AGENTS];

type RobotsRule = { type: "allow" | "disallow"; path: string; line: string };
type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

/** Parse robots.txt into agent groups. Consecutive `User-agent:` lines share one
 *  rule set, per the robots.txt convention. */
export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = (rawLine.split("#")[0] ?? "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      if (!current) continue;
      current.rules.push({ type: field === "allow" ? "allow" : "disallow", path: value, line });
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Does a robots.txt path pattern cover the site root? RFC 9309 gives `*` the
 *  meaning "any run of characters" and `$` the meaning "end of path", so
 *  `Disallow: /`, `Disallow: /*` and `Disallow: /$` are three spellings of one
 *  site-wide block. Matching only the literal "/" reports a fully blocked site
 *  as open — the one error this report must never make. */
export function pathCoversRoot(pattern: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test("/");
}

/** Can each agent fetch the site root? Only rules that cover "/" decide: a
 *  `Disallow: /admin` scopes a section, not the site, and must not read as a
 *  block in the report. An agent-specific group wins over the wildcard group. */
export function evaluateAgentAccess(robotsTxt: string | null): RobotsAgentAccess[] {
  if (robotsTxt === null) {
    return ALL_AGENTS.map((agent) => ({ agent, allowed: true, matchedRule: null }));
  }
  const groups = parseRobots(robotsTxt);
  return ALL_AGENTS.map((agent) => {
    const lower = agent.toLowerCase();
    // RFC 9309: every group naming this agent is combined into one; the wildcard
    // group is consulted ONLY when no group names it. Appending a second
    // `User-agent: GPTBot` block is exactly what the block-the-AI-bots guides
    // tell owners to do, so first-match-wins reads such a file in the wrong order.
    const named = groups.filter((g) => g.agents.includes(lower));
    const matched = named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"));
    if (matched.length === 0) return { agent, allowed: true, matchedRule: null };
    const header = `User-agent: ${named.length > 0 ? agent : "*"}`;
    const rootRules = matched.flatMap((g) => g.rules).filter((r) => pathCoversRoot(r.path));
    const block = rootRules.find((r) => r.type === "disallow");
    const allow = rootRules.find((r) => r.type === "allow");
    if (block && !allow) return { agent, allowed: false, matchedRule: `${header} → ${block.line}` };
    return { agent, allowed: true, matchedRule: allow ? `${header} → ${allow.line}` : null };
  });
}

/** Same-origin http(s) hrefs in document order, absolute, fragment-stripped, deduped. */
export function sameOriginLinks(html: string, baseUrl: string): string[] {
  const site = new URL(baseUrl);
  const doc = parse(html);
  const baseHref = doc.querySelector("base")?.getAttribute("href");
  let resolveBase = site;
  if (baseHref) {
    try {
      resolveBase = new URL(baseHref, site);
    } catch {
      // A malformed <base> is ignored, exactly as a browser ignores it.
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (el: HTMLElement): void => {
    for (const child of el.childNodes) {
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const e = child as HTMLElement;
      if (UNRENDERED_TAGS.has(e.tagName)) continue;
      if (e.tagName === "A") {
        const href = e.getAttribute("href");
        if (href) {
          let u: URL | null;
          try {
            u = new URL(href, resolveBase);
          } catch {
            u = null;
          }
          if (
            u &&
            u.origin === site.origin &&
            (u.protocol === "http:" || u.protocol === "https:")
          ) {
            u.hash = "";
            const norm = u.toString();
            if (!seen.has(norm)) {
              seen.add(norm);
              out.push(norm);
            }
          }
        }
      }
      walk(e);
    }
  };
  walk(doc);
  return out;
}

/** Sitemap XML escapes `&` as `&amp;`, so a URL with a query string arrives
 *  encoded; handing that straight to fetch requests a different resource. */
function decodeXmlText(s: string): string {
  return (
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // Last, so `&amp;lt;` decodes to the literal `&lt;` rather than to `<`.
      .replace(/&amp;/g, "&")
  );
}

export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<(?:[\w-]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?loc>/gi)]
    .map((m) => decodeXmlText(m[1] ?? "").trim())
    .filter(Boolean);
}

export function isSitemapIndex(xml: string): boolean {
  return /<(?:[\w-]+:)?sitemapindex[\s>]/i.test(xml);
}

export type FetchResponse = { status: number; body: string; headers: Record<string, string> };

export type CrawlDeps = {
  fetchUrl: (url: string) => Promise<FetchResponse>;
  /** Rendered DOM per URL. A URL absent from the map has no rendered extract. */
  renderPages: (urls: string[]) => Promise<Map<string, string>>;
  maxPages: number;
  delayMs: number;
};

/** Honest, identified UA — we audit on the prospect's behalf and say so. */
export const USER_AGENT = "ReddoorAudit/1.0 (+https://reddoorla.com/; operator-run site audit)";

const ASSET_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|zip|mp4|mov|css|js|xml|json)$/i;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Never throws — a missing robots/sitemap/llms file is information, not a failure. */
async function optional(deps: CrawlDeps, url: string): Promise<FetchResponse | null> {
  try {
    const res = await deps.fetchUrl(url);
    return res.status >= 400 ? null : res;
  } catch {
    return null;
  }
}

/** A text sidecar that actually is text. Netlify/SPA catch-alls answer 200 with
 *  an HTML shell for /robots.txt and /llms.txt; reading that as a robots file
 *  would invent rules the site never wrote. */
function textSidecar(res: FetchResponse | null): string | null {
  if (!res) return null;
  const body = res.body.trim();
  if (!body || body.startsWith("<")) return null;
  return res.body;
}

function normalizeCandidates(urls: string[], origin: string, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (ASSET_EXT.test(u.pathname)) continue;
    u.hash = "";
    const norm = u.toString();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Fetch the prospect's site: robots/sitemap/llms sidecars, then up to
 * `maxPages` same-origin pages, each captured BOTH as raw HTTP HTML (what a
 * non-JS crawler sees) and as rendered DOM (what a browser sees). Sequential
 * and delayed — this is someone else's server.
 */
export async function crawlSite(rawUrl: string, deps: CrawlDeps): Promise<CrawlResult> {
  const start = new URL(rawUrl);
  const origin = start.origin;

  let home: FetchResponse;
  try {
    home = await deps.fetchUrl(start.toString());
  } catch (err) {
    throw Object.assign(
      new Error(
        `Could not reach ${start.toString()}: ${err instanceof Error ? err.message : String(err)}`,
      ),
      { exitCode: 1 },
    );
  }
  if (home.status >= 400) {
    throw Object.assign(
      new Error(`${start.toString()} returned HTTP ${home.status} — nothing to audit.`),
      { exitCode: 1 },
    );
  }

  const robotsTxt = textSidecar(await optional(deps, `${origin}/robots.txt`));
  const agentAccess: RobotsAgentAccess[] = evaluateAgentAccess(
    robotsTxt && /user-agent/i.test(robotsTxt) ? robotsTxt : null,
  );

  const llmsRaw = textSidecar(await optional(deps, `${origin}/llms.txt`));
  const llmsTxt = llmsRaw
    ? {
        present: true,
        firstLine:
          llmsRaw
            .split(/\r?\n/)
            .find((l) => l.trim())
            ?.trim() ?? null,
      }
    : { present: false, firstLine: null };

  const sitemapRes = await optional(deps, `${origin}/sitemap.xml`);
  let sitemapUrls: string[] = [];
  let sitemapPresent = false;
  if (sitemapRes && /<(urlset|sitemapindex)[\s>]/i.test(sitemapRes.body)) {
    sitemapPresent = true;
    if (isSitemapIndex(sitemapRes.body)) {
      for (const child of parseSitemapLocs(sitemapRes.body).slice(0, 3)) {
        const nested = await optional(deps, child);
        if (nested) sitemapUrls.push(...parseSitemapLocs(nested.body));
      }
    } else {
      sitemapUrls = parseSitemapLocs(sitemapRes.body);
    }
  }

  const pageUrls = normalizeCandidates(
    [start.toString(), ...sitemapUrls, ...sameOriginLinks(home.body, start.toString())],
    origin,
    deps.maxPages,
  );

  const rendered = await deps.renderPages(pageUrls).catch(() => new Map<string, string>());

  const pages: PageCapture[] = [];
  for (const url of pageUrls) {
    let res: FetchResponse | null = null;
    let error: string | null = null;
    if (url === start.toString()) {
      res = home;
    } else {
      if (deps.delayMs > 0) await sleep(deps.delayMs);
      try {
        res = await deps.fetchUrl(url);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    const renderedHtml = rendered.get(url) ?? null;
    const usable = res !== null && res.status < 400;
    pages.push({
      url,
      status: res?.status ?? null,
      raw: usable ? extractPage(res!.body) : null,
      rendered: renderedHtml ? extractPage(renderedHtml) : null,
      error: error ?? (res && res.status >= 400 ? `HTTP ${res.status}` : null),
    });
  }

  const homeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(home.headers)) homeHeaders[k.toLowerCase()] = v;

  return {
    origin,
    robotsTxt,
    agentAccess,
    sitemap: { present: sitemapPresent, urlCount: sitemapUrls.length },
    llmsTxt,
    homeHeaders,
    pages,
  };
}

/** Real deps: identified sequential fetches + one shared Playwright chromium.
 *  Playwright is imported lazily so unit tests (which inject deps) never load it. */
export function defaultCrawlDeps(over: Partial<CrawlDeps> = {}): CrawlDeps {
  return {
    async fetchUrl(url) {
      const res = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain,*/*",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { status: res.status, body: await res.text(), headers };
    },
    async renderPages(urls) {
      const { chromium } = await import("@playwright/test");
      const out = new Map<string, string>();
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext({ userAgent: USER_AGENT });
        const page = await ctx.newPage();
        for (const url of urls) {
          try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
            out.set(url, await page.content());
          } catch {
            // A page that won't render simply has no rendered extract.
          }
        }
      } finally {
        await browser.close();
      }
      return out;
    },
    maxPages: 20,
    delayMs: 500,
    ...over,
  };
}
