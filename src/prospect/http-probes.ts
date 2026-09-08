import { isPrivateOrLoopbackHost } from "../util/url.js";
import { pacedEach, sleep as defaultSleep } from "./crawl.js";
import { canonicalizeUrl, resolveNavigable } from "./journey.js";
import type { CrawlResult, PageCapture, PageExtract } from "./types.js";

/**
 * The questions you can only answer by asking the server.
 *
 * Everything in Tier 0 and Tier 1 reads bytes we already had. This module makes
 * NEW requests to a stranger's website, which changes the ethics and the
 * budget: every probe is capped, paced through `pacedEach`, and counted, and
 * the count is reported. A prospect who never asked for this audit should not
 * be able to notice it in their logs.
 *
 * WHAT MAKES A CHECK BELONG HERE. Only questions where the declared answer and
 * the served answer can differ. `<link rel="icon">` exists in the markup — Tier
 * 1 already knows that — but whether the URL it points at returns an image is a
 * different claim, and it is the one a visitor experiences. The same split
 * governs the og:image, the logo, and the sitemap: a sitemap advertising four
 * hundred URLs is worth nothing if they 404.
 *
 * THE RULE THAT SHAPES EVERY VERDICT HERE. A request that fails is ours, not
 * theirs. `assets.ts` learned this the expensive way and its `classifyProbe`
 * encodes it: only 404 and 410 prove a URL is not there, and 401/403/429/5xx
 * are things WE could not verify. Every field below is three-state for that
 * reason — `undefined` means we did not get an answer, and no check may turn
 * that into a finding about the site.
 *
 * SSRF: every URL probed here is either derived from the origin or came out of
 * the prospect's markup, so `isPrivateOrLoopbackHost` guards each one exactly
 * as it does in `assets.ts` and the crawler.
 */

export type HttpResponse = {
  /** HTTP status after redirects, or null when the request never answered.
   *  Those are different claims and only the first is about their site. */
  status: number | null;
  headers: Record<string, string>;
  /** URL the request settled on. Null when it never got there. */
  finalUrl: string | null;
  /** Redirect hops taken. Null when the client could not report them. */
  hops: number | null;
  /** First bytes, present only when the caller asked for a range. */
  body: Uint8Array | null;
  error: string | null;
};

export type HttpProbeDeps = {
  request: (
    url: string,
    opts: { method: "GET" | "HEAD"; rangeBytes?: number },
  ) => Promise<HttpResponse>;
  delayMs: number;
  sleep?: (ms: number) => Promise<void>;
};

/** A URL that answered, that provably did not, or that we could not read.
 *  The third is not a failure and never enters a denominator. */
export type ProbeVerdict = "ok" | "broken" | "unverified";

export type UrlProbe = { url: string; status: number | null; verdict: ProbeVerdict };

export type HttpFindings = {
  /** False when we had no origin to probe — nothing below is then about them. */
  measured: boolean;
  /** Requests this stage made, reported so the cost is visible. */
  requests: number;

  /** The icon a browser tab actually gets. `url` is what the page declared, or
   *  the conventional `/favicon.ico` when it declared nothing. */
  favicon: { url: string; declared: boolean; verdict: ProbeVerdict } | undefined;

  /** What `http://` does. `hops` counts redirects; `https` is where it landed. */
  httpUpgrade: { hops: number | null; https: boolean } | undefined;

  /** Two homepage samples. Equal statuses mean nothing to report; different
   *  ones are the only evidence that would justify the word "intermittent". */
  homeSamples: [number | null, number | null] | undefined;

  /** A path fetched with and without its trailing slash. `settled` is true when
   *  the two agree on one address — either by redirect or by canonical. */
  trailingSlash: { path: string; settled: boolean; detail: string } | undefined;

  /** `/index.html`, and whether it duplicates the homepage rather than
   *  redirecting or declaring the homepage canonical. Null when it 404s, which
   *  is the correct behaviour and not a finding. */
  indexAlias: { duplicate: boolean; detail: string } | null | undefined;

  /** The same path in a different case. Null when it 404s — also correct. */
  caseAlias: { path: string; duplicate: boolean; detail: string } | null | undefined;

  /** Sampled sitemap URLs. Null when there is no sitemap to sample. */
  sitemapUrls: { checked: number; total: number; broken: UrlProbe[] } | null | undefined;

  /** Outbound links to other sites. Null when the site links out nowhere. */
  externalLinks: { checked: number; total: number; broken: UrlProbe[] } | null | undefined;

  /** The image that appears when the site is shared. Null when none is
   *  declared — Tier 1 owns that, and saying it twice reads as two problems. */
  ogImage:
    | { url: string; verdict: ProbeVerdict; width: number | null; height: number | null }
    | null
    | undefined;

  /** The header logo, and the rule we used to find it, so a reader can tell
   *  whether we found the right image. */
  logo: { url: string; how: string; verdict: ProbeVerdict } | null | undefined;

  /** Internal links reached through more than one redirect. */
  redirectChains: { checked: number; chained: { url: string; hops: number }[] } | undefined;
};

