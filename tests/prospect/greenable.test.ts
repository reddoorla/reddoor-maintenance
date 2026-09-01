import { describe, expect, it } from "vitest";
import { checkGoal, type SiteGoal } from "../../src/prospect/goals.js";
import type {
  ChecksResult,
  CrawlResult,
  FormShape,
  PageAnchor,
  PageCapture,
  PageExtract,
} from "../../src/prospect/types.js";

/**
 * Every check must be able to come back clean.
 *
 * A check that no real site can pass is not a measurement, it is a complaint —
 * and a report full of them reads as a sales document rather than an audit,
 * which is the one thing this product cannot afford to be. If a site does the
 * thing properly, the check has to say so.
 *
 * So this is the mirror of the decoy corpus in goals.test.ts. That one asserts
 * nothing fires on a site that answers nothing; this one asserts EVERYTHING
 * fires on a site that answers everything. A check that fails here is either
 * broken or unreasonable, and both are bugs.
 *
 * The fixture below is deliberately an ordinary good site, not a contrived one:
 * plain sentences a real business would write, in the words it would use. If a
 * check needs something stranger than this to go green, the bar is in the wrong
 * place and the fixture is the wrong thing to change.
 */

const EXEMPLARY_TEXT = [
  // Booking, hours, address
  "Book online any time, or call us on (310) 555-0142.",
  "We are open Mon - Fri 8:00 am to 5:00 pm, and Saturday mornings by appointment.",
  "Our office is at 1820 Catalina Avenue, Redondo Beach, California.",
  "Free parking is available behind the building, and the bus stop is one block north.",
  // Availability
  "We are currently accepting new patients, and most first appointments are within a week.",
  // Price and what to expect
  "Treatment plans start at $250, and we publish our full price list before you book.",
  "Your first consultation is free and carries no obligation — here is what to expect.",
  // Commerce
  "Shipping is free on orders over $75 and our returns policy runs 30 days.",
  // Partnership
  "Become a partner: we work with distributors across three territories.",
  "Our dealer requirements are a minimum order of 50 units and a qualification criteria review.",
].join(" ");

function extract(over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: "An exemplary page",
    metaDescription: "Everything a visitor needs.",
    canonical: null,
    social: {},
    headings: [],
    jsonLd: [],
    images: { total: 4, withAlt: 4 },
    hasViewportMeta: true,
    text: "",
    ...over,
  };
}

const ANCHORS: PageAnchor[] = [
  { href: "https://www.zocdoc.com/practice/exemplary", text: "Book online", rel: "" },
  { href: "https://maps.app.goo.gl/exemplary", text: "Directions", rel: "" },
  { href: "tel:+13105550142", text: "Call us", rel: "" },
];

const FORMS: FormShape[] = [
  {
    kind: "enquiry",
    action: "/enquiry",
    method: "post",
    fieldCount: 7,
    hasContactField: true,
    hasSubmit: true,
  },
];

