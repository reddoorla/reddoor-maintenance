import { describe, expect, it } from "vitest";
import {
  AccuracySchema,
  backstopAbsent,
  quoteSupportsClaim,
  buildAccuracyInput,
  checkAccuracy,
  fullSiteText,
  selectPages,
  siteCoverage,
  type Assertion,
} from "../../src/prospect/accuracy.js";
import type {
  CrawlResult,
  PageCapture,
  PageExtract,
  ProbeAnswer,
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

function page(url: string, text: string): PageCapture {
  return { url, status: 200, raw: extract({ text }), rendered: null, error: null };
}

/** `sitemapUrls` is the site's own size. Pass the page count for a site we read
 *  whole; leave it out for a site with no sitemap, whose size we never learn. */
function crawl(pages: PageCapture[], sitemapUrls?: number): CrawlResult {
  return {
    origin: "https://example.com",
    robotsTxt: null,
    agentAccess: [],
    sitemap:
      sitemapUrls === undefined
        ? { present: false, urlCount: 0 }
        : { present: true, urlCount: sitemapUrls },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages,
  };
}

function branded(over: Partial<ProbeAnswer> = {}): ProbeAnswer {
  return {
    engine: "claude",
    query: "who is Beachfront Dentistry",
    kind: "branded",
    domainCited: true,
    brandMentioned: true,
    countedAsVisible: true,
    citedDomains: ["drwhitfield.example", "yelp.com", "seaviewdental.example"],
    snippet: "",
    truncated: true,
    askedAt: "2026-08-27T02:00:00.000Z",
    ...over,
  };
}

/** A branded answer from a report stored before `fullAnswer` existed. Built by
 *  omitting the key rather than setting it undefined — under
 *  exactOptionalPropertyTypes those are different things, and the stored JSON
 *  has no key at all. */
function noFullAnswer(): ProbeAnswer {
  const { fullAnswer: _drop, ...rest } = branded({ fullAnswer: "x" });
  return rest;
}

const assertion = (over: Partial<Assertion> = {}): Assertion => ({
  claim: "The practice was formerly known as Marcus Z. Whitfield DDS.",
  verdict: "absent",
  engineQuote: "formerly known as Marcus Z. Whitfield DDS",
  siteQuote: null,
  unverifiedReason: null,
  nearbyMention: null,
  sourceDomains: ["drwhitfield.example"],
  query: "who is Beachfront Dentistry",
  engine: "claude",
  ...over,
});

describe("backstopAbsent — never accuse an engine of inventing what the site published", () => {
  // The one error this stage must not make. The model only sees the pages that
  // fit in the prompt; the site is bigger than that. Reporting "your site does
  // not say this" about a sentence on page fifteen tells a client an engine
  // fabricated a fact they wrote themselves.
  it("downgrades absent to unverified when the site does mention the term", () => {
    const site = "The practice was formerly known as Marcus Z. Whitfield DDS.";
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("unverified");
    expect(out?.siteQuote).toContain("Whitfield");
    expect(out?.unverifiedReason).toContain("Whitfield");
  });

  it("keeps the finding but flags what the site DOES say, when the words are scattered", () => {
    // The real Beachfront case, and the one that decided this design. The engine
    // says the practice was "formerly known as Marcus Z. Whitfield DDS"; the site
    // never says that, but its team page lists Dr. Marcus Whitfield.
    //
    // Suppressing it loses the most valuable line in the section — an engine
    // telling the world your history out of your predecessor's website.
    // Printing it bare invites the client to open their own team page and
    // conclude we cannot read. So the verdict stands and the objection is
    // answered on the same line.
    const site = "Meet Your Team. Dr. Priya Raman. Dr. Marcus Whitfield.";
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("absent");
    expect(out?.nearbyMention).toBe("Marcus Z. Whitfield");
  });

  it("does not call a legal name 'nearby' because the site says the company's own name", () => {
    // reddoorla.com, 2026-09-09. The engine claimed "The company's legal name
    // is Reddoor Creative, LLC". `llc` appears NOWHERE on that site — 0 hits
    // across all 20 pages — but the token is 3 characters, under MIN_TOKEN, so
    // it was dropped before matching. What remained was "reddoor" and
    // "creative": the business's own name, 72 and 54 times, on every page.
    //
    // The verdict stayed `absent`, which is right. The `nearbyMention` was
    // noise, and it is offered to the reader as "something related your site
    // DOES say" — so the moment anything renders it, the report states as fact
    // that the site says a phrase it has never contained.
    //
    // An INITIAL is safe to drop from a name. A word is not.
    const site = "Reddoor Creative. We make brands. © Reddoor Creative 2006-2026.";
    const terms = new Map([[assertion().claim, ["Reddoor Creative, LLC"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("absent");
    expect(out?.nearbyMention).toBeNull();
  });

  it("cannot claim absence on a partially-read site just because a term scattered", () => {
    // The module's own guarantee: "When the site was too large to send whole,
    // `absent` cannot be claimed at all." The scattered branch returns before
    // that check, so a near-miss on a name smuggled an `absent` past it — the
    // one verdict a partial read is not allowed to reach.
    const site = "Meet Your Team. Dr. Priya Raman. Dr. Marcus Whitfield.";
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, false);
    expect(out?.verdict).toBe("unverified");
    expect(out?.nearbyMention).toBe("Marcus Z. Whitfield");
  });

  it("prefers an exact hit over a scattered one, whatever order the terms arrive in", () => {
    const site = "Dr. Marcus Whitfield. The practice was formerly known as Bayside Dental.";
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield", "formerly known"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("unverified");
    expect(out?.siteQuote).toContain("formerly known");
  });

  it("does not fire on a single common word shared with the site", () => {
    // The over-firing has to stop somewhere, or every finding on a dental site
    // dissolves into "unverified".
    const site = "Comprehensive dental care and emergency appointments.";
    const terms = new Map([[assertion().claim, ["Whitfield Dentistry"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("absent");
  });

  it("keeps absent when the term genuinely does not appear", () => {
    const site = "Our team includes Dr. Priya Raman.";
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield", "formerly known"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("absent");
    expect(out?.siteQuote).toBeNull();
  });

  it("cannot claim absence at all when the site was too large to read whole", () => {
    const terms = new Map([[assertion().claim, ["Marcus Z. Whitfield"]]]);
    const [out] = backstopAbsent([assertion()], "unrelated text", terms, false);
    expect(out?.verdict).toBe("unverified");
    expect(out?.unverifiedReason).toContain("larger than we read");
  });

  it("ignores terms too short to mean anything", () => {
    // A backstop that fired on "dental" would downgrade every honest finding on
    // a dentist's site and empty the section of its whole purpose.
    const site = "Comprehensive dental care in Redondo Beach.";
    const terms = new Map([[assertion().claim, ["DDS", "care"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("absent");
  });

  it("leaves verdicts other than absent alone", () => {
    const confirmed = assertion({ verdict: "confirmed", siteQuote: "Dr. Priya Raman" });
    const terms = new Map([[confirmed.claim, ["Raman"]]]);
    const [out] = backstopAbsent([confirmed], "Dr. Priya Raman", terms, true);
    expect(out?.verdict).toBe("confirmed");
    expect(out?.siteQuote).toBe("Dr. Priya Raman");
  });

  it("matches across the whitespace the extractor collapses", () => {
    const site = "Our team includes\n\n  Dr. Marcus   Whitfield  today.";
    const terms = new Map([[assertion().claim, ["Marcus Whitfield"]]]);
    const [out] = backstopAbsent([assertion()], site, terms, true);
    expect(out?.verdict).toBe("unverified");
  });
});

describe("checkAccuracy — quotes are verified, not trusted", () => {
  // A two-page site whose sitemap lists two pages, complete and read whole, so
  // `absent` can stand. The sitemap must say it is untruncated and give its full
  // sample, or the site is not known to be read whole (review round 1, fix 3).
  const site: CrawlResult = {
    ...crawl([
      page(
        "https://seaviewdental.example/",
        "Beachfront Dentistry in Riviera Village, Redondo Beach.",
      ),
      page(
        "https://seaviewdental.example/team",
        "Meet Your Team Dr. Priya Raman Dr. Marcus Whitfield",
      ),
    ]),
    sitemap: {
      present: true,
      urlCount: 2,
      truncated: false,
      sample: ["https://seaviewdental.example/", "https://seaviewdental.example/team"],
    },
  };
  const answer = branded({
    fullAnswer:
      "Beachfront Dentistry is a dental practice in the Riviera Village neighborhood of Redondo Beach. " +
      "It was formerly known as Marcus Z. Whitfield DDS. The practice is run by Dr. Priya Raman.",
  });

  // No network in tests: every cited domain comes back unreachable, which is the
  // honest "unknown" and keeps these tests about the quote verification.
  const offline = { fetchPage: async () => null };
  const stub = (assertions: unknown[]) => ({
    run: async () => ({ assertions }),
    ownership: offline,
  });

  it("discards an assertion whose engine quote was never said", async () => {
    // A claim about a real business, built on words the engine did not use, has
    // no salvageable part.
    const r = await checkAccuracy("https://seaviewdental.example", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "They offer 24-hour emergency care.",
            engineQuote: "open twenty-four hours for emergencies",
            verdict: "confirmed",
            siteQuote: null,
            searchTerms: ["emergency"],
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions).toEqual([]);
  });

  it("downgrades a confirmed verdict whose site quote is not on the site", async () => {
    const r = await checkAccuracy("https://seaviewdental.example", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "The practice is run by Dr. Priya Raman.",
            engineQuote: "The practice is run by Dr. Priya Raman",
            verdict: "confirmed",
            siteQuote: "Dr. Priya Raman has practised here since 1998",
            searchTerms: ["Priya Raman"],
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions[0]?.verdict).toBe("unverified");
    expect(r.assertions[0]?.siteQuote).toBeNull();
  });

  it("keeps a confirmed verdict whose site quote is real", async () => {
    const r = await checkAccuracy("https://seaviewdental.example", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "The practice is run by Dr. Priya Raman.",
            engineQuote: "The practice is run by Dr. Priya Raman",
            verdict: "confirmed",
            siteQuote: "Dr. Priya Raman",
            searchTerms: ["Priya Raman"],
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions[0]?.verdict).toBe("confirmed");
    expect(r.assertions[0]?.siteQuote).toBe("Dr. Priya Raman");
  });

  it("names who the engine read instead, and never the prospect themselves", async () => {
    const r = await checkAccuracy("https://seaviewdental.example", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "The practice was formerly known as Marcus Z. Whitfield DDS.",
            engineQuote: "It was formerly known as Marcus Z. Whitfield DDS",
            verdict: "absent",
            siteQuote: null,
            searchTerms: ["formerly known", "Marcus Z. Whitfield"],
          },
        ],
      }),
      ownership: offline,
    });
    const a = r.assertions[0];
    // Absent, with the team-page mention noted rather than used to silence it.
    expect(a?.verdict).toBe("absent");
    expect(a?.nearbyMention).toBe("Marcus Z. Whitfield");
    expect(a?.sourceDomains).toContain("drwhitfield.example");
    expect(a?.sourceDomains).not.toContain("seaviewdental.example");
  });

  it("reports nothing measured when the probes predate full answers", async () => {
    // Not "no claims found" — a report that renders zero assertions as a clean
    // bill of health is our missing data sold as their good news.
    const r = await checkAccuracy(
      "https://seaviewdental.example",
      site,
      [noFullAnswer()],
      [],
      stub([]),
    );
    expect(r.answersRead).toBe(0);
    expect(r.assertions).toEqual([]);
  });

  it("ignores category answers", async () => {
    const r = await checkAccuracy(
      "https://seaviewdental.example",
      site,
      [branded({ kind: "category", fullAnswer: "some category answer" })],
      [],
      stub([]),
    );
    expect(r.answersRead).toBe(0);
  });
});

describe("buildAccuracyInput", () => {
  const site = crawl([
    page("https://x.com/", "home text"),
    page("https://x.com/a/b/c", "deep page"),
    page("https://x.com/team", "shallow page"),
  ]);

  it("fences site and engine text with a tag that changes every call", () => {
    const a = buildAccuracyInput(site, [branded({ fullAnswer: "an answer" })]);
    const b = buildAccuracyInput(site, [branded({ fullAnswer: "an answer" })]);
    const tagOf = (s: string) => s.match(/data_[0-9a-f]{12}/)?.[0];
    expect(tagOf(a.system)).toBeDefined();
    expect(tagOf(a.system)).not.toBe(tagOf(b.system));
    // Both untrusted bodies sit inside it: the site AND the engine's reply.
    expect(a.user).toContain(`<${tagOf(a.system)}>\nan answer`);
    expect(a.user).toContain("home text");
  });

  it("does not truncate a page's text", () => {
    // analyze cuts pages at 1500 chars. Here a fact past the cut would read as
    // absent, so whole pages are dropped instead and the drop is disclosed.
    const long = "z".repeat(40_000);
    const one = buildAccuracyInput(crawl([page("https://x.com/", long)]), [
      branded({ fullAnswer: "a" }),
    ]);
    expect(one.user).toContain(long);
  });

  it("prefers shallow pages when it cannot take them all", () => {
    const { pages } = selectPages(site);
    expect(pages[0]?.url).toBe("https://x.com/");
    expect(pages[1]?.url).toBe("https://x.com/team");
  });

  it("does not count a page we never read as read", () => {
    // The verdict this file says it must never get wrong is `absent` — "your
    // site does not say this" — and `fullyRead` is what licenses it to stand.
    // A page whose fetch was refused has no extract, contributed no text, and
    // was still counted toward "we read your whole site", so an assertion could
    // be declared absent from a page nobody ever read.
    const refused: PageCapture = {
      url: "https://x.com/blocked",
      status: 403,
      raw: null,
      rendered: null,
      error: "HTTP 403",
    };
    const partial = crawl([page("https://x.com/", "home text"), refused]);

    const selected = selectPages(partial);

    expect(selected.fullyRead).toBe(false);
    expect(selected.pages.map((p) => p.url)).toEqual(["https://x.com/"]);
    expect(selected.pagesUnread).toBe(1);
  });

  it("reports fullyRead false when a page had to be dropped", () => {
    const big = crawl([
      page("https://x.com/", "z".repeat(100_000)),
      page("https://x.com/two", "z".repeat(100_000)),
    ]);
    expect(selectPages(big).fullyRead).toBe(false);
    expect(selectPages(site).fullyRead).toBe(true);
  });
});

describe("fullSiteText", () => {
  it("joins every page, including ones that never reach the prompt", () => {
    const text = fullSiteText(
      crawl([page("https://x.com/", "one"), page("https://x.com/b", "two")]),
    );
    expect(text).toContain("one");
    expect(text).toContain("two");
  });
});

describe("backstopAbsent — a single common word is a topic, not an answer", () => {
  const assertion = (claim: string) => ({
    claim,
    verdict: "absent" as const,
    engineQuote: "q",
    siteQuote: null,
    unverifiedReason: null,
    nearbyMention: null,
    sourceDomains: [],
    query: "who is Acme",
    engine: "claude",
  });

  it("does not excuse a claim because one common word appears somewhere", () => {
    // Observed on a real run of our own site. An engine claimed the company has
    // "about 5 employees"; the backstop found the word "employees" inside an
    // unrelated case study about an organisation of 84,000 people, and printed
    // `Your site does say "employees", so we have not counted this as missing.`
    // That is a topic match dressed as an answer, and it reads as a tool that
    // cannot read.
    const site =
      "We turned policy into county-wide action by managing an organization of over 84,000 employees.";
    const [out] = backstopAbsent(
      [assertion("Acme has about 5 employees")],
      site,
      new Map([["Acme has about 5 employees", ["employees"]]]),
      true,
    );
    expect(out!.verdict).toBe("absent");
    expect(out!.nearbyMention).toBeNull();
  });

  it("still excuses a claim when the site uses the actual phrase", () => {
    const site = "Our studio has about 5 employees across three states.";
    const [out] = backstopAbsent(
      [assertion("Acme has about 5 employees")],
      site,
      new Map([["Acme has about 5 employees", ["about 5 employees"]]]),
      true,
    );
    expect(out!.verdict).toBe("unverified");
  });

  it("is not fooled by the CAPITALISED spelling of the same common word", () => {
    // `searchTerms` is free text the model writes, and the gate used to accept
    // any term starting with a capital. So `["Employees"]` walked straight
    // through the fix above while `["employees"]` was stopped — the gate closed
    // only the lowercase spelling of the bug. A lone capital is not evidence of
    // a name: the claim itself writes the word in lower case.
    const site =
      "We turned policy into county-wide action by managing an organization of over 84,000 employees.";
    const [out] = backstopAbsent(
      [assertion("Acme has about 5 employees")],
      site,
      new Map([["Acme has about 5 employees", ["Employees"]]]),
      true,
    );
    expect(out!.verdict).toBe("absent");
    expect(out!.nearbyMention).toBeNull();
  });

  it("still trusts a distinctive proper noun on its own", () => {
    // The case the backstop was built for: an engine names a practice after a
    // clinician the site never mentions, and the team page lists a similar
    // name. A single word is enough here precisely because it is a name.
    const site = "Our team is led by Dr Alderson, who founded the practice.";
    const [out] = backstopAbsent(
      [assertion("Formerly known as Alderson Dental")],
      site,
      new Map([["Formerly known as Alderson Dental", ["Alderson"]]]),
      true,
    );
    expect(out!.verdict).toBe("unverified");
  });
});

describe("quoteSupportsClaim — a related passage is not a supporting one", () => {
  it("rejects a quote that shares only one common word with the claim", () => {
    // Observed live. The engine said Reddoor is "a graphic design and branding
    // company"; the model marked it confirmed and cited our tagline — "We save
    // you from drowning in an ocean of noise by arming you with a clear story
    // and compelling design." The only word in common is "design". A reader
    // notices immediately that the quote does not say what the claim says, and
    // once they have noticed, every other quote on the page is in question.
    expect(
      quoteSupportsClaim(
        "Reddoor Creative is a graphic design and branding company.",
        "We save you from drowning in an ocean of noise by arming you with a clear story and compelling design.",
      ),
    ).toBe(false);
  });

  it("accepts a quote that carries the substance of the claim", () => {
    // Every one of these is a real confirmed pair from the same run, and each
    // must survive: the guard is worthless if it demotes true confirmations.
    const pairs: [string, string][] = [
      [
        "Reddoor Creative is based in Fair Oaks Ranch, Texas.",
        "HQ MAILING ADDRESS 29027 Dapper Dan Dr. Fair Oaks Ranch, TX 78015",
      ],
      [
        "Reddoor Creative has designers spread across California, Texas and Idaho.",
        "We have designers sprinkled across California, Texas and Idaho, conveniently located near the Los Angeles, San Antonio, and Boise metro areas.",
      ],
      [
        "Reddoor Creative is led by Tim Holmes.",
        "Because of unforeseen circumstances owner, Tim Holmes, found himself stuck in LA with a white Toyota.",
      ],
    ];
    for (const [claim, quote] of pairs) {
      expect(quoteSupportsClaim(claim, quote), claim).toBe(true);
    }
  });

  it("does not count a sentence-initial capital as a proper noun", () => {
    // Two measured false confirms. `The` opened both sentences, and
    // `/^[A-Z]/` made it a "proper noun" — a free shared token handed to any
    // pair, which is half of the two the bar asks for. The rest of each pair
    // shares one word and nothing else: a city the quote merely mentions, and
    // a year the quote uses for something else entirely.
    expect(
      quoteSupportsClaim("The company is based in Los Angeles.", "Los Angeles has a lot of noise."),
    ).toBe(false);
    expect(
      quoteSupportsClaim(
        "The business opened in 2018.",
        "The 2018 rebrand was our largest project.",
      ),
    ).toBe(false);
  });

  it("accepts a passage that names the same thing the claim names", () => {
    // The false MISS, and the worse of the two failures: `verifyQuotes` wrote
    // "The passage we found is about the same subject but does not actually say
    // this" about a passage that says exactly this. One name shared, spelled
    // the same way and capitalised mid-sentence in both, is a statement — the
    // 2-token bar was counting words where the evidence is a name.
    expect(quoteSupportsClaim("They accept Medicaid.", "We are a Medicaid provider.")).toBe(true);
  });

  it("rejects a quote with nothing of the claim in it at all", () => {
    expect(
      quoteSupportsClaim("Acme is open on Saturdays.", "Our team has served the region."),
    ).toBe(false);
  });
});

const NO_SECOND_VALUE =
  "The passage we found does not show a different value for this, so we have not stated it either way.";

describe("a place the site itself names", () => {
  // The audited site listed a Texas mailing address on one page and "near the
  // Los Angeles metro" on another. The model called "Los Angeles-based"
  // contradicted on the strength of the address alone. Code once overrode it
  // on the site using "Los Angeles"; it no longer changes the model's verdict,
  // so only the quote checks apply.
  const site = crawl([
    page(
      "https://acme.example/",
      "Acme Design. HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.",
    ),
    page(
      "https://acme.example/about",
      "We are conveniently located near the Los Angeles metro area.",
    ),
  ]);
  const answer = branded({
    query: "who is Acme Design",
    citedDomains: ["yelp.com"],
    fullAnswer: "Acme Design (Los Angeles-based) is a studio.",
  });
  const offline = { fetchPage: async () => null };

  it("leaves the model's contradicted alone even when the site uses the claim's own terms", async () => {
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "Acme Design is based in Los Angeles.",
            engineQuote: "Acme Design (Los Angeles-based)",
            verdict: "contradicted",
            siteQuote: "HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.",
            searchTerms: ["Los Angeles"],
          },
        ],
      }),
      ownership: offline,
    });
    const [a] = r.assertions;
    expect(a?.verdict).not.toBe("confirmed");
    expect(a?.siteQuote).toBe("HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.");
    // The model's verdict stands; only the quote check moves it: a
    // contradiction must name the two values it rests on, and this one names
    // none.
    expect(a).toMatchObject({ verdict: "unverified", unverifiedReason: NO_SECOND_VALUE });
  });

  it("keeps contradicted when the site never uses the claim's terms", async () => {
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "Acme Design is based in Portland.",
            engineQuote: "Acme Design (Los Angeles-based)",
            verdict: "contradicted",
            siteQuote: "HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.",
            searchTerms: ["Portland"],
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions[0]?.verdict).not.toBe("confirmed");
    expect(r.assertions[0]?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it("keeps a supported contradiction as contradicted, with no reason added", async () => {
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "Acme Design is based in Los Angeles.",
            engineQuote: "Acme Design (Los Angeles-based)",
            verdict: "contradicted",
            siteQuote: "HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.",
            searchTerms: ["Portland"],
            subject: "prospect",
            contradiction: {
              attribute: "location",
              engineValue: "Los Angeles",
              siteValue: "Fair Oaks Ranch",
            },
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions[0]).toMatchObject({
      verdict: "contradicted",
      siteQuote: "HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.",
      unverifiedReason: null,
    });
  });

  it("holds a contradiction to two different values even when the site uses its search term", async () => {
    // A valid contradiction: the engine says Portland, the site says Los Angeles,
    // and the site also uses the claim's search term ("metro area"). The
    // search-term hit must not undo a contradiction the two values support.
    const portland = branded({
      query: "who is Acme Design",
      citedDomains: ["yelp.com"],
      fullAnswer: "Acme Design (Los Angeles-based) is a studio. Acme Design is based in Portland.",
    });
    const r = await checkAccuracy("https://acme.example/", site, [portland], [], {
      run: async () => ({
        assertions: [
          {
            claim: "Acme Design is located in the Portland metro area.",
            engineQuote: "Acme Design is based in Portland",
            verdict: "contradicted",
            siteQuote: "We are conveniently located near the Los Angeles metro area.",
            searchTerms: ["metro area"],
            subject: "prospect",
            contradiction: {
              attribute: "location",
              engineValue: "Portland",
              siteValue: "Los Angeles",
            },
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions[0]).toMatchObject({
      verdict: "contradicted",
      unverifiedReason: null,
    });
  });
});

describe("code never upgrades a verdict to 'confirmed'", () => {
  // Invented. A rule here once turned the model's "contradicted" into
  // "confirmed" whenever the site used one of the claim's search terms, and a
  // report told a business its own site agreed it was something it is not.
  // The terms were the model's evidence AGAINST the claim.
  const site = crawl([
    page(
      "https://rosewood.example/",
      "Our business is known for fresh flowers arranged daily for weddings and events. " +
        "Find us in Riverside, Oregon. ©2026 Rosewood Market | All Rights Reserved",
    ),
  ]);
  const answer = branded({
    query: "who is Rosewood Market",
    citedDomains: ["directory.example"],
    fullAnswer:
      'I couldn\'t find a company called "Rosewood Market". ' +
      "Rosewood Market is a bakery known for sourdough bread, based in Lakeside, Oregon.",
  });
  const offline = { fetchPage: async () => null };
  const judge = async (a: {
    claim: string;
    engineQuote: string;
    searchTerms: string[];
    siteQuote: string;
  }) =>
    (
      await checkAccuracy("https://rosewood.example/", site, [answer], [], {
        run: async () => ({ assertions: [{ ...a, verdict: "contradicted" }] }),
        ownership: offline,
      })
    ).assertions;

  it.each([
    {
      why: "the term is the model's counter-evidence, not in the claim",
      verdict: "unverified",
      reason: NO_SECOND_VALUE,
      claim: "The business is a bakery known for sourdough bread.",
      engineQuote: "a bakery known for sourdough bread",
      searchTerms: ["fresh flowers"],
      siteQuote: "Our business is known for fresh flowers arranged daily for weddings and events.",
    },
    {
      why: "the claim denies the name the site uses",
      verdict: "unverified",
      reason: NO_SECOND_VALUE,
      claim: 'No business operates under the name "Rosewood Market".',
      engineQuote: 'I couldn\'t find a company called "Rosewood Market"',
      searchTerms: ["Rosewood Market"],
      siteQuote: "©2026 Rosewood Market | All Rights Reserved",
    },
    {
      why: "the term is only the business's own name",
      verdict: "unverified",
      reason: NO_SECOND_VALUE,
      claim: "Rosewood Market is a bakery known for sourdough bread.",
      engineQuote: "Rosewood Market is a bakery known for sourdough bread",
      searchTerms: ["Rosewood Market"],
      siteQuote: "Our business is known for fresh flowers arranged daily for weddings and events.",
    },
    {
      why: "the term carries only part of the place the claim asserts",
      verdict: "unverified",
      reason: NO_SECOND_VALUE,
      claim: "Rosewood Market is based in Lakeside, Oregon.",
      engineQuote: "based in Lakeside, Oregon",
      searchTerms: ["Oregon"],
      // Real on the site, and without the term, so only the place guard holds.
      siteQuote: "Find us in Riverside",
    },
    {
      why: "the term is the claim's own opening words",
      verdict: "unverified",
      reason: NO_SECOND_VALUE,
      claim: "The business is a bakery known for sourdough bread.",
      engineQuote: "a bakery known for sourdough bread",
      searchTerms: ["The business"],
      siteQuote: "Our business is known for fresh flowers arranged daily for weddings and events.",
    },
  ] as const)("leaves the model's verdict alone when $why", async (c) => {
    const { why: _why, verdict, reason, ...a } = c;
    const [r] = await judge({ ...a, searchTerms: [...a.searchTerms] });
    // Exactly what the quote checks give the model's "contradicted": none of
    // these names its two values, so each is unverified, and none is ever
    // confirmed.
    expect(r).toMatchObject({ verdict, unverifiedReason: reason, siteQuote: a.siteQuote });
  });

  it("leaves it alone when the model's own quote already holds the term", async () => {
    const [r] = await judge({
      claim: "Rosewood Market is based in Riverside, Oregon.",
      engineQuote: "based in Lakeside, Oregon",
      searchTerms: ["Riverside, Oregon"],
      siteQuote: "Find us in Riverside, Oregon.",
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });
});

describe("name collision", () => {
  const site = crawl([page("https://acme.example/", "Acme Design, Boise.")]);
  const offline = { fetchPage: async () => null };

  it("records when the engine describes more than one business under the name", async () => {
    const answer = branded({
      query: "who is Acme Design",
      citedDomains: [],
      fullAnswer:
        '"Acme Design" is a name used by several companies. The main one is Acme Design Photography (Virginia).',
    });
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [],
        conflation: {
          detected: true,
          settled: false,
          otherNames: ["Acme Design Photography"],
          engineQuote: '"Acme Design" is a name used by several companies',
        },
      }),
      ownership: offline,
    });
    expect(r.conflation).toEqual({
      detected: true,
      settled: false,
      otherNames: ["Acme Design Photography"],
      engineQuote: '"Acme Design" is a name used by several companies',
    });
  });

  it("discards a conflation whose quote is not in the answer", async () => {
    const answer = branded({
      query: "who is Acme Design",
      citedDomains: [],
      fullAnswer: "Acme Design is a Boise studio.",
    });
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [],
        conflation: {
          detected: true,
          otherNames: ["Someone Else"],
          engineQuote: "several companies",
        },
      }),
      ownership: offline,
    });
    expect(r.conflation).toEqual({
      detected: false,
      settled: true,
      otherNames: [],
      engineQuote: null,
    });
  });

  // An answer that names this business first and sets an unrelated namesake
  // apart has settled which one it is. That is not a finding, and the record
  // says so rather than leaving "detected" to stand for "unsure".
  it("records a namesake the answer set apart as settled", async () => {
    const answer = branded({
      query: "who is Acme Design",
      citedDomains: [],
      fullAnswer:
        "Acme Design is a Boise design studio (acme.example). It is unrelated to ACME-2, a protein " +
        "marker, which just shares the name.",
    });
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [],
        conflation: {
          detected: true,
          settled: true,
          otherNames: ["ACME-2 (a protein marker)"],
          engineQuote: "It is unrelated to ACME-2, a protein marker, which just shares the name.",
        },
      }),
      ownership: offline,
    });
    expect(r.conflation).toEqual({
      detected: true,
      settled: true,
      otherNames: ["ACME-2 (a protein marker)"],
      engineQuote: "It is unrelated to ACME-2, a protein marker, which just shares the name.",
    });
  });

  // A model that leaves `settled` out has not said the answer was unsure, so
  // the record must not say so either.
  it("reads a detected conflation without `settled` as settled", async () => {
    const answer = branded({
      query: "who is Acme Design",
      citedDomains: [],
      fullAnswer: '"Acme Design" is a name used by several companies.',
    });
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [],
        conflation: {
          detected: true,
          otherNames: ["Acme Design Photography"],
          engineQuote: '"Acme Design" is a name used by several companies',
        },
      }),
      ownership: offline,
    });
    expect(r.conflation.settled).toBe(true);
  });

  it("reads as not-detected when the model omits the field", async () => {
    const answer = branded({
      query: "who is Acme Design",
      citedDomains: [],
      fullAnswer: "Acme Design is a Boise studio.",
    });
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({ assertions: [] }),
      ownership: offline,
    });
    expect(r.conflation).toEqual({
      detected: false,
      settled: true,
      otherNames: [],
      engineQuote: null,
    });
  });
});

