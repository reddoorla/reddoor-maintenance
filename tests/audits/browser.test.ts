import { describe, it, expect, vi } from "vitest";
import {
  summarizeBrowser,
  browserAudit,
  defaultDiscoverDeps,
  reverifyRoutes,
  reverifyLinks,
  excuseChallengedEngineChecks,
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
  over: {
    status?: number | null;
    title?: string | null;
    metaDescription?: string | null;
    /** When provided, stamped onto EVERY desktop/mobile entry (per-engine nav status). */
    entryStatus?: number | null;
    /** Unsubstituted SvelteKit placeholders the served HTML leaked (empty/omitted = clean). */
    leakedTemplateTokens?: string[];
  } = {},
): RouteResult {
  const entry = over.entryStatus !== undefined ? { status: over.entryStatus } : {};
  return {
    url,
    desktop: [
      { engine: "chromium", ok: desktopOk, ...entry },
      { engine: "firefox", ok: desktopOk, ...entry },
      { engine: "webkit", ok: desktopOk, ...entry },
    ],
    mobile: [
      { device: "Pixel 7", ok: mobileOk, ...entry },
      { device: "iPhone 14", ok: mobileOk, ...entry },
    ],
    links,
    status: over.status !== undefined ? over.status : 200,
    title: over.title !== undefined ? over.title : `Title for ${url}`,
    metaDescription: over.metaDescription !== undefined ? over.metaDescription : `Meta for ${url}`,
    ...(over.leakedTemplateTokens !== undefined
      ? { leakedTemplateTokens: over.leakedTemplateTokens }
      : {}),
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

describe("summarizeBrowser → templateOk (unsubstituted SvelteKit tokens)", () => {
  it("templateOk true when no route leaked a placeholder (incl. the field being absent)", () => {
    const s = summarizeBrowser([route("https://a.com/", true, true, ["https://a.com/x"])], [], {
      "/": 1,
    });
    expect(s.templateOk).toBe(true);
    expect(s.templateProblems).toEqual([]);
  });

  it("templateOk false + names the leaked token per url when a route served an unsubstituted placeholder", () => {
    const s = summarizeBrowser(
      [route("https://a.com/", true, true, [], { leakedTemplateTokens: ["%sveltekit.body%"] })],
      [{ url: "x", status: 200 }],
      { "/": 1 },
    );
    expect(s.templateOk).toBe(false);
    expect(s.templateProblems).toContain("https://a.com/: unsubstituted %sveltekit.body%");
  });

  it("surfaces the leaked token in the note", () => {
    const s = summarizeBrowser(
      [route("https://a.com/", true, true, [], { leakedTemplateTokens: ["%sveltekit.head%"] })],
      [{ url: "x", status: 200 }],
      { "/": 1 },
    );
    expect(s.note).toContain("%sveltekit.head%");
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

// 2026-07-16 honesty pass, part 2: desktop/mobile/links fails now name their offenders too
// (mirroring unreachableUrls) so all three verdicts are actionable without a JSON dig.
describe("summarizeBrowser — offender naming for desktop/mobile/links", () => {
  it("names the failing engine, with a status suffix only for a definite bad nav status", () => {
    const r = route("https://a.com/", true, true);
    r.desktop[1] = { engine: "firefox", ok: false, status: 200 }; // JS error on a loaded page
    r.desktop[2] = { engine: "webkit", ok: false, status: 403 }; // challenge-shaped nav
    const s = summarizeBrowser([r], [{ url: "x", status: 200 }], { "/": 1 });
    expect(s.desktopFailures).toEqual([
      "https://a.com/ [firefox]",
      "https://a.com/ [webkit] → 403",
    ]);
    expect(s.note).toContain("desktop failing: https://a.com/ [firefox]");
  });

  it("names the failing mobile device symmetrically", () => {
    const r = route("https://a.com/", true, true);
    r.mobile[0] = { device: "Pixel 7", ok: false }; // legacy shape: no status captured
    const s = summarizeBrowser([r], [{ url: "x", status: 200 }], { "/": 1 });
    expect(s.mobileFailures).toEqual(["https://a.com/ [Pixel 7]"]);
    expect(s.note).toContain("mobile failing: https://a.com/ [Pixel 7]");
  });

  it("names each broken link with its status (null → 'no response')", () => {
    const links: LinkResult[] = [
      { url: "https://a.com/ok", status: 200 },
      { url: "https://a.com/gone", status: 404 },
      { url: "https://a.com/dead", status: null },
    ];
    const s = summarizeBrowser([route("https://a.com/", true, true)], links, { "/": 1 });
    expect(s.brokenLinkUrls).toEqual([
      "https://a.com/gone → 404",
      "https://a.com/dead → no response",
    ]);
    expect(s.brokenLinks).toBe(2);
    expect(s.note).toContain("broken: https://a.com/gone → 404");
  });

  it("all-green run → empty offender arrays and none of the note segments", () => {
    const s = summarizeBrowser(
      [route("https://a.com/", true, true, ["https://a.com/x"])],
      [{ url: "https://a.com/x", status: 200 }],
      { "/": 1 },
    );
    expect(s.desktopFailures).toEqual([]);
    expect(s.mobileFailures).toEqual([]);
    expect(s.brokenLinkUrls).toEqual([]);
    expect(s.note).not.toContain("desktop failing");
    expect(s.note).not.toContain("mobile failing");
    expect(s.note).not.toContain("broken:");
  });

  it("a route with no desktop observations is named as such", () => {
    const blind: RouteResult = {
      url: "https://a.com/blind",
      desktop: [],
      mobile: [{ device: "Pixel 7", ok: true }],
      links: [],
      status: 200,
      title: "Blind",
      metaDescription: "Blind meta",
    };
    const s = summarizeBrowser([blind], [{ url: "x", status: 200 }], { "/": 1 });
    expect(s.desktopFailures).toEqual(["https://a.com/blind: no desktop observations"]);
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

describe("excuseChallengedEngineChecks — challenge-poisoned engine checks are voided against verified reachability", () => {
  // THE headline 2026-07-16 case: the WAF challenged several engines mid-burst while the route
  // itself re-verified reachable — #428 cleared reachableOk but desktop/mobile still false-alarmed.
  it("voids engine/device fails whose nav got a challenge-shaped status on a reachable route", () => {
    const challenged: RouteResult = {
      url: "https://a.com/x",
      desktop: [
        { engine: "chromium", ok: true, status: 200 },
        { engine: "firefox", ok: false, status: 403 },
        { engine: "webkit", ok: false, status: 403 },
      ],
      mobile: [
        { device: "Pixel 7", ok: false, status: 403 },
        { device: "iPhone 14", ok: true, status: 200 },
      ],
      links: [],
      status: 200, // reverifyRoutes' plain-fetch-verified truth
      title: "X",
      metaDescription: "About X",
    };
    const { routes, excused } = excuseChallengedEngineChecks([challenged]);
    expect(excused).toEqual([
      "https://a.com/x [firefox]: browser saw 403, route re-verified reachable (200)",
      "https://a.com/x [webkit]: browser saw 403, route re-verified reachable (200)",
      "https://a.com/x [Pixel 7]: browser saw 403, route re-verified reachable (200)",
    ]);
    const s = summarizeBrowser(routes, [{ url: "x", status: 200 }], { "/": 1 });
    expect(s.desktopOk).toBe(true);
    expect(s.mobileOk).toBe(true);
  });

  it("keeps a genuine rendering fail on a LOADED page (2xx entry status = JS error/missing main)", () => {
    const r = route("https://a.com/", true, true);
    r.desktop[1] = { engine: "firefox", ok: false, status: 200 };
    const { routes, excused } = excuseChallengedEngineChecks([r]);
    expect(excused).toEqual([]);
    expect(summarizeBrowser(routes, [{ url: "x", status: 200 }], { "/": 1 }).desktopOk).toBe(false);
  });

  it("keeps a mobile overflow fail on a loaded page (2xx entry status)", () => {
    const r = route("https://a.com/", true, true);
    r.mobile[0] = { device: "Pixel 7", ok: false, status: 200 };
    const { routes, excused } = excuseChallengedEngineChecks([r]);
    expect(excused).toEqual([]);
    expect(summarizeBrowser(routes, [{ url: "x", status: 200 }], { "/": 1 }).mobileOk).toBe(false);
  });

  it("excuses nothing on a confirmed-dead route — everything fails honestly", () => {
    const dead = route("https://a.com/gone", false, false, [], {
      status: 404,
      entryStatus: 404,
      title: null,
      metaDescription: null,
    });
    const { routes, excused } = excuseChallengedEngineChecks([dead]);
    expect(excused).toEqual([]);
    const s = summarizeBrowser(routes, [{ url: "x", status: 200 }], { "/": 1 });
    expect(s.desktopOk).toBe(false);
    expect(s.reachableOk).toBe(false);
  });

  it("keeps a definitive engine 404 on an otherwise-reachable route (not challenge-shaped)", () => {
    const r = route("https://a.com/", true, true);
    r.desktop[2] = { engine: "webkit", ok: false, status: 404 };
    const { excused } = excuseChallengedEngineChecks([r]);
    expect(excused).toEqual([]);
  });

  it("never excuses a null (nav timeout) or undefined (never captured) entry status", () => {
    const r = route("https://a.com/", true, true);
    r.desktop[1] = { engine: "firefox", ok: false, status: null };
    r.desktop[2] = { engine: "webkit", ok: false }; // legacy shape: status never captured
    const { routes, excused } = excuseChallengedEngineChecks([r]);
    expect(excused).toEqual([]);
    expect(routes[0]!.desktop[1]!.ok).toBe(false);
    expect(routes[0]!.desktop[2]!.ok).toBe(false);
  });

  it("never mutates its input", () => {
    const r = route("https://a.com/", true, true);
    r.desktop[1] = { engine: "firefox", ok: false, status: 403 };
    const { routes } = excuseChallengedEngineChecks([r]);
    expect(routes[0]!.desktop[1]!.ok).toBe(true); // output excused
    expect(r.desktop[1]!.ok).toBe(false); // input untouched
  });
});

describe("reverifyLinks — cooldown re-check before a link counts broken", () => {
  const trackingVerify = (answer: (url: string, call: number) => PageFetch) => {
    const calls: string[] = [];
    const verify: VerifyDeps = {
      fetchPage: async (url) => {
        calls.push(url);
        return answer(url, calls.length);
      },
    };
    return { calls, verify };
  };
  const pageOk: PageFetch = { status: 200, title: null, metaDescription: null };
  const noSleep = (slept: number[]) => async (ms: number) => {
    slept.push(ms);
  };

  it("clears a challenge-shaped 403 when the plain re-fetch says 200 (zero sleeps)", async () => {
    const { calls, verify } = trackingVerify(() => pageOk);
    const slept: number[] = [];
    const { links, reverified } = await reverifyLinks(
      [{ url: "https://a.com/x", status: 403 }],
      verify,
      noSleep(slept),
    );
    expect(links).toEqual([{ url: "https://a.com/x", status: 200 }]);
    expect(reverified).toEqual([{ url: "https://a.com/x", firstStatus: 403, fetchedStatus: 200 }]);
    expect(calls).toEqual(["https://a.com/x"]);
    expect(slept).toEqual([]);
    const s = summarizeBrowser([route("https://a.com/", true, true)], links, { "/": 1 });
    expect(s.linksOk).toBe(true);
  });

  it("cools down and retries a 403 that persists on the first re-fetch", async () => {
    const answers: PageFetch[] = [
      { status: 403, title: null, metaDescription: null }, // still WAF-flagged
      pageOk, // cooled down
    ];
    const { calls, verify } = trackingVerify((_url, call) => answers[call - 1]!);
    const slept: number[] = [];
    const { links } = await reverifyLinks(
      [{ url: "https://a.com/x", status: 403 }],
      verify,
      noSleep(slept),
    );
    expect(slept).toEqual([15_000]);
    expect(calls).toHaveLength(2);
    expect(links[0]!.status).toBe(200);
  });

  it("confirms a 403 that survives every cooldown — counts broken, still recorded", async () => {
    const { verify } = trackingVerify(() => ({ status: 403, title: null, metaDescription: null }));
    const slept: number[] = [];
    const { links, reverified } = await reverifyLinks(
      [{ url: "https://a.com/x", status: 403 }],
      verify,
      noSleep(slept),
    );
    expect(slept).toEqual([15_000, 45_000]);
    expect(links[0]!.status).toBe(403);
    expect(reverified).toEqual([{ url: "https://a.com/x", firstStatus: 403, fetchedStatus: 403 }]);
    const s = summarizeBrowser([route("https://a.com/", true, true)], links, { "/": 1 });
    expect(s.linksOk).toBe(false);
    expect(s.brokenLinks).toBe(1);
  });

  it("never re-verifies a definitive 404 — one observation stands, zero fetches", async () => {
    const { calls, verify } = trackingVerify(() => pageOk);
    const slept: number[] = [];
    const { links, reverified } = await reverifyLinks(
      [{ url: "https://a.com/gone", status: 404 }],
      verify,
      noSleep(slept),
    );
    expect(calls).toEqual([]);
    expect(slept).toEqual([]);
    expect(links).toEqual([{ url: "https://a.com/gone", status: 404 }]);
    expect(reverified).toEqual([]);
  });

  it("a null (timeout) is retryable and clears when the re-fetch answers 200", async () => {
    const { calls, verify } = trackingVerify(() => pageOk);
    const { links, reverified } = await reverifyLinks(
      [{ url: "https://a.com/slow", status: null }],
      verify,
      noSleep([]),
    );
    expect(calls).toEqual(["https://a.com/slow"]);
    expect(links[0]!.status).toBe(200);
    expect(reverified).toEqual([
      { url: "https://a.com/slow", firstStatus: null, fetchedStatus: 200 },
    ]);
  });

  it("touches nothing when no link is suspect (incl. empty input)", async () => {
    const { calls, verify } = trackingVerify(() => pageOk);
    const healthy: LinkResult[] = [{ url: "https://a.com/ok", status: 200 }];
    expect(await reverifyLinks(healthy, verify, noSleep([]))).toEqual({
      links: healthy,
      reverified: [],
    });
    expect(await reverifyLinks([], verify, noSleep([]))).toEqual({ links: [], reverified: [] });
    expect(calls).toEqual([]);
  });

  it("preserves length + order (the linksOk zero-checked fail-safe depends on it) and never mutates input", async () => {
    const input: LinkResult[] = [
      { url: "https://a.com/ok", status: 200 },
      { url: "https://a.com/waf", status: 403 },
      { url: "https://a.com/gone", status: 404 },
    ];
    const { verify } = trackingVerify(() => pageOk);
    const { links } = await reverifyLinks(input, verify, noSleep([]));
    expect(links.map((l) => l.url)).toEqual([
      "https://a.com/ok",
      "https://a.com/waf",
      "https://a.com/gone",
    ]);
    expect(links.map((l) => l.status)).toEqual([200, 200, 404]);
    expect(input[1]!.status).toBe(403); // input not mutated
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

  it("warns on a leaked SvelteKit token even when desktop/mobile/links all pass", async () => {
    const r = await browserAudit({
      site,
      now: NOW,
      discoverDeps,
      browserRunner: fakeRunner(
        [
          route("https://a.com/", true, true, ["https://a.com/x"], {
            leakedTemplateTokens: ["%sveltekit.body%"],
          }),
        ],
        [{ url: "https://a.com/x", status: 200 }],
      ),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ desktopOk: true, mobileOk: true, linksOk: true });
    expect(r.details).toMatchObject({ templateOk: false });
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

  // End-to-end shape of the crossbrowser/mobile/links extension: a run where the WAF challenged
  // EVERY engine + the link check lands fully green once the plain fetch proves the site fine.
  // (verifyDeps answers ok on the FIRST re-fetch so the real cooldown sleeps never run —
  // browserAudit has no sleep injection.)
  it("passes a fully-challenged run: engine checks excused + link re-verified, all surfaced", async () => {
    const challenged = route("https://a.com/", false, false, ["https://a.com/x"], {
      status: 403,
      entryStatus: 403,
      title: "a.com",
      metaDescription: null,
    });
    const verifyDeps: VerifyDeps = {
      fetchPage: async () => ({ status: 200, title: "Home", metaDescription: "Welcome" }),
    };
    const r = await browserAudit({
      site,
      now: NOW,
      discoverDeps,
      verifyDeps,
      browserRunner: fakeRunner([challenged], [{ url: "https://a.com/x", status: 403 }]),
    });
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({
      desktopOk: true,
      mobileOk: true,
      linksOk: true,
      reachableOk: true,
      titleMetaOk: true,
    });
    const details = r.details as { excusedEngineChecks: string[]; linkReverifiedUrls: string[] };
    expect(details.excusedEngineChecks).toContain(
      "https://a.com/ [chromium]: browser saw 403, route re-verified reachable (200)",
    );
    expect(details.excusedEngineChecks).toHaveLength(5); // 3 engines + 2 devices
    expect(details.linkReverifiedUrls).toEqual([
      "https://a.com/x: first check saw 403, plain re-fetch 200",
    ]);
    expect(r.summary).toContain("5 engine/device check(s) excused");
    expect(r.summary).toContain("1 link(s) re-verified ok");
  });

  it("still warns on a genuinely broken link (definitive 404 — verify deps never consulted)", async () => {
    const calls: string[] = [];
    const verifyDeps: VerifyDeps = {
      fetchPage: async (url) => {
        calls.push(url);
        return { status: 200, title: "T", metaDescription: "M" };
      },
    };
    const r = await browserAudit({
      site,
      now: NOW,
      discoverDeps,
      verifyDeps,
      browserRunner: fakeRunner(
        [route("https://a.com/", true, true, ["https://a.com/x"])],
        [{ url: "https://a.com/x", status: 404 }],
      ),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ linksOk: false, brokenLinks: 1 });
    expect((r.details as { brokenLinkUrls: string[] }).brokenLinkUrls).toEqual([
      "https://a.com/x → 404",
    ]);
    expect(r.summary).toContain("broken: https://a.com/x → 404");
    expect(calls).toEqual([]); // a definitive 404 earns no second chance
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
