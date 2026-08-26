import { parse, HTMLElement, NodeType } from "node-html-parser";
import type { CrawlResult, PageCapture, RobotsAgentAccess } from "./types.js";
import { extractPage, UNRENDERED_TAGS } from "./extract.js";
import { isPrivateOrLoopbackHost } from "../util/url.js";

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

/** Word/Google-Docs paste soup and broken page-builder plugins nest ordinary
 *  markup far past anything hand-written would reach — a plain recursive walk
 *  throws `RangeError: Maximum call stack size exceeded` around 5,000 levels.
 *  Mirrors checks.ts's `MAX_SCHEMA_DEPTH` precedent: generous enough that no
 *  real page is anywhere near it, so the branch just stops descending. */
const MAX_WALK_DEPTH = 100;

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
  const walk = (el: HTMLElement, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) return;
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
      walk(e, depth + 1);
    }
  };
  walk(doc, 0);
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

/**
 * May we fetch this nested sitemap?
 *
 * A `<loc>` inside a sitemap index is attacker-controlled input — it comes from
 * the site being audited, which by definition is a stranger's. Same-origin is
 * the binding constraint: a sitemap index legitimately only ever points at
 * sitemaps on its own site, so anything else is a mistake or an attempt, and
 * refusing costs nothing real.
 *
 * The private-host check is defence in depth behind that. It is redundant while
 * `origin` is a public site — which the dispatch path already enforces — but
 * this function should not depend on a guarantee made three files away.
 */
export function isSafeNestedSitemap(child: string, origin: string): boolean {
  let url: URL;
  try {
    // Resolved against `origin` so a relative <loc> is judged on where it
    // actually lands, not on the string.
    url = new URL(child, origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.origin !== origin) return false;
  return !isPrivateOrLoopbackHost(url.hostname);
}

export function isSitemapIndex(xml: string): boolean {
  return /<(?:[\w-]+:)?sitemapindex[\s>]/i.test(xml);
}

export type FetchResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
  /** The URL after redirects. Absent → the requested URL was final. */
  url?: string;
};

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

/** A generous multi-megabyte ceiling on any one response body — a real
 *  business homepage (or robots.txt/llms.txt/sitemap.xml) is far below it.
 *  Applies to every fetch `defaultCrawlDeps` makes: without it, an 80MB
 *  page-builder bloat page reads in whole (proven: process RSS 64MB → 423MB),
 *  and up to `maxPages` of those can be held in memory at once. Exported so a
 *  test can assert against it directly. */
export const MAX_RESPONSE_BYTES = 5_000_000;

/** How long to let a page settle after `load` before capturing its DOM.
 *
 *  The rendered extract exists to be compared against the raw HTML, and the
 *  difference is what a client-side framework painted — so the capture has to
 *  happen after hydration or it measures nothing. Long enough for that,
 *  nowhere near long enough to wait out a polling widget. Exported so a test
 *  can assert the budget rather than rediscover it. */
export const RENDER_SETTLE_MS = 1_500;

/** Thrown by `defaultCrawlDeps().fetchUrl` when a body exceeds
 *  `MAX_RESPONSE_BYTES` — either the declared `content-length` refuses the
 *  request early, or the actual byte count catches a missing or lying header
 *  mid-stream. Its own class so callers can tell "too large" apart from a
 *  genuine transport failure: `optional()` below treats it as an absent
 *  sidecar (like a 404), not a fetch error worth reporting. */
export class ResponseTooLargeError extends Error {
  constructor(url: string) {
    super(`response exceeds the ${MAX_RESPONSE_BYTES}-byte limit: ${url}`);
    this.name = "ResponseTooLargeError";
  }
}

/** Exported so probes.ts (which paces calls to metered AI-visibility APIs
 *  with the same `pacedEach`) doesn't need its own identical copy. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Runs `fn` once per item, waiting `delayMs` between calls but never before
 *  the first — the same courtesy pacing the raw-fetch loop already applies to
 *  a prospect's server, given here to the heavier half of the traffic (each
 *  Playwright navigation pulls images, fonts and third-party scripts). A
 *  standalone, dependency-free function so the pacing itself is unit-testable
 *  without loading Playwright. */
