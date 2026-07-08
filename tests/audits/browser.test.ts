import { describe, it, expect, vi } from "vitest";
import {
  summarizeBrowser,
  browserAudit,
  defaultDiscoverDeps,
  type RouteResult,
  type LinkResult,
  type BrowserRunner,
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
