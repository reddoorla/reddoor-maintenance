import { describe, expect, it } from "vitest";
import {
  runSiteChecks,
  tally,
  TIER0_CHECK_KEYS,
  TIER1_CHECK_KEYS,
  TIER2_DNS_CHECK_KEYS,
  TIER3_CHECK_KEYS,
} from "../../src/prospect/site-checks.js";
import type {
  ChecksResult,
  CrawlResult,
  PageCapture,
  PageExtract,
} from "../../src/prospect/types.js";

/**
 * The floor is bare HTML.
 *
 * The fixture below is an ordinary, careful small-business site — not a
 * contrived one. Every check in this battery has to go green on it. A check
 * that needs something stranger than this to pass is measuring fashion rather
 * than care, and it turns the report into an argument.
 *
 * This is the same guard `greenable.test.ts` puts on the goal battery, pointed
 * at the Tier 0 checks, and it is the reason a trivial check is allowed to
 * exist at all: it costs one collapsed row until the day it fails.
 */

const HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), geolocation=()",
  "content-encoding": "br",
  server: "nginx",
};

const SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "Acme Roofing",
  url: "https://acme.example",
  logo: "https://acme.example/logo.png",
  telephone: "(310) 555-0142",
  address: { "@type": "PostalAddress", addressLocality: "Boise", addressRegion: "ID" },
  openingHours: "Mo-Fr 08:00-17:00",
});

function extract(over: Partial<PageExtract> = {}): PageExtract {
  const merged: PageExtract = {
    title: "Acme Roofing — Commercial Roof Repair in Boise",
    metaDescription:
      "Commercial roof repair and replacement across the Treasure Valley, from a Boise crew.",
    canonical: "https://acme.example/",
    social: {},
    headings: [{ level: 1, text: "Commercial roof repair in Boise" }],
    jsonLd: [SCHEMA],
    images: { total: 3, withAlt: 3 },
    hasViewportMeta: true,
    text: "We repair commercial roofs across the Treasure Valley. Call us on (310) 555-0142.",
    // `target: ""` on every anchor, because the real extractor always sets it.
    // Nothing reads it any more — the one check that did is gone — but the
    // fixture keeps the shape the extractor produces rather than a subset of it.
    anchors: [
      { href: "/services", text: "Services", rel: "", target: "" },
      { href: "/contact", text: "Contact", rel: "", target: "" },
      { href: "tel:+13105550142", text: "Call us", rel: "", target: "" },
      { href: "https://www.facebook.com/acmeroofingboise", text: "Facebook", rel: "", target: "" },
    ],
    anchorCount: 4,
    imageSrcs: [],
    scriptSrcs: ["https://www.googletagmanager.com/gtag/js?id=G-ABC"],
    scriptCount: 1,
    metas: { charset: "utf-8" },
    links: [
      { rel: "icon", href: "/favicon.ico" },
      { rel: "canonical", href: "https://acme.example/" },
    ],
    forms: [
      {
        kind: "enquiry",
        action: "/enquiry",
        method: "post",
        fieldCount: 5,
        hasContactField: true,
        hasSubmit: true,
        fields: [
          { type: "text", name: "name", autocomplete: "name", required: true },
          { type: "email", name: "email", autocomplete: "email", required: true },
          { type: "tel", name: "phone", autocomplete: "tel", required: false },
          { type: "textarea", name: "message", autocomplete: null, required: true },
        ],
      },
    ],
    ...over,
  };
  // The real extractor sets `ariaLabel` on every anchor, empty when there is
  // none. A fixture that omits it is a report stored before we captured it, and
  // `link-text` correctly reads that as unmeasured — so fill it in here and let
  // the one test that wants the old shape ask for it.
  return merged.anchors === undefined
    ? merged
    : { ...merged, anchors: merged.anchors.map((a) => ({ ariaLabel: "", ...a })) };
}

/** A page the browser opened and found nothing wrong with. Separate from the
 *  extract because these are the browser's observations, not the markup's. */
const CLEAN_VITALS = {
  consoleErrors: [],
  failedRequests: [],
  overflowAt375: 0,
  tinyText: { count: 0, sample: null },
  oversizedImages: [],
};

function page(
  url: string,
  over: Partial<PageExtract> = {},
  vitals: PageCapture["vitals"] = CLEAN_VITALS,
): PageCapture {
  // Self-canonical unless a test says otherwise. `extract()` carries the home
  // page's canonical, so before this every ad-hoc second page silently claimed
  // to BE the home page — which the checks that fold by declared address now
  // read correctly, and which made two of them skip on fixtures that meant to
  // exercise them.
  const rendered = extract({ canonical: url, ...over });
  return { url, status: 200, raw: null, rendered, error: null, vitals };
}

function exemplary(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: "User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap.xml",
    agentAccess: [],
    // `truncated: false` — a flat sitemap, read whole, which is what almost
    // every small business publishes and what the exemplary site has.
    sitemap: { present: true, urlCount: 12, truncated: false },
    llmsTxt: { present: true, firstLine: "# Acme Roofing" },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: HEADERS,
    pages: [
      page("https://acme.example/"),
      page("https://acme.example/services", {
        title: "Roof repair services — Acme Roofing",
        metaDescription: "What we repair, how long it takes, and what a commercial roof job costs.",
        canonical: "https://acme.example/services",
        headings: [{ level: 1, text: "What we repair" }],
        links: [
          { rel: "icon", href: "/favicon.ico" },
          { rel: "canonical", href: "https://acme.example/services" },
        ],
      }),
    ],
    ...over,
  };
}

const exemplaryChecks = (): ChecksResult =>
  ({
    consistency: {
      phones: [
        {
          normalized: "3105550142",
          seenAs: ["(310) 555-0142"],
          pages: ["https://acme.example/"],
          linked: true,
        },
      ],
      emails: [],
      copyrightYears: [],
      newestCopyrightYear: null,
      pagesOffTemplate: [],
      sharedNavLinks: 2,
      pagesExamined: 2,
    },
  }) as unknown as ChecksResult;