/** Ceilings. Each one is a promise to a server we were not invited to. */
export const MAX_SITEMAP_PROBES = 12;
export const MAX_EXTERNAL_PROBES = 15;
export const MAX_REDIRECT_PROBES = 10;
/**
 * Hops before an internal link is worth mentioning.
 *
 * ONE redirect is ordinary and often deliberate — a trailing slash, a locale
 * prefix, a short URL. TWO is where apple.com sits on every `/us/shop/goto/*`
 * link, which is a deliberate redirector doing its job. Three is where a chain
 * stops looking intentional and starts looking like something nobody has
 * revisited, which is the only version of this a reader can act on.
 */
export const MAX_ORDINARY_HOPS = 2;
/** Bytes pulled when a probe needs to read image dimensions. Every format we
 *  can measure carries them in the first few hundred bytes; 32KB is slack for
 *  a JPEG with a large EXIF block ahead of its first frame header. */
export const IMAGE_HEADER_BYTES = 32_768;
/** An og:image below this in either direction is cropped to mush by every
 *  platform that renders it. Facebook's own floor is 200. */
export const MIN_OG_IMAGE_EDGE = 200;

export function classify(status: number | null): ProbeVerdict {
  if (status === null) return "unverified";
  if (status >= 200 && status < 300) return "ok";
  // The fetch follows redirects, so a 3xx arriving here is one that never
  // resolved — a visitor following it lands nowhere.
  if (status >= 300 && status < 400) return "broken";
  if (status === 404 || status === 410) return "broken";
  return "unverified";
}

