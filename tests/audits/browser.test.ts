import { describe, it, expect, vi } from "vitest";
import {
  summarizeBrowser,
  browserAudit,
  defaultDiscoverDeps,
  reverifyRoutes,
  extractTitleMeta,
  type RouteResult,
  type LinkResult,
  type BrowserRunner,
  type VerifyDeps,
  type PageFetch,
} from "../../src/audits/browser.js";
import type { DiscoverDeps } from "../../src/audits/route-discovery.js";

const NOW = new Date("2026-06-18T00:00:00.000Z");

function route(
  url: string,
  desktopOk: boolean,
  mobileOk: boolean,
  links: string[] = [],
  over: { status?: number | null; title?: string | null; metaDescription?: string | null } = {},
): RouteResult {
  return {
    url,
    desktop: [
      { engine: "chromium", ok: desktopOk },
      { engine: "firefox", ok: desktopOk },
      { engine: "webkit", ok: desktopOk },
    ],
    mobile: [
      { device: "Pixel 7", ok: mobileOk },
      { device: "iPhone 14", ok: mobileOk },
    ],
    links,
    status: over.status !== undefined ? over.status : 200,
    title: over.title !== undefined ? over.title : `Title for ${url}`,
    metaDescription: over.metaDescription !== undefined ? over.metaDescription : `Meta for ${url}`,
  };
}

describe("summarizeBrowser", () => {
  it("all green when every route loads everywhere and no link is broken", () => {
    const s = summarizeBrowser(
      [route("https://a.com/", true, true, ["https://a.com/x"])],
      [{ url: "https://a.com/x", status: 200 }],
      { "/": 1 },
    );
    expect(s).toMatchObject({ desktopOk: true, mobileOk: true, linksOk: true, brokenLinks: 0 });
  });

  it("desktopOk false when ANY engine fails on ANY route", () => {
    const s = summarizeBrowser([route("https://a.com/", false, true)], [], { "/": 1 });
    expect(s.desktopOk).toBe(false);
    expect(s.mobileOk).toBe(true);
  });

  it("mobileOk false when a device fails (overflow/error)", () => {
    const s = summarizeBrowser([route("https://a.com/", true, false)], [], { "/": 1 });
    expect(s.mobileOk).toBe(false);
  });

  it("linksOk false + counts broken links (>=400 or null)", () => {
    const links: LinkResult[] = [
      { url: "https://a.com/ok", status: 200 },
      { url: "https://a.com/gone", status: 404 },
      { url: "https://a.com/dead", status: null },
    ];
    const s = summarizeBrowser([route("https://a.com/", true, true)], links, { "/": 1 });
    expect(s.linksOk).toBe(false);
    expect(s.brokenLinks).toBe(2);
  });

  it("fail-safe: empty observations are NOT ok (prove, don't assume)", () => {
    const s = summarizeBrowser([], [], {});
    expect(s).toMatchObject({ desktopOk: false, mobileOk: false, linksOk: false });
  });

  it("fail-safe: linksOk is FALSE when zero links were actually checked (no false 'all resolve')", () => {
    // A route loaded fine but link discovery yielded nothing (SPA / chromium evaluate threw).
    // brokenLinks is 0 but nothing was proven → must NOT pass.
    const s = summarizeBrowser([route("https://a.com/", true, true)], [], { "/": 1 });
    expect(s.brokenLinks).toBe(0);
    expect(s.linksOk).toBe(false);
  });

  it("fail-safe: a route that produced NO desktop/mobile observations is not excused", () => {
    const ok = route("https://a.com/", true, true);
    const blind: RouteResult = {
      url: "https://a.com/work/x",
      desktop: [],
      mobile: [],
      links: [],
      status: 200,
      title: "Work",
      metaDescription: "Work meta",
    };
    const s = summarizeBrowser([ok, blind], [{ url: "x", status: 200 }], { "/": 1, "/work": 1 });
    expect(s.desktopOk).toBe(false);
    expect(s.mobileOk).toBe(false);
  });

  it("note lists route count, families, engines/devices, link tally", () => {
    const s = summarizeBrowser([route("https://a.com/", true, true)], [{ url: "x", status: 200 }], {
      "/": 1,
      "/work": 3,
    });
    expect(s.note).toMatch(/1 routes/);
    expect(s.note).toMatch(/work ×3/);
    expect(s.note).toMatch(/chromium\/firefox\/webkit/);
  });
});

