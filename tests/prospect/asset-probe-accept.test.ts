import { describe, expect, it } from "vitest";
import { defaultAssetProbe } from "../../src/prospect/pipeline.js";

/**
 * Measure what a browser actually downloads, not what a CDN falls back to.
 *
 * The asset probe sent no Accept header, so every content-negotiating image
 * host — imgix, Cloudinary, Cloudflare Images, and Prismic, which is most of
 * our own fleet — handed us the original JPEG and we published its size as the
 * site's image weight. Measured on reddoorla.com: we reported 1,760 KB for a
 * hero that a real desktop browser receives as a 543 KB AVIF. Three times over,
 * in the one direction that flatters our own findings.
 *
 * That is our instrument reported as their defect, which is the one thing this
 * report must never do.
 */

type Probe = Parameters<typeof defaultAssetProbe>[1];

function recorder(status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
    });
    return new Response(null, { status, headers: { "content-length": "123" } });
  }) as unknown as Probe;
  return { calls, fetchImpl };
}

describe("defaultAssetProbe", () => {
  it("asks for the formats a browser asks for", async () => {
    const { calls, fetchImpl } = recorder();
    await defaultAssetProbe("https://example.com/hero.jpg", fetchImpl);
    const accept = calls[0]!.headers["accept"];
    expect(accept, "an Accept header is sent at all").toBeTruthy();
    expect(accept).toContain("image/avif");
    expect(accept).toContain("image/webp");
    // The wildcard matters as much as the modern formats: without it a host
    // that serves something we did not list could answer 406, and an image we
    // failed to ask for correctly would be reported as a broken one.
    expect(accept).toContain("*/*");
  });

  it("sends the same Accept on the GET fallback when HEAD is refused", async () => {
    // A host that rejects HEAD would otherwise be measured through an
    // unnegotiated GET — the same bug, reachable by a different route.
    const { calls, fetchImpl } = recorder(405);
    await defaultAssetProbe("https://example.com/hero.jpg", fetchImpl);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers["accept"]).toContain("image/avif");
  });
});