function safe(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (isPrivateOrLoopbackHost(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Two URLs that mean the same page. A trailing slash and a `www.` are not
 *  differences a reader cares about, and treating them as ones buries the case
 *  that matters — every page declaring the homepage canonical. */
function sameAddress(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const key = (u: string) =>
    canonicalizeUrl(u)
      ?.replace(/^www\./, "")
      .replace(/\/$/, "") ?? u;
  return key(a) === key(b);
}

function extractOf(page: PageCapture): PageExtract | null {
  return page.rendered ?? page.raw;
}

/** The `<link rel="canonical">` of a page we fetched here rather than crawled.
 *  A narrow regex rather than a parse: this reads one attribute out of a
 *  document we are not otherwise interested in, and a miss costs us an
 *  `unmeasured`, never a wrong finding. */
function canonicalOf(body: Uint8Array | null): string | null {
  if (!body) return null;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(body.slice(0, 65_536));
  const tag = head.match(/<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i)?.[0];
  const href = tag?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  return href?.trim() || null;
}

/**
 * Pixel dimensions from the first bytes of an image.
 *
 * PNG, GIF and WebP put them at a fixed offset; JPEG requires walking the
 * segment chain to the first frame header. Anything else — SVG above all, which
 * has no intrinsic size worth the name — returns null, and null is reported as
 * "we did not measure this", never as a failure. A vector logo is not a defect.
 */
export function imageSize(bytes: Uint8Array | null): { width: number; height: number } | null {
  if (!bytes || bytes.length < 24) return null;
  // `>>> 0`, because `0x89 << 24` is NEGATIVE in JavaScript and the PNG
  // signature test silently never matched without it.
  const be32 = (o: number) =>
    ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
  const be16 = (o: number) => (bytes[o]! << 8) | bytes[o + 1]!;
  const le16 = (o: number) => bytes[o]! | (bytes[o + 1]! << 8);

  // PNG: an 8-byte signature, then an IHDR chunk whose first two fields are the
  // dimensions.
  if (be32(0) === 0x89504e47 && be32(4) === 0x0d0a1a0a) {
    return { width: be32(16), height: be32(20) };
  }
  // GIF87a / GIF89a: little-endian, straight after the six-byte magic.
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: le16(6), height: le16(8) };
  }
  // RIFF/WEBP. Three sub-formats, each storing the size differently.
  if (be32(0) === 0x52494646 && be32(8) === 0x57454250 && bytes.length >= 30) {
    const fourcc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (fourcc === "VP8 ") return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (fourcc === "VP8L") {
      const b = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === "VP8X") {
      const dim = (o: number) => 1 + (bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16));
      return { width: dim(24), height: dim(27) };
    }
    return null;
  }
  // JPEG: walk the markers to the first SOFn, skipping every other segment by
  // its declared length. Bounded by the buffer we were given.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      // Standalone markers carry no length; SOS means the entropy-coded scan
      // has begun and there is no header left to find.
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      if (marker === 0xda) return null;
      const len = be16(i + 2);
      // SOFn, excluding the four that are not frame headers.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { width: be16(i + 7), height: be16(i + 5) };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

function empty(measured: boolean): HttpFindings {
  return {
    measured,
    requests: 0,
    favicon: undefined,
    httpUpgrade: undefined,
    homeSamples: undefined,
    trailingSlash: undefined,
    indexAlias: undefined,
    caseAlias: undefined,
    sitemapUrls: undefined,
    externalLinks: undefined,
    ogImage: undefined,
    logo: undefined,
    redirectChains: undefined,
  };
}

export async function probeHttp(crawl: CrawlResult, deps: HttpProbeDeps): Promise<HttpFindings> {
  // `.origin`, not `.toString()`: the latter appends a slash to a bare host, so
  // every `${origin}/index.html` in this file became `//index.html` — a URL
  // that 404s everywhere, which read as "the alias does not exist" on every
  // site we would ever audit.
  const origin = (() => {
    const ok = safe(crawl.origin);
    return ok ? new URL(ok).origin : null;
  })();
  if (!origin) return empty(false);

  const out = empty(true);
  const sleep = deps.sleep ?? defaultSleep;
  let requests = 0;

  /** Every request in this module goes through here: it counts, it paces, and
   *  it refuses anything the SSRF guard rejects. */
  const ask = async (
    url: string,
    opts: { method: "GET" | "HEAD"; rangeBytes?: number } = { method: "HEAD" },
  ): Promise<HttpResponse | null> => {
    const target = safe(url);
    if (!target) return null;
    if (requests > 0 && deps.delayMs > 0) await sleep(deps.delayMs);
    requests++;
    try {
      return await deps.request(target, opts);
    } catch (err) {
      return {
        status: null,
        headers: {},
        finalUrl: null,
        hops: null,
        body: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const home = crawl.pages[0];
  const homeExtract = home ? extractOf(home) : null;

  // ---- The icon a tab actually gets -------------------------------------
  {
    const declared = homeExtract?.links?.find((l) =>
      /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(l.rel ?? ""),
    );
    const href = declared?.href ? resolveNavigable(declared.href, home?.url ?? origin) : null;
    const url = href ?? `${origin}/favicon.ico`;
    const res = await ask(url, { method: "GET", rangeBytes: 2048 });
    if (res) {
      const type = res.headers["content-type"] ?? "";
      const verdict = classify(res.status);
      out.favicon = {
        url,
        declared: Boolean(href),
        // A 200 that hands back the HTML of a soft-404 page is not an icon.
        // The content type is what separates "served" from "answered".
        verdict:
          verdict === "ok" && /^(image|text\/xml|application\/xml)/i.test(type)
            ? "ok"
            : verdict === "ok"
              ? "broken"
              : verdict,
      };
    }
  }

  // ---- What http:// does -------------------------------------------------
  {
    const insecure = origin.replace(/^https:/, "http:");
    if (insecure !== origin) {
      const res = await ask(insecure, { method: "HEAD" });
      if (res && res.status !== null) {
        out.httpUpgrade = { hops: res.hops, https: (res.finalUrl ?? "").startsWith("https:") };
      }
    }
  }

  // ---- Does the homepage answer the same way twice? ----------------------
  {
    const a = await ask(origin, { method: "HEAD" });
    const b = await ask(origin, { method: "HEAD" });
    if (a && b) out.homeSamples = [a.status, b.status];
  }

  // ---- One address per page ----------------------------------------------
  // A path fetched both ways. Picked from the crawl rather than invented, so
  // we are asking about a page that exists.
  {
    const sample = crawl.pages
      .map((p) => p.url)
      .find((u) => {
        try {
          const path = new URL(u).pathname;
          return path !== "/" && !/\.[a-z0-9]+$/i.test(path);
        } catch {
          return false;
        }
      });
    if (sample) {
      const bare = sample.replace(/\/+$/, "");
      const slashed = `${bare}/`;
      const [a, b] = [
        await ask(bare, { method: "GET", rangeBytes: 65_536 }),
        await ask(slashed, { method: "GET", rangeBytes: 65_536 }),
      ];
      if (a && b && a.status !== null && b.status !== null) {
        const bothServed = classify(a.status) === "ok" && classify(b.status) === "ok";
        if (!bothServed) {
          // One of them redirects or 404s, which is exactly the desired
          // behaviour — the site has one address for the page.
          out.trailingSlash = {
            path: new URL(bare).pathname,
            settled: true,
            detail: "one form redirects to the other",
          };
        } else if (a.finalUrl !== null && a.finalUrl === b.finalUrl) {
          // Compared exactly, NOT through `sameAddress` — that helper ignores a
          // trailing slash, which is the entire subject of this check. Using it
          // here made every site look settled.

          out.trailingSlash = {
            path: new URL(bare).pathname,
            settled: true,
            detail: "both forms resolve to the same address",
          };
        } else {
          const ca = canonicalOf(a.body);
          const cb = canonicalOf(b.body);
          const agree = sameAddress(ca, cb);
          out.trailingSlash = {
            path: new URL(bare).pathname,
            settled: agree,
            detail: agree
              ? "both forms answer, and both declare the same canonical"
              : "both forms answer with no canonical to settle which is the real one",
          };
        }
      }
    }
  }

  // ---- /index.html ---------------------------------------------------------
  {
    const alias = `${origin}/index.html`;
    const res = await ask(alias, { method: "GET", rangeBytes: 65_536 });
    if (res && res.status !== null) {
      if (classify(res.status) !== "ok") {
        // A 404 here is correct behaviour, not a defect.
        out.indexAlias = null;
      } else if (sameAddress(res.finalUrl, origin)) {
        out.indexAlias = { duplicate: false, detail: "it redirects to the homepage" };
      } else {
        const canonical = canonicalOf(res.body);
        const points = sameAddress(canonical, origin);
        out.indexAlias = {
          duplicate: !points,
          detail: points
            ? "it answers, and declares the homepage canonical"
            : "it answers with the homepage's content and does not point back at it",
        };
      }
    }
  }

  // ---- The same path in a different case ----------------------------------
  {
    const sample = crawl.pages
      .map((p) => p.url)
      .find((u) => {
        try {
          return /\/[a-z][a-z0-9-]*\/?$/.test(new URL(u).pathname);
        } catch {
          return false;
        }
      });
    if (sample) {
      const url = new URL(sample);
      const flipped = url.pathname.replace(/\/([a-z])/g, (_m, c: string) => `/${c.toUpperCase()}`);
      url.pathname = flipped;
      const res = await ask(url.toString(), { method: "GET", rangeBytes: 65_536 });
      if (res && res.status !== null) {
        if (classify(res.status) !== "ok") {
          out.caseAlias = null;
        } else {
          const canonical = canonicalOf(res.body);
          const points = sameAddress(canonical, sample) || sameAddress(res.finalUrl, sample);
          out.caseAlias = {
            path: flipped,
            duplicate: !points,
            detail: points
              ? "it resolves back to the lower-case address"
              : "it answers as its own page, so the same content has two addresses",
          };
        }
      }
    }
  }

  // ---- Do the sitemap's URLs answer? --------------------------------------
  const sitemapSample = crawl.sitemap.sample ?? [];
  if (!crawl.sitemap.present || sitemapSample.length === 0) {
    out.sitemapUrls = crawl.sitemap.present ? undefined : null;
  } else {
    // Spread across the sitemap rather than its first twelve entries, which on
    // most CMSes are the newest posts and the least likely to be stale.
    const step = Math.max(1, Math.floor(sitemapSample.length / MAX_SITEMAP_PROBES));
    const picked = sitemapSample.filter((_, i) => i % step === 0).slice(0, MAX_SITEMAP_PROBES);
    const broken: UrlProbe[] = [];
    await pacedEach(picked, 0, async (url) => {
      const res = await ask(url, { method: "HEAD" });
      if (!res) return;
      const verdict = classify(res.status);
      if (verdict === "broken") broken.push({ url, status: res.status, verdict });
    });
    out.sitemapUrls = { checked: picked.length, total: crawl.sitemap.urlCount, broken };
  }

  // ---- Links out to other sites -------------------------------------------
  {
    const originKey = canonicalizeUrl(origin)?.split("/")[0] ?? "";
    const external = new Set<string>();
    for (const page of crawl.pages) {
      for (const a of extractOf(page)?.anchors ?? []) {
        const abs = resolveNavigable(a.href, page.url);
        if (!abs || !safe(abs)) continue;
        const host = canonicalizeUrl(abs)?.split("/")[0] ?? "";
        if (host && host !== originKey) external.add(abs);
      }
    }
    const all = [...external];
    if (all.length === 0) {
      out.externalLinks = null;
    } else {
      const picked = all.slice(0, MAX_EXTERNAL_PROBES);
      const broken: UrlProbe[] = [];
      await pacedEach(picked, 0, async (url) => {
        const res = await ask(url, { method: "HEAD" });
        if (!res) return;
        const verdict = classify(res.status);
        if (verdict === "broken") broken.push({ url, status: res.status, verdict });
      });
      out.externalLinks = { checked: picked.length, total: all.length, broken };
    }
  }

  // ---- The image that appears when the site is shared ----------------------
  {
    const declared = homeExtract?.social?.["og:image"] ?? null;
    const url = declared ? resolveNavigable(declared, home?.url ?? origin) : null;
    if (!url) {
      out.ogImage = null;
    } else {
      const res = await ask(url, { method: "GET", rangeBytes: IMAGE_HEADER_BYTES });
      if (res) {
        const size = imageSize(res.body);
        out.ogImage = {
          url,
          verdict: classify(res.status),
          width: size?.width ?? null,
          height: size?.height ?? null,
        };
      }
    }
  }

  // ---- The logo ------------------------------------------------------------
  {
    // `imageSrcs` is absent on reports stored before it existed, which reads as
    // "we did not look", not "the page has no images".
    const images = homeExtract?.imageSrcs;
    const byName = images?.find((src) => /logo/i.test(src));
    const chosen = byName ?? images?.[0] ?? null;
    const url = chosen ? resolveNavigable(chosen, home?.url ?? origin) : null;
    if (!images) {
      out.logo = undefined;
    } else if (!url) {
      out.logo = null;
    } else {
      const res = await ask(url, { method: "HEAD" });
      if (res) {
        out.logo = {
          url,
          // Named, because "the logo" is a guess and the reader deserves to
          // know which guess we made before they act on the verdict.
          how: byName
            ? "the first image with 'logo' in its file name"
            : "the first image on the homepage",
          verdict: classify(res.status),
        };
      }
    }
  }

  // ---- Internal links that take more than one hop --------------------------
  {
    const originKey = canonicalizeUrl(origin)?.split("/")[0] ?? "";
    const internal = new Set<string>();
    for (const page of crawl.pages) {
      for (const a of extractOf(page)?.anchors ?? []) {
        const abs = resolveNavigable(a.href, page.url);
        if (!abs || !safe(abs)) continue;
        const host = canonicalizeUrl(abs)?.split("/")[0] ?? "";
        if (host === originKey && !sameAddress(abs, page.url)) internal.add(abs);
      }
    }
    // Spread across the set, not the first ten. On apple.com the first ten
    // internal links are all shop navigation, so the sample described one
    // component rather than the site.
    const all = [...internal];
    const step = Math.max(1, Math.floor(all.length / MAX_REDIRECT_PROBES));
    const picked = all.filter((_, i) => i % step === 0).slice(0, MAX_REDIRECT_PROBES);
    if (picked.length > 0) {
      const chained: { url: string; hops: number }[] = [];
      await pacedEach(picked, 0, async (url) => {
        const res = await ask(url, { method: "HEAD" });
        if (res?.hops != null && res.hops > MAX_ORDINARY_HOPS) {
          chained.push({ url, hops: res.hops });
        }
      });
      out.redirectChains = { checked: picked.length, chained };
    }
  }

  out.requests = requests;
  return out;
}

/**
 * The production request.
 *
 * `redirect: "manual"` and the chain walked by hand, because `fetch` following
 * redirects for us hides the one thing two of these checks are about: how many
 * hops it took. `res.url` after an automatic follow gives the destination and
 * not the distance.
 *
 * The SSRF guard is applied to every hop, not only the first — a redirect is
 * the classic way to get a fetcher to an address it would have refused.
 */
export const MAX_HOPS = 6;

export function defaultHttpProbeDeps(
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): HttpProbeDeps {
  return {
    delayMs: 150,
    async request(url, opts) {
      const headers: Record<string, string> = {
        "user-agent": userAgent,
        accept: "text/html,image/*,*/*",
      };
      if (opts.rangeBytes) headers.range = `bytes=0-${opts.rangeBytes - 1}`;

      let current = url;
      let hops = 0;
      for (;;) {
        if (!safe(current)) {
          return { status: null, headers: {}, finalUrl: null, hops, body: null, error: "refused" };
        }
        const res = await fetchImpl(current, {
          method: opts.method,
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
        const flat: Record<string, string> = Object.fromEntries(
          [...res.headers].map(([k, v]) => [k.toLowerCase(), v]),
        );
        const location = flat["location"];
        if (res.status >= 300 && res.status < 400 && location && hops < MAX_HOPS) {
          await res.body?.cancel();
          const next = resolveNavigable(location, current);
          if (!next) break;
          current = next;
          hops++;
          continue;
        }
        let body: Uint8Array | null = null;
        if (opts.rangeBytes) {
          // A server that ignores `Range` sends the whole file, so the read is
          // capped on our side too rather than trusting the header we sent.
          const buf = await res.arrayBuffer();
          body = new Uint8Array(buf.slice(0, opts.rangeBytes));
        } else {
          await res.body?.cancel();
        }
        return { status: res.status, headers: flat, finalUrl: current, hops, body, error: null };
      }
      return {
        status: null,
        headers: {},
        finalUrl: current,
        hops,
        body: null,
        error: "redirect loop",
      };
    },
  };
}