/**
 * The page count was the crawl cap, presented as the site (#677).
 *
 * The report said "we read 14 of your 20 pages" about a site whose sitemap lists
 * 49. Both numbers were ours — a private cap inside this file, and the crawl's
 * cap — and neither was a fact about the prospect. An unread page is where an
 * `absent` verdict turns into a wrong claim about somebody's business, so the
 * accuracy pass should read everything the crawl actually retrieved, and the
 * result should carry the site's own denominator rather than implying we
 * measured a whole site we only sampled.
 */
describe("the accuracy pass and the site's real size", () => {
  it("reads everything the crawl retrieved, not a lower private cap", () => {
    const pages = Array.from({ length: 20 }, (_, i) =>
      page(`https://example.com/p${i}`, `Page ${i} says something short.`),
    );
    expect(selectPages(crawl(pages)).pages).toHaveLength(20);
  });

  it("reports the site's own URL count, distinct from the pages we crawled", async () => {
    const site49: CrawlResult = {
      ...crawl([page("https://example.com/", "Seaview Dental is open on Saturdays.")]),
      sitemap: { present: true, urlCount: 49 },
    };
    const r = await checkAccuracy(
      "https://example.com",
      site49,
      [branded({ fullAnswer: "Seaview Dental is open on Saturdays." })],
      [],
      { run: async () => ({ assertions: [] }), ownership: { fetchPage: async () => null } },
    );
    // pagesTotal is what WE crawled — it was never the site's page count.
    expect(r.pagesTotal).toBe(1);
    expect(r.siteUrlCount).toBe(49);
  });

  it("leaves the site's URL count null when there is no sitemap to read it from", async () => {
    const r = await checkAccuracy(
      "https://example.com",
      crawl([page("https://example.com/", "Seaview Dental is open on Saturdays.")]),
      [branded({ fullAnswer: "Seaview Dental is open on Saturdays." })],
      [],
      { run: async () => ({ assertions: [] }), ownership: { fetchPage: async () => null } },
    );
    expect(r.siteUrlCount).toBeNull();
  });
});

