const HOSTS = ["d3syaxnfm3oj0e.cloudfront.net", "dv4tl7yyk1zlp.cloudfront.net"];

/** Strip Blux transform segments (any path part containing ':') to the proven
 *  original `<host>/<siteId>/<uuid>.<ext>`. Returns null for non-CDN urls. */
export function normalizeCdnUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!HOSTS.includes(u.hostname)) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  const siteId = segs[0]!;
  const file = segs[segs.length - 1]!;
  if (!/\.[a-z0-9]+$/i.test(file)) return null;
  return `https://${u.hostname}/${siteId}/${file}`;
}

const URL_RE = new RegExp(
  `https?://(?:${HOSTS.join("|").replace(/\./g, "\\.")})/[^"'\\\\ )>]+`,
  "g",
);

/** uuid (last path segment sans extension) → canonical CDN url, scraped from HTML. */
export function collectAssetUrls(htmls: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const html of htmls) {
    for (const m of html.matchAll(URL_RE)) {
      const canon = normalizeCdnUrl(m[0]);
      if (!canon) continue;
      const file = canon.split("/").pop()!;
      const uuid = file.replace(/\.[a-z0-9]+$/i, "");
      if (!map.has(uuid)) map.set(uuid, canon);
    }
  }
  return map;
}