describe("summarizeBrowser → reachableOk + titleMetaOk", () => {
  it("reachableOk true when every sampled route is 2xx/3xx", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { status: 200 }),
        route("https://a.com/b", true, true, [], { status: 301 }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.reachableOk).toBe(true);
  });

  it("reachableOk false when any route is 4xx/5xx or unreachable (null status)", () => {
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { status: 404 })], [], { "/": 1 })
        .reachableOk,
    ).toBe(false);
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { status: null })], [], { "/": 1 })
        .reachableOk,
    ).toBe(false);
  });

  it("reachableOk false for empty observations (prove, don't assume)", () => {
    expect(summarizeBrowser([], [], {}).reachableOk).toBe(false);
  });

  it("titleMetaOk true when every route has a non-empty title ≤70 + meta, all titles unique", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { title: "Home", metaDescription: "Welcome home" }),
        route("https://a.com/b", true, true, [], { title: "About", metaDescription: "About us" }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.titleMetaOk).toBe(true);
  });

  it("titleMetaOk false when a title is empty, missing meta, or >70 chars", () => {
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { title: "" })], [], { "/": 1 })
        .titleMetaOk,
    ).toBe(false);
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { metaDescription: "" })], [], {
        "/": 1,
      }).titleMetaOk,
    ).toBe(false);
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { title: "x".repeat(71) })], [], {
        "/": 1,
      }).titleMetaOk,
    ).toBe(false);
  });

  it("titleMetaOk false on duplicate titles across the sample", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { title: "Same", metaDescription: "one" }),
        route("https://a.com/b", true, true, [], { title: "Same", metaDescription: "two" }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.titleMetaOk).toBe(false);
  });

  it("titleMetaOk false for empty observations (nothing proven)", () => {
    expect(summarizeBrowser([], [], {}).titleMetaOk).toBe(false);
  });

  // 2026-07-16 honesty fix: a bare pass/fail was unactionable — the operator could not see WHICH
  // url failed or why. Every fail now names its offenders in details + the evidence note.
  it("names the failing url + status in unreachableUrls and the note", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { status: 200 }),
        route("https://a.com/gone", true, true, [], { status: 404 }),
        route("https://a.com/dead", true, true, [], { status: null }),
      ],
      [],
      { "/": 3 },
    );
    expect(s.reachableOk).toBe(false);
    expect(s.unreachableUrls).toEqual([
      "https://a.com/gone → 404",
      "https://a.com/dead → no response",
    ]);
    expect(s.note).toContain("unreachable: https://a.com/gone → 404");
  });

  it("records per-url title/meta problems, incl. which routes share a duplicate title", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { title: "Same", metaDescription: "one" }),
        route("https://a.com/b", true, true, [], { title: "Same", metaDescription: null }),
        route("https://a.com/c", true, true, [], { title: "x".repeat(71), metaDescription: "c" }),
      ],
      [],
      { "/": 3 },
    );
    expect(s.titleMetaOk).toBe(false);
    expect(s.titleMetaProblems).toEqual([
      "https://a.com/b: missing meta description",
      "https://a.com/c: title 71 chars (max 70)",
      'duplicate title "Same": https://a.com/ + https://a.com/b',
    ]);
    expect(s.note).toContain("title/meta: https://a.com/b: missing meta description");
  });

  it("empty details arrays + unchanged note shape when both verdicts pass", () => {
    const s = summarizeBrowser(
      [route("https://a.com/", true, true, ["https://a.com/x"])],
      [{ url: "https://a.com/x", status: 200 }],
      { "/": 1 },
    );
    expect(s.unreachableUrls).toEqual([]);
    expect(s.titleMetaProblems).toEqual([]);
    expect(s.note).not.toContain("unreachable");
    expect(s.note).not.toContain("title/meta");
  });
});