/**
 * A crawl with no `sitemap` key at all must not take the stage down.
 *
 * `CrawlResult.sitemap` is required by the type, but this stage also runs over
 * crawls deserialized from `prospect_audits.result_json`, and a row stored
 * before that field existed simply has no such key. Reaching through it threw
 * `Cannot read properties of undefined (reading 'present')` and failed the whole
 * accuracy stage — our own missing field turned into a dead stage, which is the
 * shape of failure this file exists to avoid.
 */
describe("a crawl stored before sitemap was tracked", () => {
  it("reads as an unknown site size rather than throwing", async () => {
    const legacy = crawl([page("https://example.com/", "Seaview Dental is open on Saturdays.")]);
    delete (legacy as { sitemap?: unknown }).sitemap;
    const r = await checkAccuracy(
      "https://example.com",
      legacy,
      [branded({ fullAnswer: "Seaview Dental is open on Saturdays." })],
      [],
      { run: async () => ({ assertions: [] }), ownership: { fetchPage: async () => null } },
    );
    expect(r.siteUrlCount).toBeNull();
  });
});

describe("W2: what the assistant said, about the right company", () => {
  const offline = { fetchPage: async () => null };
  const run = (assertions: unknown[]) => ({
    run: async () => ({ assertions }),
    ownership: offline,
  });

  // The stored shape, renamed: the site says it was founded in 2022, the answer
  // says 2001. The passage contradicts the claim in exactly the word that
  // matters, so it shares too few words with it to pass a resemblance test.
  describe("a contradiction is checked on its two values, not on shared words", () => {
    const site = crawl(
      [page("https://north.example/", "Northwind Supply opened its first warehouse in 2022.")],
      1,
    );
    const answer = branded({
      query: "who is Northwind Supply",
      fullAnswer: "Northwind Supply was established in 2001 and serves contractors.",
    });
    const base = {
      claim: "The business was founded in 2001.",
      engineQuote: "Northwind Supply was established in 2001",
      verdict: "contradicted",
      siteQuote: "opened its first warehouse in 2022",
      searchTerms: ["2001"],
      subject: "prospect",
    };

    it("keeps 2001 against 2022 as contradicted, with both values", async () => {
      const r = await checkAccuracy(
        "https://north.example/",
        site,
        [answer],
        [],
        run([
          {
            ...base,
            contradiction: { attribute: "founding year", engineValue: "2001", siteValue: "2022" },
          },
        ]),
      );
      expect(r.assertions[0]).toMatchObject({
        verdict: "contradicted",
        unverifiedReason: null,
        contradiction: { attribute: "founding year", engineValue: "2001", siteValue: "2022" },
      });
    });

    it("does not stand without the two values", async () => {
      const r = await checkAccuracy("https://north.example/", site, [answer], [], run([base]));
      expect(r.assertions[0]?.verdict).toBe("unverified");
      expect(r.assertions[0]?.contradiction).toBeNull();
    });

    it("does not stand when a value is not in its own quote", async () => {
      const r = await checkAccuracy(
        "https://north.example/",
        site,
        [answer],
        [],
        run([
          {
            ...base,
            contradiction: { attribute: "founding year", engineValue: "2001", siteValue: "2019" },
          },
        ]),
      );
      expect(r.assertions[0]?.verdict).toBe("unverified");
    });

    it("does not stand when the two values are the same", async () => {
      const r = await checkAccuracy(
        "https://north.example/",
        crawl([page("https://north.example/", "Founded in 2001 in Ohio.")], 1),
        [answer],
        [],
        run([
          {
            ...base,
            siteQuote: "Founded in 2001 in Ohio.",
            contradiction: { attribute: "founding year", engineValue: "2001", siteValue: "2001" },
          },
        ]),
      );
      expect(r.assertions[0]?.verdict).toBe("unverified");
    });

    it("matches a value as whole words: 022 is not in 2022", async () => {
      const r = await checkAccuracy(
        "https://north.example/",
        site,
        [answer],
        [],
        run([
          {
            ...base,
            contradiction: { attribute: "founding year", engineValue: "2001", siteValue: "022" },
          },
        ]),
      );
      expect(r.assertions[0]?.verdict).toBe("unverified");
    });

    it("matches a value as whole words: 20 is not in 2022", async () => {
      const r = await checkAccuracy(
        "https://north.example/",
        site,
        [answer],
        [],
        run([
          {
            ...base,
            contradiction: { attribute: "founding year", engineValue: "2001", siteValue: "20" },
          },
        ]),
      );
      expect(r.assertions[0]?.verdict).toBe("unverified");
    });
  });

  describe("absent needs the whole site, by its own sitemap", () => {
    const pages = Array.from({ length: 20 }, (_, i) =>
      page(`https://north.example/${i === 0 ? "" : `p${i}`}`, `Page ${i} of Northwind Supply.`),
    );
    const answer = branded({
      query: "who is Northwind Supply",
      fullAnswer: "Northwind Supply is based at 12 Harbor Road.",
    });
    const absent = {
      claim: "The business is based at 12 Harbor Road.",
      engineQuote: "based at 12 Harbor Road",
      verdict: "absent",
      siteQuote: null,
      searchTerms: ["12 Harbor Road"],
    };

    it("makes an absent on a partly read site unverified: 20 of 95 pages", async () => {
      // The count is said only when the sitemap's size is complete (truncated
      // is false), so this sitemap says so explicitly (review round 2, fix 6).
      const r = await checkAccuracy(
        "https://north.example/",
        { ...crawl(pages, 95), sitemap: { present: true, urlCount: 95, truncated: false } },
        [answer],
        [],
        run([absent]),
      );
      expect(r.siteFullyRead).toBe(false);
      expect(r.assertions[0]).toMatchObject({
        verdict: "unverified",
        unverifiedReason:
          "We read 20 of your 95 pages, so we cannot say this is absent from your site.",
      });
    });

    it("makes it unverified when there is no sitemap to give the site's size", async () => {
      const r = await checkAccuracy(
        "https://north.example/",
        crawl(pages),
        [answer],
        [],
        run([absent]),
      );
      expect(r.siteFullyRead).toBe(false);
      expect(r.assertions[0]?.verdict).toBe("unverified");
      expect(r.assertions[0]?.unverifiedReason).toMatch(/could not learn how many/);
    });

    it("makes it unverified when we stopped reading the sitemap part way", async () => {
      const c = crawl(pages, 20);
      c.sitemap = { present: true, urlCount: 20, truncated: true };
      const r = await checkAccuracy("https://north.example/", c, [answer], [], run([absent]));
      expect(r.siteFullyRead).toBe(false);
    });

    // Changed in review round 1 (fix 3a): a crawl that took the 20-page cap is never
    // read whole, so this fixture now stops one page short of it. Every page of a
    // 19-page site is read, the sitemap is complete and untruncated, and its sample
    // lists the pages we read.
    it("keeps absent when the pages read cover the sitemap", async () => {
      const nineteen = pages.slice(0, 19);
      const c: CrawlResult = {
        ...crawl(nineteen),
        sitemap: {
          present: true,
          urlCount: 19,
          truncated: false,
          sample: nineteen.map((p) => p.url),
        },
      };
      const r = await checkAccuracy("https://north.example/", c, [answer], [], run([absent]));
      expect(r.siteFullyRead).toBe(true);
      expect(r.assertions[0]?.verdict).toBe("absent");
    });
  });

  describe("the business's own name is not evidence", () => {
    it("does not confirm a claim whose only shared words are the client's name and one more", () => {
      const claim =
        "Calder's services include gutter repair, skylight installation and roof inspections for homeowners.";
      const quote = "Calder provides custom solutions for the skylight needs of any client.";
      expect(quoteSupportsClaim(claim, quote)).toBe(true); // the false pass, without the name
      expect(quoteSupportsClaim(claim, quote, "Calder")).toBe(false);
    });

    it("still confirms a passage that says the claim in other words", () => {
      expect(
        quoteSupportsClaim(
          "Calder offers gutter repair for homeowners.",
          "Calder handles gutter repair for homeowners citywide.",
          "Calder",
        ),
      ).toBe(true);
    });

    it("drops a confirmed whose quote shares only the name, through checkAccuracy", async () => {
      const site = crawl(
        [
          page(
            "https://calder.example/",
            "Calder provides custom solutions for the skylight needs of any client.",
          ),
        ],
        1,
      );
      const answer = branded({
        query: "who is Calder",
        fullAnswer: "Calder offers gutter repair and skylight installation for homeowners.",
      });
      const r = await checkAccuracy(
        "https://calder.example/",
        site,
        [answer],
        [],
        run([
          {
            claim:
              "Calder's services include gutter repair and skylight installation for homeowners.",
            engineQuote: "Calder offers gutter repair and skylight installation for homeowners",
            verdict: "confirmed",
            siteQuote: "Calder provides custom solutions for the skylight needs of any client.",
            searchTerms: ["skylight installation"],
          },
        ]),
      );
      expect(r.assertions[0]?.verdict).toBe("unverified");
    });
  });

  describe("who a statement is about is recorded", () => {
    // The stored shape, renamed: the answer hedges a "most likely match" to
    // another firm, then gives that firm's rating.
    const site = crawl([page("https://north.example/", "Northwind Supply serves contractors.")], 1);
    const answer = branded({
      query: "who is Northwind Supply",
      fullAnswer:
        "Most likely match: Southgate Outfitters (Riverton) — lists Northwind Supply as an alternate name. It holds a 2.1 out of 5 rating.",
    });

    it("carries subject, the other name and the topic", async () => {
      const r = await checkAccuracy(
        "https://north.example/",
        site,
        [answer],
        [],
        run([
          {
            claim: "Southgate Outfitters holds a 2.1 out of 5 rating.",
            engineQuote: "It holds a 2.1 out of 5 rating.",
            verdict: "absent",
            siteQuote: null,
            searchTerms: ["2.1 out of 5"],
            subject: "other",
            otherName: "Southgate Outfitters",
            topic: "ratings_reviews",
          },
        ]),
      );
      expect(r.assertions[0]).toMatchObject({
        subject: "other",
        otherName: "Southgate Outfitters",
        topic: "ratings_reviews",
      });
    });

    it("reads an omitted subject as unclear, never as about the prospect", async () => {
      const r = await checkAccuracy(
        "https://north.example/",
        site,
        [answer],
        [],
        run([
          {
            claim: "It holds a 2.1 out of 5 rating.",
            engineQuote: "It holds a 2.1 out of 5 rating.",
            verdict: "absent",
            siteQuote: null,
            searchTerms: ["2.1 out of 5"],
          },
        ]),
      );
      expect(r.assertions[0]?.subject).toBe("unclear");
      expect(r.assertions[0]?.otherName).toBeNull();
    });
  });

  describe("the prompt asks for subject, topic and both values", () => {
    it("names each field", () => {
      const { system } = buildAccuracyInput(crawl([page("https://x.example/", "x")], 1), [
        branded({ fullAnswer: "x" }),
      ]);
      for (const field of [
        "subject:",
        "otherName:",
        "topic:",
        "contradiction:",
        "engineValue",
        "siteValue",
      ]) {
        expect(system).toContain(field);
      }
    });
  });
});

