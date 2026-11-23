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
import { extractPage, formShape, UNRENDERED_TAGS } from "./extract.js";
import { isPrivateOrLoopbackHost } from "../util/url.js";
import { pathDepth } from "../util/path-depth.js";

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

/**
 * Every URL a sitemap LISTS — and only those.
 *
 * The optional namespace prefix is for a sitemap that writes its own elements
 * as `<sitemap:loc>`, which is legal and does happen. It also matched
 * `<image:loc>`, the image-sitemap extension Squarespace, Wix and Yoast all
 * emit inside each `<url>` — so a site's image count was added to its page
 * count. Eleven of the 29 corpus sites carry them: vascularperfusion.solutions
 * lists 13 pages and 60 images, and we reported "73 URLs listed" to them. The
 * image namespace is the only one of the sitemap extensions that defines a
 * bare `loc`, so excluding it by name is the whole fix.
 */
export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<(?!image:)(?:[\w-]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?loc>/gi)]
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
  // The same SITE, not the same origin string: a child listed on `https://` for
  // an `http://` site (or on `www.`) is this site's sitemap, as `toSameOrigin`
  // already decides for every other address the crawl reads.
  if (toSameOrigin(url.toString(), origin) === null) return false;
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
  // No `formProbe` key: a caller handing back raw HTML never opened a browser,
  // so it did not try a form — which is not the same as trying and finding none.
  return typeof v === "string" ? { html: v, axe: null, vitals: null } : v;
}

/**
 * Runs the enquiry-form probe under its time budget, and keeps its three answers
 * apart: a FormProbe (a form was pressed), `null` (tried, and this page had no
 * enquiry form) and `undefined` (not tried to the end: the probe ran out of time
 * or failed). `undefined` is stored as ABSENT, which reads as "not measured";
 * a timeout must never become `null`, which would read as a fact about the site.
 * `probeForms` itself answers `undefined` when the forms did not line up with
 * the classifier's, which is the same "could not try" and stays absent.
 */