describe("extractTitleMeta", () => {
  it("parses title + meta description regardless of attribute order, decoding entities", () => {
    const html = `<head><title> Dev &amp; Test | Site </title>
      <meta content="A &quot;great&quot; page" name="description"></head>`;
    expect(extractTitleMeta(html)).toEqual({
      title: "Dev & Test | Site",
      metaDescription: 'A "great" page',
    });
  });

  it("returns nulls when title/meta are absent or empty", () => {
    expect(extractTitleMeta("<html><title></title></html>")).toEqual({
      title: null,
      metaDescription: null,
    });
    expect(extractTitleMeta("plain text")).toEqual({ title: null, metaDescription: null });
  });
});

describe("reverifyRoutes — plain-fetch re-verification before any fail persists", () => {
  const fetchReturning =
    (byUrl: Record<string, PageFetch>) =>
    (calls: string[] = []): VerifyDeps => ({
      fetchPage: async (url) => {
        calls.push(url);
        return byUrl[url] ?? { status: null, title: null, metaDescription: null };
      },
    });

  // THE 2026-07-16 regression: Netlify's bot protection served 403 challenge interstitials
  // (title = the bare domain, no meta) to the headless probe on reddoorla.com/MSOT/Sonder while
  // every url answered 200 to a plain fetch — reachable + titles-meta failed fleet-wide.
  it("clears a WAF-challenge 403 when the plain fetch says 200, taking the served HTML's title/meta", async () => {
    const challenged: RouteResult = {
      url: "https://a.com/contact",
      desktop: [{ engine: "chromium", ok: false }],
      mobile: [{ device: "Pixel 7", ok: true }],
      links: [],
      status: 403,
      title: "a.com", // the challenge interstitial's title
      metaDescription: null,
    };
    const { routes, reverified } = await reverifyRoutes(
      [challenged],
      fetchReturning({
        "https://a.com/contact": {
          status: 200,
          title: "Contact | Site",
          metaDescription: "Get in touch",
        },
      })(),
    );
    expect(routes[0]).toMatchObject({
      status: 200,
      title: "Contact | Site",
      metaDescription: "Get in touch",
    });
    expect(reverified).toEqual([
      { url: "https://a.com/contact", browserStatus: 403, fetchedStatus: 200 },
    ]);
    // The cleared route now passes both verdicts.
    const s = summarizeBrowser(routes, [{ url: "x", status: 200 }], { "/": 1 });
    expect(s.reachableOk).toBe(true);
    expect(s.titleMetaOk).toBe(true);
  });

  it("keeps a CONFIRMED 404 (sitemap-advertised dead page is a real problem) and nulls the poisoned title/meta", async () => {
    const dead = route("https://a.com/essays", true, true, [], {
      status: 404,
      title: "Page not found",
      metaDescription: null,
    });
    const { routes } = await reverifyRoutes(
      [dead],
      fetchReturning({
        "https://a.com/essays": { status: 404, title: "Page not found", metaDescription: null },
      })(),
    );
    expect(routes[0]).toMatchObject({ status: 404, title: null, metaDescription: null });
    const s = summarizeBrowser(routes, [{ url: "x", status: 200 }], { "/": 1 });
    expect(s.reachableOk).toBe(false);
    expect(s.unreachableUrls).toEqual(["https://a.com/essays → 404"]);
  });

  it("keeps the fail when the plain fetch also times out across all cooldown retries", async () => {
    const dead = route("https://a.com/hung", true, true, [], { status: null, title: null });
    const slept: number[] = [];
    const { routes, reverified } = await reverifyRoutes(
      [dead],
      fetchReturning({})(),
      async (ms) => {
        slept.push(ms);
      },
    );
    expect(routes[0]!.status).toBeNull();
    expect(reverified).toEqual([
      { url: "https://a.com/hung", browserStatus: null, fetchedStatus: null },
    ]);
    // A transient-looking answer (timeout) earns every cooldown retry before the fail persists.
    expect(slept).toEqual([15_000, 45_000]);
  });

  // The probe burst itself can leave the runner's IP WAF-flagged for a few seconds, so even the
  // plain re-fetch can 403 at first (observed live 2026-07-16 on reddoorla.com). The re-check
  // must cool down and retry before believing a WAF-shaped status.
  it("retries a WAF-shaped 403 after a cooldown and clears it when the retry says 200", async () => {
    const challenged = route("https://a.com/x", true, true, [], { status: 403, title: "a.com" });
    const answers: PageFetch[] = [
      { status: 403, title: "a.com", metaDescription: null }, // still WAF-flagged
      { status: 200, title: "Real Title", metaDescription: "Real meta" }, // cooled down
    ];
    const slept: number[] = [];
    let calls = 0;
    const { routes, reverified } = await reverifyRoutes(
      [challenged],
      { fetchPage: async () => answers[Math.min(calls++, answers.length - 1)]! },
      async (ms) => {
        slept.push(ms);
      },
    );
    expect(slept).toEqual([15_000]); // second delay skipped once the retry cleared
    expect(calls).toBe(2);
    expect(routes[0]).toMatchObject({ status: 200, title: "Real Title" });
    expect(reverified).toEqual([
      { url: "https://a.com/x", browserStatus: 403, fetchedStatus: 200 },
    ]);
  });

  it("does NOT retry a definitive 404 — one plain fetch confirms it", async () => {
    const dead = route("https://a.com/gone", true, true, [], { status: 404, title: null });
    const slept: number[] = [];
    let calls = 0;
    const { routes } = await reverifyRoutes(
      [dead],
      {
        fetchPage: async () => {
          calls++;
          return { status: 404, title: null, metaDescription: null };
        },
      },
      async (ms) => {
        slept.push(ms);
      },
    );
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
    expect(routes[0]!.status).toBe(404);
  });

  it("fills ONLY the missing title/meta fields on an otherwise-ok route (capture flake)", async () => {
    const flaky = route("https://a.com/x", true, true, [], {
      status: 200,
      title: "Kept Browser Title",
      metaDescription: null,
    });
    const { routes, reverified } = await reverifyRoutes(
      [flaky],
      fetchReturning({
        "https://a.com/x": { status: 200, title: "HTML Title", metaDescription: "From HTML" },
      })(),
    );
    // Browser-captured title is NOT overwritten; the missing meta is recovered from the HTML.
    expect(routes[0]).toMatchObject({
      status: 200,
      title: "Kept Browser Title",
      metaDescription: "From HTML",
    });
    // Not a reachability re-check — nothing to report there.
    expect(reverified).toEqual([]);
  });

  it("a genuinely absent meta description stays absent (the fail is honest)", async () => {
    const noMeta = route("https://a.com/", true, true, [], { metaDescription: null });
    const { routes } = await reverifyRoutes(
      [noMeta],
      fetchReturning({
        "https://a.com/": { status: 200, title: "Home", metaDescription: null },
      })(),
    );
    expect(routes[0]!.metaDescription).toBeNull();
    expect(summarizeBrowser(routes, [{ url: "x", status: 200 }], { "/": 1 }).titleMetaOk).toBe(
      false,
    );
  });

  it("does not fetch healthy routes and never mutates its input", async () => {
    const healthy = route("https://a.com/", true, true);
    const challenged = route("https://a.com/b", true, true, [], { status: 403, title: "a.com" });
    const calls: string[] = [];
    const { routes } = await reverifyRoutes(
      [healthy, challenged],
      fetchReturning({
        "https://a.com/b": { status: 200, title: "B", metaDescription: "b" },
      })(calls),
    );
    expect(calls).toEqual(["https://a.com/b"]); // healthy route untouched
    expect(challenged.status).toBe(403); // input not mutated
    expect(routes[1]!.status).toBe(200);
  });
});