const byKey = (checks: ReturnType<typeof runSiteChecks>, key: string) =>
  checks.find((c) => c.key === key);

describe("an ordinary careful site passes the whole battery", () => {
  const checks = runSiteChecks(exemplary(), exemplaryChecks(), "Acme Roofing");

  it("fails nothing", () => {
    const failed = checks
      .filter((c) => c.status === "fail")
      .map((c) => `${c.key} — ${c.evidence ?? "no evidence"}`);
    expect(failed, "a check an ordinary good site fails is measuring fashion, not care").toEqual(
      [],
    );
  });

  it("reaches a verdict on most of them rather than skipping its way to green", () => {
    // The cheap way to make the assertion above pass is to skip everything.
    // This is the guard on the guard.
    const t = tally(checks);
    expect(t.total).toBeGreaterThanOrEqual(50);
    expect(t.passed).toBe(t.total);
  });

  it("carries a receipt on every check that reached a verdict", () => {
    for (const c of checks) {
      if (c.status === "pass" || c.status === "fail") {
        expect(c.evidence, `${c.key} reached a verdict with no receipt`).toBeTruthy();
      }
    }
  });

  it("declares every key it promises", () => {
    for (const key of [
      ...TIER0_CHECK_KEYS,
      ...TIER1_CHECK_KEYS,
      ...TIER3_CHECK_KEYS,
      ...TIER2_DNS_CHECK_KEYS,
    ]) {
      expect(byKey(checks, key), `${key} was never produced`).toBeDefined();
    }
  });
});

describe("the four states, and the denominator that depends on them", () => {
  it("excludes not-applicable from the total, rather than passing it", () => {
    // The defect this whole shape exists to prevent: a site with no schema
    // silently scoring five free passes for schema it does not have.
    const noSchema = exemplary({
      pages: [
        page("https://acme.example/", { jsonLd: [] }),
        page("https://acme.example/services", { jsonLd: [] }),
      ],
    });
    const checks = runSiteChecks(noSchema, exemplaryChecks(), "Acme Roofing");
    const schema = checks.filter((c) => c.key.startsWith("schema-"));
    expect(schema.every((c) => c.status === "not-applicable")).toBe(true);

    // Only the schema checks that reached a verdict on the exemplary site can
    // leave its denominator. `schema-self-review` was already not-applicable
    // there — the fixture publishes no rating markup — so subtracting all five
    // would be the same arithmetic mistake this check exists to prevent.
    const baseline = runSiteChecks(exemplary(), exemplaryChecks(), "Acme Roofing");
    const hadVerdict = baseline.filter(
      (c) => c.key.startsWith("schema-") && (c.status === "pass" || c.status === "fail"),
    ).length;
    expect(tally(checks).total).toBe(tally(baseline).total - hadVerdict);
  });

  it("excludes unmeasured from the total too", () => {
    // Our gap, not theirs — and a denominator that counted it would print a
    // failure rate we caused.
    const noHeaders = exemplary({ homeHeaders: {} });
    const checks = runSiteChecks(noHeaders, exemplaryChecks(), "Acme Roofing");
    const headers = checks.filter((c) => c.key.startsWith("header-"));
    // Six security headers plus the version and compression checks are ours to
    // not know; the HSTS age check is not-applicable without an HSTS header.
    expect(headers.filter((c) => c.status === "unmeasured")).toHaveLength(8);
    expect(headers.filter((c) => c.status === "pass" || c.status === "fail")).toHaveLength(0);
  });

  it("never passes a check about a page when we read no pages", () => {
    // The single failure mode this codebase is built around. Scoped to the
    // checks that actually read a page: robots.txt and llms.txt are fetched
    // independently, and "no robots.txt, so nothing is disallowed" stays a
    // legitimate pass whether or not any page came back.
    const empty = exemplary({ pages: [], homeHeaders: {}, robotsTxt: null });
    const checks = runSiteChecks(empty, null, null);
    const fromPages = checks.filter(
      (c) =>
        !["robots-not-blocking", "robots-names-sitemap", "sitemap-coverage", "llms-txt"].includes(
          c.key,
        ),
    );
    expect(fromPages.filter((c) => c.status === "pass").map((c) => c.key)).toEqual([]);
  });

  it("treats a missing robots.txt as everything allowed, which is a real pass", () => {
    // The opposite error: no robots.txt genuinely means nothing is disallowed,
    // and calling that unmeasured would hide a true green.
    const checks = runSiteChecks(exemplary({ robotsTxt: null }), exemplaryChecks(), "Acme Roofing");
    expect(byKey(checks, "robots-not-blocking")?.status).toBe("pass");
    // But its sitemap line cannot be read from a file that is not there.
    expect(byKey(checks, "robots-names-sitemap")?.status).toBe("not-applicable");
  });
});

