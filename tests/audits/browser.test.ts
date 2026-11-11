import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, devices, firefox, webkit, type Browser } from "@playwright/test";
import {
  summarizeBrowser,
  sharedTitleSuffix,
  browserAudit,
  canonicalizeBaseUrl,
  defaultDiscoverDeps,
  defaultVerifyDeps,
  reverifyRoutes,
  reverifyLinks,
  excuseChallengedEngineChecks,
  extractTitleMeta,
  extractLocale,
  probeMobile,
  probeDesktop,
  probeRoutes,
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
    /** The served `<html lang>` (omitted = not captured). */
    lang?: string | null;
    /** The served `<link rel="alternate" hreflang>` hrefs (omitted = not captured). */
    alternates?: string[];
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
    ...(over.lang !== undefined ? { lang: over.lang } : {}),
    ...(over.alternates !== undefined ? { alternates: over.alternates } : {}),
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

  it("fail-safe: empty observations are NOT ok (prove, don't assume); links are not measured (P1-78c)", () => {
    const s = summarizeBrowser([], [], {});
    expect(s).toMatchObject({ desktopOk: false, mobileOk: false, linksOk: null });
  });

  it("linksOk is null, not measured, when zero links were actually checked: never a pass, never a fail (P1-78c)", () => {
    // A route loaded fine but link discovery yielded nothing (SPA / chromium evaluate threw).
    // brokenLinks is 0 but nothing was proven → must NOT pass, and must not raise the
    // broken-links alarm either (LA Homelessness ×2 on 2026-10-26 checked no link).
    const s = summarizeBrowser([route("https://a.com/", true, true)], [], { "/": 1 });
    expect(s.brokenLinks).toBe(0);
    expect(s.linksOk).toBeNull();
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

  it("reachableOk is null, not measured, for empty observations: never 'site down' (P1-78c)", () => {
    expect(summarizeBrowser([], [], {}).reachableOk).toBeNull();
  });

  it("titleMetaOk true when every route has a non-empty title + meta, all titles unique", () => {
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

  it("titleMetaOk false when a title is empty or the meta description is missing", () => {
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { title: "" })], [], { "/": 1 })
        .titleMetaOk,
    ).toBe(false);
    expect(
      summarizeBrowser([route("https://a.com/", true, true, [], { metaDescription: "" })], [], {
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

  it("a title over 70 chars is a warning, not a fail", () => {
    const s = summarizeBrowser(
      [route("https://a.com/", true, true, [], { title: "x".repeat(71), metaDescription: "d" })],
      [],
      { "/": 1 },
    );
    expect(s.titleMetaOk).toBe(true);
    expect(s.titleMetaProblems).toEqual([]);
    expect(s.titleLengthWarnings).toEqual(["https://a.com/: title 71 chars (over 70)"]);
    expect(s.note).toContain("long titles (warn): https://a.com/: title 71 chars (over 70)");
    expect(s.note).not.toContain("title/meta:");
  });

  it("a title of exactly 70 chars draws no warning", () => {
    const s = summarizeBrowser(
      [route("https://a.com/", true, true, [], { title: "x".repeat(70), metaDescription: "d" })],
      [],
      { "/": 1 },
    );
    expect(s.titleLengthWarnings).toEqual([]);
    expect(s.note).not.toContain("long titles");
  });

  it("does not count a brand suffix the sampled routes share", () => {
    const body73 = "Artists - Ruben Benjamin - Borja Colom - Theo Hirschfield - Anthony James";
    const body60 = "y".repeat(60);
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { title: "Gallery Sonder", metaDescription: "d" }),
        route("https://a.com/b", true, true, [], {
          title: `${body60} | Gallery Sonder`,
          metaDescription: "d",
        }),
        route("https://a.com/artists", true, true, [], {
          title: `${body73} | Gallery Sonder`,
          metaDescription: "d",
        }),
      ],
      [],
      { "/": 3 },
    );
    expect(body73.length).toBe(73);
    expect(s.titleMetaOk).toBe(true);
    expect(s.titleLengthWarnings).toEqual([
      'https://a.com/artists: title 73 chars without the " | Gallery Sonder" suffix (over 70)',
    ]);
  });

  it("strips only the shared suffix, never a separator inside the page's own words", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], {
          title: `${"a".repeat(40)} - ${"b".repeat(40)} | Brand`,
          metaDescription: "d",
        }),
        route("https://a.com/c", true, true, [], {
          title: "Contact | Brand",
          metaDescription: "d",
        }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.titleLengthWarnings).toEqual([
      'https://a.com/: title 83 chars without the " | Brand" suffix (over 70)',
    ]);
  });

  it("finds the brand after the last separator when the page's words use the same one", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], {
          title: `${"a".repeat(40)} | ${"b".repeat(35)} | Brand`,
          metaDescription: "d",
        }),
        route("https://a.com/c", true, true, [], {
          title: "Contact | Brand",
          metaDescription: "d",
        }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.titleLengthWarnings).toEqual([
      'https://a.com/: title 78 chars without the " | Brand" suffix (over 70)',
    ]);
  });

  it("counts the whole title when no suffix is shared by at least two routes", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], {
          title: `${"a".repeat(65)} | Brand`,
          metaDescription: "d",
        }),
        route("https://a.com/c", true, true, [], { title: "Contact us", metaDescription: "d" }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.titleLengthWarnings).toEqual(["https://a.com/: title 73 chars (over 70)"]);
  });

  it.each([" | ", " — ", " – ", " - ", " · ", " :: "])(
    "strips a shared brand suffix after %j",
    (sep) => {
      const s = summarizeBrowser(
        [
          route("https://a.com/", true, true, [], {
            title: `${"p".repeat(69)}${sep}Brand`,
            metaDescription: "d",
          }),
          route("https://a.com/c", true, true, [], {
            title: `Contact${sep}Brand`,
            metaDescription: "d",
          }),
        ],
        [],
        { "/": 2 },
      );
      expect(s.titleLengthWarnings).toEqual([]);
    },
  );

  it("counts a long title whole when it lacks the suffix the other pages share", () => {
    const own = "Gallery Sonder: Contemporary Art from Los Angeles Artists, on View Now!";
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { title: own, metaDescription: "d" }),
        route("https://a.com/a", true, true, [], {
          title: "About | Gallery Sonder",
          metaDescription: "d",
        }),
        route("https://a.com/c", true, true, [], {
          title: "Contact | Gallery Sonder",
          metaDescription: "d",
        }),
      ],
      [],
      { "/": 3 },
    );
    expect(own.length).toBe(71);
    expect(s.titleLengthWarnings).toEqual(["https://a.com/: title 71 chars (over 70)"]);
  });

  it("a page titled with the bare brand backs its suffix, even on a two-page sample", () => {
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { title: "Brand", metaDescription: "d" }),
        route("https://a.com/p", true, true, [], {
          title: `${"a".repeat(64)} | Brand`,
          metaDescription: "d",
        }),
      ],
      [],
      { "/": 2 },
    );
    expect(s.titleLengthWarnings).toEqual([]);
  });

  it("never strips a section name every page shares as if it were the brand", () => {
    const long = "How We Restored a 1920s Craftsman Bungalow Kitchen in Pasadena CA";
    const s = summarizeBrowser(
      [
        route("https://a.com/", true, true, [], { title: "Brand", metaDescription: "d" }),
        route("https://a.com/1", true, true, [], {
          title: `${long} - Blog | Brand`,
          metaDescription: "d",
        }),
        route("https://a.com/2", true, true, [], {
          title: "Ten Tips for Choosing Cabinet Hardware - Blog | Brand",
          metaDescription: "d",
        }),
      ],
      [],
      { "/": 3 },
    );
    expect(s.titleLengthWarnings).toEqual([
      `https://a.com/1: title ${long.length + 7} chars without the " | Brand" suffix (over 70)`,
    ]);
  });

  it("on a tie with no bare-brand page, the shorter shared tail wins", () => {
    expect(
      sharedTitleSuffix([
        `${"a".repeat(65)} - Kitchen Projects | Brand`,
        "Bathroom Refresh - Kitchen Projects | Brand",
      ]),
    ).toBe(" | Brand");
    expect(
      sharedTitleSuffix([
        `${"a".repeat(64)} | Services - Brand`,
        "SEO | Services - Brand",
        `${"c".repeat(64)} | Brand`,
      ]),
    ).toBe(" - Brand");
  });

  it("a brand containing a separator is kept whole when a page carries the bare brand", () => {
    expect(
      sharedTitleSuffix([
        "Smith - Jones Law",
        "Contact | Smith - Jones Law",
        "About | Smith - Jones Law",
      ]),
    ).toBe(" | Smith - Jones Law");
  });

  it("a brand-backed tail beats a more common unbacked one", () => {
    expect(sharedTitleSuffix(["Brand", "Q | Brand", "X - LA", "Y - LA", "Z - LA"])).toBe(
      " | Brand",
    );
  });

  it("the note names the first three long titles and counts the rest", () => {
    const s = summarizeBrowser(
      ["a", "b", "c", "d"].map((p) =>
        route(`https://a.com/${p}`, true, true, [], {
          title: p.repeat(71),
          metaDescription: "d",
        }),
      ),
      [],
      { "/": 4 },
    );
    expect(s.titleLengthWarnings).toHaveLength(4);
    expect(s.note).toContain("https://a.com/c: title 71 chars (over 70) (+1 more)");
    expect(s.note).not.toContain("https://a.com/d: title");
  });

  it("titleMetaOk is null, not measured, for empty observations (P1-78c)", () => {
    expect(summarizeBrowser([], [], {}).titleMetaOk).toBeNull();
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
        route("https://a.com/c", true, true, [], { title: "", metaDescription: "c" }),
      ],
      [],
      { "/": 3 },
    );
    expect(s.titleMetaOk).toBe(false);
    expect(s.titleMetaProblems).toEqual([
      "https://a.com/b: missing meta description",
      "https://a.com/c: empty title",
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
    expect(s.titleLengthWarnings).toEqual([]);
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

// #1872: Vida's "/" and "/es" share the title "Vida Legacy Foundation" (the organisation's proper
// name) as reciprocal hreflang alternates with <html lang> en and es. A translation is not a
// duplicate; a same-language copy still is.
describe("summarizeBrowser → duplicate titles across hreflang alternates (#1872)", () => {
  const EN = "https://a.com/";
  const ES = "https://a.com/es";
  const page = (url: string, lang: string | null, alternates: string[] | undefined) =>
    route(url, true, true, [], {
      title: "Vida Legacy Foundation",
      metaDescription: `Meta for ${url}`,
      lang,
      ...(alternates !== undefined ? { alternates } : {}),
    });

  it("passes the same title on reciprocal hreflang alternates in different languages", () => {
    const s = summarizeBrowser([page(EN, "en", [EN, ES]), page(ES, "es", [ES, EN])], [], {
      "/": 2,
    });
    expect(s.titleMetaProblems).toEqual([]);
    expect(s.titleMetaOk).toBe(true);
  });

  it("still fails the same title on two same-language routes, even when reciprocal (positive control)", () => {
    const s = summarizeBrowser([page(EN, "en", [EN, ES]), page(ES, "en", [ES, EN])], [], {
      "/": 2,
    });
    expect(s.titleMetaOk).toBe(false);
    expect(s.titleMetaProblems).toEqual([
      `duplicate title "Vida Legacy Foundation": ${EN} + ${ES}`,
    ]);
  });

  it("still fails the same title with no hreflang, even across different languages", () => {
    const s = summarizeBrowser([page(EN, "en", []), page(ES, "es", undefined)], [], { "/": 2 });
    expect(s.titleMetaOk).toBe(false);
    expect(s.titleMetaProblems).toEqual([
      `duplicate title "Vida Legacy Foundation": ${EN} + ${ES}`,
    ]);
  });

  it("still fails a one-way hreflang: each route must list the other", () => {
    const s = summarizeBrowser([page(EN, "en", [EN, ES]), page(ES, "es", [ES])], [], { "/": 2 });
    expect(s.titleMetaOk).toBe(false);
    const t = summarizeBrowser([page(EN, "en", [EN]), page(ES, "es", [ES, EN])], [], { "/": 2 });
    expect(t.titleMetaOk).toBe(false);
  });

  it("still fails when either route's lang is missing, though the hreflang is reciprocal", () => {
    for (const [a, b] of [
      [null, null],
      ["", ""],
      ["en", null],
      [null, "es"],
    ] as const) {
      const s = summarizeBrowser([page(EN, a, [EN, ES]), page(ES, b, [ES, EN])], [], { "/": 2 });
      expect(s.titleMetaOk).toBe(false);
    }
  });

  it("compares languages case-insensitively, so EN and en are one language", () => {
    const s = summarizeBrowser([page(EN, "EN", [EN, ES]), page(ES, "en", [ES, EN])], [], {
      "/": 2,
    });
    expect(s.titleMetaOk).toBe(false);
  });

  it("reads en_US (underscore) as English, so it is not a translation of en", () => {
    const s = summarizeBrowser([page(EN, "en_US", [EN, ES]), page(ES, "en", [ES, EN])], [], {
      "/": 2,
    });
    expect(s.titleMetaOk).toBe(false);
  });

  it("compares the primary language subtag, so en-US and en-GB are one language", () => {
    const s = summarizeBrowser([page(EN, "en-US", [EN, ES]), page(ES, "en-GB", [ES, EN])], [], {
      "/": 2,
    });
    expect(s.titleMetaOk).toBe(false);
    const t = summarizeBrowser([page(EN, "EN-us", [EN, ES]), page(ES, "es-MX", [ES, EN])], [], {
      "/": 2,
    });
    expect(t.titleMetaOk).toBe(true);
  });

  it("matches an alternate href to a route url across a trailing slash or a fragment", () => {
    const s = summarizeBrowser(
      [page(EN, "en", ["https://a.com/es/"]), page(ES, "es", ["https://a.com/#top"])],
      [],
      { "/": 2 },
    );
    expect(s.titleMetaOk).toBe(true);
  });

  it("still reports a same-language copy that shares a title with a translated pair", () => {
    const COPY = "https://a.com/home";
    const s = summarizeBrowser(
      [page(EN, "en", [EN, ES]), page(ES, "es", [ES, EN]), page(COPY, "en", [])],
      [],
      { "/": 3 },
    );
    expect(s.titleMetaOk).toBe(false);
    expect(s.titleMetaProblems).toEqual([
      `duplicate title "Vida Legacy Foundation": ${EN} + ${ES} + ${COPY}`,
    ]);
  });
});

describe("reverifyRoutes — locale of a challenged route (#1872)", () => {
  const challenged = (url: string): RouteResult => ({
    ...route(url, false, true, [], { status: 403, title: "a.com", metaDescription: null }),
    lang: "en",
    alternates: [],
  });

  it("takes the served HTML's lang + alternates when the plain fetch clears the route", async () => {
    const { routes } = await reverifyRoutes([challenged("https://a.com/es")], {
      fetchPage: async () => ({
        status: 200,
        title: "Vida Legacy Foundation",
        metaDescription: "es",
        lang: "es",
        alternates: ["https://a.com/es", "https://a.com/"],
      }),
    });
    expect(routes[0]).toMatchObject({
      lang: "es",
      alternates: ["https://a.com/es", "https://a.com/"],
    });
  });

  it("drops the challenge page's locale when the fail is confirmed", async () => {
    const { routes } = await reverifyRoutes(
      [challenged("https://a.com/es")],
      {
        fetchPage: async () => ({
          status: 404,
          title: null,
          metaDescription: null,
          lang: "es",
          alternates: ["https://a.com/"],
        }),
      },
      async () => {},
    );
    expect(routes[0]).toMatchObject({ lang: null, alternates: [] });
  });
});

describe("reverifyRoutes — locale of a route whose title the browser missed (#1872)", () => {
  it("fills a missing locale from the served HTML, as it fills the missing title", async () => {
    const blind = (url: string): RouteResult => ({
      ...route(url, true, true, [], { title: null }),
      lang: null,
      alternates: [],
    });
    const served: Record<string, PageFetch> = {
      "https://a.com/": {
        status: 200,
        title: "Org",
        metaDescription: "en",
        lang: "en",
        alternates: ["https://a.com/", "https://a.com/es"],
      },
      "https://a.com/es": {
        status: 200,
        title: "Org",
        metaDescription: "es",
        lang: "es",
        alternates: ["https://a.com/es", "https://a.com/"],
      },
    };
    const { routes } = await reverifyRoutes([blind("https://a.com/"), blind("https://a.com/es")], {
      fetchPage: async (url) => served[url]!,
    });
    expect(routes[1]).toMatchObject({ title: "Org", lang: "es" });
    expect(summarizeBrowser(routes, [], { "/": 2 }).titleMetaOk).toBe(true);
  });

  it("keeps a locale the browser did capture", async () => {
    const r: RouteResult = {
      ...route("https://a.com/es", true, true, [], { metaDescription: null }),
      lang: "es",
      alternates: ["https://a.com/"],
    };
    const { routes } = await reverifyRoutes([r], {
      fetchPage: async () => ({
        status: 200,
        title: "x",
        metaDescription: "d",
        lang: "fr",
        alternates: ["https://a.com/fr"],
      }),
    });
    expect(routes[0]).toMatchObject({ lang: "es", alternates: ["https://a.com/"] });
  });
});

describe("defaultVerifyDeps.fetchPage — served locale (#1872)", () => {
  it("parses lang + hreflang from the served HTML, resolving hrefs against the final url", async () => {
    const html = `<html lang="es"><head><title>Org</title>
      <meta name="description" content="d"><link rel="alternate" hreflang="en" href="/"></head></html>`;
    const res = new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(res, "url", { value: "https://www.a.com/es" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );
    try {
      expect(await defaultVerifyDeps().fetchPage("https://a.com/es")).toEqual({
        status: 200,
        title: "Org",
        metaDescription: "d",
        lang: "es",
        alternates: ["https://www.a.com/"],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("extractLocale", () => {
  it("reads <html lang> and the hreflang alternates, resolving relative hrefs against the page", () => {
    const html = `<!doctype html><html class="x" lang="es"><head>
      <link rel="alternate" hreflang="es" href="https://vidalegacy.org/es"/>
      <link href="/" hreflang="en" rel="alternate">
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="canonical" hreflang="en" href="https://vidalegacy.org/canon">
      </head></html>`;
    expect(extractLocale(html, "https://vidalegacy.org/es")).toEqual({
      lang: "es",
      alternates: ["https://vidalegacy.org/es", "https://vidalegacy.org/"],
    });
  });

  it("does not take a lang attribute from an element other than <html>", () => {
    expect(extractLocale(`<html><body><p lang="fr">x</p></body></html>`, "https://a.com/")).toEqual(
      {
        lang: null,
        alternates: [],
      },
    );
    expect(extractLocale(`<html lang="">`, "https://a.com/").lang).toBeNull();
    // The document's own <html> tag comes first; a later one (markup in a script string) is not it.
    expect(
      extractLocale(`<html lang="en"><script>s = '<html lang="fr">';</script>`, "https://a.com/")
        .lang,
    ).toBe("en");
  });

  it("reads unquoted attributes, as a minifier writes them", () => {
    expect(
      extractLocale(`<html lang=es><link rel=alternate hreflang=en href=/>`, "https://a.com/es"),
    ).toEqual({ lang: "es", alternates: ["https://a.com/"] });
  });

  it("ignores commented-out tags, data-* look-alikes and non-alternate rels", () => {
    const html = `<!-- <html lang="fr"> <link rel="alternate" hreflang="fr" href="/fr"> -->
      <html-x lang="de"><html lang="en">
      <link data-rel="alternate" rel="stylesheet" hreflang="es" href="/es.css">
      <link rel="alternates" hreflang="it" href="/it">
      <link rel="alternate" hreflang="es" data-href="/x" href="/es?a=1&amp;b=2">`;
    expect(extractLocale(html, "https://a.com/")).toEqual({
      lang: "en",
      alternates: ["https://a.com/es?a=1&b=2"],
    });
  });

  it("reads nothing after an unterminated comment, and skips custom elements named link-*", () => {
    const html = `<html lang="en"><link-card rel="alternate" hreflang="fr" href="/fr">
      <link rel="alternate" hreflang="es" href="/es"><!-- <link rel="alternate" hreflang="de" href="/de">`;
    expect(extractLocale(html, "https://a.com/")).toEqual({
      lang: "en",
      alternates: ["https://a.com/es"],
    });
  });

  it("returns no lang and no alternates for a page that has neither", () => {
    expect(extractLocale("plain text", "https://a.com/")).toEqual({ lang: null, alternates: [] });
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
    const stub = vi.fn((_url: string, _init?: { signal?: AbortSignal }): Promise<Response> =>
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

describe("canonicalizeBaseUrl", () => {
  const pageOk: PageFetch = { status: 200, title: "T", metaDescription: "D" };
  const withRedirect = (status: number | null, location: string | null): VerifyDeps => ({
    fetchPage: async () => pageOk,
    fetchRedirect: async () => ({ status, location }),
  });

  it("is a no-op when the deps carry no fetchRedirect (older fakes)", async () => {
    const verify: VerifyDeps = { fetchPage: async () => pageOk };
    expect(await canonicalizeBaseUrl("https://a.com/", verify)).toEqual({ url: "https://a.com/" });
  });

  it("follows a 301 to the same-site www host ONCE (the Vineyard apex→www class)", async () => {
    const out = await canonicalizeBaseUrl(
      "https://a.com/",
      withRedirect(301, "https://www.a.com/"),
    );
    expect(out).toEqual({ url: "https://www.a.com/", redirectedFrom: "https://a.com/" });
  });

  it("follows 302/307/308 same-site redirects too", async () => {
    for (const status of [302, 307, 308]) {
      const out = await canonicalizeBaseUrl(
        "https://a.com/",
        withRedirect(status, "https://www.a.com/"),
      );
      expect(out.url).toBe("https://www.a.com/");
    }
  });

  it("resolves a relative Location against the configured base", async () => {
    const out = await canonicalizeBaseUrl("https://a.com/old", withRedirect(301, "/"));
    expect(out).toEqual({ url: "https://a.com/", redirectedFrom: "https://a.com/old" });
  });

  it("stays on the configured URL for a 200 (no redirect)", async () => {
    expect(await canonicalizeBaseUrl("https://a.com/", withRedirect(200, null))).toEqual({
      url: "https://a.com/",
    });
  });

  it("surfaces but does NOT follow an off-site redirect (no green verdicts for a squatter)", async () => {
    const out = await canonicalizeBaseUrl(
      "https://a.com/",
      withRedirect(301, "https://parked.example/"),
    );
    expect(out).toEqual({ url: "https://a.com/", offsiteLocation: "https://parked.example/" });
  });

  it("treats apex↔www both directions as same-site", async () => {
    const out = await canonicalizeBaseUrl(
      "https://www.a.com/",
      withRedirect(301, "https://a.com/"),
    );
    expect(out).toEqual({ url: "https://a.com/", redirectedFrom: "https://www.a.com/" });
  });

  it("fail-open: network error (null status), redirect without Location, non-http target, and an unparseable base all stand unchanged", async () => {
    expect((await canonicalizeBaseUrl("https://a.com/", withRedirect(null, null))).url).toBe(
      "https://a.com/",
    );
    expect((await canonicalizeBaseUrl("https://a.com/", withRedirect(301, null))).url).toBe(
      "https://a.com/",
    );
    expect(
      (await canonicalizeBaseUrl("https://a.com/", withRedirect(301, "mailto:x@a.com"))).url,
    ).toBe("https://a.com/");
    expect((await canonicalizeBaseUrl("not a url", withRedirect(301, "https://a.com/"))).url).toBe(
      "not a url",
    );
  });

  // End-to-end: the audit discovers routes on the CANONICAL host and surfaces the hop in
  // note + details, so an apex-configured site is probed without per-route redirect hops.
  it("browserAudit probes the canonical host when the base 301s to www", async () => {
    const fetched: string[] = [];
    const discoverDeps: DiscoverDeps = {
      fetchText: async (url) => {
        fetched.push(url);
        return url === "https://www.a.com/sitemap.xml"
          ? `<urlset><url><loc>https://www.a.com/</loc></url></urlset>`
          : null;
      },
    };
    const verifyDeps: VerifyDeps = {
      fetchPage: async () => pageOk,
      fetchRedirect: async () => ({ status: 301, location: "https://www.a.com/" }),
    };
    const r = await browserAudit({
      site: { path: "/tmp/a", name: "a", deployedUrl: "https://a.com/" },
      now: NOW,
      discoverDeps,
      verifyDeps,
      browserRunner: {
        probe: async () => [route("https://www.a.com/", true, true, ["https://www.a.com/x"])],
        checkLinks: async () => [{ url: "https://www.a.com/x", status: 200 }],
      },
    });
    expect(fetched[0]).toBe("https://www.a.com/sitemap.xml");
    expect(r.summary).toContain("probed https://www.a.com/");
    expect(r.details).toMatchObject({
      canonicalBaseUrl: "https://www.a.com/",
      canonicalizedFrom: "https://a.com/",
    });
  });

  it("browserAudit surfaces an off-site base redirect without following it", async () => {
    const fetched: string[] = [];
    const discoverDeps: DiscoverDeps = {
      fetchText: async (url) => {
        fetched.push(url);
        return null; // root-only discovery on the configured host
      },
    };
    const verifyDeps: VerifyDeps = {
      fetchPage: async () => pageOk,
      fetchRedirect: async () => ({ status: 301, location: "https://parked.example/" }),
    };
    const r = await browserAudit({
      site: { path: "/tmp/a", name: "a", deployedUrl: "https://a.com/" },
      now: NOW,
      discoverDeps,
      verifyDeps,
      browserRunner: {
        probe: async () => [route("https://a.com/", true, true, ["https://a.com/x"])],
        checkLinks: async () => [{ url: "https://a.com/x", status: 200 }],
      },
    });
    expect(fetched[0]).toBe("https://a.com/sitemap.xml");
    expect(r.summary).toContain("OFF-SITE");
    expect(r.details).toMatchObject({ offsiteRedirect: "https://parked.example/" });
  });

  it("defaultVerifyDeps.fetchRedirect uses redirect:manual, is bounded, and degrades to nulls", async () => {
    const stub = vi.fn(
      (_url: string, init?: { redirect?: string; signal?: AbortSignal }): Promise<Response> => {
        expect(init?.redirect).toBe("manual");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Promise.reject(new Error("simulated timeout abort"));
      },
    );
    vi.stubGlobal("fetch", stub);
    try {
      const out = await defaultVerifyDeps().fetchRedirect!("https://hung.example/");
      expect(out).toEqual({ status: null, location: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// #1871 (P1-85): the mobile check was wrong both ways under Chromium's mobile emulation, which the
// runner uses for BOTH devices. It read overflow at domcontentloaded, before a slow stylesheet
// applied (false fail), and compared against window.innerWidth, which emulation widens with the
// page up to 4x the device width (false pass: a 600px-wide page read innerWidth 608). These run the
// real probe in real Chromium against local fixtures.
describe("probeMobile — real Chromium, device-width overflow after styles apply (#1871)", () => {
  const head =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title>';
  const pages: Record<string, string> = {
    // Truly too wide on any phone: a 600px block.
    "/wide": `${head}</head><body><main><div style="width:600px;height:20px">x</div></main></body></html>`,
    // Fits once its stylesheet applies; before that the 2000px image is 2000px wide, past the 4x
    // widening cap on both devices, so the pre-fix read at domcontentloaded failed it.
    "/precss":
      `${head}<link rel="stylesheet" href="/slow.css"></head>` +
      '<body><main><img src="/big.svg" width="2000" height="100" alt=""></main></body></html>',
    // No viewport meta: a phone lays it out at ~980px and zooms out. The old innerWidth read
    // widened with it and passed; the device-width check fails it (review round 1).
    "/nometa":
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head>' +
      "<body><main><p>Desktop only.</p></main></body></html>",
    "/fits": `${head}</head><body><main><p>Fits.</p></main></body></html>`,
  };
  let server: Server;
  let base = "";
  let browser: Browser;
  let dropped = 0;
  let alwaysDropped = 0;
  const hung: import("node:net").Socket[] = [];
  const hangAt: number[] = [];
  let wideServed = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      // /drop-once: the first request's connection is cut (a transient network drop),
      // later ones serve a fitting page. /drop-always: every connection is cut.
      // /hang: never answers, so the navigation times out.
      if (req.url === "/hang") {
        hung.push(req.socket);
        hangAt.push(Date.now());
        return;
      }
      if (req.url === "/drop-always") alwaysDropped++;
      if (req.url === "/drop-always" || (req.url === "/drop-once" && dropped++ === 0)) {
        req.socket.destroy();
        return;
      }
      // /wide-once: too wide on its first load only (as CalTex's / was before hydration).
      if (req.url === "/wide-once") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(wideServed++ === 0 ? pages["/wide"] : pages["/fits"]);
        return;
      }
      if (req.url === "/drop-once") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(pages["/fits"]);
        return;
      }
      if (req.url === "/slow.css") {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "text/css" });
          res.end("img{max-width:100%;height:auto}");
        }, 1500);
        return;
      }
      if (req.url === "/big.svg") {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="100"></svg>');
        return;
      }
      // /block/<px>: a body exactly <px> wide, for the tolerance edge (vw + 1 passes, vw + 3 fails).
      const block = /^\/block\/(\d+)$/.exec(req.url ?? "");
      const html = block
        ? `${head}<style>body{margin:0}</style></head><body><main><div style="width:${Number(block[1])}px;height:5px"></div></main></body></html>`
        : pages[req.url ?? ""];
      res.writeHead(html ? 200 : 404, { "content-type": "text/html" });
      res.end(html ?? "not found");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  const targets = [
    { device: "Pixel 7", descriptor: devices["Pixel 7"]! },
    { device: "iPhone 14", descriptor: devices["iPhone 14"]! },
  ];

  for (const target of targets) {
    const vw = target.descriptor.viewport.width;

    it(`fails a page that is too wide [${target.device}], and names the width`, async () => {
      const r = await probeMobile(browser, `${base}/wide`, target);
      expect(r).toMatchObject({ device: target.device, ok: false, status: 200 });
      expect(r.reason).toBe(`overflow ${600 + 8}px > ${vw}px`); // + body margin
    }, 30_000);

    it(`passes a fitting page that only overflows before its CSS loads [${target.device}]`, async () => {
      const r = await probeMobile(browser, `${base}/precss`, target);
      expect(r).toEqual({ device: target.device, ok: true, status: 200 });
    }, 30_000);

    it(`tolerates a 1px rounding overflow but not 3px [${target.device}]`, async () => {
      expect((await probeMobile(browser, `${base}/block/${vw + 1}`, target)).ok).toBe(true);
      const over3 = await probeMobile(browser, `${base}/block/${vw + 3}`, target);
      expect(over3.ok).toBe(false);
      expect(over3.reason).toBe(`overflow ${vw + 3}px > ${vw}px`);
    }, 30_000);
  }

  it("fails a page with no viewport meta, which a phone shows zoomed out", async () => {
    const r = await probeMobile(browser, `${base}/nometa`, targets[0]!);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^overflow 9\d\dpx > 412px$/);
  }, 30_000);

  // 2026-11-03: one dropped connection on one device put Reddoor at Broken.
  it("a load that fails once and then succeeds is measured on the second load", async () => {
    dropped = 0;
    expect(await probeMobile(browser, `${base}/drop-once`, targets[0]!)).toEqual({
      device: "Pixel 7",
      ok: true,
      status: 200,
    });
    expect(dropped).toBe(2);
  }, 60_000);

  it("only a load that threw is retried: an overflow seen once stands", async () => {
    wideServed = 0;
    const r = await probeMobile(browser, `${base}/wide-once`, targets[0]!);
    expect(r).toMatchObject({ ok: false, reason: "overflow 608px > 412px" });
    expect(wideServed).toBe(1);
  }, 60_000);

  it("a route that never loads still fails, as load failed, after exactly one retry", async () => {
    alwaysDropped = 0;
    expect(await probeMobile(browser, `${base}/drop-always`, targets[0]!)).toMatchObject({
      device: "Pixel 7",
      ok: false,
      reason: "load failed",
    });
    // One retry, never more: its cost is what fleet-lighthouse's 75 minutes allow.
    expect(alwaysDropped).toBe(2);
  }, 60_000);

  // Review round 2: a crashed browser must not read as every route failing to load.
  it("a browser that has crashed throws, so the audit names the crash", async () => {
    const gone = await chromium.launch();
    await gone.close();
    await expect(probeMobile(gone, `${base}/fits`, targets[0]!)).rejects.toThrow(/closed/);
  }, 60_000);

  // Review round 2: the retry's own cap, not the first try's 30 s, bounds a route that
  // hangs again (the nightly's 75-minute budget), and the first try keeps its 30 s.
  it("a route that hangs twice costs about 30 s plus 10 s, not 60", async () => {
    hangAt.length = 0;
    const t0 = Date.now();
    try {
      expect(await probeMobile(browser, `${base}/hang`, targets[0]!)).toMatchObject({
        ok: false,
        reason: "load failed",
      });
      const took = Date.now() - t0;
      expect(took).toBeGreaterThan(38_000);
      expect(took).toBeLessThan(52_000);
      // The first try waited its full 30 s before the retry asked: the caps are not swapped.
      expect(hangAt).toHaveLength(2);
      expect(hangAt[1]! - hangAt[0]!).toBeGreaterThan(28_000);
    } finally {
      for (const sock of hung) sock.destroy();
    }
  }, 90_000);

  it("passes a fitting page, and names a missing page's cause", async () => {
    expect(await probeMobile(browser, `${base}/fits`, targets[0]!)).toEqual({
      device: "Pixel 7",
      ok: true,
      status: 200,
    });
    const missing = await probeMobile(browser, `${base}/missing`, targets[0]!);
    expect(missing).toMatchObject({ ok: false, status: 404 });
  }, 30_000);
});

// P1-107: the 2026-11-10 nightly read reddoorla.com/ as failing on Firefox with no status, and
// the cockpit put Reddoor at Broken, while Firefox and Chromium each loaded it twice that morning.
// Desktop now gets mobile's one retry: only for a navigation that threw, in a fresh context, at
// RETRY_PAGE_TIMEOUT_MS. These run the real probe in real Chromium against local fixtures.
describe("probeDesktop — one retry for a navigation that threw (P1-107)", () => {
  const ok =
    '<!doctype html><html lang="en"><head><title>t</title></head><body><main>ok</main></body></html>';
  const noMain =
    '<!doctype html><html lang="en"><head><title>t</title></head><body><div>no main</div></body></html>';
  let server: Server;
  let base = "";
  let browser: Browser;
  const served: Record<string, number> = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "";
      const n = (served[path] = (served[path] ?? 0) + 1);
      // /drop-once: the first connection is cut, later ones load. /drop-always: every one is cut.
      if (path === "/drop-always" || (path === "/drop-once" && n === 1)) {
        req.socket.destroy();
        return;
      }
      // /cut-once/*: the first response is cut mid-body, later ones load. Firefox resends a
      // request whose connection was reset before any reply (measured 11-11: one drop read 200,
      // two drops read 200 after 3 requests), so /drop-once never reaches Firefox's retry; a
      // body cut short throws on Firefox (NS_ERROR_NET_PARTIAL_TRANSFER) and WebKit ("Connection
      // terminated unexpectedly") after one request.
      if (path.startsWith("/cut-once/") && n === 1) {
        req.socket.write(
          "HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: 5000\r\n\r\n<!doctype html><ma",
        );
        req.socket.destroy();
        return;
      }
      // /nomain-once: loads, but with no <main> the first time only, so a retry would hide it.
      res.writeHead(200, { "content-type": "text/html" });
      res.end(path === "/nomain-once" && n === 1 ? noMain : ok);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  /** A real browser, recording each context it opens and each navigation's timeout. */
  function watched(real: Browser = browser) {
    const contexts: import("@playwright/test").BrowserContext[] = [];
    const timeouts: (number | undefined)[] = [];
    const spy = new Proxy(real, {
      get(target, prop) {
        if (prop !== "newContext") return Reflect.get(target, prop, target);
        return async (...args: Parameters<Browser["newContext"]>) => {
          const ctx = await target.newContext(...args);
          contexts.push(ctx);
          const newPage = ctx.newPage.bind(ctx);
          ctx.newPage = async () => {
            const page = await newPage();
            const goto = page.goto.bind(page);
            page.goto = (u, o) => {
              timeouts.push(o?.timeout);
              return goto(u, o);
            };
            return page;
          };
          return ctx;
        };
      },
    });
    return { spy, contexts, timeouts };
  }

  it("a navigation that throws once is retried once, in a fresh context, at the retry's cap", async () => {
    served["/drop-once"] = 0;
    const w = watched();
    const r = await probeDesktop(w.spy, `${base}/drop-once`, "firefox");
    expect(r).toEqual({ ok: true, status: 200, threw: false });
    expect(served["/drop-once"]).toBe(2);
    // A fresh context for the retry, not the first one reused.
    expect(w.contexts).toHaveLength(2);
    expect(w.contexts[0]).not.toBe(w.contexts[1]);
    // The first try keeps its 30 s; the retry is capped at RETRY_PAGE_TIMEOUT_MS (10 s).
    expect(w.timeouts).toEqual([30_000, 10_000]);
  }, 60_000);

  it("a route that throws twice still fails, with no status, after exactly one retry", async () => {
    served["/drop-always"] = 0;
    const w = watched();
    const r = await probeDesktop(w.spy, `${base}/drop-always`, "firefox");
    expect(r).toMatchObject({ ok: false, status: null, threw: true });
    // One retry, never more: its cost is what fleet-lighthouse's 75 minutes allow.
    expect(served["/drop-always"]).toBe(2);
    expect(w.contexts).toHaveLength(2);
  }, 60_000);

  it("a page that loaded but failed is not retried, and still fails", async () => {
    served["/nomain-once"] = 0;
    const w = watched();
    const r = await probeDesktop(w.spy, `${base}/nomain-once`, "firefox");
    expect(r).toEqual({ ok: false, status: 200, threw: false });
    expect(served["/nomain-once"]).toBe(1);
    expect(w.contexts).toHaveLength(1);
  }, 60_000);

  it("chromium's retried load supplies the route's page facts", async () => {
    served["/drop-once"] = 0;
    const r = await probeDesktop(browser, `${base}/drop-once`, "chromium");
    expect(r).toMatchObject({ ok: true, status: 200, threw: false });
    expect(r.page).toMatchObject({ status: 200, title: "t", lang: "en" });
  }, 60_000);

  it("a browser that has crashed throws, so the audit names the crash", async () => {
    const gone = await chromium.launch();
    await gone.close();
    await expect(probeDesktop(gone, `${base}/drop-once`, "firefox")).rejects.toThrow(/closed/);
  }, 60_000);

  // #2018: the tests above drive Chromium under the label "firefox", but the 11-10 incident was
  // a throw in real Firefox. These run the real engines, each through one thrown first load.
  for (const [engine, type] of [
    ["firefox", firefox],
    ["webkit", webkit],
  ] as const) {
    it(`a first navigation that throws on real ${engine} reaches the retry and loads`, async () => {
      const real = await type.launch();
      try {
        const path = `/cut-once/${engine}`;
        served[path] = 0;
        const w = watched(real);
        const r = await probeDesktop(w.spy, `${base}${path}`, engine);
        expect(r).toEqual({ ok: true, status: 200, threw: false });
        // Exactly two requests: the cut one, then the retry. The engine did not resend it itself.
        expect(served[path]).toBe(2);
        expect(w.contexts).toHaveLength(2);
        expect(w.timeouts).toEqual([30_000, 10_000]);
      } finally {
        await real.close();
      }
    }, 60_000);
  }
});

// P1-107b: each retry costs up to 10 s, times 15 routes × (3 engines + 2 devices), so a site
// whose every route hangs took 59.6 min with both retries against 51.9 without desktop's
// (measured 2026-11-10: workspace decisions/2026-11-10-2048-p1-107-desktop-retry-budget.md),
// past fleet-lighthouse's 75-minute audit step once the rest of the fleet is added. One budget
// of 3 retries per site, shared by desktop and mobile, bounds that to 30 s. These run the real
// per-site loop in real Chromium (every engine slot on one Chromium: the engine's name only
// decides which load reads the page facts).
describe("probeRoutes — one retry budget of 3 per site, shared by desktop and mobile (P1-107b)", () => {
  const head =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title></head>';
  const fits = `${head}<body><main><p>ok</p></main></body></html>`;
  const noMain = `${head}<body><div>no main</div></body></html>`;
  let server: Server;
  let base = "";
  let browser: Browser;
  const served: Record<string, number> = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? "";
      const n = (served[path] = (served[path] ?? 0) + 1);
      // /alt/*: the 1st, 3rd, 5th… connection is cut and the others load, so every probe's
      // first try throws and its retry, when it gets one, loads. /drop/*: every one is cut.
      if (path.startsWith("/drop/") || (path.startsWith("/alt/") && n % 2 === 1)) {
        req.socket.destroy();
        return;
      }
      // /nomain/*: loads every time, and fails every time, without throwing.
      res.writeHead(200, { "content-type": "text/html" });
      res.end(path.startsWith("/nomain/") ? noMain : fits);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  /** One site's browsers, in the production order: three desktop engines, then two devices. */
  function site() {
    return {
      desktop: ["chromium", "firefox", "webkit"].map((engine) => ({ engine, browser })),
      mobile: [
        { target: { device: "Pixel 7", descriptor: devices["Pixel 7"]! }, browser },
        { target: { device: "iPhone 14", descriptor: devices["iPhone 14"]! }, browser },
      ],
    };
  }
  const loaded = { ok: true, status: 200 };
  const threwDesktop = { ok: false, status: null };

  it("the first 3 throws are each retried once; the 4th is not, and fails as its first try did", async () => {
    const [r] = await probeRoutes([`${base}/alt/a`], site());
    // Three desktop throws, each retried once and loaded on the retry, as today.
    expect(r!.desktop).toEqual([
      { engine: "chromium", ...loaded },
      { engine: "firefox", ...loaded },
      { engine: "webkit", ...loaded },
    ]);
    // The 4th throw (Pixel 7's) is not retried: it stands as "load failed". iPhone 14's first
    // try is the next request, which loads, so it spends nothing.
    expect(r!.mobile).toEqual([
      { device: "Pixel 7", ok: false, status: null, reason: "load failed" },
      { device: "iPhone 14", ...loaded },
    ]);
    // Five first tries and three retries: one budget across desktop and mobile, not one each.
    expect(served["/alt/a"]).toBe(8);
  }, 60_000);

  it("once the budget is spent, every later thrown navigation on the site fails on its first try", async () => {
    const [first, second] = await probeRoutes([`${base}/alt/b`, `${base}/drop/c`], site());
    expect(first!.desktop.every((d) => d.ok)).toBe(true);
    expect(second!.desktop).toEqual([
      { engine: "chromium", ...threwDesktop },
      { engine: "firefox", ...threwDesktop },
      { engine: "webkit", ...threwDesktop },
    ]);
    expect(second!.mobile).toEqual([
      { device: "Pixel 7", ok: false, status: null, reason: "load failed" },
      { device: "iPhone 14", ok: false, status: null, reason: "load failed" },
    ]);
    // No retries on the second route at all: 5 probes, 5 requests.
    expect(served["/drop/c"]).toBe(5);
  }, 60_000);

  it("a new probeRoutes call (the next site) starts with a full budget", async () => {
    const [d] = await probeRoutes([`${base}/alt/d`], site());
    const [e] = await probeRoutes([`${base}/alt/e`], site());
    for (const r of [d!, e!]) {
      expect(r.desktop.map((x) => x.ok)).toEqual([true, true, true]);
      expect(r.mobile.map((x) => x.ok)).toEqual([false, true]);
    }
    expect(served["/alt/d"]).toBe(8);
    expect(served["/alt/e"]).toBe(8);
  }, 60_000);

  it("a probe whose first try did not throw never spends the budget", async () => {
    const [nomain, ok, alt] = await probeRoutes(
      [`${base}/nomain/f`, `${base}/fits/g`, `${base}/alt/h`],
      site(),
    );
    // Ten probes that loaded (five failing, five passing) spent nothing, and none was retried.
    expect(nomain!.desktop.map((x) => x.ok)).toEqual([false, false, false]);
    expect(nomain!.mobile.map((x) => x.reason)).toEqual(["no visible <main>", "no visible <main>"]);
    expect(ok!.desktop.map((x) => x.ok)).toEqual([true, true, true]);
    expect(served["/nomain/f"]).toBe(5);
    expect(served["/fits/g"]).toBe(5);
    // So the third route still has all three retries.
    expect(alt!.desktop.map((x) => x.ok)).toEqual([true, true, true]);
    expect(served["/alt/h"]).toBe(8);
  }, 60_000);

  it("chromium's page facts come from its retried load", async () => {
    const [r] = await probeRoutes([`${base}/alt/i`], site());
    expect(r).toMatchObject({ status: 200, title: "t", lang: "en" });
  }, 60_000);
});

// #2017: probeRoutes copies chromium's page facts onto the route, and before this no test read
// most of them: deleting the links, the meta description, the leaked tokens or the alternates
// left every test green. One page carries all seven, each with a value no default can match.
describe("probeRoutes — every desktop page fact reaches the route (#2017)", () => {
  const facts =
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Facts page</title>' +
    '<meta name="description" content="A described page">' +
    '<link rel="alternate" hreflang="en" href="/en/facts"></head>' +
    '<body><main><a href="/a">a</a><a href="/b">b</a><a href="https://elsewhere.example/c">c</a>' +
    "<!-- %sveltekit.body% --></main></body></html>";
  let server: Server;
  let base = "";
  let browser: Browser;

  beforeAll(async () => {
    server = createServer((req, res) => {
      // 203, not 200: a status the mapping must copy, which no default or constant supplies.
      res.writeHead(req.url === "/facts" ? 203 : 404, { "content-type": "text/html" });
      res.end(req.url === "/facts" ? facts : "not found");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  it("copies status, title, meta description, links, leaked tokens, lang and alternates", async () => {
    // The production engine order: chromium reads the facts, and the later engines, which read
    // none, must not clear them.
    const desktop = ["chromium", "firefox", "webkit"].map((engine) => ({ engine, browser }));
    const [r] = await probeRoutes([`${base}/facts`], { desktop, mobile: [] });
    expect(r).toEqual({
      url: `${base}/facts`,
      desktop: [
        { engine: "chromium", ok: true, status: 203 },
        { engine: "firefox", ok: true, status: 203 },
        { engine: "webkit", ok: true, status: 203 },
      ],
      mobile: [],
      status: 203,
      title: "Facts page",
      metaDescription: "A described page",
      links: [`${base}/a`, `${base}/b`],
      leakedTemplateTokens: ["%sveltekit.body%"],
      lang: "fr",
      alternates: [`${base}/en/facts`],
    });
  }, 60_000);
});

describe("summarizeBrowser — a failing mobile entry carries its measured cause (#1871)", () => {
  it("appends the reason to the offender string", () => {
    const r = route("https://a.com/", true, true);
    r.mobile[0] = { device: "Pixel 7", ok: false, status: 200, reason: "overflow 441px > 412px" };
    const s = summarizeBrowser([r], [{ url: "https://a.com/x", status: 200 }], { "/": 1 });
    expect(s.mobileFailures).toEqual(["https://a.com/ [Pixel 7] (overflow 441px > 412px)"]);
  });
});