function exemplarySite(): CrawlResult {
  const home: PageCapture = {
    url: "https://exemplary.example/",
    status: 200,
    raw: extract({ text: EXEMPLARY_TEXT, anchors: ANCHORS, forms: FORMS }),
    rendered: null,
    error: null,
  };
  return {
    origin: "https://exemplary.example",
    robotsTxt: "User-agent: *\nAllow: /",
    agentAccess: [],
    sitemap: { present: true, urlCount: 12 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: [home],
  };
}

function exemplaryChecks(): ChecksResult {
  return {
    crawlerAccessMeasured: true,
    crawlerAccess: { blockedAi: [], allowedAi: ["GPTBot"], blockedClassical: [] },
    jsDependence: { avgMissing: 0, perPage: [] },
    schema: {
      typesFound: ["LocalBusiness", "openingHoursSpecification", "PostalAddress"],
      missingExpected: [],
      invalidBlocks: 0,
    },
    meta: {
      pageCount: 1,
      missingTitle: 0,
      missingDescription: 0,
      missingCanonical: 0,
      missingSocial: 0,
      pagesWithoutExtract: 0,
    },
    headings: { pagesWithoutH1: 0, pagesWithLevelSkips: 0 },
    securityHeaders: { present: ["content-security-policy"], missing: [] },
    sitemapMeasured: true,
    sitemapPresent: true,
    llmsTxtMeasured: true,
    llmsTxtPresent: false,
    viewportOk: true,
    consistency: {
      phones: [
        {
          normalized: "3105550142",
          seenAs: ["(310) 555-0142"],
          pages: ["https://exemplary.example/"],
          linked: true,
        },
      ],
      emails: [],
      copyrightYears: [],
      newestCopyrightYear: null,
      pagesOffTemplate: [],
      sharedNavLinks: 6,
      pagesExamined: 1,
    },
    journey: {
      affordances: [
        { kind: "tel", page: "https://exemplary.example/", detail: "+13105550142" },
        { kind: "form", page: "https://exemplary.example/", detail: "/enquiry" },
      ],
      pages: [{ url: "https://exemplary.example/", clicksToContact: 1, internalLinks: 6 }],
      deadEnds: [],
      worstClicksToContact: 1,
      pagesExamined: 1,
      // We recorded this site's links, so an empty `deadEnds` is a measurement
      // rather than an absence. Without this the honest verdict is "not
      // measured", and the exemplary site could not go green at all.
      anchorsMeasured: true,
    },
  };
}

const GOALS: SiteGoal[] = ["book", "enquire", "call", "visit", "buy", "demo", "partner"];

describe("a site that does everything right scores clean", () => {
  it.each(GOALS)("every %s requirement is met", (goal) => {
    const fit = checkGoal(goal, "operator", exemplarySite(), exemplaryChecks());

    const notMet = fit.requirements
      .filter((r) => r.status !== "met")
      .map((r) => `${r.key} (${r.status}) — ${r.label}`);

    expect(notMet, `a check no good site can pass is a complaint, not a measurement`).toEqual([]);
    expect(fit.met).toBe(fit.total);
    expect(fit.total).toBeGreaterThan(0);
  });

  it("says so plainly rather than finding something to say", () => {
    const fit = checkGoal("book", "operator", exemplarySite(), exemplaryChecks());
    expect(fit.requirements.every((r) => r.evidence !== null)).toBe(true);
  });
});

describe("each answer carries its own check, not the sentence beside it", () => {
  // The fixture is one blob of text, so a check can go green off a neighbouring
  // sentence and nobody notices. That is how the price check hid a real recall
  // gap: "Treatment plans start at $250" did not match anything, and the line
  // passed only because "we publish our full price list" sat next to it in the
  // same sentence. Each line below therefore stands on its own.
  const ALONE: [SiteGoal, string, string][] = [
    ["enquire", "price-signal", "Treatment plans start at $250."],
    ["visit", "getting-there", "Free parking is available behind the building."],
    ["visit", "getting-there", "The bus stop is one block north of the entrance."],
    ["buy", "shipping", "Shipping is free on orders over $75."],
    ["buy", "returns", "Our returns policy runs 30 days."],
    ["call", "what-to-expect", "Your first consultation is free and carries no obligation."],
    ["book", "new-clients", "We are currently accepting new patients."],
    ["partner", "partner-route", "Become a partner: we are signing distributors this year."],
    [
      "partner",
      "requirements",
      "Our dealer requirements are a minimum order of 50 units and a qualification criteria review.",
    ],
  ];

  it.each(ALONE)("%s / %s", (goal, key, sentence) => {
    const page: PageCapture = {
      url: "https://exemplary.example/",
      status: 200,
      raw: extract({ text: sentence, anchors: ANCHORS, forms: FORMS }),
      rendered: null,
      error: null,
    };
    const fit = checkGoal(
      goal,
      "operator",
      { ...exemplarySite(), pages: [page] },
      exemplaryChecks(),
    );
    expect(
      fit.requirements.find((r) => r.key === key)?.status,
      `"${sentence}" has to answer ${key} on its own`,
    ).toBe("met");
  });

  it("finds the address behind the map link a real site would use", () => {
    // Google's own two URL shapes plus Bing's. All three were missed while any
    // href containing "cal.com" credited a booking system.
    for (const href of [
      "https://maps.google.com/?q=1820+Catalina+Ave",
      "https://www.google.com/maps/place/Exemplary",
      "https://www.bing.com/maps?q=1820+Catalina+Ave",
    ]) {
      const page: PageCapture = {
        url: "https://exemplary.example/",
        status: 200,
        raw: extract({ text: EXEMPLARY_TEXT, anchors: [{ href, text: "Directions", rel: "" }] }),
        rendered: null,
        error: null,
      };
      const fit = checkGoal(
        "visit",
        "operator",
        { ...exemplarySite(), pages: [page] },
        // No PostalAddress schema, so the map link is the only thing that can
        // carry this check.
        { ...exemplaryChecks(), schema: { typesFound: [], missingExpected: [], invalidBlocks: 0 } },
      );
      expect(fit.requirements.find((r) => r.key === "address")?.status, href).toBe("met");
    }
  });
});

describe("the exemplary fixture is not passing by being unreadable", () => {
  // Guards the guard, the same way the decoy corpus does. A fixture that had
  // drifted out of reach of the checks would pass this file forever while
  // proving nothing.
  it("a site missing everything fails the same checks", () => {
    const bare: CrawlResult = { ...exemplarySite(), pages: [] };
    const fit = checkGoal("book", "operator", bare, null);
    expect(fit.met).toBe(0);
  });
});