describe("each check fires on the thing it is named for", () => {
  const withText = (text: string) =>
    runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { text })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );

  it("catches mojibake", () => {
    const c = byKey(withText("We repair the cityâ€™s commercial roofs."), "mojibake");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toContain("â€™");
  });

  it("catches lorem ipsum", () => {
    expect(byKey(withText("Lorem ipsum dolor sit amet."), "lorem")?.status).toBe("fail");
  });

  it("catches an unrendered template expression", () => {
    expect(byKey(withText("Call {{ business.phone }} today."), "template-leakage")?.status).toBe(
      "fail",
    );
  });

  it("does not flag the word null in honest prose", () => {
    // `null` and `undefined` are English. Flagging them would fail a page for
    // writing well, which is why only syntax is matched.
    expect(
      byKey(withText("We could not reject the null hypothesis."), "template-leakage")?.status,
    ).toBe("pass");
  });

  it("catches a javascript: no-op link", () => {
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            anchors: [{ href: "javascript:void(0)", text: "Book now", rel: "" }],
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "dead-links")?.status).toBe("fail");
  });

  it("does not flag a bare # link, which is how good disclosures are written", () => {
    const checks = runSiteChecks(
      exemplary({
        pages: [page("https://acme.example/", { anchors: [{ href: "#", text: "Menu", rel: "" }] })],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "dead-links")?.status).toBe("pass");
  });

  it("does not flag internal links on a site that itself lives at a dev-looking host", () => {
    // Found by building the report fixture, which is deliberately on a `.test`
    // domain so nothing can be mistaken for a client: every internal link fired.
    // A site served from `.local` or `.test` is not a site full of stray
    // staging links, and the same bug would have hit any client running an
    // internal tool.
    const checks = runSiteChecks(
      exemplary({
        origin: "https://acme.test",
        pages: [
          {
            url: "https://acme.test/",
            status: 200,
            raw: null,
            rendered: extract({
              anchors: [{ href: "https://acme.test/about", text: "About", rel: "" }],
            }),
            error: null,
          },
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "staging-links")?.status).toBe("pass");
  });

  it("catches a staging link", () => {
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            anchors: [{ href: "http://localhost:3000/about", text: "About", rel: "" }],
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "staging-links")?.status).toBe("fail");
  });

  it("catches an unedited social placeholder but not a real profile", () => {
    const fired = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            anchors: [{ href: "https://twitter.com/yourhandle", text: "Twitter", rel: "" }],
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(fired, "social-placeholders")?.status).toBe("fail");
    // The exemplary fixture links a real Facebook page and must stay green.
    expect(
      byKey(runSiteChecks(exemplary(), exemplaryChecks(), "Acme Roofing"), "social-placeholders")
        ?.status,
    ).toBe("pass");
  });

  it("catches an undialable tel: link", () => {
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            anchors: [{ href: "tel:call-us-today", text: "Call", rel: "" }],
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "tel-dialable")?.status).toBe("fail");
  });

  it("tolerates one vague link but not a page built of them", () => {
    const vague = (n: number) =>
      runSiteChecks(
        exemplary({
          pages: [
            page("https://acme.example/", {
              anchors: Array.from({ length: n }, (_, i) => ({
                href: `/post-${i}`,
                text: "Read more",
                rel: "",
              })),
            }),
          ],
        }),
        exemplaryChecks(),
        "Acme Roofing",
      );
    // A blog index with a few "read more"s is ordinary writing, not a finding.
    expect(byKey(vague(3), "link-text")?.status).toBe("pass");
    expect(byKey(vague(20), "link-text")?.status).toBe("fail");
  });

  it("catches a menu item that leads somewhere different on another page", () => {
    const drift: CrawlResult = exemplary({
      pages: [
        page("https://acme.example/", {
          anchors: [{ href: "/contact", text: "Contact", rel: "" }],
        }),
        page("https://acme.example/services", {
          anchors: [{ href: "/contact-us", text: "Contact", rel: "" }],
        }),
      ],
    });
    expect(
      byKey(runSiteChecks(drift, exemplaryChecks(), "Acme Roofing"), "nav-consistency")?.status,
    ).toBe("fail");
  });

  it("does not read a mega-menu as a menu that disagrees with itself", () => {
    // apple.com's word "Mac" links to /mac/, to two shop pages and to a support
    // page — the SAME four destinations on all twenty pages. The old rule
    // unioned the targets, counted four, and reported 18 menu items as leading
    // somewhere different depending on the page.
    const megaMenu = ["/mac/", "/shop/buy-mac", "/shop/mac-accessories", "/support/mac"].map(
      (href) => ({ href, text: "Mac", rel: "" }),
    );
    const same: CrawlResult = exemplary({
      pages: [
        page("https://acme.example/", { anchors: megaMenu }),
        page("https://acme.example/services", { anchors: megaMenu }),
      ],
    });
    const c = byKey(runSiteChecks(same, exemplaryChecks(), "Acme Roofing"), "nav-consistency");
    expect(c?.status).toBe("pass");
  });

  it("still catches drift when one page shares NO destination with another", () => {
    // The same four links, except this page's "Mac" reaches none of the four
    // the other page reaches. That is the finding the union rule was reaching
    // for and the intersection rule keeps.
    const drift: CrawlResult = exemplary({
      pages: [
        page("https://acme.example/", {
          anchors: [
            { href: "/mac/", text: "Mac", rel: "" },
            { href: "/shop/buy-mac", text: "Mac", rel: "" },
          ],
        }),
        page("https://acme.example/services", {
          anchors: [{ href: "/computers/apple", text: "Mac", rel: "" }],
        }),
      ],
    });
    expect(
      byKey(runSiteChecks(drift, exemplaryChecks(), "Acme Roofing"), "nav-consistency")?.status,
    ).toBe("fail");
  });

  it("reads the aria-label, not the visible text, when a link has one", () => {
    // Every "Learn more" on apple.com is written
    // `aria-label="Learn more about accessibility"` around a span reading
    // "Learn more". Sixty labelled links were reported as bare.
    const labelled = Array.from({ length: 20 }, (_, i) => ({
      href: `/post-${i}`,
      text: "Read more",
      rel: "",
      ariaLabel: `Read more about roof repair ${i}`,
    }));
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { anchors: labelled })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "link-text")?.status).toBe("pass");
  });

  it("counts a link whose aria-label is ALSO vague", () => {
    const bare = Array.from({ length: 20 }, (_, i) => ({
      href: `/post-${i}`,
      text: "A perfectly good label",
      rel: "",
      ariaLabel: "Read more",
    }));
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { anchors: bare })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    // The point is the destination, not which attribute carries it.
    expect(byKey(checks, "link-text")?.status).toBe("fail");
  });

  it("cannot judge link text on a report stored before aria-labels were captured", () => {
    // Built past `page()`, which fills the attribute in — the whole point here
    // is an extract that predates it. Absent is our gap, and must never read as
    // "this link has no label".
    const stored = page("https://acme.example/");
    const rendered = {
      ...stored.rendered!,
      anchors: [{ href: "/x", text: "Read more", rel: "", target: "" }],
    };
    const old = runSiteChecks(
      exemplary({ pages: [{ ...stored, rendered }] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(old, "link-text")?.status).toBe("unmeasured");
  });

  it("names the true link total beside the capped one", () => {
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            anchors: [{ href: "/x", text: "Our services", rel: "", ariaLabel: "" }],
            anchorCount: 4000,
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    // Printing "all 1 links we read" as if 1 were the site's link count is the
    // capped-list mistake this codebase keeps having to fix.
    expect(byKey(checks, "link-text")?.evidence).toContain("4000");
  });

  it("folds query-string deep-links into the page they declare themselves to be", () => {
    // apple.com handed us /accessibility/features/ five times — ?vision,
    // ?hearing, ?speech, ?cognitive and bare — each declaring the bare URL
    // canonical. Compared as five pages they read as five sharing a headline
    // and five sharing a description. They are one page.
    const tabs = ["", "?vision", "?hearing", "?speech", "?cognitive"].map((q) =>
      page(`https://acme.example/services${q}`, {
        canonical: "https://acme.example/services",
        title: "Roof repair services — Acme Roofing",
        metaDescription: "What we repair, how long it takes, and what a commercial roof job costs.",
        headings: [{ level: 1, text: "What we repair" }],
      }),
    );
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/"), ...tabs] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "h1-distinct")?.status).toBe("pass");
    expect(byKey(checks, "duplicate-descriptions")?.status).toBe("pass");
  });

  it("still catches two genuinely different pages sharing a headline", () => {
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/services", { headings: [{ level: 1, text: "Our work" }] }),
          page("https://acme.example/about", { headings: [{ level: 1, text: "Our work" }] }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "h1-distinct")?.status).toBe("fail");
  });

  it("does not fail three duplicates for correctly naming the page they duplicate", () => {
    // apple.com serves one comparison page at /airpods-4/compare/,
    // /airpods-max/compare/ and /airpods-pro/compare/, all three naming
    // /airpods/compare/ canonical and all three headlined the same. That is
    // what a canonical is FOR, and we failed it for doing the right thing.
    const dup = (path: string) =>
      page(`https://acme.example/${path}`, {
        canonical: "https://acme.example/compare",
        headings: [{ level: 1, text: "Compare our roof systems" }],
      });
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/"),
          page("https://acme.example/services", {
            headings: [{ level: 1, text: "What we repair" }],
          }),
          dup("flat/compare"),
          dup("metal/compare"),
          dup("tile/compare"),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "canonical-self")?.status).toBe("pass");
  });

  it("catches a canonical that contradicts the page it names", () => {
    // We read both pages, and they carry different headlines. This page has
    // told search engines to index something it is not.
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", { headings: [{ level: 1, text: "Roof repair in Boise" }] }),
          page("https://acme.example/services", {
            canonical: "https://acme.example/",
            headings: [{ level: 1, text: "What we repair" }],
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    const c = byKey(checks, "canonical-self");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toContain("different headlines");
  });

  it("catches pages that name one target and disagree on their own headlines", () => {
    // Three different pages cannot all be duplicates of one page — and this
    // needs no access to the target at all, which we never crawled.
    const checks = runSiteChecks(
      exemplary({
        pages: [
          // A self-canonical page, so this is the disagreement rule firing and
          // not the whole-crawl backstop.
          page("https://acme.example/"),
          ...["a", "b", "c"].map((n) =>
            page(`https://acme.example/${n}`, {
              canonical: "https://acme.example/elsewhere",
              headings: [{ level: 1, text: `Page ${n}` }],
            }),
          ),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    const c = byKey(checks, "canonical-self");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toContain("different headlines");
  });

  it("catches a whole crawl naming one address, even with one headline everywhere", () => {
    // The backstop for a template that writes the site name as every h1 AND
    // canonicalises everything to the home page. A site cannot be one page
    // served at every address.
    const checks = runSiteChecks(
      exemplary({
        pages: ["a", "b", "c"].map((n) =>
          page(`https://acme.example/${n}`, {
            canonical: "https://acme.example/",
            headings: [{ level: 1, text: "Acme Roofing" }],
          }),
        ),
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "canonical-self")?.status).toBe("fail");
  });

  it("does not fail a duplicate whose target we never read", () => {
    // A target we never fetched is not evidence either way, and our gap must
    // not become their defect.
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/"),
          page("https://acme.example/services"),
          page("https://acme.example/roofing", { canonical: "https://acme.example/never-crawled" }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "canonical-self")?.status).toBe("pass");
  });

  it("does not ask a page that canonicalises away to name itself in its alternates", () => {
    const ALT = [
      { rel: "alternate", href: "https://acme.example/services", hreflang: "en" },
      { rel: "alternate", href: "https://acme.example/es/servicios", hreflang: "es" },
    ];
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/services", { links: ALT }),
          // A duplicate carrying its canonical's alternate set. Naming ITSELF
          // in there would be the mistake.
          page("https://acme.example/roof-repair", {
            canonical: "https://acme.example/services",
            links: ALT,
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "hreflang-self")?.status).toBe("pass");
  });

  it("does not fail a description that misses the band by two characters", () => {
    // apple.com failed twice at 50-170: a 172-character home page and a
    // 48-character specs page. Truncation is by pixel width; no character count
    // predicts it, so a tight band manufactures findings.
    const of = (n: number) => "a".repeat(n);
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", { metaDescription: of(172) }),
          page("https://acme.example/services", { metaDescription: of(48) }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "description-length")?.status).toBe("pass");

    // A stub and a wall of text are still findings — that is what the band is for.
    for (const n of [12, 400]) {
      const bad = runSiteChecks(
        exemplary({ pages: [page("https://acme.example/", { metaDescription: of(n) })] }),
        exemplaryChecks(),
        "Acme Roofing",
      );
      expect(byKey(bad, "description-length")?.status).toBe("fail");
    }
  });

  it("records a missing llms.txt without counting it against the site", () => {
    // `checks.ts` already took llms.txt out of the Findability score because no
    // answer engine has published that it reads one. A red row is a grade-down,
    // so leaving it failing here contradicted a decision already made.
    const checks = runSiteChecks(
      exemplary({ llmsTxt: { present: false, firstLine: null } }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "llms-txt")?.status).toBe("not-applicable");
    expect(byKey(checks, "llms-txt")?.why).not.toMatch(/the one file/i);
    // Having one is still worth saying.
    expect(byKey(runSiteChecks(exemplary(), exemplaryChecks(), "Acme"), "llms-txt")?.status).toBe(
      "pass",
    );
  });

  it("does not pass a permissions-policy whose every directive is a wildcard", () => {
    // Measured in a browser: `geolocation=*` behaves identically to sending no
    // header at all. A check a site can green with a no-op is not a check.
    const withHeader = (v: string) =>
      byKey(
        runSiteChecks(
          exemplary({ homeHeaders: { ...HEADERS, "permissions-policy": v } }),
          exemplaryChecks(),
          "Acme Roofing",
        ),
        "header-permissions-policy",
      );
    expect(withHeader("camera=*, geolocation=*")?.status).toBe("fail");
    expect(withHeader("camera=(), geolocation=*")?.status).toBe("pass");
    expect(withHeader("camera=(self)")?.status).toBe("pass");
  });

  it("says what permissions-policy actually does, not what browsers already do", () => {
    const c = byKey(
      runSiteChecks(exemplary(), exemplaryChecks(), "Acme"),
      "header-permissions-policy",
    );
    // A cross-origin iframe is refused camera and geolocation with no header
    // set at all, and granted them the moment the SITE writes allow= on the
    // iframe. Nothing about it is quiet, and claiming otherwise is the shape of
    // overstatement that discredits every other line.
    expect(c?.why).not.toMatch(/quietly|embedded third party/i);
  });

  it("fails only the two referrer policies that leak more than sending nothing", () => {
    const rp = (v: string | null) => {
      const headers = { ...HEADERS };
      if (v === null) delete headers["referrer-policy"];
      else headers["referrer-policy"] = v;
      return byKey(
        runSiteChecks(exemplary({ homeHeaders: headers }), exemplaryChecks(), "Acme Roofing"),
        "header-referrer-policy",
      );
    };
    // Measured, from a page at /some/deep/path?secret=token123:
    //   no header / strict-origin-when-cross-origin  ->  Referer: http://host/
    //   unsafe-url / no-referrer-when-downgrade      ->  the whole address
    expect(rp("unsafe-url")?.status).toBe("fail");
    expect(rp("no-referrer-when-downgrade")?.status).toBe("fail");
    expect(rp("strict-origin-when-cross-origin")?.status).toBe("pass");
    expect(rp("no-referrer")?.status).toBe("pass");
    // Absent is neither: the site did nothing, and the browser's own default
    // does not leak the address. Blaming them for it would be as wrong as
    // crediting them for it.
    expect(rp(null)?.status).toBe("not-applicable");
    // A list: the browser takes the last value it understands.
    expect(rp("no-referrer, unsafe-url")?.status).toBe("fail");
    expect(rp("unsafe-url, strict-origin-when-cross-origin")?.status).toBe("pass");
  });

  it("does not say a form is unguarded when we watched it refuse an empty submit", () => {
    // viget.com's contact form is marked method="get" with nothing required —
    // and we pressed its button and watched it paint an error instead of
    // submitting. Publishing "the browser cannot stop a half-filled form" in
    // the same report as "the form showed an error rather than submitting" is
    // two answers to one question, and the probe already settled it.
    const crawl = exemplary({
      pages: [
        {
          ...page("https://acme.example/contact", {
            forms: [
              {
                kind: "enquiry",
                action: null,
                method: "get",
                fieldCount: 3,
                hasContactField: true,
                hasSubmit: true,
                fields: [
                  { type: "email", name: "email", autocomplete: "email", required: false },
                  { type: "tel", name: "phone", autocomplete: "tel", required: false },
                  { type: "textarea", name: "message", autocomplete: null, required: false },
                ],
              },
            ],
          }),
          formProbe: {
            url: "https://acme.example/contact",
            emptyRefused: true,
            emptyHow: "the form showed an error rather than submitting",
            invalidEmailRefused: true,
            invalidEmailHow: "the form showed an error rather than submitting",
            blocked: 0,
          },
        },
      ],
    });
    const checks = runSiteChecks(crawl, exemplaryChecks(), "Acme Roofing");
    expect(byKey(checks, "form-required")?.status).toBe("not-applicable");
    expect(byKey(checks, "form-required")?.evidence).toContain("its script does the checking");
    expect(byKey(checks, "form-method")?.status).toBe("not-applicable");
    // The lints that hold whatever submits the form are untouched.
    expect(byKey(checks, "form-field-types")?.status).toBe("pass");
  });

  it("still fails a bare GET form when no probe watched it", () => {
    // Markup is a prediction. Without an observation to overrule it, it stands.
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/contact", {
            forms: [
              {
                kind: "enquiry",
                action: null,
                method: "get",
                fieldCount: 2,
                hasContactField: true,
                hasSubmit: true,
                fields: [
                  { type: "email", name: "email", autocomplete: "email", required: false },
                  { type: "textarea", name: "message", autocomplete: null, required: false },
                ],
              },
            ],
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "form-required")?.status).toBe("fail");
    expect(byKey(checks, "form-method")?.status).toBe("fail");
  });

  it("will not claim a sitemap gap it did not finish reading", () => {
    // viget.com publishes a sitemap INDEX with 35 children holding 1,636 URLs.
    // We followed the first few, counted 66, and reported that 179 of their own
    // pages were missing from their sitemap. Every number in that sentence was
    // ours.
    const truncated = runSiteChecks(
      exemplary({ sitemap: { present: true, urlCount: 66, sample: [], truncated: true } }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(truncated, "sitemap-coverage")?.status).toBe("unmeasured");

    // Absent means the run predates the field, which is "we do not know" and
    // not "we read the whole thing".
    const older = runSiteChecks(
      exemplary({ sitemap: { present: true, urlCount: 66, sample: [] } }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(older, "sitemap-coverage")?.status).toBe("unmeasured");
  });

  it("catches a page with no h1 and a page with three", () => {
    const none = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { headings: [] })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(none, "single-h1")?.status).toBe("fail");

    const three = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            headings: [1, 1, 1].map((level, i) => ({ level, text: `Heading ${i}` })),
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(three, "single-h1")?.status).toBe("fail");
  });

  it("catches each security header individually", () => {
    const { "x-frame-options": _dropped, ...rest } = HEADERS;
    const checks = runSiteChecks(
      exemplary({ homeHeaders: rest }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "header-x-frame-options")?.status).toBe("fail");
    // And only that one — the value of splitting the aggregate is that five
    // stay green and name themselves.
    expect(byKey(checks, "header-content-security-policy")?.status).toBe("pass");
  });

  it("catches a version number in the server header", () => {
    const checks = runSiteChecks(
      exemplary({ homeHeaders: { ...HEADERS, server: "nginx/1.18.0" } }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "header-version-leak")?.status).toBe("fail");
  });

  it("catches a blanket Disallow but not a rule aimed at one crawler", () => {
    const blocked = runSiteChecks(
      exemplary({ robotsTxt: "User-agent: *\nDisallow: /" }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(blocked, "robots-not-blocking")?.status).toBe("fail");

    // A policy about one bot is a decision, not an accident.
    const targeted = runSiteChecks(
      exemplary({ robotsTxt: "User-agent: SemrushBot\nDisallow: /\n\nUser-agent: *\nAllow: /" }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(targeted, "robots-not-blocking")?.status).toBe("pass");
  });

  it("catches schema pointing at a domain they no longer use", () => {
    const old = JSON.stringify({
      "@type": "Organization",
      name: "Acme Roofing",
      url: "https://old-acme-roofing.example",
      logo: "https://acme.example/logo.png",
    });
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { jsonLd: [old] })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "schema-url-matches")?.status).toBe("fail");
  });

  it("catches a schema phone that is not the one on the page", () => {
    const wrong = JSON.stringify({
      "@type": "Organization",
      name: "Acme Roofing",
      url: "https://acme.example",
      logo: "/logo.png",
      telephone: "(208) 555-9999",
    });
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { jsonLd: [wrong] })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "schema-phone-matches")?.status).toBe("fail");
  });

  it("will not call a large all-first-party site analytics-free", () => {
    // apple.com: 47 scripts, every one its own, telemetry inside the bundle.
    // Markup cannot see it, so we do not get to call it absent.
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            scriptSrcs: Array.from({ length: 12 }, (_, i) => `/ac/built/${i}.js`),
            inlineScriptUrls: [],
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "analytics")?.status).toBe("unmeasured");
  });

  it("catches a site with no analytics at all", () => {
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { scriptSrcs: ["/js/main.js"] })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "analytics")?.status).toBe("fail");
  });

  it("reports a sitemap thinner than the site's own linking", () => {
    const checks = runSiteChecks(
      exemplary({
        sitemap: { present: true, urlCount: 1, truncated: false },
        pages: [
          page("https://acme.example/", {
            anchors: ["/a", "/b", "/c", "/d"].map((href) => ({ href, text: href, rel: "" })),
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "sitemap-coverage")?.status).toBe("fail");
  });
});

describe("Tier 1 — each check fires on the thing it is named for", () => {
  const one = (over: Partial<PageExtract>) =>
    runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", over)] }),
      exemplaryChecks(),
      "Acme Roofing",
    );

  it("catches the noindex a staging site leaves behind", () => {
    // The highest-value check in the battery: nothing on the page looks wrong,
    // the owner cannot see it, and it removes them from search entirely.
    const c = byKey(
      one({ metas: { charset: "utf-8", robots: "noindex, nofollow" } }),
      "meta-noindex",
    );
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toContain("noindex");
  });

  it("does not read an ordinary robots meta as noindex", () => {
    expect(
      byKey(
        one({ metas: { charset: "utf-8", robots: "index, follow, max-snippet:-1" } }),
        "meta-noindex",
      )?.status,
    ).toBe("pass");
  });

  it("catches a missing charset, which is what turns apostrophes into mojibake", () => {
    expect(byKey(one({ metas: {} }), "meta-charset")?.status).toBe("fail");
  });

  it("catches every page pointing its canonical at the home page", () => {
    // The headlines are what make these two DIFFERENT pages. Two addresses
    // serving one page, with one headline between them, is a duplicate handled
    // properly — and is tested for separately.
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", { headings: [{ level: 1, text: "Roof repair in Boise" }] }),
          page("https://acme.example/services", {
            canonical: "https://acme.example/",
            headings: [{ level: 1, text: "What we repair" }],
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "canonical-self")?.status).toBe("fail");
  });

  it("forgives a trailing slash and a www, which are not what that check is about", () => {
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/services", {
            canonical: "https://www.acme.example/services/",
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "canonical-self")?.status).toBe("pass");
  });

  it("catches a canonical left pointing at a staging host", () => {
    const checks = one({ canonical: "https://acme.staging.example/" });
    expect(byKey(checks, "canonical-origin")?.status).toBe("fail");
  });

  it("catches a missing favicon", () => {
    expect(
      byKey(
        one({ links: [{ rel: "canonical", href: "https://acme.example/" }] }),
        "favicon-declared",
      )?.status,
    ).toBe("fail");
  });

  it("catches a relative og:image, which renders no card anywhere", () => {
    expect(byKey(one({ social: { "og:image": "/og.jpg" } }), "og-image-absolute")?.status).toBe(
      "fail",
    );
  });

  it("skips the og:image check entirely when there is no og:image", () => {
    // Not a failure — this site declares no share image, which the meta section
    // already reports. Two headings for one gap reads as two problems.
    expect(byKey(one({ social: {} }), "og-image-absolute")?.status).toBe("not-applicable");
  });

  it("tolerates a long title but not an absurd one", () => {
    expect(
      byKey(one({ title: "Acme Roofing — Commercial Roof Repair in Boise, Idaho" }), "title-length")
        ?.status,
    ).toBe("pass");
    expect(byKey(one({ title: "A".repeat(120) }), "title-length")?.status).toBe("fail");
  });

  it("catches the same description repeated on every page", () => {
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/"),
          page("https://acme.example/services", { canonical: "https://acme.example/services" }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    // Both pages inherit the base description in this fixture.
    expect(byKey(checks, "duplicate-descriptions")?.status).toBe("fail");
  });

  it("catches an email field a phone keyboard cannot help with", () => {
    const checks = one({
      forms: [
        {
          kind: "enquiry",
          action: "/enquiry",
          method: "post",
          fieldCount: 2,
          hasContactField: true,
          hasSubmit: true,
          fields: [
            { type: "text", name: "email", autocomplete: "email", required: true },
            { type: "textarea", name: "message", autocomplete: null, required: true },
          ],
        },
      ],
    });
    const c = byKey(checks, "form-field-types");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toContain('type="text"');
  });

  it("catches an enquiry form that submits with GET", () => {
    const checks = one({
      forms: [
        {
          kind: "enquiry",
          action: "/enquiry",
          method: "get",
          fieldCount: 2,
          hasContactField: true,
          hasSubmit: true,
          fields: [{ type: "email", name: "email", autocomplete: "email", required: true }],
        },
      ],
    });
    expect(byKey(checks, "form-method")?.status).toBe("fail");
  });

  it("calls an unrecognised third-party form endpoint unmeasured, never broken", () => {
    // Our provider list will always be incomplete. Reporting a working in-house
    // endpoint as broken is the false alarm that costs a prospect's trust in
    // every other line of the report.
    const checks = one({
      forms: [
        {
          kind: "enquiry",
          action: "https://forms.some-agency.example/submit/abc",
          method: "post",
          fieldCount: 2,
          hasContactField: true,
          hasSubmit: true,
          fields: [{ type: "email", name: "email", autocomplete: "email", required: true }],
        },
      ],
    });
    expect(byKey(checks, "form-action")?.status).toBe("unmeasured");
  });

  it("recognises a known provider and passes it", () => {
    const checks = one({
      forms: [
        {
          kind: "enquiry",
          action: "https://formspree.io/f/xyzabc",
          method: "post",
          fieldCount: 2,
          hasContactField: true,
          hasSubmit: true,
          fields: [{ type: "email", name: "email", autocomplete: "email", required: true }],
        },
      ],
    });
    expect(byKey(checks, "form-action")?.status).toBe("pass");
  });

  it("skips hreflang on a monolingual site rather than passing it", () => {
    expect(byKey(one({}), "hreflang-self")?.status).toBe("not-applicable");
  });

  it("catches an hreflang set that does not name itself", () => {
    const checks = one({
      links: [
        { rel: "icon", href: "/favicon.ico" },
        { rel: "canonical", href: "https://acme.example/" },
        { rel: "alternate", href: "https://acme.example/es/", hreflang: "es" },
      ],
    });
    expect(byKey(checks, "hreflang-self")?.status).toBe("fail");
  });
});

