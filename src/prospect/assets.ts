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

/**
 * Why a probe produced no evidence about the prospect's site.
 *
 * Every value here is OUR missing data, never their defect — which is the whole
 * reason the type exists. Grouped rather than free text so a report can count
 * them and a test can assert on them.
 *
 *   auth-required  401. The URL exists and is gated; a visitor with an account
 *                  sees it and we do not.
 *   refused        403. Overwhelmingly bot management, not a dead URL — a CDN
 *                  declining a non-browser client for an image the page paints
 *                  perfectly well.
 *   rate-limited   429. We caused this one, by asking too fast.
 *   server-error   5xx. The server was having a bad moment when we asked;
 *                  saying so as "your link is broken" outlives the moment.
 *   no-response    The request never got an answer at all — possibly our
 *                  network, possibly a timeout we set.
 *   other          Any other non-2xx we are not willing to characterise.
 */
export type UnverifiedReason =
  "auth-required" | "refused" | "rate-limited" | "server-error" | "no-response" | "other";

export type UnverifiedGroup = {
  reason: UnverifiedReason;
  count: number;
  /** A sentence a report can print as-is, phrased as our limit rather than
   *  their fault. */
  detail: string;
  /** One URL from the group, so a reader can reproduce it themselves. */
  example: string;
};

/** The half of the probe budget that came back without evidence. Reported
 *  beside the broken lists, never inside them: "we could not check 6 of your
 *  40 links" is an honest sentence, and "6 broken links" would have been a
 *  false one. */
export type UnverifiedProbes = {
  count: number;
  groups: UnverifiedGroup[];
};

export type AssetCheck = {
  /** Internal links that did not resolve to something a visitor can read.
   *  Only answers that prove absence — see `classifyProbe`. */
  brokenLinks: ProbedUrl[];
  /** Images that did not load. A broken image is visible to every visitor and
   *  is usually a one-line fix, which makes it the cheapest finding here. */
  brokenImages: ProbedUrl[];
  /**
   * Links we asked about and learned nothing from.
   *
   * Optional because this type also describes runs deserialized from
   * `prospect_audits.result_json`, and every report stored before this field
   * existed lacks it — and lacks it for the worst reason: in those reports the
   * unverifiable answers are sitting in `brokenLinks`. `checkAssets` always
   * sets it; a reader must treat absence as "not measured", never as "nothing
   * went unverified".
   */
  linksUnverified?: UnverifiedProbes;
  /** Images we asked about and learned nothing from. Optional for the same
   *  reason as `linksUnverified`, and with the same reading of absence. */
  imagesUnverified?: UnverifiedProbes;
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

/**
 * Broken, fine, or unknowable — and the three are not interchangeable.
 *
 * This used to be `isOk` alone, which made every non-2xx answer a broken link
 * with its status printed as proof. That is the exact failure this audit exists
 * to avoid: a 403 from bot management, a 429 our own burst provoked, and a 502
 * from a bad afternoon are all things WE could not verify, and a report that
 * calls them the prospect's broken links is wrong in a way the prospect cannot
 * even act on — there is nothing to fix.
 *
 * Only two answers prove a URL is not there: 404 and 410. A 3xx counts as
 * broken because the fetch follows redirects, so one arriving here is a
 * redirect that never resolved and a visitor following it lands nowhere.
 * Everything else is `unverified`.
 *
 * (A HEAD that answers 405 never reaches here through the production probe:
 * `defaultAssetProbe` in pipeline.ts retries it as a ranged GET. If one does
 * arrive — because the GET refused too — it is unverified, not broken.)
 */
export function classifyProbe(status: number | null): "ok" | "broken" | "unverified" {
  if (status === null) return "unverified";
  if (isOk(status)) return "ok";
  if (status >= 300 && status < 400) return "broken";
  if (status === 404 || status === 410) return "broken";
  return "unverified";
}

function reasonFor(probed: ProbedUrl): UnverifiedReason {
  if (probed.status === null) return "no-response";
  if (probed.status === 401) return "auth-required";
  if (probed.status === 403) return "refused";
  if (probed.status === 429) return "rate-limited";
  if (probed.status >= 500) return "server-error";
  return "other";
}

const UNVERIFIED_DETAIL: Record<UnverifiedReason, string> = {
  "auth-required": "answered 401, so it is gated rather than missing — we could not see it.",
  refused:
    "answered 403 to our request. That is usually bot management declining a non-browser client, not a dead URL, so we have not counted it either way.",
  "rate-limited":
    "answered 429, which our own request rate can cause. We stopped rather than guess.",
  "server-error": "answered a 5xx while we were looking, so we have no reading on it.",
  "no-response": "never answered us — possibly our network, possibly a timeout of ours.",
  other: "answered something we are not willing to read as either working or broken.",
};

/** The unverifiable probes, grouped by reason. Order is by count so the
 *  dominant reason — nearly always one CDN policy — reads first. */
function summarizeUnverified(probed: ProbedUrl[]): UnverifiedProbes {
  const groups = new Map<UnverifiedReason, { count: number; example: string }>();
  for (const p of probed) {
    if (classifyProbe(p.status) !== "unverified") continue;
    const reason = reasonFor(p);
    const existing = groups.get(reason);
    if (existing) existing.count += 1;
    else groups.set(reason, { count: 1, example: p.url });
  }
  return {
    count: [...groups.values()].reduce((sum, g) => sum + g.count, 0),
    groups: [...groups.entries()]
      .map(([reason, g]) => ({
        reason,
        count: g.count,
        detail: UNVERIFIED_DETAIL[reason],
        example: g.example,
      }))
      .sort((a, b) => b.count - a.count),
  };
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

type ProbeJob = { url: string; referencedBy: string[] };

/**
 * Every probe this stage makes, in one paced pass.
 *
 * Links and images used to be two separate `pacedEach` loops, and `pacedEach`
 * never waits before its first item — so the first image request followed the
 * last link request with no gap at all. One unpaced request in a stage whose
 * whole budget exists to be courteous, and a burst is exactly what earns the
 * 429 that then got printed as the prospect's broken link. One pass, one delay
 * between every pair of requests.
 */
async function probeAll(jobs: ProbeJob[], deps: AssetCheckDeps): Promise<ProbedUrl[]> {
  const out: ProbedUrl[] = [];
  await pacedEach(
    jobs,
    deps.delayMs,
    async ({ url, referencedBy }) => {
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

  const jobs: ProbeJob[] = [
    ...linkEntries.map(([url, referencedBy]): ProbeJob => ({ url, referencedBy })),
    ...imageEntries.map(([url, referencedBy]): ProbeJob => ({ url, referencedBy })),
  ];
  // `pacedEach` is sequential, so the results come back in job order: links
  // first, then images, exactly as they went in.
  const probed = await probeAll(jobs, deps);
  const probedLinks = probed.slice(0, linkEntries.length);
  const probedImages = probed.slice(linkEntries.length);

  const sized = probedImages.filter((i) => i.bytes !== null && i.status !== null && isOk(i.status));
  const totalBytes = sized.reduce((sum, i) => sum + (i.bytes ?? 0), 0);

  return {
    // Only a 404, a 410 or an unresolved redirect proves the URL is not there.
    // A transport failure, a 401/403/429 or a 5xx is evidence about our request
    // rather than their site, and is reported as unverified below instead.
    brokenLinks: probedLinks.filter((l) => classifyProbe(l.status) === "broken"),
    brokenImages: probedImages.filter((i) => classifyProbe(i.status) === "broken"),
    linksUnverified: summarizeUnverified(probedLinks),
    imagesUnverified: summarizeUnverified(probedImages),
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