export async function budgetedFormProbe(
  probe: Promise<FormProbe | null | undefined>,
  budgetMs: number,
): Promise<FormProbe | null | undefined> {
  const probed = await withTimeout(
    probe.then((value) => ({ value })),
    budgetMs,
  );
  return probed === null ? undefined : probed.value;
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

/** Returns a gate that waits `delayMs` before every call but the first. Used for
 *  the sitemap requests, which are made at the same stranger's server as the
 *  pages and were fired back to back until now. */
function pacer(delayMs: number): () => Promise<void> {
  let first = true;
  return async () => {
    if (!first && delayMs > 0) await sleep(delayMs);
    first = false;
  };
}

/** How many sitemap URLs are carried forward for probing. Ten times the number
 *  Tier 2 samples, so the sample is drawn from a spread of the sitemap rather
 *  than its first twelve entries — which on most CMSes are the newest posts. */
export const MAX_SITEMAP_SAMPLE = 120;

/** How many children of a sitemap index we follow. Was 3, which read 66 of
 *  viget.com's 1,636 URLs and turned our own ceiling into a finding about their
 *  sitemap. Each child is still filtered by `isSafeNestedSitemap` BEFORE the cap
 *  applies, so raising it does not widen what a hostile index can reach — it
 *  only stops a real one being cut off. Whatever the number, going over it now
 *  sets `truncated`, and a truncated read may not become a finding. */
export const MAX_SITEMAP_CHILDREN = 25;

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
async function optional(
  deps: CrawlDeps,
  url: string,
  serverErrorIsError = false,
): Promise<SidecarFetch> {
  try {
    const res = await deps.fetchUrl(url);
    // A 5xx from an address the owner named is a server that did not answer, not
    // a file that is absent: `serverErrorIsError` says so for those addresses.
    if (serverErrorIsError && res.status >= 500) {
      return { res: null, error: `HTTP ${res.status}` };
    }
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
  return `${sitePathKey(u)}${u.search}`;
}

/** A hostname with one leading `www.` taken off, lower-cased. */
function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * The address of a page on its SITE, without its scheme, its `www.`, its query
 * or a trailing slash: `acme.example/about` for `https://www.acme.example/about/`
 * and for `http://acme.example/about`. Two addresses with the same key are the
 * same page, so each is fetched once. Exported for goals.ts, which asks the
 * same question of "did we read that page?".
 */
export function sitePathKey(u: URL): string {
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${bareHost(u.hostname)}${u.port ? `:${u.port}` : ""}${path}`;
}

/**
 * `raw` moved onto `origin`, when it is the same SITE: the same host give or
 * take one leading `www.`, over http or https, on the default port. Null for
 * anything else, including a URL that does not parse.
 *
 * A sitemap that lists `http://www.` addresses for an `https://` apex site is
 * listing this site's pages; the old `u.origin !== origin` test dropped every
 * one of them without a word, and one stored site was read at 12 pages of a
 * sitemap of 83 that way. The equivalence is deliberately this narrow: another
 * subdomain (`shop.`, `blog.`) is often a different system run by someone
 * else, so it stays out.
 */
export function toSameOrigin(raw: string, origin: string): string | null {
  let u: URL;
  let o: URL;
  try {
    u = new URL(raw, origin);
    o = new URL(origin);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (bareHost(u.hostname) !== bareHost(o.hostname)) return null;
  // Already this origin, port and all. A site on a non-default port is its own
  // origin, and refusing every explicit port crawled 0 pages of it.
  if (u.origin === o.origin) return u.toString();
  // Moved onto our origin only when the ports agree: `:8443` against the default
  // port is a different server, not a spelling of this one.
  if (u.port !== o.port) return null;
  u.hostname = o.hostname;
  // Never downgraded: an https address on an http origin keeps its https scheme,
  // so the crawl never asks for plain http when the sitemap says https.
  if (!(u.protocol === "https:" && o.protocol === "http:")) u.protocol = o.protocol;
  return u.toString();
}

/** How a sitemap's address compares with the origin the crawl read.
 *  `off`: a fault we can name (listed on http for an https site, or on the host
 *  the entry redirected away from). `unsettled`: another scheme or www. host
 *  with nothing to say which one the site answers on, so the check cannot be
 *  measured. `null`: the same address, or not this site at all. */
export type SitemapAddressVerdict = "off" | "unsettled" | null;

/** Classifies one listed address. `redirectedFrom` is the host the entry URL
 *  was requested on when the homepage redirected away from it, else null. */
export function sitemapAddressVerdict(
  raw: string,
  origin: string,
  redirectedFrom: string | null,
): SitemapAddressVerdict {
  let u: URL;
  let o: URL;
  try {
    u = new URL(raw);
    o = new URL(origin);
  } catch {
    return null;
  }
  if (toSameOrigin(raw, origin) === null || u.origin === o.origin) return null;
  if (u.protocol === "http:" && o.protocol === "https:") return "off";
  if (redirectedFrom !== null && u.hostname.toLowerCase() === redirectedFrom.toLowerCase()) {
    return "off";
  }
  return "unsettled";
}

/** Path words that mean "this is how you reach them", matched against whole
 *  hyphen- or underscore-separated words of a path segment, so `/ebook` and
 *  `/facebook` are not a booking page and `/request-demo` is a demo. */
const CONTACT_PATH_WORDS = new Set([
  "contact",
  "contactus",
  "quote",
  "demo",
  "book",
  "booking",
  "enquiry",
  "enquire",
  "inquiry",
  "inquire",
  "schedule",
  "consultation",
  "appointment",
  "appointments",
]);

/** The words that make a path segment a booking page on their own only at the
 *  top of the site: `/book` and `/schedule`, but not `/events/schedule` (an
 *  events calendar) or `/book/my-novel` (a title). */
const BOOKING_PATH_WORDS = new Set(["book", "schedule"]);

/** What may follow a contact word and still make a segment a contact page:
 *  `contact-us`, `book-now`, `schedule-a-call`. */
const CONTACT_QUALIFIERS = new Set(["us", "now", "online", "a"]);

/**
 * Is one hyphen-separated path segment a contact page? A segment counts when it
 * is a contact word on its own, starts with one and is qualified (`contact-us`),
 * or ends with one (`request-demo`, `get-a-quote`). A contact word in the middle
 * of a title does not (`demo-reel`, `how-to-book-a-trip`), and `book` or
 * `schedule` count only at the top of the site.
 */
function isContactSegment(words: string[], topLevel: boolean): boolean {
  const [first, second] = words;
  if (first === undefined) return false;
  const last = words[words.length - 1] ?? first;
  if (BOOKING_PATH_WORDS.has(first) && !topLevel) return false;
  if (words.length === 1) return CONTACT_PATH_WORDS.has(first);
  if (CONTACT_PATH_WORDS.has(first) && second !== undefined && CONTACT_QUALIFIERS.has(second)) {
    return true;
  }
  return CONTACT_PATH_WORDS.has(last) && !BOOKING_PATH_WORDS.has(last);
}

/** A path segment that is a contact page, by its whole name: `contact`,
 *  `contact-us`, `contactus`, or `contact-` and one of the words a contact page
 *  is called. Not a prefix: `contact-lenses` and `contactless-payments` are not. */
const CONTACT_PAGE_SEGMENT =
  /^(?:contact|contact-us|contactus|contact-(?:sales|form|page|information|info|our-team|team|me|details|support))$/;

/** Path segments that mark a blog, a news feed or a dated archive. "Consultation"
 *  in such a path is a post's title, not an offer. */
const ARCHIVE_SEGMENT = /^(?:blog|blogs|news|articles?|posts?|insights|resources|(?:19|20)\d{2})$/;

/** A consultation offered in link text, as a verb phrase: "Book a consultation",
 *  "Request a consultation", "Free consultation". "Consultation tips for owners"
 *  is a post's title, not an offer. */
const CONSULTATION_OFFER =
  /\b(?:book|request|schedule|arrange|get)\s+(?:an?\s+|your\s+|a\s+free\s+)?consultations?\b|\bfree consultations?\b/i;

/** Link text that means the same, as a whole short label: a verb phrase that
 *  asks for contact, not a noun that happens to contain the word. "Book review"
 *  and "View schedule" are not contact links; "Book a demo" and "Get a free
 *  quote" are; "Contact lenses" is not "Contact". */
const CONTACT_LABEL =
  /^(?:contact(?: (?:us|me|sales|our team|support))?|get in touch|talk to us|let['’]?s talk|get started|enquire|inquire|schedule|(?:get|request) (?:a |an |your |my |free )*(?:quote|estimate|consultation|demo|appointment|call|started)|book(?: (?:a|an|your|my|now|online|the|free))*(?: (?:demo|call|appointment|consultation|visit|session|meeting|table|quote|estimate))?|schedule (?:a|an|your|my|now|online)(?: (?:call|demo|consultation|appointment|visit|meeting|session))?|make (?:an? )?(?:enquiry|inquiry|appointment|booking))(?: (?:today|now|online|here))?$/i;

/**
 * Does this link lead to the way a visitor gets in touch: contact, quote, demo,
 * book, get started? Read off the path, or off the link's own words when the
 * path says nothing (`/start` labelled "Get started").
 *
 * Shared by the crawl, which reads these pages before the sitemap's, and by
 * the goal checklist, which will not call a form missing while one of these
 * pages went unread.
 */
export function isContactLike(href: string, text = ""): boolean {
  let path: string;
  try {
    path = new URL(href).pathname.toLowerCase();
  } catch {
    return false;
  }
  const segments = path.split("/").filter(Boolean);
  const archived = segments.some((s) => ARCHIVE_SEGMENT.test(s));
  for (const [i, segment] of segments.entries()) {
    const bare = segment.replace(/\.[a-z0-9]+$/, "");
    if (CONTACT_PAGE_SEGMENT.test(bare)) return true;
    const words = bare.split(/[-_]+/);
    // "consultation" in a blog or dated path is a post's title, never an offer.
    const consultationTitle = archived && words.includes("consultation");
    if (!consultationTitle && isContactSegment(words, segments.length === 1 && i === 0)) {
      return true;
    }
    if (words.join(" ").includes("get started")) return true;
  }
  const label = text.replace(/\s+/g, " ").trim();
  if (label.length === 0 || label.length > 40) return false;
  // The whole-label verb phrases, or a consultation offered as one (not on a
  // blog or dated path).
  return CONTACT_LABEL.test(label) || (!archived && CONSULTATION_OFFER.test(label));
}

/** A dated post (`/2019/04/…`, `/2019/…`), a page of a paginated list
 *  (`/page/3`, `?page=3`, `?paged=3`) or a CMS archive listing (`/tag/…`,
 *  `/category/…`, `/author/…`). Read last: a buyer arrives at the service
 *  pages, and these are what a CMS sitemap lists first. The archives were
 *  found by the replay over stored rows: with posts ranked last, four of one
 *  site's 20 seats went to `/category/` and `/tag/` lists. */
export function isDatedOrPaginated(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const path = u.pathname.toLowerCase();
  // A year anywhere in the path, as a whole segment: `/2019/`, `/2019/04/x/`.
  if (/\/(19|20)\d{2}(\/|$)/.test(path)) return true;
  if (/\/page\/\d+\/?$/.test(path)) return true;
  // An archive listing wherever it sits: `/tag/x/`, `/blog/tag/x/`.
  if (/\/(tag|tags|category|categories|author)\//.test(path)) return true;
  return /[?&](page|paged|p)=\d+/i.test(u.search);
}

/** A child sitemap that holds posts rather than pages: Yoast's
 *  `post-sitemap.xml`, WordPress core's `wp-sitemap-posts-post-1.xml`, and the
 *  blog and news equivalents. Yoast lists it BEFORE `page-sitemap.xml`, which
 *  is how one stored crawl came to be the home page, `/blog/` and 18 posts
 *  whose own paths carry no date.
 *
 *  WordPress core names every sitemap `wp-sitemap-<type>-<n>.xml`, and the type
 *  is `posts-post` for posts, `posts-page` for pages and `posts-product` for a
 *  shop's products. Only the first is posts; the word `posts` in the other two
 *  is the name of a type of record, not of a blog. */
export function isPostSitemap(url: string): boolean {
  let file: string;
  try {
    file = new URL(url).pathname.toLowerCase().split("/").pop() ?? "";
  } catch {
    return false;
  }
  const core = /^wp-sitemap-(.+)-\d+\.xml$/.exec(file);
  if (core) return core[1] === "posts-post";
  return /(^|[-_])(post|posts|blog|news|article|articles|press)([-_.]|$)/.test(file);
}

/** Same-origin hrefs of the `<a>` elements under `roots`, absolute,
 *  fragment-stripped and deduped, in document order, kept when `keep` says. */
function anchorHrefs(
  html: string,
  baseUrl: string,
  selector: string | null,
  keep: (href: string, text: string) => boolean,
  skipRoot: (root: HTMLElement) => boolean = () => false,
): string[] {
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
  const roots = selector === null ? [doc] : doc.querySelectorAll(selector);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (skipRoot(root)) continue;
    for (const a of root.querySelectorAll("a")) {
      const href = a.getAttribute("href");
      if (!href) continue;
      let u: URL;
      try {
        u = new URL(href, resolveBase);
      } catch {
        continue;
      }
      const onSite = toSameOrigin(u.toString(), site.origin);
      if (onSite === null) continue;
      u = new URL(onSite);
      u.hash = "";
      const norm = u.toString();
      if (seen.has(norm) || !keep(norm, a.text)) continue;
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/** Same-origin links inside the home page's `<header>` and `<nav>`: the menu,
 *  which is the owner's own list of what matters. */
export function navLinks(html: string, baseUrl: string): string[] {
  // A footer's own `<nav>` is a list of legal pages and sitemaps, not the menu a
  // visitor is shown first, and it came ahead of the contact links on one stored
  // site. Skipped by walking up from the region to any enclosing footer.
  const inFooter = (root: HTMLElement): boolean => {
    for (let node: HTMLElement | null = root; node; node = node.parentNode) {
      if (node.tagName === "FOOTER") return true;
    }
    return false;
  };
  return anchorHrefs(html, baseUrl, "header, nav", () => true, inFooter);
}

/** Same-origin links anywhere on the page whose path or words say "contact". */
export function contactLinks(html: string, baseUrl: string): string[] {
  return anchorHrefs(html, baseUrl, null, isContactLike);
}

/**
 * The candidate list in the order the page budget is spent: what a buyer would
 * read, before what a CMS happens to list first.
 *
 *   1. the home page;
 *   2. contact-like links anywhere on the home page, the menu's included
 *      (contact, quote, demo, book, get started): the pages the lead-capture
 *      verdicts are about, ahead of every other menu link;
 *   3. the other links in the home page's `<header>` and `<nav>`: the owner's
 *      own menu;
 *   4. the sitemap's URLs and the home page's other links, shallowest path
 *      first, with dated posts, post sitemaps and paginated lists last.
 *
 * Step 4 used to be the whole of it, in sitemap file order, cut at 20: one
 * stored crawl spent all 20 pages on the home page, `/blog/` and 18 posts while
 * the home page linked to `/contact` seven times. Ties keep their order,
 * sitemap before body links, so the site's own sequence still decides between
 * pages we cannot tell apart. The 20-page cap is unchanged; only who gets the
 * seats is.
 */
export function rankCandidates(input: {
  home: string;
  nav: string[];
  contact: string[];
  sitemap: string[];
  postUrls?: ReadonlySet<string>;
  bodyLinks: string[];
}): string[] {
  const posts = input.postUrls ?? new Set<string>();
  const pool = [...input.sitemap, ...input.bodyLinks].map((url, i) => ({
    url,
    i,
    late: posts.has(url) || isDatedOrPaginated(url) ? 1 : 0,
    depth: pathDepth(url),
  }));
  pool.sort((a, b) => a.late - b.late || a.depth - b.depth || a.i - b.i);
  // Contact-like links first, wherever they sit: the menu's own "Contact" is
  // part of `contact` too, so the menu's other links come after it.
  // At most three contact-like links rank ahead of the menu; the rest come
  // after it, so a page with dozens of "request an appointment" links cannot
  // push the owner's own menu out of the budget.
  const contactLinks = input.contact.filter((url) => url !== input.home);
  const contact = new Set(contactLinks);
  const menu = input.nav.filter((url) => !contact.has(url));
  return [
    input.home,
    ...contactLinks.slice(0, 3),
    ...menu,
    ...contactLinks.slice(3),
    ...pool.map((p) => p.url),
  ];
}

/**
 * Could the crawl ever read this URL as a page? The same three refusals the
 * page budget applies, exported so anything that counts links a visitor could
 * follow (goals.ts) refuses the same ones: a PDF, a piece of CMS infrastructure,
 * or a path the site's own robots.txt disallows is a link we can never read.
 */
export function isFetchableCandidate(url: string, robotsTxt: string | null): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (ASSET_EXT.test(u.pathname)) return false;
  // Infrastructure a crawler can follow but a visitor never lands on — see
  // pages.ts. Following them costs a page of the budget and then invites a
  // finding about a URL the prospect never chose to publish.
  if (isInfraPath(u.toString())) return false;
  // The site's own Disallow, obeyed. Not the AI-crawler matrix — that reports
  // what OTHER crawlers may do. This is us.
  return robotsAllowsUs(robotsTxt, u.toString(), USER_AGENT);
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
 *
 * Exported for the offline replay of page selection over stored rows.
 */
export function normalizeCandidates(
  urls: string[],
  origin: string,
  max: number,
  robotsTxt: string | null,
): { chosen: string[]; considered: number } {
  const firstOfPath: string[] = [];
  const variants: string[] = [];
  const seen = new Set<string>();
  const paths = new Set<string>();
  for (const raw of urls) {
    // Same SITE, not same origin: a sitemap written on `http://` or `www.` for
    // an `https://` apex site lists this site's pages, and dropping them all
    // read one stored site at 1 page of 52. Rewritten onto the origin we
    // landed on, so every page is fetched from one address.
    const onOrigin = toSameOrigin(raw, origin);
    if (onOrigin === null) continue;
    if (!isFetchableCandidate(onOrigin, robotsTxt)) continue;
    const u = new URL(onOrigin);
    u.hash = "";
    const key = samePageKey(u);
    if (seen.has(key)) continue;
    seen.add(key);
    const path = sitePathKey(u);
    if (paths.has(path)) variants.push(u.toString());
    else {
      paths.add(path);
      firstOfPath.push(u.toString());
    }
  }
  const all = [...firstOfPath, ...variants];
  return { chosen: all.slice(0, max), considered: all.length };
}

type Sidecars = {
  robotsTxt: string | null;
  agentAccess: RobotsAgentAccess[];
  llmsTxt: { present: boolean; firstLine: string | null };
  sitemapUrls: string[];
  /** URLs that came out of a post sitemap (see `isPostSitemap`). */
  sitemapPostUrls: Set<string>;
  sitemapPresent: boolean;
  sitemapTruncated: boolean;
  /** The address the sitemap was read from, or null when none was found. */
  sitemapSource: string | null;
  /** How many listed URLs are a fault we can name (see `sitemapAddressVerdict`). */
  sitemapOffOrigin: number;
  sitemapOffOriginExample: string | null;
  /** How many listed URLs are on another scheme or `www.` host with no way to
   *  tell which one the site answers on. */
  sitemapAmbiguousOrigin: number;
  sidecarErrors: { robots: string | null; llms: string | null; sitemap: string | null };
};

/** How many `Sitemap:` lines in robots.txt we follow. An owner names one or two;
 *  a file naming hundreds (one held 500) was 503 requests from one crawl, all
 *  unpaced, against a stranger's server. Each named address is still checked
 *  for being this site before it counts toward the cap. */
export const MAX_ROBOTS_SITEMAPS = 5;

/** Kept as a function so the field is written from one place, and so a future
 *  sidecar shape that cannot answer the question returns `true` rather than
 *  silently claiming a complete read. */
function sitemapTruncatedOf(s: Sidecars): boolean {
  return s.sitemapTruncated;
}

/** robots.txt, llms.txt and sitemap.xml — every one degrades instead of
 *  failing the crawl, but a transport failure must stay visible in the result
 *  (see `optional`/`optionalRobots` above) rather than reading as "file
 *  absent". */
async function fetchSidecars(
  origin: string,
  deps: CrawlDeps,
  redirectedFrom: string | null,
): Promise<Sidecars> {
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

  // WHERE THE SITEMAP IS: the `Sitemap:` lines in robots.txt first, because
  // that is where the owner says it is, then the three addresses CMSes use.
  // Only `/sitemap.xml` used to be tried, so a site whose robots.txt names
  // `/sitemap.php`, or whose WordPress serves only `/wp-sitemap.xml`, was told
  // it has no sitemap. Each candidate must be this site (give or take `www.`
  // and the scheme) and is fetched at this origin, like every other URL here.
  // The owner's own addresses come first and are capped: `MAX_ROBOTS_SITEMAPS`,
  // gzipped ones skipped (this parser reads text, so a `.gz` is never a sitemap
  // it can use). The three CMS defaults follow.
  const candidates: string[] = [];
  for (const line of (robotsTxt ?? "").split(/\r?\n/)) {
    if (candidates.length >= MAX_ROBOTS_SITEMAPS) break;
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (!m?.[1] || /\.gz(?:[?#]|$)/i.test(m[1])) continue;
    const at = toSameOrigin(m[1], origin);
    if (at !== null && !candidates.includes(at)) candidates.push(at);
  }
  const namedCount = candidates.length;
  for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
    const at = `${origin}${path}`;
    if (!candidates.includes(at)) candidates.push(at);
  }
  // Every request at a stranger's server waits `delayMs` after the first, as the
  // page fetches do.
  const pace = pacer(deps.delayMs);
  let sitemap: SidecarFetch = { res: null, error: null };
  let sitemapSource: string | null = null;
  let firstError: string | null = null;
  for (const [i, at] of candidates.entries()) {
    if (!isSafeNestedSitemap(at, origin)) continue;
    await pace();
    // An address the owner named that answers 5xx is a sitemap we did not read.
    const tried = await optional(deps, at, i < namedCount);
    if (tried.error !== null && firstError === null) firstError = tried.error;
    if (tried.res && /<(?:[\w-]+:)?(urlset|sitemapindex)[\s>]/i.test(tried.res.body)) {
      sitemap = tried;
      sitemapSource = at;
      break;
    }
  }
  // A transport failure on any address we tried means we do not know there is
  // no sitemap; only when every address answered is absence a fact. An address
  // the owner NAMED that answered 404 is the same kind of gap: they told us the
  // sitemap is there, and we could not read it, so it is not "no sitemap".
  if (sitemapSource === null) {
    const namedUnread = namedCount > 0 ? "robots.txt names a sitemap that could not be read" : null;
    sitemap = { res: null, error: firstError ?? namedUnread };
  }

  let listed: string[] = [];
  const sitemapPostUrls = new Set<string>();
  let sitemapPresent = false;
  let sitemapTruncated = false;
  if (sitemap.res) {
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
      //
      // A child on the other side of `www.` or the scheme is moved onto this
      // origin first (`toSameOrigin`), so the same-origin rule still binds.
      const safe = parseSitemapLocs(sitemap.res.body)
        .map((child) => toSameOrigin(child, origin))
        .filter((child): child is string => child !== null && isSafeNestedSitemap(child, origin));
      const children = safe.slice(0, MAX_SITEMAP_CHILDREN);
      sitemapTruncated = safe.length > children.length;
      for (const child of children) {
        await pace();
        const nested = await optional(deps, child);
        // A child we could not fetch is a piece of their sitemap we did not
        // read, and the count that comes out is short by however much it held.
        if (nested.res) {
          const locs = parseSitemapLocs(nested.res.body);
          listed.push(...locs);
          if (isPostSitemap(child)) {
            for (const loc of locs) sitemapPostUrls.add(toSameOrigin(loc, origin) ?? loc);
          }
        } else sitemapTruncated = true;
      }
    } else {
      listed = parseSitemapLocs(sitemap.res.body);
    }
  }
  // Every listed URL on this site is moved onto the origin we landed on; the
  // ones that needed moving are counted, because "your sitemap lists http://
  // addresses for an https:// site" is a finding in its own right.
  let sitemapOffOrigin = 0;
  let sitemapOffOriginExample: string | null = null;
  let sitemapAmbiguousOrigin = 0;
  const sitemapUrls = listed.map((loc) => {
    const verdict = sitemapAddressVerdict(loc, origin, redirectedFrom);
    if (verdict === "off") {
      sitemapOffOrigin += 1;
      sitemapOffOriginExample ??= loc;
    } else if (verdict === "unsettled") {
      sitemapAmbiguousOrigin += 1;
    }
    return toSameOrigin(loc, origin) ?? loc;
  });

  return {
    robotsTxt,
    agentAccess,
    llmsTxt,
    sitemapUrls,
    sitemapPostUrls,
    sitemapPresent,
    sitemapTruncated,
    sitemapSource,
    sitemapOffOrigin,
    sitemapOffOriginExample,
    sitemapAmbiguousOrigin,
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
  // The host the entry was requested on, when the homepage redirected away from
  // it: a sitemap still listing that host is a fault we can name.
  const redirectedFrom = start.hostname !== resolved.hostname ? start.hostname : null;

  const sidecars = await fetchSidecars(origin, deps, redirectedFrom);

  const { chosen: pageUrls, considered: pagesConsidered } = normalizeCandidates(
    rankCandidates({
      home: resolvedUrl,
      nav: navLinks(home.body, resolvedUrl),
      contact: contactLinks(home.body, resolvedUrl),
      sitemap: sidecars.sitemapUrls,
      postUrls: sidecars.sitemapPostUrls,
      bodyLinks: sameOriginLinks(home.body, resolvedUrl),
    }),
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
      // Spread, so an absent probe stays absent: `formProbe: undefined` is
      // rejected under exactOptionalPropertyTypes, and `?? null` would turn
      // "we never tried" into "we tried and there was nothing".
      ...(usable && renderedPage?.formProbe !== undefined
        ? { formProbe: renderedPage.formProbe }
        : {}),
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
      truncated: sitemapTruncatedOf(sidecars),
    },
    // The denominator. Every distinct page of this site we knew of and were
    // allowed to read (home, its links, the sitemap), before the 20-page cap:
    // what "we read N of your M pages" is made of.
    selection: {
      pagesConsidered,
      sitemapSource: sidecars.sitemapSource,
      sitemapOffOrigin: sidecars.sitemapOffOrigin,
      sitemapOffOriginExample: sidecars.sitemapOffOriginExample,
      sitemapAmbiguousOrigin: sidecars.sitemapAmbiguousOrigin,
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

/** Per `<form>` in a rendered document, in document order: is it an enquiry
 *  form by the same classifier the static checks use? What the probe is told
 *  it may press. */
export function enquiryFormsIn(html: string): boolean[] {
  return parse(html)
    .querySelectorAll("form")
    .map((form) => formShape(form).kind === "enquiry");
}

/** Real deps: identified sequential fetches + one shared Playwright chromium.
 *  Playwright is imported lazily so unit tests (which inject deps) never load it. */
export function defaultCrawlDeps(
  over: Partial<CrawlDeps> & {
    /**
     * Whether to press a form on the first page that has one. Default true —
     * production behaviour, and the only way `form-rejects-empty` and
     * `form-rejects-bad-email` can ever answer.
     *
     * Turn it OFF for a read-only pass. The abort harness stops the submission
     * before it leaves the browser and there are real-Chromium tests, control
     * cases included, that say so — but pressing a stranger's send button is
     * still an act, and a bulk re-crawl of sites we might approach is not the
     * place to perform it dozens of times over.
     *
     * With it off the two probe checks report `unmeasured` and say we did not
     * try, rather than "we found no enquiry form" — which would be a false
     * statement about their site made to cover a choice of ours.
     */
    probeForms?: boolean;
  } = {},
): CrawlDeps {
  // Resolved up front so the renderPages closure below paces itself on the
  // SAME delay the caller configured, instead of silently ignoring it.
  const { probeForms: pressForms = true, ...deps } = over;
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
        // Contact-like pages first, so the one form we press is the one on the
        // page the site calls its contact page, where one exists. The order is
        // only the browser's: what comes back is keyed by URL.
        const order = [
          ...urls.filter((u) => isContactLike(u)),
          ...urls.filter((u) => !isContactLike(u)),
        ];
        await pacedEach(order, delayMs, async (url) => {
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
            //
            // `formProbe` is left ABSENT — not null — when probing is off.
            // Absent means "we never tried"; null means "we tried and this page
            // had no form we could identify". Only one of those is a fact about
            // their site, and the checks have to be able to tell them apart.
            if (!pressForms) {
              out.set(url, { html, axe, vitals });
            } else {
              // Three answers, and each must stay distinct: a FormProbe (pressed),
              // null (tried, no enquiry form on this page) and absent (we could not
              // try: the probe ran out of time, or the forms did not line up with
              // the classifier's). Absent reads as "not measured"; null reads as a
              // fact about the site. So a timeout or mismatch never becomes null.
              let formProbe: FormProbe | null | undefined;
              if (!formProbed) {
                formProbe = await budgetedFormProbe(
                  probeForms(pageInteractionDeps(page, url, enquiryFormsIn(html))),
                  PROBE_BUDGET_MS,
                );
                if (formProbe) formProbed = true;
              }
              out.set(url, {
                html,
                axe,
                vitals,
                ...(formProbe === undefined ? {} : { formProbe }),
              });
            }
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
    ...deps,
  };
}
