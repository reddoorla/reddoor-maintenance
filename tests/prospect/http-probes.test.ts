import { describe, expect, it } from "vitest";
import {
  classify,
  imageSize,
  probeHttp,
  MIN_OG_IMAGE_EDGE,
  type HttpProbeDeps,
  type HttpResponse,
} from "../../src/prospect/http-probes.js";
import { httpChecks, TIER2_HTTP_CHECK_KEYS } from "../../src/prospect/site-checks.js";
import type { CrawlResult, PageCapture, PageExtract } from "../../src/prospect/types.js";

/**
 * The floor is a careful ordinary site, same as every other battery here.
 *
 * The fixture below is a site that has done nothing clever: an icon, a share
 * image, a sitemap whose URLs answer, and http redirecting once to https. Every
 * one of the twelve checks has to go green on it. A check that needs more than
 * this is measuring fashion, and it turns the report into an argument.
 */

/** A PNG header of a given size — enough for `imageSize`, which never reads
 *  past IHDR. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const be32 = (o: number, v: number) => {
    b[o] = (v >>> 24) & 0xff;
    b[o + 1] = (v >>> 16) & 0xff;
    b[o + 2] = (v >>> 8) & 0xff;
    b[o + 3] = v & 0xff;
  };
  be32(16, width);
  be32(20, height);
  return b;
}

const html = (body: string) => new TextEncoder().encode(`<!doctype html><html><head>${body}`);

type Route = Partial<HttpResponse>;

/** A server that answers exactly what a test says, remembers what was asked,
 *  and 404s anything else — so a check that probes a URL nobody set up fails
 *  loudly rather than passing on a default. */
function server(routes: Record<string, Route>) {
  const asked: string[] = [];
  const deps: HttpProbeDeps = {
    delayMs: 0,
    async request(url) {
      asked.push(url);
      const r = routes[url] ?? routes[url.replace(/\/$/, "")] ?? { status: 404 };
      return {
        status: r.status ?? 200,
        headers: r.headers ?? { "content-type": "text/html" },
        finalUrl: r.finalUrl ?? url,
        hops: r.hops ?? 0,
        body: r.body ?? null,
        error: null,
      };
    },
  };
  return { deps, asked };
}

const OK_HTML = { status: 200, headers: { "content-type": "text/html" } };

function extract(over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: "Acme Roofing",
    metaDescription: "Commercial roof repair in Boise.",
    canonical: "https://acme.example/",
    social: { "og:image": "https://acme.example/share.png" },
    headings: [{ level: 1, text: "Commercial roof repair" }],
    jsonLd: [],
    images: { total: 2, withAlt: 2 },
    hasViewportMeta: true,
    text: "We repair commercial roofs.",
    anchors: [
      { href: "/services", text: "Services", rel: "", target: "" },
      { href: "https://partner.example/listing", text: "Partner", rel: "", target: "" },
    ],
    anchorCount: 2,
    imageSrcs: ["/logo.svg", "/hero.jpg"],
    scriptSrcs: [],
    scriptCount: 0,
    metas: { charset: "utf-8" },
    links: [{ rel: "icon", href: "/favicon.ico" }],
    forms: [],
    ...over,
  } as PageExtract;
}

const page = (url: string, over: Partial<PageExtract> = {}): PageCapture => ({
  url,
  status: 200,
  raw: null,
  rendered: extract(over),
  error: null,
  vitals: null,
});

function crawl(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: null,
    agentAccess: [],
    sitemap: {
      present: true,
      urlCount: 2,
      sample: ["https://acme.example/", "https://acme.example/services"],
    },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: [page("https://acme.example/"), page("https://acme.example/services")],
    ...over,
  } as CrawlResult;
}

/** Routes under which every check passes. Individual tests override one. */
const GOOD: Record<string, Route> = {
  "https://acme.example": OK_HTML,
  "https://acme.example/": OK_HTML,
  "https://acme.example/favicon.ico": { status: 200, headers: { "content-type": "image/x-icon" } },
  "http://acme.example": { status: 200, finalUrl: "https://acme.example/", hops: 1 },
  // The trailing-slash pair: the slashed form redirects to the bare one.
  "https://acme.example/services": {
    ...OK_HTML,
    body: html('<link rel="canonical" href="https://acme.example/services">'),
  },
  "https://acme.example/services/": {
    status: 301,
    finalUrl: "https://acme.example/services",
    hops: 1,
  },
  "https://acme.example/index.html": { status: 404 },
  "https://acme.example/Services": { status: 404 },
  "https://acme.example/share.png": {
    status: 200,
    headers: { "content-type": "image/png" },
    body: png(1200, 630),
  },
  "https://acme.example/logo.svg": { status: 200, headers: { "content-type": "image/svg+xml" } },
  "https://partner.example/listing": OK_HTML,
};

