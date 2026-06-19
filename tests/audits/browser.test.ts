import { describe, it, expect } from "vitest";
import {
  summarizeBrowser,
  browserAudit,
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
    const blind: RouteResult = { url: "https://a.com/work/x", desktop: [], mobile: [], links: [] };
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
