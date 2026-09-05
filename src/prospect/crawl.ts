import { parse, HTMLElement, NodeType } from "node-html-parser";
import { isInfraPath } from "./pages.js";
import {
  MAX_CONSOLE_ERRORS,
  MAX_FAILED_REQUESTS,
  MAX_OVERSIZED_IMAGES,
  type AxePageResult,
  type PageVitals,
} from "./accessibility.js";
import {
  pageInteractionDeps,
  probeForms,
  withTimeout,
  PROBE_BUDGET_MS,
  type FormProbe,
} from "./interaction.js";
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

/**
 * Does a robots.txt path pattern match this path? RFC 9309 prefix semantics,
 * with `*` for any run of characters and `$` anchoring the end.
 *
 * `pathCoversRoot` is this function asked about "/", and stays separate because
 * it answers a different question — "is the whole site blocked?" — which the
 * report states as a headline.
 */
export function robotsPathMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/**
 * WHAT WE MAY FETCH — our own crawler obeying the file, not the matrix of what
 * other people's crawlers may do.
 *
 * These are different questions and only the second one was being asked. We
 * read robots.txt to report whether an owner turns away GPTBot, and then
 * fetched whatever we liked. A tool that grades a site on crawler access and
 * ignores that site's own Disallow has no standing to publish the grade — and
 * viget.com, the first third party we pointed this at, asks crawlers to leave
 * `/admin`, `/exhibit`, `/login` and `/search?q=` alone.
 *
 * Longest-match-wins between Allow and Disallow, per RFC 9309, so an
 * `Allow: /blog/public` under a `Disallow: /blog` is honoured. A group naming
 * us specifically wins over the wildcard group; with no robots.txt at all,
 * everything is permitted, because absence is not refusal.
 */
export function robotsAllowsUs(robotsTxt: string | null, url: string, agent: string): boolean {
  if (robotsTxt === null) return true;
  let path: string;
  try {
    const u = new URL(url);
    path = `${u.pathname}${u.search}`;
  } catch {
    return true;
  }
  const groups = parseRobots(robotsTxt);
  const lower = agent.toLowerCase();
  // Our UA string is "ReddoorAudit/1.0 (+https://...)"; a robots group naming
  // us would write "reddooraudit", so match on containment either way round.
  const named = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && (lower.includes(a) || a.includes(lower.split("/")[0] ?? ""))),
  );
  const matched = named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"));
  let best: { type: "allow" | "disallow"; length: number } | null = null;
  for (const rule of matched.flatMap((g) => g.rules)) {
    if (!robotsPathMatches(rule.path, path)) continue;
    // An empty `Disallow:` is the conventional "nothing is disallowed" and
    // matches nothing, which `robotsPathMatches` already returns false for.
    if (best === null || rule.path.length > best.length) {
      best = { type: rule.type, length: rule.path.length };
    }
  }
  return best === null || best.type === "allow";
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

/**
 * What one browser pass produced for a page.
 *
 * A bare string is still accepted, and every injected test stub returns one —
 * which normalises to `axe: null`, meaning "we ran no accessibility rules here".
 * That is the honest reading: absence of results must never render as absence
 * of violations, and widening the type this way keeps the seventeen existing
 * stubs correct rather than making them lie by omission.
 */
export type RenderedPage = {
  html: string;
  axe: AxePageResult | null;
  vitals?: PageVitals | null;
  /** Present only on the one page we interacted with. */
  formProbe?: FormProbe | null;
};

export type CrawlDeps = {
  fetchUrl: (url: string) => Promise<FetchResponse>;
  /**
   * Rendered DOM per URL, and whatever else the one browser pass collected. A
   * URL absent from the map has no rendered extract.
   *
   * The accessibility rules run HERE rather than in a stage of their own,
   * because a stage of their own would mean opening a second browser and
   * navigating every page a second time — doubling the heaviest traffic we put
   * on a stranger's server to learn something the first visit could have told
   * us.
   */
  renderPages: (urls: string[]) => Promise<Map<string, string | RenderedPage>>;
  maxPages: number;
  delayMs: number;
};

/** Normalises the union above. A stub that returns plain HTML has measured no
 *  accessibility rules, and says so. */