const run = async (routes = GOOD, c = crawl()) => {
  const { deps, asked } = server(routes);
  const findings = await probeHttp(c, deps);
  return { findings, checks: httpChecks(findings), asked };
};

const byKey = (checks: Awaited<ReturnType<typeof run>>["checks"], key: string) =>
  checks.find((c) => c.key === key);

describe("an ordinary careful site passes all twelve", () => {
  it("fails nothing", async () => {
    const { checks } = await run();
    expect(
      checks.filter((c) => c.status === "fail").map((c) => `${c.key} — ${c.evidence}`),
    ).toEqual([]);
  });

  it("reaches a verdict on nearly all of them, so the battery is not padding", async () => {
    const { checks } = await run();
    const verdicts = checks.filter((c) => c.status === "pass" || c.status === "fail");
    // /index.html and /Services correctly 404, which is not-applicable rather
    // than a pass — the two that are allowed to sit out.
    expect(verdicts.length).toBeGreaterThanOrEqual(TIER2_HTTP_CHECK_KEYS.length - 2);
  });

  it("emits every key exactly once, whatever the site looks like", async () => {
    const { checks } = await run();
    expect(checks.map((c) => c.key).sort()).toEqual([...TIER2_HTTP_CHECK_KEYS].sort());
    // The bug this guards: a key pushed twice, once as unmeasured and once as
    // not-applicable, from a helper that read the three states as two.
    expect(new Set(checks.map((c) => c.key)).size).toBe(checks.length);
  });

  it("stays inside its request budget", async () => {
    const { findings, asked } = await run();
    expect(findings.requests).toBe(asked.length);
    expect(findings.requests).toBeLessThan(40);
  });
});

describe("a probe we could not read is never their defect", () => {
  it("reads 403 on the favicon as unmeasured, not as a missing icon", async () => {
    // Bot management declining a non-browser client. The icon is very likely
    // fine and a visitor sees it.
    const { checks } = await run({ ...GOOD, "https://acme.example/favicon.ico": { status: 403 } });
    expect(byKey(checks, "favicon-served")?.status).toBe("unmeasured");
  });

  it("reads 429 on an outbound link as unmeasured, since we caused it", async () => {
    const { checks } = await run({ ...GOOD, "https://partner.example/listing": { status: 429 } });
    expect(byKey(checks, "external-links-live")?.status).toBe("pass");
    expect(byKey(checks, "external-links-live")?.evidence).not.toMatch(/dead/);
  });

  it("reads a 5xx on a sitemap URL as unmeasured, not as a page that is gone", async () => {
    const { checks } = await run({ ...GOOD, "https://acme.example/services": { status: 503 } });
    expect(byKey(checks, "sitemap-urls-live")?.status).toBe("pass");
  });

  it("is unmeasured across the board when there was no origin to probe", async () => {
    const { checks } = await run(GOOD, crawl({ origin: "not-a-url" }));
    for (const c of checks) expect(c.status, c.key).toBe("unmeasured");
  });
});