/**
 * Review round 1 (reddoorla/reddoor-maintenance#2256).
 */
describe("review round 1: a contradiction needs the site to differ from the engine", () => {
  const offline = { fetchPage: async () => null };
  const run = (assertions: unknown[]) => ({
    run: async () => ({ assertions }),
    ownership: offline,
  });

  it("is unverified when the site quote also says the engine's value", async () => {
    const site = crawl([page("https://acme.example/", "Founded in 2001. Copyright 2022.")], 1);
    const answer = branded({
      query: "who is Acme Design",
      fullAnswer: "Acme was founded in 2001.",
    });
    const r = await checkAccuracy(
      "https://acme.example/",
      site,
      [answer],
      [],
      run([
        {
          claim: "Acme was founded in 2001.",
          engineQuote: "Acme was founded in 2001",
          verdict: "contradicted",
          siteQuote: "Founded in 2001. Copyright 2022.",
          searchTerms: ["2001"],
          contradiction: { attribute: "founding year", engineValue: "2001", siteValue: "2022" },
        },
      ]),
    );
    expect(r.assertions[0]).toMatchObject({ verdict: "unverified", contradiction: null });
  });

  describe("the same value written two ways is not a contradiction", () => {
    const contradictionBetween = async (
      engineQuote: string,
      engineValue: string,
      siteQuote: string,
      siteValue: string,
    ) => {
      const r = await checkAccuracy(
        "https://acme.example/",
        crawl([page("https://acme.example/", siteQuote)], 1),
        [branded({ query: "who is Acme Design", fullAnswer: engineQuote })],
        [],
        run([
          {
            claim: "Acme Design's figure is the one the site gives.",
            engineQuote,
            verdict: "contradicted",
            siteQuote,
            searchTerms: ["Acme"],
            subject: "prospect",
            contradiction: { attribute: "figure", engineValue, siteValue },
          },
        ]),
      );
      return r.assertions[0]?.verdict;
    };

    it("LA and Los Angeles", async () => {
      expect(
        await contradictionBetween(
          "Acme Design is based in LA.",
          "LA",
          "Acme Design is based in Los Angeles.",
          "Los Angeles",
        ),
      ).toBe("unverified");
    });

    it("12 and twelve", async () => {
      expect(
        await contradictionBetween(
          "Acme Design has 12 staff.",
          "12",
          "Acme Design has twelve staff.",
          "twelve",
        ),
      ).toBe("unverified");
    });

    it("$1M and $1,000,000", async () => {
      expect(
        await contradictionBetween(
          "Acme Design reports revenue of $1M.",
          "$1M",
          "Acme Design reports revenue of $1,000,000.",
          "$1,000,000",
        ),
      ).toBe("unverified");
    });

    it("still stands for two different years: 2001 against 2022", async () => {
      expect(
        await contradictionBetween(
          "Acme Design was founded in 2001.",
          "2001",
          "Acme Design opened in 2022.",
          "2022",
        ),
      ).toBe("contradicted");
    });
  });

  it("the engine half of the check: an engine value not in its own quote does not stand", async () => {
    // "1999" is not in the engine's quote, so the contradiction is not held,
    // even though the site's value is in its quote.
    const site = crawl([page("https://north.example/", "Northwind Supply opened in 2022.")], 1);
    const answer = branded({
      query: "who is Northwind Supply",
      fullAnswer: "Northwind Supply was established in 2001.",
    });
    const r = await checkAccuracy(
      "https://north.example/",
      site,
      [answer],
      [],
      run([
        {
          claim: "Northwind Supply was founded in 1999.",
          engineQuote: "established in 2001",
          verdict: "contradicted",
          siteQuote: "opened in 2022",
          searchTerms: ["Northwind"],
          subject: "prospect",
          contradiction: { attribute: "founding year", engineValue: "1999", siteValue: "2022" },
        },
      ]),
    );
    expect(r.assertions[0]).toMatchObject({
      verdict: "unverified",
      unverifiedReason: NO_SECOND_VALUE,
    });
  });

  it("the otherName is kept only for a statement about another business", async () => {
    const site = crawl([page("https://acme.example/", "Acme Design is a studio.")], 1);
    const answer = branded({
      query: "who is Acme Design",
      fullAnswer: "Acme Design is a studio run by Northwind.",
    });
    const r = await checkAccuracy(
      "https://acme.example/",
      site,
      [answer],
      [],
      run([
        {
          claim: "Acme Design is run by Northwind.",
          engineQuote: "Acme Design is a studio run by Northwind",
          verdict: "absent",
          siteQuote: null,
          searchTerms: ["Northwind"],
          subject: "prospect",
          otherName: "Northwind",
        },
      ]),
    );
    expect(r.assertions[0]?.otherName).toBeNull();
  });
});