describe("browserAudit", () => {
  const site = { path: "/tmp/a", name: "a", deployedUrl: "https://a.com" };
  const discoverDeps: DiscoverDeps = {
    fetchText: async (url) =>
      url.endsWith("/sitemap.xml")
        ? `<urlset><url><loc>https://a.com/</loc></url><url><loc>https://a.com/work/x</loc></url></urlset>`
        : null,
  };

  function fakeRunner(routes: RouteResult[], links: LinkResult[]): BrowserRunner {
    return {
      probe: async () => routes,
      checkLinks: async () => links,
    };
  }

  it("skips a site with no deployed URL", async () => {
    const r = await browserAudit({ site: { path: "/tmp/a", name: "a" }, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
  });

  it("passes when all three verdicts are green", async () => {
    const r = await browserAudit({
      site,
      now: NOW,
      discoverDeps,
      browserRunner: fakeRunner(
        [route("https://a.com/", true, true, ["https://a.com/x"])],
        [{ url: "https://a.com/x", status: 200 }],
      ),
    });
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({ desktopOk: true, mobileOk: true, linksOk: true });
    expect(r.details).toMatchObject({ reachableOk: true, titleMetaOk: true });
    expect((r.details as { checkedAt: string }).checkedAt).toBe(NOW.toISOString());
  });

  it("warns when a verdict is not green", async () => {
    const r = await browserAudit({
      site,
      now: NOW,
      discoverDeps,
      browserRunner: fakeRunner([route("https://a.com/", true, false)], []),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ mobileOk: false });
  });

  // End-to-end shape of the 2026-07-16 fix: a browser-side challenge/flake is re-verified by a
  // plain fetch BEFORE the verdict persists, and the re-check is visible in note + details.
  it("re-verifies a challenged route before persisting: reachable + titleMeta pass, re-check surfaced", async () => {
    const challenged = route("https://a.com/work/x", true, true, [], {
      status: 403,
      title: "a.com",
      metaDescription: null,
    });
    const healthy = route("https://a.com/", true, true, ["https://a.com/x"]);
    const verifyDeps: VerifyDeps = {
      fetchPage: async () => ({
        status: 200,
        title: "Work X",
        metaDescription: "A project",
      }),
    };
    const r = await browserAudit({
      site,
      now: NOW,
      discoverDeps,
      verifyDeps,
      browserRunner: fakeRunner([healthy, challenged], [{ url: "https://a.com/x", status: 200 }]),
    });
    expect(r.details).toMatchObject({ reachableOk: true, titleMetaOk: true });
    expect(r.summary).toContain("1 route(s) re-verified reachable by plain fetch");
    expect((r.details as { reverifiedUrls: string[] }).reverifiedUrls).toEqual([
      "https://a.com/work/x: browser saw 403, plain fetch 200",
    ]);
  });

  it("persists a CONFIRMED fail (plain fetch agrees) and names the url in summary + details", async () => {
    const dead = route("https://a.com/work/x", true, true, [], { status: 404, title: null });
    const healthy = route("https://a.com/", true, true, ["https://a.com/x"]);
    const verifyDeps: VerifyDeps = {
      fetchPage: async () => ({ status: 404, title: null, metaDescription: null }),
    };
    const r = await browserAudit({
      site,
      now: NOW,
      discoverDeps,
      verifyDeps,
      browserRunner: fakeRunner([healthy, dead], [{ url: "https://a.com/x", status: 200 }]),
    });
    expect(r.details).toMatchObject({ reachableOk: false });
    expect((r.details as { unreachableUrls: string[] }).unreachableUrls).toEqual([
      "https://a.com/work/x → 404",
    ]);
    expect(r.summary).toContain("unreachable: https://a.com/work/x → 404");
    expect(r.summary).not.toContain("re-verified reachable");
  });
});

describe("defaultDiscoverDeps fetchText (bounded fetch)", () => {
  it("passes an AbortSignal timeout and degrades to null on abort/error", async () => {
    const stub = vi.fn(
      (_url: string, _init?: { signal?: AbortSignal }): Promise<Response> =>
        // Simulate the timeout firing (or any network error) — must be swallowed to null,
        // never thrown past the audit.
        Promise.reject(new Error("simulated timeout abort")),
    );
    vi.stubGlobal("fetch", stub);
    try {
      const out = await defaultDiscoverDeps().fetchText("https://hung.example/");
      expect(out).toBeNull();
      // The fetch was bounded — an AbortSignal (from AbortSignal.timeout) was supplied.
      expect(stub.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
