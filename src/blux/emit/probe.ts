/** Reconstruct-and-probe fallback for assets the rendered HTML never showed:
 *  the Blux CDN serves originals at <host>/<siteId>/<uuid>.<ext>. Proven on
 *  thePointe 2026-07-06: the scrape found 4/320 library assets while the probe
 *  resolved the remaining 52/52 used ones. Network-touching by design — wired
 *  to `blux emit --probe`, never into the pure builders. */

const HOSTS = ["d3syaxnfm3oj0e.cloudfront.net", "dv4tl7yyk1zlp.cloudfront.net"];
const COMMON_EXTS = ["jpg", "png", "jpeg", "webp", "gif", "svg", "mp4", "pdf"];

export type ProbeTarget = { id: string; name: string; mime: string };

function extCandidates(t: ProbeTarget): string[] {
  const c: string[] = [];
  const nameExt = t.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (nameExt) c.push(nameExt);
  const mimeExt = t.mime.split("/")[1]?.replace("jpeg", "jpg");
  if (mimeExt && !c.includes(mimeExt)) c.push(mimeExt);
  for (const e of COMMON_EXTS) if (!c.includes(e)) c.push(e);
  return c;
}

async function probeOne(
  t: ProbeTarget,
  siteId: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  for (const ext of extCandidates(t)) {
    for (const host of HOSTS) {
      const url = `https://${host}/${siteId}/${t.id}.${ext}`;
      try {
        if ((await fetchImpl(url, { method: "HEAD" })).ok) return url;
      } catch {
        // network hiccup on one candidate — try the next
      }
    }
  }
  return null;
}

export async function probeAssetUrls(
  targets: ProbeTarget[],
  siteId: string,
  fetchImpl: typeof fetch = fetch,
  concurrency = 8,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (i < targets.length) {
        const t = targets[i++]!;
        results.set(t.id, await probeOne(t, siteId, fetchImpl));
      }
    }),
  );
  return results;
}