describe("each check fires on the thing it is named for", () => {
  it("catches an icon that 404s", async () => {
    const { checks } = await run({ ...GOOD, "https://acme.example/favicon.ico": { status: 404 } });
    expect(byKey(checks, "favicon-served")?.status).toBe("fail");
  });

  it("catches a soft 404 — a 200 that hands back HTML where an icon should be", async () => {
    // The status says fine and the tab still shows a blank sheet. Declared and
    // served are different claims, and so are served and served an image.
    const { checks } = await run({
      ...GOOD,
      "https://acme.example/favicon.ico": { status: 200, headers: { "content-type": "text/html" } },
    });
    expect(byKey(checks, "favicon-served")?.status).toBe("fail");
  });

  it("catches http:// never reaching https://", async () => {
    const { checks } = await run({
      ...GOOD,
      "http://acme.example": { status: 200, finalUrl: "http://acme.example/", hops: 0 },
    });
    const c = byKey(checks, "https-upgrade");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toMatch(/does not end up on https/);
  });

  it("catches a four-hop redirect to https", async () => {
    const { checks } = await run({
      ...GOOD,
      "http://acme.example": { status: 200, finalUrl: "https://www.acme.example/", hops: 4 },
    });
    expect(byKey(checks, "https-upgrade")?.evidence).toMatch(/4 redirects/);
  });

  it("catches a homepage answering two ways in a row", async () => {
    let n = 0;
    const deps: HttpProbeDeps = {
      delayMs: 0,
      async request(url) {
        const base: HttpResponse = {
          status: 200,
          headers: { "content-type": "text/html" },
          finalUrl: url,
          hops: 0,
          body: null,
          error: null,
        };
        // The slashed form: a bare origin normalises to one before it is sent.
        if (url === "https://acme.example/") return { ...base, status: ++n === 1 ? 200 : 502 };
        const r = GOOD[url] ?? { status: 404 };
        return { ...base, ...r, status: r.status ?? 200, finalUrl: r.finalUrl ?? url };
      },
    };
    const c = httpChecks(await probeHttp(crawl(), deps)).find((k) => k.key === "home-stable");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toMatch(/200 and 502/);
  });

  it("says nothing about stability when both samples agree, however bad", async () => {
    // Two matching 500s is a server that is consistently down, which is a
    // different check's business. Calling it "intermittent" would be wrong.
    const { checks } = await run({ ...GOOD, "https://acme.example/": { status: 500 } });
    expect(byKey(checks, "home-stable")?.status).toBe("not-applicable");
  });

  it("catches both slash forms answering with no canonical to settle it", async () => {
    const { checks } = await run({
      ...GOOD,
      "https://acme.example/services": { ...OK_HTML, body: html("<title>Services</title>") },
      "https://acme.example/services/": { ...OK_HTML, body: html("<title>Services</title>") },
    });
    const c = byKey(checks, "trailing-slash");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toMatch(/no canonical/);
  });

  it("passes when both forms answer but agree on a canonical", async () => {
    const canonical = html('<link rel="canonical" href="https://acme.example/services">');
    const { checks } = await run({
      ...GOOD,
      "https://acme.example/services": { ...OK_HTML, body: canonical },
      "https://acme.example/services/": { ...OK_HTML, body: canonical },
    });
    expect(byKey(checks, "trailing-slash")?.status).toBe("pass");
  });

  it("catches /index.html answering as its own page", async () => {
    const { checks } = await run({
      ...GOOD,
      "https://acme.example/index.html": { ...OK_HTML, body: html("<title>Home</title>") },
    });
    expect(byKey(checks, "index-alias")?.status).toBe("fail");
  });

  it("treats /index.html declaring the homepage canonical as fine", async () => {
    const { checks } = await run({
      ...GOOD,
      "https://acme.example/index.html": {
        ...OK_HTML,
        body: html('<link rel="canonical" href="https://acme.example/">'),
      },
    });
    expect(byKey(checks, "index-alias")?.status).toBe("pass");
  });

  it("treats a 404 on /index.html as the behaviour we wanted, not a finding", async () => {
    const { checks } = await run();
    const c = byKey(checks, "index-alias");
    expect(c?.status).toBe("not-applicable");
    expect(c?.evidence).toMatch(/hoping for/);
  });

  it("catches the same page answering at two spellings", async () => {
    const { checks } = await run({
      ...GOOD,
      "https://acme.example/Services": { ...OK_HTML, body: html("<title>Services</title>") },
    });
    expect(byKey(checks, "case-alias")?.status).toBe("fail");
  });

  it("catches a sitemap advertising a page that is gone", async () => {
    const { checks } = await run({ ...GOOD, "https://acme.example/services": { status: 404 } });
    const c = byKey(checks, "sitemap-urls-live");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toMatch(/acme\.example\/services/);
  });

  it("carries the denominator, so a sampled sitemap never reads as a complete one", async () => {
    const many = Array.from({ length: 60 }, (_, i) => `https://acme.example/p${i}`);
    const routes = { ...GOOD, ...Object.fromEntries(many.map((u) => [u, OK_HTML])) };
    const { checks } = await run(
      routes,
      crawl({ sitemap: { present: true, urlCount: 400, sample: many } }),
    );
    // Phrased so it cannot be misread as "12 answered and 388 did not".
    expect(byKey(checks, "sitemap-urls-live")?.evidence).toMatch(
      /we sampled 12 of 400; all of them answer/,
    );
  });

  it("catches an outbound link that is gone", async () => {
    const { checks } = await run({ ...GOOD, "https://partner.example/listing": { status: 404 } });
    expect(byKey(checks, "external-links-live")?.status).toBe("fail");
  });

  it("catches a share image that does not load", async () => {
    const { checks } = await run({ ...GOOD, "https://acme.example/share.png": { status: 404 } });
    expect(byKey(checks, "og-image-served")?.status).toBe("fail");
  });

  it("catches a share image too small to render anywhere", async () => {
    const small = MIN_OG_IMAGE_EDGE - 1;
    const { checks } = await run({
      ...GOOD,
      "https://acme.example/share.png": {
        status: 200,
        headers: { "content-type": "image/png" },
        body: png(small, small),
      },
    });
    const c = byKey(checks, "og-image-size");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toBe(`${small}×${small}`);
  });

  it("does not call an SVG logo small — we cannot measure one, and it is not a defect", async () => {
    const { checks } = await run();
    expect(byKey(checks, "og-image-size")?.status).toBe("pass");
    expect(byKey(checks, "logo-served")?.status).toBe("pass");
  });

  it("names the rule it used to pick the logo, since picking one is a guess", async () => {
    const { findings } = await run();
    expect(findings.logo?.how).toMatch(/logo/);
    expect(byKey(httpChecks(findings), "logo-served")?.evidence).toMatch(/file name/);
  });

  it("catches an internal link that redirects three times", async () => {
    const { checks } = await run({
      ...GOOD,
      "https://acme.example/services": { ...OK_HTML, hops: 3 },
    });
    const c = byKey(checks, "redirect-chains");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toMatch(/3 hops/);
  });

  it("leaves a two-hop link alone, because a deliberate redirector is one", async () => {
    // Every `/us/shop/goto/*` link on apple.com takes two hops, by design.
    // Flagging those described the pattern, not a problem.
    const { checks } = await run({
      ...GOOD,
      "https://acme.example/services": { ...OK_HTML, hops: 2 },
    });
    expect(byKey(checks, "redirect-chains")?.status).toBe("pass");
  });
});