describe("Tier 3 — what the browser itself reported", () => {
  const withVitals = (v: Partial<NonNullable<PageCapture["vitals"]>>) =>
    runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", {}, { ...CLEAN_VITALS, ...v })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );

  it("catches a JavaScript error, which no amount of markup reading can reach", () => {
    const c = byKey(
      withVitals({ consoleErrors: ["TypeError: n.slice is not a function"] }),
      "console-errors",
    );
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toContain("TypeError");
  });

  it("catches a page that scrolls sideways on a phone", () => {
    const c = byKey(withVitals({ overflowAt375: 84 }), "mobile-overflow");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toContain("84px");
  });

  it("forgives a few pixels, which is a scrollbar and not a layout bug", () => {
    expect(byKey(withVitals({ overflowAt375: 3 }), "mobile-overflow")?.status).toBe("pass");
  });

  it("blames the site for its own broken file", () => {
    const c = byKey(
      withVitals({
        failedRequests: [
          { url: "https://acme.example/css/main.css", status: 404, firstParty: true },
        ],
      }),
      "failed-requests",
    );
    expect(c?.status).toBe("fail");
  });

  it("does not blame the site for a third party that failed", () => {
    // An ad blocker, our network, or somebody else's outage. Reporting it as
    // their broken site is the exact error this codebase exists to avoid.
    const c = byKey(
      withVitals({
        failedRequests: [
          {
            url: "https://connect.facebook.net/en_US/fbevents.js",
            status: null,
            firstParty: false,
          },
        ],
      }),
      "failed-requests",
    );
    expect(c?.status).toBe("pass");
  });

  it("catches text too small to read", () => {
    const c = byKey(
      withVitals({ tinyText: { count: 6, sample: "Terms and conditions apply" } }),
      "tiny-text",
    );
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toContain("Terms and conditions");
  });

  it("catches an image downloaded far larger than it is drawn", () => {
    const c = byKey(
      withVitals({
        oversizedImages: [
          { src: "https://acme.example/hero.jpg", naturalWidth: 4000, renderedWidth: 600 },
        ],
      }),
      "oversized-images",
    );
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toContain("4000px");
  });

  it("is unmeasured on a report stored before the browser recorded any of this", () => {
    // Not "nothing went wrong" — the opposite claim, and the one that would
    // matter most to get wrong.
    const stored = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", {}, null)] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    for (const key of TIER3_CHECK_KEYS) {
      expect(byKey(stored, key)?.status, key).toBe("unmeasured");
    }
  });
});

