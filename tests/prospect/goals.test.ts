import { describe, expect, it } from "vitest";
import { checkGoal, orderRequirements, type SiteGoal } from "../../src/prospect/goals.js";
import type {
  ChecksResult,
  CrawlResult,
  PageAnchor,
  PageCapture,
  PageExtract,
} from "../../src/prospect/types.js";

function extract(over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: "A page",
    metaDescription: null,
    canonical: null,
    social: {},
    headings: [],
    jsonLd: [],
    images: { total: 0, withAlt: 0 },
    hasViewportMeta: true,
    text: "",
    ...over,
  };
}

// `forms` defaults to undefined, not [], because that is what a report stored
// before form extraction shipped actually looks like — and the difference
// between "no form" and "we never looked" is the whole point of the tri-state.
function crawl(
  text: string,
  anchors: PageAnchor[] = [],
  forms: PageExtract["forms"] = undefined,
): CrawlResult {
  const page: PageCapture = {
    url: "https://example.com/",
    status: 200,
    raw: extract({ text, anchors, ...(forms ? { forms } : {}) }),
    rendered: null,
    error: null,
  };
  return {
    origin: "https://example.com",
    robotsTxt: null,
    agentAccess: [],
    sitemap: { present: false, urlCount: 0 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: [page],
  };
}

function checks(over: Partial<ChecksResult> = {}): ChecksResult {
  return {
    crawlerAccessMeasured: true,
    crawlerAccess: { blockedAi: [], allowedAi: [], blockedClassical: [] },
    jsDependence: { avgMissing: 0, perPage: [] },
    schema: { typesFound: [], missingExpected: [], invalidBlocks: 0 },
    meta: {
      pageCount: 1,
      missingTitle: 0,
      missingDescription: 0,
      missingCanonical: 0,
      missingSocial: 0,
      pagesWithoutExtract: 0,
    },
    headings: { pagesWithoutH1: 0, pagesWithLevelSkips: 0 },
    securityHeaders: { present: [], missing: [] },
    sitemapMeasured: true,
    sitemapPresent: true,
    llmsTxtMeasured: true,
    llmsTxtPresent: false,
    viewportOk: true,
    ...over,
  };
}

const anchor = (href: string, text = ""): PageAnchor => ({ href, text, rel: "" });
const status = (fit: ReturnType<typeof checkGoal>, key: string): string | undefined =>
  fit.requirements.find((r) => r.key === key)?.status;
const met = (fit: ReturnType<typeof checkGoal>, key: string): boolean => status(fit, key) === "met";

describe("checkGoal — booking", () => {
  it("finds a third-party booking link", () => {
    const fit = checkGoal(
      "book",
      "inferred",
      crawl("", [anchor("https://www.zocdoc.com/practice/x")]),
      null,
    );
    expect(met(fit, "booking")).toBe(true);
    expect(fit.requirements.find((r) => r.key === "booking")?.evidence).toContain("zocdoc");
  });

  it("does not credit booking for a phone number alone", () => {
    // The distinction the prompt calls out: a practice with one footer number
    // is "call", not "book", and grading it as booking would report a missing
    // feature it never claimed to have.
    const fit = checkGoal("book", "inferred", crawl("Call us on 310-378-9241"), null);
    expect(met(fit, "booking")).toBe(false);
  });

  it("reads opening hours out of prose", () => {
    const fit = checkGoal("book", "inferred", crawl("Mon - Fri 7:00 am to 5:00 pm"), null);
    expect(met(fit, "hours")).toBe(true);
  });

  it("accepts opening hours declared only in schema", () => {
    const fit = checkGoal(
      "book",
      "inferred",
      crawl(""),
      checks({
        schema: {
          typesFound: ["LocalBusiness", "openingHoursSpecification"],
          missingExpected: [],
          invalidBlocks: 0,
        },
      }),
    );
    expect(met(fit, "hours")).toBe(true);
  });
});

describe("checkGoal — enquiry", () => {
  it("credits a form that asks enough to brief a conversation", () => {
    const fit = checkGoal(
      "enquire",
      "inferred",
      crawl(
        "",
        [],
        [
          {
            kind: "enquiry",
            action: "/submit",
            method: "post",
            fieldCount: 6,
            hasContactField: true,
            hasSubmit: true,
          },
        ],
      ),
      null,
    );
    expect(met(fit, "qualifying-form")).toBe(true);
  });

  it("does not credit a two-field name-and-email box", () => {
    const fit = checkGoal(
      "enquire",
      "inferred",
      crawl(
        "",
        [],
        [
          {
            kind: "enquiry",
            action: null,
            method: "post",
            fieldCount: 2,
            hasContactField: true,
            hasSubmit: true,
          },
        ],
      ),
      null,
    );
    expect(met(fit, "qualifying-form")).toBe(false);
  });

  it("requires BOTH a currency amount and price language before calling it a price signal", () => {
    // A case study saying "17% revenue lift" and "$2.4M raised" is not pricing.
    // Requiring the two together is what keeps this from firing on every
    // portfolio page on the web.
    const caseStudy = checkGoal(
      "enquire",
      "inferred",
      crawl("We delivered a 17% lift and $2.4M in new revenue"),
      null,
    );
    expect(met(caseStudy, "price-signal")).toBe(false);

    const realPrice = checkGoal(
      "enquire",
      "inferred",
      crawl("Branding packages starting at $12,000"),
      null,
    );
    expect(met(realPrice, "price-signal")).toBe(true);
  });
});

describe("checkGoal — contact basics", () => {
  it("counts a tel: link found anywhere on the site", () => {
    const fit = checkGoal(
      "call",
      "inferred",
      crawl(""),
      checks({
        consistency: {
          phones: [
            { normalized: "3103789241", seenAs: ["310-378-9241"], pages: ["/"], linked: true },
          ],
          emails: [],
          copyrightYears: [],
          newestCopyrightYear: null,
          pagesOffTemplate: [],
          sharedNavLinks: 3,
          pagesExamined: 1,
        },
      }),
    );
    expect(met(fit, "tappable-phone")).toBe(true);
  });

  it("treats an older report's missing `linked` as not measured, never as a pass", () => {
    const fit = checkGoal(
      "call",
      "inferred",
      crawl(""),
      checks({
        consistency: {
          phones: [{ normalized: "3103789241", seenAs: ["310-378-9241"], pages: ["/"] }],
          emails: [],
          copyrightYears: [],
          newestCopyrightYear: null,
          pagesOffTemplate: [],
          sharedNavLinks: 3,
          pagesExamined: 1,
        },
      }),
    );
    expect(met(fit, "tappable-phone")).toBe(false);
  });
});

describe("checkGoal — unknown", () => {
  it("produces no requirements at all", () => {
    // Grading a site against a purpose we could not identify would report our
    // own guess as their failing. The finding is that we could not tell.
    const fit = checkGoal("unknown", "inferred", crawl("Welcome to our website"), null);
    expect(fit.requirements).toEqual([]);
    expect(fit.total).toBe(0);
  });
});

describe("checkGoal — provenance", () => {
  it("records whether the goal was supplied or inferred", () => {
    expect(checkGoal("buy", "operator", crawl(""), null).source).toBe("operator");
    expect(checkGoal("buy", "inferred", crawl(""), null).source).toBe("inferred");
  });

  it("gives every goal a non-empty checklist except unknown", () => {
    const goals: SiteGoal[] = ["book", "enquire", "call", "visit", "buy", "demo", "partner"];
    for (const g of goals) {
      expect(checkGoal(g, "inferred", crawl(""), null).requirements.length).toBeGreaterThan(0);
    }
  });
});

describe("content checks match an answer, never a topic", () => {
  // Both false positives this section has shipped were the same bug wearing a
  // different noun, so the guard is written against the CLASS rather than the
  // two instances we happened to catch. Every sentence below mentions a topic
  // one of the checks looks for, and answers none of them — the way a real site
  // mentions them in passing. Nothing may fire.
  //
  // When a check is loosened, this corpus is where it has to stay quiet. If a
  // new pattern needs a line removed from here to pass, the pattern is wrong.
  const DECOYS = [
    "Building relationships with our new patients is what Michelle likes best about working here.",
    "Returning patients can skip this step, and please return to reception afterwards.",
    "We opened on the same day the pier reopened, back in 1994.",
    "Our office is a short walk from the park in the centre of town.",
    "We take real pride in the delivery of care and the volume of work we handle.",
    "Requirements for your first visit are listed below.",
    "Dr. Alvarez holds credentials from three separate boards.",
    "We photographed each package at our studio over two afternoons.",
    "That campaign eventually delivered $2.4M in new revenue for the client.",
  ].join(" ");

  const GOALS: SiteGoal[] = ["book", "enquire", "call", "visit", "buy", "demo", "partner"];

  it.each(GOALS)("stays silent on the decoy corpus for goal %s", (goal) => {
    const fit = checkGoal(goal, "inferred", crawl(DECOYS), null);
    const wrong = fit.requirements
      .filter((r) => r.scope === "content" && r.status === "met")
      .map((r) => `${r.key} matched: ${r.evidence}`);
    expect(wrong).toEqual([]);
  });

  it("the corpus is not silent by accident — real answers still register", () => {
    // Guards the guard. A corpus that no longer reaches the checks at all would
    // pass the test above forever while measuring nothing.
    const real =
      "We are accepting new patients. Free parking is behind the building. " +
      "Shipping is free over $50 and our returns policy runs 30 days. " +
      "Book a free consultation with no obligation.";
    const book = checkGoal("book", "inferred", crawl(real), null);
    expect(met(book, "new-clients")).toBe(true);
    const visit = checkGoal("visit", "inferred", crawl(real), null);
    expect(met(visit, "getting-there")).toBe(true);
    const buy = checkGoal("buy", "inferred", crawl(real), null);
    expect(met(buy, "shipping")).toBe(true);
    expect(met(buy, "returns")).toBe(true);
    const call = checkGoal("call", "inferred", crawl(real), null);
    expect(met(call, "what-to-expect")).toBe(true);
  });
});

describe("orderRequirements", () => {
  it("puts unmet first, then cheapest to fix first", () => {
    // The commercial ladder, and the only place it appears: a reader meets the
    // afternoon's work first and reaches the structural questions having
    // already agreed with everything above them.
    const fit = checkGoal("book", "inferred", crawl(""), null);
    const ordered = orderRequirements(fit.requirements);
    const scopes = ordered.filter((r) => r.status === "missing").map((r) => r.scope);
    const rank = { quick: 0, content: 1, structural: 2 };
    for (let i = 1; i < scopes.length; i++) {
      expect(rank[scopes[i]!]).toBeGreaterThanOrEqual(rank[scopes[i - 1]!]);
    }
    const rankOf = { missing: 0, met: 1, unmeasured: 2 } as const;
    for (let i = 1; i < ordered.length; i++) {
      expect(rankOf[ordered[i]!.status]).toBeGreaterThanOrEqual(rankOf[ordered[i - 1]!.status]);
    }
  });
});

describe("checkGoal — never converts our own missing data into their defect", () => {
  // Found on live data, not in a fixture. Both of these read their input from
  // `checks`, which reports stored before those fields existed do not carry.
  // With a two-state boolean they came back `false`, and the report told sites
  // that have a tappable number and a reachable contact page that they had
  // neither.
  it("marks the reachability check unmeasured when there is no journey map", () => {
    const fit = checkGoal("enquire", "inferred", crawl(""), checks());
    expect(status(fit, "reachable")).toBe("unmeasured");
  });

  it("marks the tappable-phone check unmeasured when no phone was found at all", () => {
    const fit = checkGoal("enquire", "inferred", crawl(""), checks());
    expect(status(fit, "tappable-phone")).toBe("unmeasured");
  });

  it("does not score OUR OWN case-study numbers as a published price", () => {
    // Found by replaying the check over the stored audits: reddoorla.com scored
    // a published price off its own results copy. Both the price word and the
    // amount are in one sentence, so only the subject of the sentence separates
    // a rate card from a growth chart.
    const results =
      "We helped them double sales year over year for five straight years, from $1M to $16M.";
    expect(met(checkGoal("enquire", "inferred", crawl(results), null), "price-signal")).toBe(false);

    // The counter-case, from a real prospect: a pricing comparison table. It
    // must survive, or the check measures nothing.
    const table = "Avg Monthly Cost $20k+/mo with a retainer. Up to 2-Week Trial.";
    expect(met(checkGoal("enquire", "inferred", crawl(table), null), "price-signal")).toBe(true);
  });

  it("marks the form check unmeasured when the crawl never extracted forms", () => {
    // `forms` is optional on PageExtract, so every report stored before form
    // extraction shipped carries `undefined` — which counted as zero fields and
    // told six real sites they had no usable enquiry form. Same error as the
    // phone and reachability checks, in a field added later.
    const noExtraction = checkGoal("enquire", "inferred", crawl("", [], undefined), null);
    expect(status(noExtraction, "qualifying-form")).toBe("unmeasured");

    // An empty array is a real measurement: we looked, there was no form.
    const looked = checkGoal("enquire", "inferred", crawl("", [], []), null);
    expect(status(looked, "qualifying-form")).toBe("missing");
  });

  it("keeps unmeasured checks out of the denominator", () => {
    // "3 of 4" must never count something we did not look at.
    const fit = checkGoal("enquire", "inferred", crawl(""), checks());
    const judged = fit.requirements.filter((r) => r.status !== "unmeasured").length;
    expect(fit.total).toBe(judged);
    expect(fit.total).toBeLessThan(fit.requirements.length);
  });

  it("does not credit 'taking new clients' to a staff bio that merely says 'new patients'", () => {
    // Found on the live Beachfront run, and the same class as the Ludlow price
    // bug: every dental site on earth contains the words "new patients", so
    // matching them measures that the site is about dentistry and nothing else.
    const bio = "Building relationships with our new patients is what Michelle likes best.";
    expect(met(checkGoal("book", "inferred", crawl(bio), null), "new-clients")).toBe(false);

    const answer = "We are currently accepting new patients at both locations.";
    expect(met(checkGoal("book", "inferred", crawl(answer), null), "new-clients")).toBe(true);
  });

  it("counts a NEGATIVE answer as an answer", () => {
    // The requirement is that the site says, not that the answer is yes. A
    // practice at capacity that says so has done the visitor the service; the
    // failure is silence.
    const full = "We are not accepting new patients until the spring.";
    expect(met(checkGoal("book", "inferred", crawl(full), null), "new-clients")).toBe(true);
  });

  it("quotes evidence in the case the site wrote it", () => {
    // The quote is shown to the client as the receipt. Lower-casing the site's
    // own copy makes it read as though we mangled it.
    const fit = checkGoal(
      "book",
      "inferred",
      crawl("Dr. Michelle Alvarez is accepting new patients in Hermosa Beach."),
      null,
    );
    const evidence = fit.requirements.find((r) => r.key === "new-clients")?.evidence ?? "";
    expect(evidence).toContain("Michelle Alvarez");
    expect(evidence).not.toContain("michelle alvarez");
  });

  it("does not read a price signal from a case-study figure in the next sentence", () => {
    // Ludlow Kingsley scored a price signal off "shooting lovely portraits of
    // each package", with the dollar amount coming from an unrelated case study.
    //
    // This test used to pad the gap to 400 characters, which made it pass
    // against a proximity rule that did not actually work — the decoy corpus
    // caught that. At the distance these two really occur, only the sentence
    // boundary separates them, so that is what the check has to read.
    const adjacent =
      "We photographed each package at our studio. That campaign delivered $2.4M in new revenue.";
    expect(met(checkGoal("enquire", "inferred", crawl(adjacent), null), "price-signal")).toBe(false);
  });

  it("still reads a real price out of the sentence that quotes it", () => {
    for (const real of [
      "Branding packages starting at $12,000.",
      "Our rates begin at $200 per hour.",
      "Retainers from $4,500 per month.",
    ]) {
      expect(met(checkGoal("enquire", "inferred", crawl(real), null), "price-signal")).toBe(true);
    }
  });
});
