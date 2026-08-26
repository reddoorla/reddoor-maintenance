import { isPrivateOrLoopbackHost } from "../util/url.js";
import { pacedEach, sleep as defaultSleep } from "./crawl.js";
import { canonicalizeUrl, resolveNavigable } from "./journey.js";
import type { PageCapture, PageExtract } from "./types.js";

/**
 * What is broken, and what is heavy.
 *
 * Lighthouse audits one page and scores it. It does not crawl, so it never sees
 * a link that 404s three pages in, and it reports a performance number without
 * naming the four-megabyte hero image that caused it. Both of those are the
 * actionable half: "your performance is 60" is a grade, "this one photograph is
 * 4.2 MB and it is on every page" is a job.
 *
 * Everything here costs requests to someone else's server, so it is bounded and
 * paced, and the bounds are reported. `linksFound` against `linksChecked` is
 * how the report avoids saying "every link works" when it tested forty of two
 * hundred — the same discipline as `anchorCount` in the extract.
 *
 * SSRF: every URL probed here came out of the prospect's markup, which means an
 * attacker who controls the page controls what we fetch. `isPrivateOrLoopbackHost`
 * is the same guard the crawler applies to its own entry point and redirects,
 * and it is applied here for the same reason.
 */

export type ProbedUrl = {
  url: string;
  /** HTTP status, or null when the request itself failed. Those are different
   *  claims: a 404 is the prospect's broken link, a transport failure might be
   *  our network, and only the first belongs in a report as their defect. */
  status: number | null;
  /** Size in bytes, from `content-length`. Null when the server did not say —
   *  which is common, and is reported as unknown rather than guessed at. */
  bytes: number | null;
  error: string | null;
  /** Crawled pages that reference it, so a fix has an address. */
  referencedBy: string[];
};

export type AssetCheck = {
  /** Internal links that did not resolve to something a visitor can read. */
  brokenLinks: ProbedUrl[];
  /** Images that did not load. A broken image is visible to every visitor and
   *  is usually a one-line fix, which makes it the cheapest finding here. */
  brokenImages: ProbedUrl[];
  /** Heaviest images first, capped — the ones worth naming. */
  heaviestImages: ProbedUrl[];
  /** Summed `content-length` of every image we got a size for. Null when no
   *  image reported one, so the report never prints "0 MB of images" for a
   *  page full of pictures whose server is quiet about sizes. */
  imageBytesMeasured: number | null;
  /** How many images contributed to that sum, against how many were checked —
   *  the honest denominator for it. */
  imagesWithKnownSize: number;
  linksFound: number;
  linksChecked: number;
  imagesFound: number;
  imagesChecked: number;
};

export type AssetCheckDeps = {
  /** Resolves to the status and headers of one URL. Injected so the whole
   *  check is testable without a network. */
  probe: (url: string) => Promise<{ status: number; headers: Record<string, string> }>;
  /** Per-kind ceilings on how many requests this will make. */
  maxLinks: number;
  maxImages: number;
  delayMs: number;
  sleep?: (ms: number) => Promise<void>;
};

/** Images big enough to be worth naming in a report, and how many to name. */
export const HEAVY_IMAGE_BYTES = 300_000;
export const MAX_HEAVY_IMAGES = 8;

/** A status that means a visitor sees something. 3xx is not included because
 *  the fetch follows redirects — a 3xx surfacing here means a redirect that did
 *  not resolve, which is a defect. */
function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function extractOf(page: PageCapture): PageExtract | null {
  return page.rendered ?? page.raw;
}

/** Absolute, http(s), not a private address, deduped — with the referring
 *  pages accumulated so a finding can say where it lives. */
function collect(
  pages: PageCapture[],
  hrefsOf: (extract: PageExtract) => string[],
  sameSiteOnly: boolean,
  origin: string,
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const originKey = canonicalizeUrl(origin)?.split("/")[0] ?? "";

  for (const page of pages) {
    const extract = extractOf(page);
    if (!extract) continue;
    for (const href of hrefsOf(extract)) {
      const abs = resolveNavigable(href, page.url);
      if (!abs) continue;
      let parsed: URL;
      try {
        parsed = new URL(abs);
      } catch {
        continue;
      }
      // Never probe a private address just because a page linked to one.
      if (isPrivateOrLoopbackHost(parsed.hostname)) continue;
      if (sameSiteOnly) {
        const host = canonicalizeUrl(abs)?.split("/")[0] ?? "";
        if (host !== originKey) continue;
      }
      const key = parsed.toString();
      const referrers = found.get(key);
      if (referrers) {
        if (!referrers.includes(page.url)) referrers.push(page.url);
      } else {
        found.set(key, [page.url]);
      }
    }
  }
  return found;
}

async function probeAll(entries: [string, string[]][], deps: AssetCheckDeps): Promise<ProbedUrl[]> {
  const out: ProbedUrl[] = [];
  await pacedEach(
    entries,
    deps.delayMs,
    async ([url, referencedBy]) => {
      try {
        const { status, headers } = await deps.probe(url);
        const declared = Number(headers["content-length"]);
        out.push({
          url,
          status,
          // Only a finite, non-negative number counts as a size. A missing or
          // malformed header is unknown, and `Number("")` is 0 — which would
          // report a real image as weighing nothing.
          bytes: Number.isFinite(declared) && declared >= 0 ? declared : null,
          error: null,
          referencedBy,
        });
      } catch (err) {
        out.push({
          url,
          status: null,
          bytes: null,
          error: err instanceof Error ? err.message : String(err),
          referencedBy,
        });
      }
    },
    deps.sleep ?? defaultSleep,
  );
  return out;
}

export async function checkAssets(
  pages: PageCapture[],
  origin: string,
  deps: AssetCheckDeps,
): Promise<AssetCheck> {
  // Links: same-site only. An external 404 is somebody else's outage as often
  // as it is a stale link, and probing the whole outbound web on a prospect's
  // behalf is neither courteous nor useful.
  const links = collect(pages, (e) => (e.anchors ?? []).map((a) => a.href), true, origin);
  // Images: wherever they are hosted. A broken image from a CDN is still a
  // broken image on the prospect's page.
  const images = collect(pages, (e) => e.imageSrcs ?? [], false, origin);

  const linkEntries = [...links.entries()].slice(0, deps.maxLinks);
  const imageEntries = [...images.entries()].slice(0, deps.maxImages);

  const probedLinks = await probeAll(linkEntries, deps);
  const probedImages = await probeAll(imageEntries, deps);

  const sized = probedImages.filter((i) => i.bytes !== null && i.status !== null && isOk(i.status));
  const totalBytes = sized.reduce((sum, i) => sum + (i.bytes ?? 0), 0);

  return {
    // A transport failure is excluded: it may be our network, and only a real
    // HTTP answer is evidence about the prospect's site.
    brokenLinks: probedLinks.filter((l) => l.status !== null && !isOk(l.status)),
    brokenImages: probedImages.filter((i) => i.status !== null && !isOk(i.status)),
    heaviestImages: sized
      .filter((i) => (i.bytes ?? 0) >= HEAVY_IMAGE_BYTES)
      .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
      .slice(0, MAX_HEAVY_IMAGES),
    imageBytesMeasured: sized.length > 0 ? totalBytes : null,
    imagesWithKnownSize: sized.length,
    linksFound: links.size,
    linksChecked: linkEntries.length,
    imagesFound: images.size,
    imagesChecked: imageEntries.length,
  };
}
