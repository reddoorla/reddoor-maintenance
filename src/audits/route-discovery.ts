/**
 * Route discovery for the deployed-URL browser audit. Pulls the site's sitemap, then samples a
 * REPRESENTATIVE set of paths — bucketed by path family (first segment) and sampled round-robin —
 * so every page *type* is covered, including the dynamic CMS-generated templates (Prismic
 * `[uid]`/`[slug]` detail pages: blog posts, projects, portfolio items) where broken
 * images / overflowing galleries / dead links hide. Taking the first N sitemap entries would skew
 * to top-level static pages and miss them. Pure functions + one fetch-injected entry point.
 */

export type DiscoverDeps = {
  /** Fetch a URL, returning its text body, or null on any non-2xx / network error. */
  fetchText: (url: string) => Promise<string | null>;
};

export type DiscoveredRoutes = {
  /** Absolute URLs (rebuilt on the deployed origin), always including the homepage. */
  routes: string[];
  source: "sitemap" | "homepage-links" | "root-only";
  /** Path-family → count, for the evidence note ("/, /work ×4, /blog ×4"). */
  familyCounts: Record<string, number>;
};

const DEFAULT_CAP = 15;

/** Extract `<loc>` URLs from sitemap XML. Tolerant of namespaces/whitespace; ignores junk. */
export function parseSitemapUrls(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1];
    if (url) out.push(url.trim());
  }
  return out;
}

/** Same-origin `<a href>` paths from an HTML body (homepage fallback). Returns root-relative
 *  pathnames; off-origin / anchor / mailto / tel links are dropped. */
export function parseHtmlLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const u = new URL(href, baseUrl);
      if (u.origin !== new URL(baseUrl).origin) continue;
      out.add(u.pathname);
    } catch {
      /* skip unparseable */
    }
  }
  return [...out];
}

/** First non-empty path segment ("/" → "", "/work/x" → "work"). The "family" we bucket by. */
function family(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

/** Extensions that mark a path as a downloadable asset/document, NOT a navigable page. Probing
 *  one in a browser can never yield a `<title>`/meta description, and a download makes
 *  `page.goto` throw — so a single homepage-linked PDF used to poison the reachability AND
 *  titles-meta verdicts with certain fails (2026-07-16: MSOT's capabilities PDF). Blocklist (not
 *  an html/htm allowlist) so dotted page slugs like `/blog/v2.0-release` are kept. */
const ASSET_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "csv",
  "txt",
  "rtf",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "svg",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "css",
  "js",
  "mjs",
  "map",
  "json",
  "xml",
  "webmanifest",
  "rss",
  "atom",
  "zip",
  "gz",
  "tar",
  "rar",
  "7z",
  "dmg",
  "exe",
  "mp3",
  "mp4",
  "webm",
  "mov",
  "avi",
  "wav",
  "ogg",
  "m4a",
  "m4v",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
]);

/** True when a pathname looks like a navigable PAGE (extensionless, .html/.htm, or a dotted slug
 *  whose "extension" isn't a known asset type). PURE; exported for tests. */
export function isPageRoutePath(pathname: string): boolean {
  const last = pathname.split("/").filter(Boolean).pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return true; // no extension (or a dotfile-style segment) → page
  const ext = last.slice(dot + 1).toLowerCase();
  if (ext === "html" || ext === "htm") return true;
  return !ASSET_EXTENSIONS.has(ext);
}

/**
 * Sample a representative set of PATHNAMES from a list of URLs/paths. Always includes "/". Buckets
 * the rest by path family and takes them round-robin (one per family per pass), so every family
 * is represented before any family gets a second page — guaranteeing CMS templates aren't skipped.
 * Caps the total. Asset/file URLs are dropped (only real pages are probed), and trailing slashes
 * are normalized away so `/a` and `/a/` — the same page — can't be sampled twice (2026-07-16:
 * revogen.com linked both forms, which guaranteed a bogus "duplicate title" titles-meta fail). PURE.
 */
export function sampleRoutePaths(urlsOrPaths: string[], cap: number = DEFAULT_CAP): string[] {
  const seen = new Set<string>(["/"]);
  const buckets = new Map<string, string[]>();
  for (const raw of urlsOrPaths) {
    let pathname: string;
    try {
      pathname = raw.startsWith("/")
        ? new URL(raw, "https://x.invalid").pathname
        : new URL(raw).pathname;
    } catch {
      continue;
    }
    pathname = pathname.replace(/\/+$/, ""); // `/a/` ≡ `/a` — same page, never two routes
    if (pathname === "") continue; // root ("/", "//", …) already guaranteed
    if (seen.has(pathname)) continue;
    seen.add(pathname);
    if (!isPageRoutePath(pathname)) continue;
    const fam = family(pathname);
    const arr = buckets.get(fam) ?? [];
    arr.push(pathname);
    buckets.set(fam, arr);
  }
  const result = ["/"];
  const families = [...buckets.values()];
  let guard = 0;
  while (result.length < cap && families.some((f) => f.length > 0) && guard++ < 10_000) {
    for (const fam of families) {
      if (result.length >= cap) break;
      const next = fam.shift();
      if (next) result.push(next);
    }
  }
  return result;
}

/** Per-family counts of a sampled path list, for the evidence note. */
export function familyCountsOf(paths: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of paths) {
    const key = p === "/" ? "/" : `/${family(p)}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Discover a representative route set for `deployedUrl`. Tries `<origin>/sitemap.xml` first
 * (family-sampled); falls back to the homepage's same-origin links; worst case the homepage only.
 * Returns absolute URLs rebuilt on the deployed origin.
 */
export async function discoverRoutes(
  deployedUrl: string,
  deps: DiscoverDeps,
  cap: number = DEFAULT_CAP,
): Promise<DiscoveredRoutes> {
  const origin = new URL(deployedUrl).origin;
  const abs = (paths: string[]) => paths.map((p) => new URL(p, origin).href);

  const sitemapXml = await deps.fetchText(new URL("/sitemap.xml", origin).href);
  if (sitemapXml) {
    const urls = parseSitemapUrls(sitemapXml);
    if (urls.length > 0) {
      const paths = sampleRoutePaths(urls, cap);
      return { routes: abs(paths), source: "sitemap", familyCounts: familyCountsOf(paths) };
    }
  }

  const homeHtml = await deps.fetchText(origin);
  if (homeHtml) {
    const links = parseHtmlLinks(homeHtml, origin);
    if (links.length > 0) {
      const paths = sampleRoutePaths(links, cap);
      return { routes: abs(paths), source: "homepage-links", familyCounts: familyCountsOf(paths) };
    }
  }

  return { routes: [new URL("/", origin).href], source: "root-only", familyCounts: { "/": 1 } };
}