export async function pacedEach<T>(
  items: T[],
  delayMs: number,
  fn: (item: T) => Promise<void>,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && delayMs > 0) await sleepFn(delayMs);
    await fn(items[i]!);
  }
}

type SidecarFetch = { res: FetchResponse | null; error: string | null };

/** A 4xx/404 is a genuinely absent file — `{res: null, error: null}`. A thrown
 *  request means we do not know whether the file exists — `{res: null, error}`
 *  — and that distinction must survive downstream: reporting "no robots.txt"
 *  when the fetch itself failed would claim the site's crawlers are
 *  unrestricted when we simply never looked. A `ResponseTooLargeError` is
 *  neither: we DO know the file exists, we simply decline to read all of it —
 *  so it reads as absent, exactly like a 404, rather than as a sidecar error. */
async function optional(deps: CrawlDeps, url: string): Promise<SidecarFetch> {
  try {
    const res = await deps.fetchUrl(url);
    return res.status >= 400 ? { res: null, error: null } : { res, error: null };
  } catch (err) {
    if (err instanceof ResponseTooLargeError) return { res: null, error: null };
    return { res: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** robots.txt alone decides the whole crawler-access section of the report, so
 *  a transient failure on it — and only it — is worth one extra request before
 *  we give up and record the error. */
async function optionalRobots(deps: CrawlDeps, url: string): Promise<SidecarFetch> {
  const first = await optional(deps, url);
  return first.error === null ? first : optional(deps, url);
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

/** Case-insensitive header lookup — `FetchResponse.headers` keys arrive in
 *  whatever case the server (or a test stub) used. */
function headerValue(headers: Record<string, string>, name: string): string | null {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return v;
  }
  return null;
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

type Sidecars = {
  robotsTxt: string | null;
  agentAccess: RobotsAgentAccess[];
  llmsTxt: { present: boolean; firstLine: string | null };
  sitemapUrls: string[];
  sitemapPresent: boolean;
  sidecarErrors: { robots: string | null; llms: string | null; sitemap: string | null };
};

/** robots.txt, llms.txt and sitemap.xml — every one degrades instead of
 *  failing the crawl, but a transport failure must stay visible in the result
 *  (see `optional`/`optionalRobots` above) rather than reading as "file
 *  absent". */
async function fetchSidecars(origin: string, deps: CrawlDeps): Promise<Sidecars> {
  const robots = await optionalRobots(deps, `${origin}/robots.txt`);
  const robotsTxt = textSidecar(robots.res);
  const agentAccess = evaluateAgentAccess(
    robotsTxt && /user-agent/i.test(robotsTxt) ? robotsTxt : null,
  );

  const llms = await optional(deps, `${origin}/llms.txt`);
  const llmsRaw = textSidecar(llms.res);
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

  const sitemap = await optional(deps, `${origin}/sitemap.xml`);
  let sitemapUrls: string[] = [];
  let sitemapPresent = false;
  if (sitemap.res && /<(urlset|sitemapindex)[\s>]/i.test(sitemap.res.body)) {
    sitemapPresent = true;
    if (isSitemapIndex(sitemap.res.body)) {
      // `child` is attacker-controlled: it comes out of the AUDITED site's
      // sitemap, and the audited site is a prospect we have not met. Without
      // isSafeNestedSitemap it reached fetch() unchecked — a hostile index could
      // make the runner request 169.254.169.254, 127.0.0.1 or any internal host,
      // from a GitHub Actions job holding TURSO_AUTH_TOKEN, RESEND_API_KEY and
      // ANTHROPIC_API_KEY.
      //
      // Filter BEFORE the cap, not inside the loop after it. Taking the first
      // three and then discarding the unsafe ones lets three hostile entries at
      // the top of an index consume the entire budget and starve out the site's
      // real sitemaps — the crawl then silently sees fewer pages, which is a
      // quieter failure than the SSRF itself. Caught by the positive control in
      // the SSRF test, not by reading the loop.
      const children = parseSitemapLocs(sitemap.res.body)
        .filter((child) => isSafeNestedSitemap(child, origin))
        .slice(0, 3);
      for (const child of children) {
        const nested = await optional(deps, child);
        if (nested.res) sitemapUrls.push(...parseSitemapLocs(nested.res.body));
      }
    } else {
      sitemapUrls = parseSitemapLocs(sitemap.res.body);
    }
  }

  return {
    robotsTxt,
    agentAccess,
    llmsTxt,
    sitemapUrls,
    sitemapPresent,
    sidecarErrors: { robots: robots.error, llms: llms.error, sitemap: sitemap.error },
  };
}

/**
 * Fetch the prospect's site: robots/sitemap/llms sidecars, then up to
 * `maxPages` same-origin pages, each captured BOTH as raw HTTP HTML (what a
 * non-JS crawler sees) and as rendered DOM (what a browser sees). Sequential
 * and delayed — this is someone else's server.
 */
export async function crawlSite(rawUrl: string, deps: CrawlDeps): Promise<CrawlResult> {
  const start = new URL(rawUrl);
  // A fragment is never sent over the wire; keeping it here makes the
  // homepage's own candidate (hash-stripped by normalizeCandidates below) fail
  // to match `start.toString()` later and fetches the homepage a second time.
  start.hash = "";
  // A prospect-supplied URL can carry HTTP userinfo (`user:pass@host`); that
  // credential must never reach the origin, the page list, the result object,
  // the database, or the published report. Strip it immediately, before
  // anything downstream is derived from `start`.
  start.username = "";
  start.password = "";
  // Check the ENTRY host before the first fetch. The redirect guard below has
  // always covered where a hostile site can send us SECOND; nothing covered a
  // caller pointing the crawler at an internal address to BEGIN with, and the
  // CLI validates only `isHttpUrl` — so one fetch of 169.254.169.254 happened
  // before the throw.
  if (isPrivateOrLoopbackHost(start.hostname)) {
    throw Object.assign(
      new Error(
        `${start.toString()} is a private address (${start.hostname}) — refusing to crawl it.`,
      ),
      { exitCode: 1 },
    );
  }

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

  // The homepage may have redirected to a different host — apex → www is the
  // most common redirect in production hosting. Every sidecar URL, the link
  // base, and the first page candidate must key off where the response
  // actually landed, not the URL we requested, or the whole site's real pages
  // get filtered out against a stale origin.
  let resolved: URL;
  try {
    resolved = new URL(home.url ?? start.toString());
  } catch {
    resolved = start;
  }
  // The PROSPECT controls where their own redirect lands — trusting it blindly
  // would let a hostile site send this crawler at an internal target. Checked
  // by address literal only (no DNS resolution): a deliberate, proportionate
  // bound for an operator-run CLI, not a complete SSRF guard.
  if (isPrivateOrLoopbackHost(resolved.hostname)) {
    throw Object.assign(
      new Error(
        `${start.toString()} redirected to a private address (${resolved.hostname}) — refusing to crawl it.`,
      ),
      { exitCode: 1 },
    );
  }
  const resolvedUrl = resolved.toString();
  const origin = resolved.origin;

  const sidecars = await fetchSidecars(origin, deps);

  const pageUrls = normalizeCandidates(
    [resolvedUrl, ...sidecars.sitemapUrls, ...sameOriginLinks(home.body, resolvedUrl)],
    origin,
    deps.maxPages,
  );

  const rendered = await deps.renderPages(pageUrls).catch(() => new Map<string, string>());

  const pages: PageCapture[] = [];
  for (const url of pageUrls) {
    let res: FetchResponse | null = null;
    let error: string | null = null;
    if (url === resolvedUrl) {
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
    // A sitemap or nav link can point at a non-HTML resource (a linked PDF
    // brochure, say). Decoding that as HTML produces raw/rendered divergence
    // that has nothing to do with the prospect's JavaScript, so it must not
    // read as "usable" — but a missing content-type header stays usable.
    const contentType = res ? headerValue(res.headers, "content-type") : null;
    const notHtmlReason =
      contentType !== null && !contentType.toLowerCase().includes("html")
        ? `not HTML (${contentType})`
        : null;
    const usable = res !== null && res.status < 400 && notHtmlReason === null;
    pages.push({
      url,
      status: res?.status ?? null,
      raw: usable ? extractPage(res!.body) : null,
      rendered: renderedHtml ? extractPage(renderedHtml) : null,
      error: error ?? (res && res.status >= 400 ? `HTTP ${res.status}` : notHtmlReason),
    });
  }

  const homeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(home.headers)) homeHeaders[k.toLowerCase()] = v;

  return {
    origin,
    robotsTxt: sidecars.robotsTxt,
    agentAccess: sidecars.agentAccess,
    sitemap: { present: sidecars.sitemapPresent, urlCount: sidecars.sitemapUrls.length },
    llmsTxt: sidecars.llmsTxt,
    sidecarErrors: sidecars.sidecarErrors,
    homeHeaders,
    pages,
  };
}

/** Reads `res`'s body as text, refusing once it would exceed
 *  `MAX_RESPONSE_BYTES`. Checks the declared `content-length` first so an
 *  honest oversized response never starts streaming at all; then guards the
 *  actual byte count as it streams, so a missing OR a lying header can't get
 *  a huge body past the check either. `Body.text()` always decodes as UTF-8
 *  per the Fetch spec, so decoding the accumulated bytes the same way here
 *  reproduces `res.text()` exactly for anything under the cap. */
async function readCapped(res: Response, url: string): Promise<string> {
  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new ResponseTooLargeError(url);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ResponseTooLargeError(url);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

/** Real deps: identified sequential fetches + one shared Playwright chromium.
 *  Playwright is imported lazily so unit tests (which inject deps) never load it. */
export function defaultCrawlDeps(over: Partial<CrawlDeps> = {}): CrawlDeps {
  // Resolved up front so the renderPages closure below paces itself on the
  // SAME delay the caller configured, instead of silently ignoring it.
  const maxPages = over.maxPages ?? 20;
  const delayMs = over.delayMs ?? 500;
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
      return { status: res.status, body: await readCapped(res, url), headers, url: res.url };
    },
    async renderPages(urls) {
      const { chromium } = await import("@playwright/test");
      const out = new Map<string, string>();
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext({ userAgent: USER_AGENT });
        const page = await ctx.newPage();
        // Playwright navigations are the heavier half of the traffic we put on
        // a stranger's server (each pulls images, fonts, third-party scripts),
        // so they get the same courtesy pacing as the raw fetches.
        await pacedEach(urls, delayMs, async (url) => {
          try {
            // `load`, NOT `networkidle`.
            //
            // `networkidle` waits for 500ms with no network activity, and a
            // great many real business sites never go quiet: a chat widget, an
            // analytics heartbeat or any polling script keeps the connection
            // busy forever. Every such page burned the full 30s timeout and
            // then threw, so at the production page budget a single chat
            // widget cost the audit ten minutes of nothing.
            //
            // Worse, the catch below turned that into a MISSING rendered
            // extract, so no page produced a raw/rendered pair, `jsDependence`
            // came back null, and the whole Readability score reported "not
            // measured" — the open Beachfront readability-null bug, which is
            // this and not a scoring fault at all.
            //
            // Playwright's own docs discourage `networkidle` for exactly this
            // reason. `load` fires once resources are in; the settle below
            // gives client-side frameworks room to hydrate, which is what the
            // rendered extract is actually for.
            await page.goto(url, { waitUntil: "load", timeout: 20_000 });
            await page.waitForTimeout(RENDER_SETTLE_MS);
            out.set(url, await page.content());
          } catch {
            // A page that won't render simply has no rendered extract.
          }
        });
      } finally {
        await browser.close();
      }
      return out;
    },
    maxPages,
    delayMs,
    ...over,
  };
}