describe("review round 1: unknown enum values do not fail the stage", () => {
  const base = {
    claim: "Acme is rated highly.",
    engineQuote: "Acme is rated highly",
    verdict: "absent",
    siteQuote: null,
    searchTerms: ["Acme"],
  };

  it("parses an unknown topic as other", () => {
    const parsed = AccuracySchema.parse({ assertions: [{ ...base, topic: "ratings" }] });
    expect(parsed.assertions[0]?.topic).toBe("other");
  });

  it("parses an unknown subject as unclear", () => {
    const parsed = AccuracySchema.parse({ assertions: [{ ...base, subject: "the business" }] });
    expect(parsed.assertions[0]?.subject).toBe("unclear");
  });
});

describe("review round 1: the site counts as read whole only when its pages were read", () => {
  const ORIGIN = "https://example.com";
  const urls = (n: number) => Array.from({ length: n }, (_, i) => `${ORIGIN}/p${i}`);
  /** A crawl that took `n` pages, all read, with the sitemap as given. */
  const taken = (
    n: number,
    sitemap: CrawlResult["sitemap"],
  ): Pick<CrawlResult, "sitemap" | "pages"> => ({
    sitemap,
    pages: urls(n).map((u) => page(u, "Text.")),
  });
  const readAll = (n: number) => ({ crawlFullyRead: true, pagesRead: n, readUrls: urls(n) });

  describe("(a) a crawl that reached its page cap is never read whole", () => {
    it("is not full when the crawl took exactly the cap, even with a matching sitemap", () => {
      const sitemap = { present: true, urlCount: 20, truncated: false, sample: urls(20) };
      expect(siteCoverage(readAll(20), taken(20, sitemap), 20).full).toBe(false);
    });

    it("is full one page under the cap, on the same evidence", () => {
      const sitemap = { present: true, urlCount: 19, truncated: false, sample: urls(19) };
      expect(siteCoverage(readAll(19), taken(19, sitemap), 20).full).toBe(true);
    });

    it("takes the cap as a parameter, so a different cap is honoured", () => {
      const sitemap = { present: true, urlCount: 5, truncated: false, sample: urls(5) };
      expect(siteCoverage(readAll(5), taken(5, sitemap), 5).full).toBe(false);
    });
  });

  describe("(b) a sitemap whose truncated flag is missing is not known to be complete", () => {
    const sitemapSample = { present: true, urlCount: 3, sample: urls(3) };

    it("is not full when truncated is absent", () => {
      expect(siteCoverage(readAll(3), taken(3, sitemapSample), 20).full).toBe(false);
    });

    it("is full only once truncated is explicitly false", () => {
      expect(
        siteCoverage(readAll(3), taken(3, { ...sitemapSample, truncated: false }), 20).full,
      ).toBe(true);
    });
  });

  describe("(c) the sitemap's sample decides which pages were the site", () => {
    it("is not full when the sample is incomplete (fewer URLs than the count)", () => {
      const sitemap = { present: true, urlCount: 3, truncated: false, sample: urls(2) };
      expect(siteCoverage(readAll(3), taken(3, sitemap), 20).full).toBe(false);
    });

    it("is not full when the sample is absent", () => {
      const sitemap = { present: true, urlCount: 3, truncated: false };
      expect(siteCoverage(readAll(3), taken(3, sitemap), 20).full).toBe(false);
    });

    it("is not full when a complete sample lists a URL we did not read", () => {
      const sitemap = {
        present: true,
        urlCount: 3,
        truncated: false,
        sample: [...urls(2), `${ORIGIN}/never-read`],
      };
      expect(siteCoverage(readAll(3), taken(3, sitemap), 20).full).toBe(false);
    });

    it("is full when every sampled URL was read, after normalising scheme, www and a trailing slash", () => {
      const sitemap = {
        present: true,
        urlCount: 3,
        truncated: false,
        sample: ["http://www.example.com/p0/", "https://example.com/p1", "https://example.com/p2/"],
      };
      expect(siteCoverage(readAll(3), taken(3, sitemap), 20).full).toBe(true);
    });
  });

  describe("(d) the P-of-S reason comes first when the site size is known", () => {
    it("says how many of the site's pages we read", () => {
      const sitemap = { present: true, urlCount: 95, truncated: false, sample: [] };
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 20, readUrls: urls(20) },
        taken(20, sitemap),
        20,
      );
      expect(r).toEqual({
        full: false,
        reason: "We read 20 of your 95 pages, so we cannot say this is absent from your site.",
      });
    });

    it("at the page cap, says the crawl stopped at its limit, not that the site is larger", () => {
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 20, readUrls: urls(20) },
        taken(20, { present: false, urlCount: 0 }),
        20,
      );
      expect(r.reason).toBe(
        "Our crawl stopped at its page limit, so we cannot say this is absent from your site.",
      );
    });

    it("below the cap with an unknown site size, says we could not learn the size", () => {
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 5, readUrls: urls(5) },
        taken(5, { present: false, urlCount: 0 }),
        20,
      );
      expect(r.reason).toBe(
        "We could not learn how many pages your site has, so we cannot say this is absent from it.",
      );
    });
  });

  describe("(e) a one-page site reads grammatically", () => {
    it("gives the sitemap-match reason, not 'larger' or the one-page wording, when a one-page site was not fully read", () => {
      const sitemap = { present: true, urlCount: 1, truncated: false, sample: urls(1) };
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 1, readUrls: urls(1) },
        taken(1, sitemap),
        20,
      );
      expect(r.reason).toBe(
        "We could not match the pages we read to your sitemap, so we cannot say this is absent from your site.",
      );
      expect(r.reason).not.toMatch(/1 of your 1/);
    });

    it("keeps the plural for a site of more than one page", () => {
      const sitemap = { present: true, urlCount: 2, truncated: false, sample: urls(2) };
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 1, readUrls: urls(1) },
        taken(1, sitemap),
        20,
      );
      expect(r.reason).toBe(
        "We read 1 of your 2 pages, so we cannot say this is absent from your site.",
      );
    });
  });

  it("through checkAccuracy: an absent on a 20-page crawl at the cap, with a 5-URL sitemap, is unverified", async () => {
    const pages = urls(20).map((u, i) => page(u, `Page ${i} of Northwind Supply.`));
    const c: CrawlResult = {
      ...crawl(pages),
      sitemap: { present: true, urlCount: 5, truncated: false },
    };
    const r = await checkAccuracy(
      "https://example.com/",
      c,
      [
        branded({
          query: "who is Northwind Supply",
          fullAnswer: "Northwind Supply is at 12 Harbor Road.",
        }),
      ],
      [],
      {
        run: async () => ({
          assertions: [
            {
              claim: "The business is based at 12 Harbor Road.",
              engineQuote: "at 12 Harbor Road",
              verdict: "absent",
              siteQuote: null,
              searchTerms: ["12 Harbor Road"],
            },
          ],
        }),
        ownership: { fetchPage: async () => null },
      },
    );
    expect(r.siteFullyRead).toBe(false);
    expect(r.assertions[0]?.verdict).toBe("unverified");
  });
});