/**
 * Five faults the stored corpus found when the current battery was re-scored
 * over 29 sites we had already crawled (see `scripts/replay-checks.mts`).
 *
 * Every one of them accused a site of something it had not done, which is the
 * only bug shape in this report that costs anything: a missed finding is a
 * missed sale, and an invented one is a stranger reading a confident sentence
 * about their site that is false. Each test below is the exact shape the corpus
 * produced, not a contrived one.
 */
describe("faults the stored corpus found", () => {
  it("reads a logo published as an ImageObject, which is how SEO plugins emit it", () => {
    // NINE of the fifteen sites we reported as "missing logo" published this.
    const asObject = JSON.stringify({
      "@type": "Organization",
      name: "Acme Roofing",
      url: "https://acme.example",
      logo: { "@type": "ImageObject", url: "https://acme.example/logo.png" },
    });
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { jsonLd: [asObject] })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "schema-org-complete")?.status).toBe("pass");
  });

  it("follows a logo declared as an @id reference into the node it names", () => {
    const graph = JSON.stringify({
      "@graph": [
        {
          "@type": "Organization",
          name: "Acme Roofing",
          url: "https://acme.example",
          logo: { "@id": "https://acme.example/#logo" },
        },
        {
          "@type": "ImageObject",
          "@id": "https://acme.example/#logo",
          url: "https://acme.example/logo.png",
        },
      ],
    });
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { jsonLd: [graph] })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "schema-org-complete")?.status).toBe("pass");
  });

  it("still fails an @id that names a node the page never declares", () => {
    const dangling = JSON.stringify({
      "@type": "Organization",
      name: "Acme Roofing",
      url: "https://acme.example",
      logo: { "@id": "https://acme.example/#nowhere" },
    });
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { jsonLd: [dangling] })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "schema-org-complete")?.status).toBe("fail");
    expect(byKey(checks, "schema-org-complete")?.evidence).toContain("logo");
  });

  it("resolves a relative schema url against the page it was declared on", () => {
    // airstrip.com publishes exactly this and we told them it pointed nowhere.
    const relative = JSON.stringify({
      "@type": "Organization",
      name: "Acme Roofing",
      url: "/",
      logo: "https://acme.example/logo.png",
    });
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { jsonLd: [relative] })] }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "schema-url-matches")?.status).toBe("pass");
    // The resolved address, not the "/" — printing the raw declaration back at
    // someone who passed reads as a bug in the report.
    expect(byKey(checks, "schema-url-matches")?.evidence).toContain("acme.example");
  });

  it("does not read ordinary copy about the future as an unfinished site", () => {
    // Both of these were real fails: a working careers page, and a locations
    // list announcing a new store.
    const prose = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            text: "Our list of open positions changes, so check back soon. Boise, ID (Coming Soon)",
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(prose, "under-construction")?.status).toBe("pass");
  });

  it("still catches a page whose own headline says it is unfinished", () => {
    const headline = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/gallery", {
            headings: [{ level: 1, text: "Coming soon" }],
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(headline, "under-construction")?.status).toBe("fail");
    expect(byKey(headline, "under-construction")?.evidence).toContain("Coming soon");
  });

  it("accepts a title that names the business but drops the category words", () => {
    // "Worthe Real Estate Group" vs "Worthe — Over 7,000,000 SF of properties in
    // the Los Angeles area". A good title, scored a fail.
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            title: "Acme — Commercial roof repair across the Treasure Valley",
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing Group LLC",
    );
    expect(byKey(checks, "name-in-title")?.status).toBe("pass");
  });

  it("skips a leading article when taking the distinctive word of a name", () => {
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { title: "The Pointe" })] }),
      exemplaryChecks(),
      "The Pointe Burbank",
    );
    expect(byKey(checks, "name-in-title")?.status).toBe("pass");
  });

  it("still fails a title that never names the business at all", () => {
    const checks = runSiteChecks(
      exemplary({ pages: [page("https://acme.example/", { title: "Your Thermistor Experts" })] }),
      exemplaryChecks(),
      "QTI Sensing Solutions",
    );
    expect(byKey(checks, "name-in-title")?.status).toBe("fail");
  });

  it("does not call an outbound http link a lapse in the site's own security", () => {
    // Three of four fails were `http://www.facebook.com/…` and the like.
    // Following one navigates AWAY; the padlock on the page they left is
    // untouched, and the destination redirects to https anyway.
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            anchors: [
              {
                href: "http://www.facebook.com/acmeroofing",
                text: "Facebook",
                rel: "",
                target: "",
              },
              { href: "http://www.chamberofcommerce.org/", text: "Chamber", rel: "", target: "" },
            ],
            anchorCount: 2,
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "insecure-links")?.status).toBe("pass");
  });

  it("still catches a link back to the site's own http address", () => {
    const checks = runSiteChecks(
      exemplary({
        pages: [
          page("https://acme.example/", {
            anchors: [
              { href: "http://www.acme.example/services", text: "Services", rel: "", target: "" },
            ],
            anchorCount: 1,
          }),
        ],
      }),
      exemplaryChecks(),
      "Acme Roofing",
    );
    expect(byKey(checks, "insecure-links")?.status).toBe("fail");
    expect(byKey(checks, "insecure-links")?.evidence).toContain("acme.example/services");
  });
});