export function asRendered(v: string | RenderedPage | undefined): RenderedPage | null {
  if (v === undefined) return null;
  return typeof v === "string" ? { html: v, axe: null, vitals: null, formProbe: null } : v;
}

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

/** How many sitemap URLs are carried forward for probing. Ten times the number
 *  Tier 2 samples, so the sample is drawn from a spread of the sitemap rather
 *  than its first twelve entries — which on most CMSes are the newest posts. */
export const MAX_SITEMAP_SAMPLE = 120;

/** Ceilings on the per-page browser work. Generous — a slow page should still
 *  be measured — but finite, because the alternative is losing the crawl. */
export const CONTENT_BUDGET_MS = 20_000;
export const AXE_BUDGET_MS = 45_000;
export const VITALS_BUDGET_MS = 30_000;

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

/**
 * The dedupe key for "is this the same page?".
 *
 * A trailing slash addresses the same page — sites link to `/services` in the
 * nav and `/services/` in the footer constantly — and crawling both produced a
 * duplicate-title finding about one page, which the client cannot fix because
 * there is nothing to fix. The query string is KEPT: `?page=2` genuinely is
 * another page, and folding it in would silently drop paginated content from
 * the crawl.
 */
function samePageKey(u: URL): string {
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.origin.toLowerCase()}${path}${u.search}`;
}

/**
 * Which URLs to spend the page budget on.
 *
 * DISTINCT PATHS FIRST, query variants with whatever is left. The budget is
 * small and a query string is the cheapest way for a site to spend all of it on
 * one page: apple.com handed us `/accessibility/features/` five times under
 * `?vision`, `?hearing`, `?speech` and `?cognitive` — tab deep-links into a
 * single page — plus `/airpods-pro/?campaign=true`, so six of twenty slots went
 * to two pages we had already read.
 *
 * A PREFERENCE, never a filter, because `samePageKey` is right that `?page=2`
 * is genuinely another page. A blog whose only content is `?page=N` still gets
 * crawled: those URLs simply queue behind the distinct paths instead of
 * crowding them out.
 */
function normalizeCandidates(
  urls: string[],
  origin: string,
  max: number,
  robotsTxt: string | null,
): string[] {
  const firstOfPath: string[] = [];
  const variants: string[] = [];
  const seen = new Set<string>();
  const paths = new Set<string>();
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (ASSET_EXT.test(u.pathname)) continue;
    // Infrastructure a crawler can follow but a visitor never lands on — see
    // pages.ts. Following them costs a page of the budget and then invites a
    // finding about a URL the prospect never chose to publish.
    if (isInfraPath(u.toString())) continue;
    // The site's own Disallow, obeyed. Not the AI-crawler matrix — that reports
    // what OTHER crawlers may do. This is us.
    if (!robotsAllowsUs(robotsTxt, u.toString(), USER_AGENT)) continue;
    u.hash = "";
    const key = samePageKey(u);
    if (seen.has(key)) continue;
    seen.add(key);
    const path = `${u.origin.toLowerCase()}${u.pathname.replace(/\/+$/, "") || "/"}`;
    if (paths.has(path)) variants.push(u.toString());
    else {
      paths.add(path);
      firstOfPath.push(u.toString());
    }
  }
  return [...firstOfPath, ...variants].slice(0, max);
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
    sidecars.robotsTxt,
  );

  const rendered = await deps
    .renderPages(pageUrls)
    .catch(() => new Map<string, string | RenderedPage>());

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
    const renderedPage = asRendered(rendered.get(url));
    const renderedHtml = renderedPage?.html ?? null;
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
      // Gated on `usable` for the same reason `raw` is. A browser paints
      // something for a 404 — Cloudflare's email-protection interstitial is the
      // case that bit us — and a captured paint is not evidence that the URL is
      // a page of this website. Leaving it non-null let every cross-page check
      // that asked "is there an extract?" admit a page the server refused, and
      // that one URL became the only dead end and the only off-template page
      // found in the entire stored corpus.
      rendered: usable && renderedHtml ? extractPage(renderedHtml) : null,
      error: error ?? (res && res.status >= 400 ? `HTTP ${res.status}` : notHtmlReason),
      // Gated on `usable` for the same reason as `rendered`: a browser paints
      // something for a 404, and running the rule set over an error page would
      // report that page's failings as the website's.
      axe: usable ? (renderedPage?.axe ?? null) : null,
      vitals: usable ? (renderedPage?.vitals ?? null) : null,
      formProbe: usable ? (renderedPage?.formProbe ?? null) : null,
    });
  }

  const homeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(home.headers)) homeHeaders[k.toLowerCase()] = v;

  return {
    origin,
    robotsTxt: sidecars.robotsTxt,
    agentAccess: sidecars.agentAccess,
    sitemap: {
      present: sidecars.sitemapPresent,
      urlCount: sidecars.sitemapUrls.length,
      // A capped sample, kept so Tier 2 can ask whether the URLs a sitemap
      // advertises actually answer — `urlCount` alone cannot be probed. Capped
      // because this lands in `result_json`, and a 4,000-URL sitemap has no
      // business being stored whole for the sake of sampling twelve of them.
      sample: sidecars.sitemapUrls.slice(0, MAX_SITEMAP_SAMPLE),
    },
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
 *  reproduces `res.text()` exactly for anything under the cap.
 *
 *  Exported because every stage that reads a body off a stranger's server needs
 *  this same guard, and a second copy of it is a second place for the limit to
 *  drift out of step with the one that has tests. */
export async function readCapped(res: Response, url: string): Promise<string> {
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

/** The viewport the overflow check is named for — an iPhone SE, the narrowest
 *  screen still worth designing for and the one that finds the bug. */
const MOBILE_WIDTH = 375;
const MOBILE_HEIGHT = 812;
/** What the crawl renders at otherwise. Restored after each measurement so the
 *  next page is captured the same way as the first. */
const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 720;
/** How long the narrow-viewport reflow gets to settle, and how often it is
 *  read. Sized off the worst real page measured so far: apple.com's comparison
 *  table needs about a second, so the budget is several times that and the step
 *  is short enough that an ordinary page pays a quarter of a second. */
const OVERFLOW_SETTLE_BUDGET_MS = 5_000;
const OVERFLOW_SETTLE_STEP_MS = 250;

/**
 * What the browser noticed, measured in the page it has already loaded.
 *
 * Every measurement here is a reflow or a DOM read — no navigation, no request.
 * Returns null on any failure, for the same reason `runAxe` does: a measurement
 * that fell over is ours, and reporting a page as clean because the measuring
 * threw would be a false all-clear.
 */
async function measureVitals(
  page: import("@playwright/test").Page,
  collected: { consoleErrors: string[]; failed: PageVitals["failedRequests"] },
): Promise<PageVitals | null> {
  try {
    // Desktop first, because that is how the page was rendered and captured.
    const desktop = await page.evaluate(
      ({ maxImages }) => {
        const tiny: { count: number; sample: string | null } = { count: 0, sample: null };
        for (const el of Array.from(document.body.querySelectorAll("*"))) {
          // Only elements with their own text, so a wrapper does not inherit
          // the blame for its child's font size.
          const ownText = Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent ?? "")
            .join("")
            .trim();
          if (ownText.length < 12) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (Number.isFinite(size) && size > 0 && size < 12) {
            tiny.count += 1;
            tiny.sample ??= ownText.slice(0, 80);
          }
        }

        const oversized: { src: string; naturalWidth: number; renderedWidth: number }[] = [];
        for (const img of Array.from(document.images)) {
          const rendered = img.clientWidth;
          // Twice the drawn width in each direction is four times the pixels,
          // which is where the waste becomes worth a sentence. A 2x retina
          // asset is deliberately under that bar.
          if (rendered > 0 && img.naturalWidth > rendered * 2.5) {
            oversized.push({
              src: img.currentSrc || img.src,
              naturalWidth: img.naturalWidth,
              renderedWidth: rendered,
            });
          }
        }
        oversized.sort((a, b) => b.naturalWidth - a.naturalWidth);
        return { tiny, oversized: oversized.slice(0, maxImages) };
      },
      { maxImages: MAX_OVERSIZED_IMAGES },
    );

    // Then the narrow viewport. A resize reflows a page the browser already
    // holds — no navigation, no new bytes from the prospect's server.
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    // POLLED UNTIL IT STOPS MOVING, not sampled once after 250ms.
    //
    // A single 250ms sample measured pages mid-reflow and reported the
    // transient as the finding. apple.com's AirPods comparison page, resized
    // from 1280 to 375, reads 303px over at 250ms, 26px at 500ms and 0px from
    // 1000ms on; loaded at 375 in the first place it never overflows at all. We
    // told a client their page scrolls sideways on a phone about a page that
    // does not, which is the most quotable finding shape we produce.
    //
    // Two consecutive equal reads is the settle condition. The budget is a
    // ceiling, not a target: a static page settles on the second read and pays
    // one extra interval.
    const overflowAt375 = await settledOverflow(
      () =>
        page.evaluate(() => {
          const doc = document.documentElement;
          return Math.max(0, Math.round(doc.scrollWidth - doc.clientWidth));
        }),
      (ms) => page.waitForTimeout(ms),
    );
    await page.setViewportSize({ width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT });

    return {
      consoleErrors: collected.consoleErrors.slice(0, MAX_CONSOLE_ERRORS),
      failedRequests: collected.failed.slice(0, MAX_FAILED_REQUESTS),
      overflowAt375,
      tinyText: desktop.tiny,
      oversizedImages: desktop.oversized,
    };
  } catch {
    return null;
  }
}

/**
 * Read the narrow-viewport overflow once it has stopped moving.
 *
 * Exported for its test. Two consecutive equal reads is the settle condition;
 * the budget is a ceiling, not a target, so a static page settles on the second
 * read and pays one extra interval.
 */
export async function settledOverflow(
  read: () => Promise<number>,
  wait: (ms: number) => Promise<unknown>,
  budgetMs: number = OVERFLOW_SETTLE_BUDGET_MS,
  stepMs: number = OVERFLOW_SETTLE_STEP_MS,
): Promise<number> {
  let last = -1;
  const deadline = Date.now() + budgetMs;
  for (;;) {
    await wait(stepMs);
    const now = await read();
    // A page still moving when the budget runs out has told us nothing
    // trustworthy, and a number we do not trust must not become a finding about
    // somebody's site. The last reading stands only if it agrees with the one
    // before it; otherwise we report no overflow rather than a transient.
    if (now === last) return now;
    if (Date.now() > deadline) return 0;
    last = now;
  }
}

/**
 * Run the whole axe rule set against the page already loaded in this tab.
 *
 * No `withTags` call, deliberately. Restricting to `wcag2a`/`wcag2aa`/`wcag21a`/
 * `wcag21aa` — which is what our own fleet audit does — silently drops every
 * landmark and heading-order rule, because those are tagged `best-practice`.
 * The default set is all of them, and the structural rules are the ones most
 * worth having.
 *
 * Returns null rather than throwing on any failure. An accessibility scan that
 * fell over is OUR missing measurement, and a page reported with no violations
 * because the scanner crashed would be the worst kind of false all-clear.
 */
async function runAxe(page: import("@playwright/test").Page): Promise<AxePageResult | null> {
  try {
    // The NAMED export, not the default. The package publishes both, and under
    // Node's CJS interop the `default` binding resolves to the whole module
    // namespace rather than the class — which type-checks as "not
    // constructable" and would have thrown at runtime.
    const { AxeBuilder } = await import("@axe-core/playwright");
    const results = await new AxeBuilder({ page }).analyze();
    return {
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: (v.impact ?? null) as AxePageResult["violations"][number]["impact"],
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
        // One element, truncated: enough for a reader to find it on the page,
        // not enough to bloat a stored report with a page of markup.
        sample: v.nodes[0]?.html?.slice(0, 200) ?? null,
      })),
      passes: results.passes.length,
      incomplete: results.incomplete.length,
      // The ids as well as the count: "three rules need a human" is a worry,
      // "colour contrast over an image needs a human" is something to look at.
      incompleteIds: results.incomplete.map((r) => r.id),
      // Carried so the report can say how many rules had something to check
      // rather than implying we checked all ninety.
      inapplicable: results.inapplicable.length,
    };
  } catch {
    return null;
  }
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
      const out = new Map<string, string | RenderedPage>();
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext({
          userAgent: USER_AGENT,
          viewport: { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT },
        });
        const page = await ctx.newPage();

        // Listeners are attached ONCE and buffer into `collected`, which is
        // cleared per URL. Attaching them per navigation would miss everything
        // the page reports during load, which is most of it.
        const collected = {
          consoleErrors: [] as string[],
          failed: [] as PageVitals["failedRequests"],
        };
        let currentOrigin = "";
        const noteError = (message: string): void => {
          const trimmed = message.trim().slice(0, 300);
          // Deduped: one broken component in a loop can report the same line a
          // thousand times, and a thousand copies is not a thousand problems.
          if (trimmed && !collected.consoleErrors.includes(trimmed)) {
            collected.consoleErrors.push(trimmed);
          }
        };
        page.on("pageerror", (err) => noteError(err.message));
        page.on("console", (msg) => {
          if (msg.type() === "error") noteError(msg.text());
        });
        const noteFailed = (url: string, status: number | null): void => {
          // A URL we cannot parse is not evidence that it belongs to this site,
          // so it counts as third-party — the direction that cannot manufacture
          // a finding against the prospect.
          const firstParty = ((): boolean => {
            try {
              return new URL(url).origin === currentOrigin;
            } catch {
              return false;
            }
          })();
          if (collected.failed.length < MAX_FAILED_REQUESTS * 4) {
            collected.failed.push({ url: url.slice(0, 200), status, firstParty });
          }
        };
        // ABORTED IS NOT FAILED.
        //
        // A browser cancels partial media loads as a matter of routine — it
        // asks for the first bytes of a hero video, decides it has enough, and
        // drops the rest. Playwright reports that as `requestfailed` with
        // `net::ERR_ABORTED`, and so does every request cut short by a
        // navigation. apple.com came back with nine "failed" requests, every
        // one of them a .webm the browser had deliberately stopped fetching.
        // Printing those as broken files is our misreading of the browser, on
        // a site whose videos play perfectly.
        page.on("requestfailed", (req) => {
          const why = req.failure()?.errorText ?? "";
          if (/ERR_ABORTED/i.test(why)) return;
          noteFailed(req.url(), null);
        });
        page.on("response", (res) => {
          if (res.status() >= 400) noteFailed(res.url(), res.status());
        });
        // Playwright navigations are the heavier half of the traffic we put on
        // a stranger's server (each pulls images, fonts, third-party scripts),
        // so they get the same courtesy pacing as the raw fetches.
        let formProbed = false;
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
            collected.consoleErrors.length = 0;
            collected.failed.length = 0;
            try {
              currentOrigin = new URL(url).origin;
            } catch {
              currentOrigin = "";
            }
            await page.goto(url, { waitUntil: "load", timeout: 20_000 });
            await page.waitForTimeout(RENDER_SETTLE_MS);
            // EVERY ONE OF THESE IS BUDGETED, and the reason is a bug that
            // already happened: an unbounded await in this loop does not fail
            // the page it is on, it stalls the whole crawl, and twenty pages
            // already fetched are lost for one that would not answer. The form
            // probe was the one that actually deadlocked; these three are the
            // same shape and were one slow page away from the same outcome.
            //
            // Each null is already a state downstream understands — no rendered
            // extract, no rules run, no browser measurements — so a timeout
            // costs that page's browser findings and nothing else.
            const html = await withTimeout(page.content(), CONTENT_BUDGET_MS);
            if (html === null) return;
            const axe = await withTimeout(runAxe(page), AXE_BUDGET_MS);
            const vitals = await withTimeout(measureVitals(page, collected), VITALS_BUDGET_MS);
            // LAST, and once per crawl. Everything above reads the page as it
            // was served; this one presses a button, so it cannot run before
            // the extract and the rules that describe the untouched document.
            // Once, because a site has one enquiry form, and probing the same
            // form on five pages is five sets of aborted requests for one
            // answer.
            //
            // BUDGETED, because a stall here used to cost the whole crawl:
            // twenty pages already fetched, thrown away, for two checks. A
            // probe that runs out of time is abandoned and reads as "not
            // measured", which is the same trade every other stage makes.
            let formProbe: FormProbe | null = null;
            if (!formProbed) {
              formProbe = await withTimeout(
                probeForms(pageInteractionDeps(page, url)),
                PROBE_BUDGET_MS,
              );
              if (formProbe) formProbed = true;
            }
            out.set(url, { html, axe, vitals, formProbe });
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