describe("review round 2: the stored verdicts", () => {
  const offline = { fetchPage: async () => null };
  const run = (assertions: unknown[]) => ({
    run: async () => ({ assertions }),
    ownership: offline,
  });

  /** One contradicted statement about Acme Design. The answer is the engine's
   *  quote and the site is the site quote, so both quotes are real; the test
   *  is about whether each value is held and whether the statement is stated. */
  const storedContradiction = async (p: {
    engineQuote: string;
    engineValue: string;
    siteQuote: string;
    siteValue: string;
    subject?: string;
    topic?: string;
  }) => {
    const r = await checkAccuracy(
      "https://acme.example/",
      crawl([page("https://acme.example/", p.siteQuote)], 1),
      [branded({ query: "who is Acme Design", fullAnswer: p.engineQuote })],
      [],
      run([
        {
          claim: `Acme Design: ${p.engineValue}, not ${p.siteValue}.`,
          engineQuote: p.engineQuote,
          verdict: "contradicted",
          siteQuote: p.siteQuote,
          searchTerms: ["Acme Design"],
          subject: p.subject ?? "prospect",
          topic: p.topic ?? "other",
          contradiction: {
            attribute: "figure",
            engineValue: p.engineValue,
            siteValue: p.siteValue,
          },
        },
      ]),
    );
    return r.assertions[0];
  };

  // ---- Fix 1: a contradiction about another business, or a withheld topic ----
  describe("a contradiction about another business, or on a withheld topic, is not stated", () => {
    it("another business: unverified, with its reason, and both values kept", async () => {
      const row = await storedContradiction({
        engineQuote: "The most likely match is Northwind Studio, which was founded in 1994",
        engineValue: "1994",
        siteQuote: "Founded in 2004.",
        siteValue: "2004",
        subject: "other",
      });
      expect(row).toMatchObject({
        verdict: "unverified",
        unverifiedReason:
          "The answer may be describing another business, so we have not set it against your site.",
        contradiction: { attribute: "figure", engineValue: "1994", siteValue: "2004" },
      });
    });

    it("a withheld topic: unverified, with its reason, and both values kept", async () => {
      const row = await storedContradiction({
        engineQuote: "Acme Design has a 3.2 rating on Glassdoor",
        engineValue: "3.2",
        siteQuote: "Rated 4.8 out of 5 by our clients.",
        siteValue: "4.8",
        topic: "ratings_reviews",
      });
      expect(row).toMatchObject({
        verdict: "unverified",
        unverifiedReason:
          "This is a topic we do not check, so we have not set it against your site.",
        contradiction: { attribute: "figure", engineValue: "3.2", siteValue: "4.8" },
      });
    });

    it("control: a prospect's founding year, on an unwithheld topic, stays contradicted", async () => {
      const row = await storedContradiction({
        engineQuote: "Acme Design was founded in 2001.",
        engineValue: "2001",
        siteQuote: "Acme Design opened in 2022.",
        siteValue: "2022",
        subject: "prospect",
        topic: "other",
      });
      expect(row).toMatchObject({ verdict: "contradicted", unverifiedReason: null });
      expect(row?.contradiction).toEqual({
        attribute: "figure",
        engineValue: "2001",
        siteValue: "2022",
      });
    });
  });

  // ---- Fix 2: the same value written two ways ----
  describe("the same value written two ways is not a contradiction", () => {
    it.each([
      [
        "a phone number, with and without brackets",
        "Acme Design's office is at (555) 010-0100.",
        "(555) 010-0100",
        "Call Acme Design at 555-010-0100.",
        "555-010-0100",
      ],
      [
        "9am and 9:00 AM",
        "Acme Design opens at 9am.",
        "9am",
        "Acme Design opens at 9:00 AM.",
        "9:00 AM",
      ],
      [
        "L.A. and Los Angeles",
        "Acme Design is based in L.A.",
        "L.A.",
        "Acme Design is based in Los Angeles.",
        "Los Angeles",
      ],
      [
        "LA and Los Angeles, CA",
        "Acme Design is based in LA.",
        "LA",
        "Acme Design is based in Los Angeles, CA.",
        "Los Angeles, CA",
      ],
      [
        "St. Louis and Saint Louis",
        "Acme Design is on St. Louis Avenue.",
        "St. Louis",
        "Acme Design is on Saint Louis Avenue.",
        "Saint Louis",
      ],
      [
        "thirty and 30",
        "Acme Design has thirty staff.",
        "thirty",
        "Acme Design has 30 staff.",
        "30",
      ],
      [
        "twenty-five and 25",
        "Acme Design has twenty-five staff.",
        "twenty-five",
        "Acme Design has 25 staff.",
        "25",
      ],
      ["Texas and TX", "Acme Design is in Texas.", "Texas", "Acme Design is in TX.", "TX"],
    ])(
      "%s are the same value, so not contradicted",
      async (_name, engineQuote, engineValue, siteQuote, siteValue) => {
        const row = await storedContradiction({ engineQuote, engineValue, siteQuote, siteValue });
        expect(row?.verdict).toBe("unverified");
        expect(row?.unverifiedReason).toBe(
          "The passage we found does not show a different value for this, so we have not stated it either way.",
        );
      },
    );

    it.each([
      [
        "2001 and 2022",
        "Acme Design was founded in 2001.",
        "2001",
        "Acme Design opened in 2022.",
        "2022",
      ],
      [
        "Denver and Austin",
        "Acme Design is based in Denver.",
        "Denver",
        "Acme Design is based in Austin.",
        "Austin",
      ],
      [
        "phone numbers one digit apart",
        "Acme Design's office is at (555) 010-0100.",
        "(555) 010-0100",
        "Acme Design's office is at (555) 010-0199.",
        "(555) 010-0199",
      ],
      ["9am and 10am", "Acme Design opens at 9am.", "9am", "Acme Design opens at 10am.", "10am"],
      ["Texas and CA", "Acme Design is in Texas.", "Texas", "Acme Design is in CA.", "CA"],
    ])("%s stay contradicted", async (_name, engineQuote, engineValue, siteQuote, siteValue) => {
      const row = await storedContradiction({ engineQuote, engineValue, siteQuote, siteValue });
      expect(row?.verdict).toBe("contradicted");
    });
  });

  // ---- Fix 3: substring matching no longer drops real contradictions ----
  describe("a real contradiction is not dropped by substring matching", () => {
    it.each([
      ["10 and 100", "Acme Design has 10 locations.", "10", "We have 100 locations.", "100"],
      ["200 and 20", "Acme Design has 200 locations.", "200", "We have 20 locations.", "20"],
    ])("%s stay contradicted", async (_name, engineQuote, engineValue, siteQuote, siteValue) => {
      const row = await storedContradiction({ engineQuote, engineValue, siteQuote, siteValue });
      expect(row).toMatchObject({ verdict: "contradicted", unverifiedReason: null });
    });
  });

  // ---- Fix 4: a support match cannot rest on the business's own name ----
  describe("a support match does not rest on the business's own name and suffix", () => {
    it("a suffix after the name is not shared support", () => {
      expect(
        quoteSupportsClaim(
          "Acme Design Group is based in Calder.",
          "© 2026 Acme Design Group. All rights reserved.",
          "Acme Design",
        ),
      ).toBe(false);
    });

    it("the name is excluded only where it is the name, so a later word still counts", () => {
      expect(
        quoteSupportsClaim(
          "Acme Dental places dental implants.",
          "We place dental implants.",
          "Acme Dental",
        ),
      ).toBe(true);
    });

    it("through checkAccuracy: a confirmed that shares only the name and its suffix is unverified", async () => {
      const quote = "© 2026 Acme Design Group. All rights reserved.";
      const r = await checkAccuracy(
        "https://acme.example/",
        crawl([page("https://acme.example/", quote)], 1),
        [
          branded({
            query: "who is Acme Design",
            fullAnswer: "Acme Design Group is based in Calder.",
          }),
        ],
        [],
        run([
          {
            claim: "Acme Design Group is based in Calder.",
            engineQuote: "Acme Design Group is based in Calder.",
            verdict: "confirmed",
            siteQuote: quote,
            searchTerms: ["Calder"],
          },
        ]),
      );
      expect(r.assertions[0]?.verdict).toBe("unverified");
    });
  });

  // ---- Fix 5: a quote must sit inside one answer ----
  describe("a quote must sit inside one answer", () => {
    const twoAnswers = [
      branded({ query: "who is Acme Design", fullAnswer: "Acme is a studio" }),
      branded({ query: "who is Acme Design", fullAnswer: "in Calder with 4.9 stars." }),
    ];
    const site = crawl([page("https://acme.example/", "Acme is a studio in Calder.")], 1);

    it("discards a quote that runs from one answer into the next", async () => {
      const r = await checkAccuracy(
        "https://acme.example/",
        site,
        twoAnswers,
        [],
        run([
          {
            claim: "Acme is a studio in Calder.",
            engineQuote: "Acme is a studio in Calder",
            verdict: "absent",
            siteQuote: null,
            searchTerms: ["Calder"],
          },
        ]),
      );
      expect(r.assertions).toHaveLength(0);
    });

    it("keeps a quote that sits inside one answer", async () => {
      const r = await checkAccuracy(
        "https://acme.example/",
        site,
        twoAnswers,
        [],
        run([
          {
            claim: "Acme has 4.9 stars.",
            engineQuote: "in Calder with 4.9 stars",
            verdict: "absent",
            siteQuote: null,
            searchTerms: ["4.9 stars"],
          },
        ]),
      );
      expect(r.assertions).toHaveLength(1);
    });

    it("a conflation quote that runs across two answers is not recorded", async () => {
      const r = await checkAccuracy("https://acme.example/", site, twoAnswers, [], {
        run: async () => ({
          assertions: [],
          conflation: {
            detected: true,
            settled: true,
            otherNames: ["Acme Design Co"],
            engineQuote: "Acme is a studio in Calder",
          },
        }),
        ownership: offline,
      });
      expect(r.conflation.detected).toBe(false);
    });

    it("a conflation quote inside one answer is recorded", async () => {
      const r = await checkAccuracy("https://acme.example/", site, twoAnswers, [], {
        run: async () => ({
          assertions: [],
          conflation: {
            detected: true,
            settled: true,
            otherNames: ["Acme Design Co"],
            engineQuote: "in Calder with 4.9 stars",
          },
        }),
        ownership: offline,
      });
      expect(r.conflation.detected).toBe(true);
    });
  });

  // ---- Fix 6: the coverage reason says only what we know ----
  describe("the coverage reason states only what we know", () => {
    const ORIGIN = "https://example.com";
    const urls = (n: number) => Array.from({ length: n }, (_, i) => `${ORIGIN}/p${i}`);
    const taken = (n: number, sitemap: CrawlResult["sitemap"]) => ({
      sitemap,
      pages: urls(n).map((u) => page(u, "Text.")),
    });
    const generic =
      "The site was larger than we read in one pass, so we cannot say this is absent from it.";

    it("a crawl of 4 pages against a 3-page sitemap gives the sitemap-match reason, not 'larger'", () => {
      const sitemap = { present: true, urlCount: 3, truncated: false, sample: [] };
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 4, readUrls: urls(4) },
        taken(4, sitemap),
        20,
      );
      expect(r.reason).toBe(
        "We could not match the pages we read to your sitemap, so we cannot say this is absent from your site.",
      );
    });

    it("a one-page site not fully read gives the sitemap-match reason, not 'larger' or the one-page wording", () => {
      const sitemap = { present: true, urlCount: 1, truncated: false, sample: urls(1) };
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 1, readUrls: urls(1) },
        taken(1, sitemap),
        20,
      );
      expect(r.reason).toBe(
        "We could not match the pages we read to your sitemap, so we cannot say this is absent from your site.",
      );
    });

    it("a sitemap whose truncated flag is missing gives the generic reason, not the count", () => {
      const sitemap = { present: true, urlCount: 95, sample: [] };
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 20, readUrls: urls(20) },
        taken(20, sitemap as CrawlResult["sitemap"]),
        20,
      );
      expect(r.reason).toBe(generic);
    });

    it("a truncated sitemap gives the generic reason, not 'of your 50000 pages'", () => {
      const sitemap = { present: true, urlCount: 50000, truncated: true, sample: [] };
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 20, readUrls: urls(20) },
        taken(20, sitemap),
        20,
      );
      expect(r.reason).toBe(generic);
    });
  });

  // ---- Fix 7: a malformed contradiction does not fail the stage ----
  describe("a malformed contradiction does not fail the stage", () => {
    it("parses, with the contradiction read as null", () => {
      const parsed = AccuracySchema.parse({
        assertions: [
          {
            claim: "Acme Design was founded in 2001.",
            engineQuote: "Acme Design was founded in 2001",
            verdict: "contradicted",
            siteQuote: "Acme Design opened in 2022.",
            searchTerms: ["2001"],
            contradiction: { attribute: "founding year", engineValue: "2001" },
          },
        ],
      });
      expect(parsed.assertions[0]?.contradiction).toBeNull();
    });

    it("stores its row unverified and leaves the other rows as they were", async () => {
      const site = crawl(
        [
          page(
            "https://acme.example/",
            "Acme Design is a studio in Calder. Acme Design opened in 2022.",
          ),
        ],
        1,
      );
      const r = await checkAccuracy(
        "https://acme.example/",
        site,
        [
          branded({
            query: "who is Acme Design",
            fullAnswer: "Acme Design is a studio in Calder. Acme Design was founded in 2001.",
          }),
        ],
        [],
        run([
          {
            claim: "Acme Design was founded in 2001.",
            engineQuote: "Acme Design was founded in 2001",
            verdict: "contradicted",
            siteQuote: "Acme Design opened in 2022.",
            searchTerms: ["2001"],
            contradiction: { attribute: "founding year", engineValue: "2001" },
          },
          {
            claim: "Acme Design is a studio in Calder.",
            engineQuote: "Acme Design is a studio in Calder",
            verdict: "confirmed",
            siteQuote: "Acme Design is a studio in Calder.",
            searchTerms: ["Calder"],
          },
        ]),
      );
      expect(r.assertions).toHaveLength(2);
      expect(r.assertions[0]).toMatchObject({
        verdict: "unverified",
        contradiction: null,
        unverifiedReason: NO_SECOND_VALUE,
      });
      expect(r.assertions[1]).toMatchObject({ verdict: "confirmed" });
    });
  });
});