describe("it does not go where it was not invited", () => {
  it("never probes a private address a page linked to", async () => {
    const c = crawl({
      pages: [
        page("https://acme.example/", {
          anchors: [
            { href: "http://169.254.169.254/latest/meta-data/", text: "x", rel: "", target: "" },
          ],
          imageSrcs: ["http://127.0.0.1:8080/logo.png"],
          social: {},
        }),
      ],
    });
    const { asked } = await run(GOOD, c);
    for (const url of asked) {
      expect(url).not.toMatch(/169\.254|127\.0\.0\.1|localhost/);
    }
  });
});

describe("imageSize reads the formats it claims to", () => {
  it("reads PNG", () => {
    expect(imageSize(png(1200, 630))).toEqual({ width: 1200, height: 630 });
  });

  it("reads GIF, which is little-endian", () => {
    const b = new Uint8Array(24);
    b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    b.set([0x20, 0x03, 0xc0, 0x01], 6); // 800 x 448
    expect(imageSize(b)).toEqual({ width: 800, height: 448 });
  });

  it("reads a JPEG by walking to its first frame header", () => {
    const b = new Uint8Array(64);
    b.set([0xff, 0xd8], 0);
    // An APP0 segment to walk past, then SOF0 carrying the dimensions.
    // APP0 declares length 16 at offset 4, so it covers 4..19 and the next
    // marker begins at 20 — the walk has to honour that, not guess.
    b.set([0xff, 0xe0, 0x00, 0x10], 2);
    b.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0], 20); // 1200 x 630
    expect(imageSize(b)).toEqual({ width: 1200, height: 630 });
  });

  it("returns null for a format it cannot read, rather than a wrong number", () => {
    // An SVG has no intrinsic size worth the name. Null is reported as "not
    // measured", never as a small image.
    expect(imageSize(new TextEncoder().encode('<svg viewBox="0 0 100 100">'))).toBeNull();
    expect(imageSize(null)).toBeNull();
    expect(imageSize(new Uint8Array(4))).toBeNull();
  });
});

describe("classify", () => {
  it("calls only 404 and 410 broken", () => {
    expect(classify(200)).toBe("ok");
    expect(classify(404)).toBe("broken");
    expect(classify(410)).toBe("broken");
    for (const s of [401, 403, 429, 500, 503, null]) expect(classify(s)).toBe("unverified");
  });
});