describe("review round 3: a stored verdict is held to its text and its values", () => {
  const offline = { fetchPage: async () => null };
  const run = (assertions: unknown[]) => ({
    run: async () => ({ assertions }),
    ownership: offline,
  });
  const WITHHELD = "This is a topic we do not check, so we have not set it against your site.";
  const ANOTHER_BUSINESS =
    "The answer may be describing another business, so we have not set it against your site.";
  const SAME_VALUE =
    "The passage we found does not show a different value for this, so we have not stated it either way.";
  const SITEMAP_MATCH =
    "We could not match the pages we read to your sitemap, so we cannot say this is absent from your site.";
  const LARGER =
    "The site was larger than we read in one pass, so we cannot say this is absent from it.";

  /** A contradicted row about Acme Design, filed under `other` unless told
   *  otherwise. Both quotes are real, so the row is judged on its values. */
  const contradictionRow = async (p: {
    engineQuote: string;
    engineValue: string;
    siteQuote: string;
    siteValue: string;
    subject?: string;
    topic?: string;
    attribute?: string;
  }) => {
    const r = await checkAccuracy(
      "https://acme.example/",
      crawl([page("https://acme.example/", p.siteQuote)], 1),
      [branded({ query: "who is Acme Design", fullAnswer: p.engineQuote })],
      [],
      run([
        {
          claim: p.engineQuote,
          engineQuote: p.engineQuote,
          verdict: "contradicted",
          siteQuote: p.siteQuote,
          searchTerms: ["Acme Design"],
          subject: p.subject ?? "prospect",
          topic: p.topic ?? "other",
          contradiction: {
            attribute: p.attribute ?? "figure",
            engineValue: p.engineValue,
            siteValue: p.siteValue,
          },
        },
      ]),
    );
    return r.assertions[0];
  };

  // ---- Fix 1: a withheld topic filed under `other` is read off its text ----
  describe("1. a rating or headcount filed under other is withheld", () => {
    it("a rating filed under other is unverified, with its values kept", async () => {
      const row = await contradictionRow({
        engineQuote: "Acme Design has a 3.2 rating on Glassdoor",
        engineValue: "3.2",
        siteQuote: "Rated 4.8 out of 5 by our clients.",
        siteValue: "4.8",
      });
      expect(row).toMatchObject({
        verdict: "unverified",
        unverifiedReason: WITHHELD,
        contradiction: { attribute: "figure", engineValue: "3.2", siteValue: "4.8" },
      });
    });

    it("a headcount filed under other is unverified, with its values kept", async () => {
      const row = await contradictionRow({
        engineQuote: "Acme Design has 10 employees",
        engineValue: "10",
        siteQuote: "Our team of 45 designers.",
        siteValue: "45",
      });
      expect(row).toMatchObject({
        verdict: "unverified",
        unverifiedReason: WITHHELD,
        contradiction: { attribute: "figure", engineValue: "10", siteValue: "45" },
      });
    });

    it("control: a founding year filed under other stays contradicted", async () => {
      const row = await contradictionRow({
        engineQuote: "Acme Design was founded in 2001.",
        engineValue: "2001",
        siteQuote: "Founded in 2022.",
        siteValue: "2022",
      });
      expect(row).toMatchObject({ verdict: "contradicted", unverifiedReason: null });
    });

    it("control: a city filed under other stays contradicted", async () => {
      const row = await contradictionRow({
        engineQuote: "Acme Design is based in Denver.",
        engineValue: "Denver",
        siteQuote: "Our studio is in Austin.",
        siteValue: "Austin",
      });
      expect(row).toMatchObject({ verdict: "contradicted", unverifiedReason: null });
    });
  });

  // ---- Fix 2: one location written two ways ----
  describe("2. the same location written two ways is not a contradiction", () => {
    it.each([
      ["Austin, Texas", "Austin, TX"],
      ["Portland, Maine", "Portland, ME"],
      ["NYC", "New York"],
      ["NYC", "New York City"],
    ])("%s and %s are the same place", async (engineValue, siteValue) => {
      const row = await contradictionRow({
        engineQuote: `Acme Design is based in ${engineValue}.`,
        engineValue,
        siteQuote: `Acme Design is based in ${siteValue}.`,
        siteValue,
      });
      expect(row).toMatchObject({ verdict: "unverified", unverifiedReason: SAME_VALUE });
    });

    it("SF is San Francisco by the table, so SF against Santa Fe stays contradicted", async () => {
      const row = await contradictionRow({
        engineQuote: "Acme Design is in SF.",
        engineValue: "SF",
        siteQuote: "Acme Design is in Santa Fe.",
        siteValue: "Santa Fe",
      });
      expect(row).toMatchObject({ verdict: "contradicted", unverifiedReason: null });
    });

    it.each([
      ["Austin, Texas", "Dallas, TX"],
      ["Portland, Maine", "Portland, OR"],
      ["Denver", "Austin"],
    ])("%s and %s stay contradicted", async (engineValue, siteValue) => {
      const row = await contradictionRow({
        engineQuote: `Acme Design is based in ${engineValue}.`,
        engineValue,
        siteQuote: `Acme Design is based in ${siteValue}.`,
        siteValue,
      });
      expect(row).toMatchObject({ verdict: "contradicted", unverifiedReason: null });
    });
  });

  // ---- Fix 3: opening hours written two ways ----
  describe("3. the same opening hours written two ways is not a contradiction", () => {
    it.each([
      ["9am-5pm", "9:00 AM - 5:00 PM"],
      ["9-5", "9am to 5pm"],
      ["Mon-Fri 9am-5pm", "Monday to Friday, 9:00 AM - 5:00 PM"],
    ])("%s and %s are the same hours", async (engineValue, siteValue) => {
      const row = await contradictionRow({
        engineQuote: `Acme Design is open ${engineValue}.`,
        engineValue,
        siteQuote: `Acme Design is open ${siteValue}.`,
        siteValue,
      });
      expect(row).toMatchObject({ verdict: "unverified", unverifiedReason: SAME_VALUE });
    });

    it.each([
      ["9am-5pm", "10am-6pm"],
      ["9am-5pm", "9am-6pm"],
    ])("%s and %s stay contradicted", async (engineValue, siteValue) => {
      const row = await contradictionRow({
        engineQuote: `Acme Design is open ${engineValue}.`,
        engineValue,
        siteQuote: `Acme Design is open ${siteValue}.`,
        siteValue,
      });
      expect(row).toMatchObject({ verdict: "contradicted", unverifiedReason: null });
    });
  });

  // ---- Fix 4 (and lens B 10): figures with units or punctuation ----
  describe("4. figures that differ in their numbers are contradicted", () => {
    it.each([
      ["$1,500/month", "$15.00/month"],
      ["2.5 weeks", "25 weeks"],
      ["1/12/2019", "11/2/2019"],
      ["2 million", "2"],
    ])("%s and %s stay contradicted", async (engineValue, siteValue) => {
      const row = await contradictionRow({
        engineQuote: `Acme Design's figure is ${engineValue}.`,
        engineValue,
        siteQuote: `Acme Design's figure is ${siteValue}.`,
        siteValue,
      });
      expect(row).toMatchObject({ verdict: "contradicted", unverifiedReason: null });
    });

    it.each([
      ["$1,500/month", "$1500 per month"],
      ["2.5 weeks", "2.5 wks"],
    ])("%s and %s are the same figure, so not contradicted", async (engineValue, siteValue) => {
      const row = await contradictionRow({
        engineQuote: `Acme Design's figure is ${engineValue}.`,
        engineValue,
        siteQuote: `Acme Design's figure is ${siteValue}.`,
        siteValue,
      });
      expect(row).toMatchObject({ verdict: "unverified", unverifiedReason: SAME_VALUE });
    });
  });

  // ---- Fix 5: a confirmation rests on the name's words, not the legal suffix or "&" ----
  describe("5. a confirmation does not rest on the business's own name", () => {
    const confirmed = async (query: string, fullAnswer: string, siteQuote: string) =>
      (
        await checkAccuracy(
          "https://northwind.example/",
          crawl([page("https://northwind.example/", siteQuote)], 1),
          [branded({ query, fullAnswer })],
          [],
          run([
            {
              claim: fullAnswer,
              engineQuote: fullAnswer,
              verdict: "confirmed",
              siteQuote,
              searchTerms: ["architecture"],
            },
          ]),
        )
      ).assertions[0];

    it("a legal suffix on the query does not make the name's words support the claim", async () => {
      const row = await confirmed(
        "who is Northwind Acme, LLC",
        "Northwind Acme is an architecture firm.",
        "© 2026 Northwind Acme. All rights reserved.",
      );
      expect(row?.verdict).toBe("unverified");
    });

    it("an ampersand in the query is matched with its 'and' form in the text", async () => {
      const row = await confirmed(
        "who is Northwind & Acme",
        "Northwind and Acme is an architecture firm.",
        "© 2026 Northwind and Acme. All rights reserved.",
      );
      expect(row?.verdict).toBe("unverified");
    });

    it("control: a passage that says the claim stays confirmed under the suffixed name", async () => {
      const row = await confirmed(
        "who is Northwind Acme, LLC",
        "Northwind Acme installs commercial skylights.",
        "Northwind Acme installs commercial skylights.",
      );
      expect(row?.verdict).toBe("confirmed");
    });
  });

  // ---- Fix 6: an empty engine quote is no quote ----
  describe("6. an empty or whitespace engine quote is discarded", () => {
    const site = crawl([page("https://acme.example/", "Acme Design is a studio in Calder.")], 1);
    const answer = branded({
      query: "who is Acme Design",
      fullAnswer: "Acme Design is a studio in Calder. Acme Design is run by Northwind Studio.",
    });

    it.each([[""], ["   "]])("an absent row with engineQuote %j is discarded", async (quote) => {
      const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
        run: async () => ({
          assertions: [
            {
              claim: "Acme Design is run by Northwind Studio.",
              engineQuote: quote,
              verdict: "absent",
              siteQuote: null,
              searchTerms: ["Northwind"],
            },
          ],
        }),
        ownership: offline,
      });
      expect(r.assertions).toHaveLength(0);
    });

    it.each([[""], ["   "]])("a conflation with engineQuote %j is not detected", async (quote) => {
      const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
        run: async () => ({
          assertions: [],
          conflation: {
            detected: true,
            settled: false,
            otherNames: ["Northwind Studio"],
            engineQuote: quote,
          },
        }),
        ownership: offline,
      });
      expect(r.conflation).toEqual({
        detected: false,
        settled: false,
        otherNames: ["Northwind Studio"],
        engineQuote: "",
      });
    });

    it("control: a real quote is kept", async () => {
      const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
        run: async () => ({
          assertions: [
            {
              claim: "Acme Design is a studio in Calder.",
              engineQuote: "Acme Design is a studio in Calder",
              verdict: "absent",
              siteQuote: null,
              searchTerms: ["Northwind"],
            },
          ],
        }),
        ownership: offline,
      });
      expect(r.assertions).toHaveLength(1);
      expect(r.assertions[0]?.engineQuote).toBe("Acme Design is a studio in Calder");
    });
  });

  // ---- Fix 9: a missing or unclear subject is out of scope ----
  describe("9. a missing or unclear subject is another business", () => {
    it.each([
      ["no subject", {}],
      ["subject unclear", { subject: "unclear" }],
    ])(
      "%s: the 2001 and 2022 contradiction is unverified, with its values kept",
      async (_name, extra) => {
        const r = await checkAccuracy(
          "https://acme.example/",
          crawl([page("https://acme.example/", "Acme Design opened in 2022.")], 1),
          [
            branded({
              query: "who is Acme Design",
              fullAnswer: "Acme Design was founded in 2001.",
            }),
          ],
          [],
          run([
            {
              claim: "Acme Design was founded in 2001.",
              engineQuote: "Acme Design was founded in 2001",
              verdict: "contradicted",
              siteQuote: "Acme Design opened in 2022.",
              searchTerms: ["2001"],
              topic: "other",
              ...extra,
              contradiction: { attribute: "founding year", engineValue: "2001", siteValue: "2022" },
            },
          ]),
        );
        expect(r.assertions[0]).toMatchObject({
          verdict: "unverified",
          unverifiedReason: ANOTHER_BUSINESS,
          contradiction: { attribute: "founding year", engineValue: "2001", siteValue: "2022" },
        });
      },
    );
  });

  // ---- Fix 11 (and lens B 11): a bare number is not a time ----
  describe("11. figures that only look alike are not the same value", () => {
    it("900 against 9:00am stays contradicted, while the phone pairs still match", async () => {
      const row = await contradictionRow({
        engineQuote: "Acme Design opens at 900.",
        engineValue: "900",
        siteQuote: "Acme Design opens at 9:00am.",
        siteValue: "9:00am",
      });
      expect(row).toMatchObject({ verdict: "contradicted", unverifiedReason: null });
    });
  });

  // ---- Fix 12: "larger than we read" only when the sitemap says so ----
  describe("12. the coverage reason at the crawl cap is not 'larger'", () => {
    const ORIGIN = "https://example.com";
    const urls = (n: number) => Array.from({ length: n }, (_, i) => `${ORIGIN}/p${i}`);
    const taken = (n: number, sitemap: CrawlResult["sitemap"]) => ({
      sitemap,
      pages: urls(n).map((u) => page(u, "Text.")),
    });

    it("a complete sitemap of 20 pages, all 20 read at a cap of 20, gives the cap reason", () => {
      const sitemap = { present: true, urlCount: 20, truncated: false, sample: urls(20) };
      const r = siteCoverage(
        { crawlFullyRead: true, pagesRead: 20, readUrls: urls(20) },
        taken(20, sitemap),
        20,
      );
      expect(r).toEqual({
        full: false,
        reason:
          "Our crawl stopped at its page limit, so we cannot say this is absent from your site.",
      });
    });

    it("4 pages read against a 3-page sitemap gives the sitemap-match reason, not 'larger'", () => {
      const sitemap = { present: true, urlCount: 3, truncated: false, sample: [] };
      const r = siteCoverage(
        { crawlFullyRead: false, pagesRead: 4, readUrls: urls(4) },
        taken(4, sitemap),
        20,
      );
      expect(r.reason).toBe(SITEMAP_MATCH);
      expect(r.reason).not.toBe(LARGER);
    });
  });

  // ---- Fix 7 is in scripts/gen-report-shapes.mts; its row is checked by the fixture run ----
});
