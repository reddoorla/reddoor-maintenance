import { describe, expect, it } from "vitest";
import {
  backstopAbsent,
  quoteSupportsClaim,
  buildAccuracyInput,
  checkAccuracy,
  fullSiteText,
  selectPages,
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

function crawl(pages: PageCapture[]): CrawlResult {
  return {
    origin: "https://example.com",
    robotsTxt: null,
    agentAccess: [],
    sitemap: { present: false, urlCount: 0 },
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
  const site = crawl([
    page(
      "https://seaviewdental.example/",
      "Beachfront Dentistry in Riviera Village, Redondo Beach.",
    ),
    page(
      "https://seaviewdental.example/team",
      "Meet Your Team Dr. Priya Raman Dr. Marcus Whitfield",
    ),
  ]);
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

describe("a place the site itself names is never 'contradicted'", () => {
  // The audited site listed a Texas mailing address on one page and "near the
  // Los Angeles metro" on another. The model called "Los Angeles-based"
  // contradicted on the strength of the address alone. The site says both;
  // the honest verdict quotes the site's own sentence.
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

  it("downgrades contradicted to unverified, quoting the site, when the site uses the claim's own terms", async () => {
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
    expect(r.assertions[0]).toMatchObject({
      verdict: "unverified",
      siteQuote: expect.stringContaining("Los Angeles"),
      unverifiedReason: 'Your site does say "Los Angeles", so we have not called this wrong.',
    });
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
  it("downgrades on a term typed in lower case", async () => {
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "Acme Design is based in Los Angeles.",
            engineQuote: "Acme Design (Los Angeles-based)",
            verdict: "contradicted",
            siteQuote: "HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.",
            searchTerms: ["los  angeles"],
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions[0]).toMatchObject({
      verdict: "unverified",
      siteQuote: expect.stringContaining("Los Angeles"),
      unverifiedReason: 'Your site does say "Los Angeles", so we have not called this wrong.',
    });
  });

  it("keeps a supported contradiction as contradicted, with no reason added", async () => {
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim: "Acme Design is located in the Portland metro area.",
            engineQuote: "Acme Design (Los Angeles-based)",
            verdict: "contradicted",
            siteQuote: "We are conveniently located near the Los Angeles metro area.",
            searchTerms: ["Portland"],
          },
        ],
      }),
      ownership: offline,
    });
    expect(r.assertions[0]).toMatchObject({
      verdict: "contradicted",
      siteQuote: "We are conveniently located near the Los Angeles metro area.",
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
      claim: "The business is a bakery known for sourdough bread.",
      engineQuote: "a bakery known for sourdough bread",
      searchTerms: ["fresh flowers"],
      siteQuote: "Our business is known for fresh flowers arranged daily for weddings and events.",
    },
    {
      why: "the claim denies the name the site uses",
      claim: 'No business operates under the name "Rosewood Market".',
      engineQuote: 'I couldn\'t find a company called "Rosewood Market"',
      searchTerms: ["Rosewood Market"],
      siteQuote: "©2026 Rosewood Market | All Rights Reserved",
    },
    {
      why: "the term is only the business's own name",
      claim: "Rosewood Market is a bakery known for sourdough bread.",
      engineQuote: "Rosewood Market is a bakery known for sourdough bread",
      searchTerms: ["Rosewood Market"],
      siteQuote: "Our business is known for fresh flowers arranged daily for weddings and events.",
    },
    {
      why: "the term carries only part of the place the claim asserts",
      claim: "Rosewood Market is based in Lakeside, Oregon.",
      engineQuote: "based in Lakeside, Oregon",
      searchTerms: ["Oregon"],
      // Real on the site, and without the term, so only the place guard holds.
      siteQuote: "Find us in Riverside",
    },
  ])("leaves the model's verdict alone when $why", async (a) => {
    const [r] = await judge(a);
    expect(r?.verdict).not.toBe("confirmed");
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
    expect(r?.siteQuote).toBe(a.siteQuote);
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

describe("a downgrade needs the claim's own names, as words on the site", () => {
  const offline = { fetchPage: async () => null };
  const run = async (opts: {
    siteText: string;
    query: string;
    fullAnswer: string;
    claim: string;
    engineQuote: string;
    term: string;
  }) =>
    (
      await checkAccuracy(
        "https://rosewood.example/",
        crawl([page("https://rosewood.example/", opts.siteText)]),
        [branded({ query: opts.query, citedDomains: [], fullAnswer: opts.fullAnswer })],
        [],
        {
          run: async () => ({
            assertions: [
              {
                claim: opts.claim,
                engineQuote: opts.engineQuote,
                verdict: "contradicted",
                siteQuote: null,
                searchTerms: [opts.term],
              },
            ],
          }),
          ownership: offline,
        },
      )
    ).assertions[0];

  it("does not read another business that shares a word with ours as ours", async () => {
    const r = await run({
      siteText: "We sit beside the Lakeside Bakery on Main Street.",
      query: "who is Rosewood Market",
      fullAnswer: 'The business is called "Rosewood Bakery".',
      claim: 'The business is called "Rosewood Bakery".',
      engineQuote: 'The business is called "Rosewood Bakery".',
      term: "Bakery",
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it("takes the name from a 'reviews' query too, and only as a whole", async () => {
    const r = await run({
      siteText: "Find us on Google any time.",
      query: "Rosewood Market reviews",
      fullAnswer: "Rosewood Market has 5-star Google Reviews.",
      claim: "Rosewood Market has 5-star Google Reviews.",
      engineQuote: "Rosewood Market has 5-star Google Reviews.",
      term: "Google",
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it("does not strip part of a different business's name as if it were ours", async () => {
    const r = await run({
      siteText: "Stay near the Salem waterfront, all week.",
      query: "who is Rosewood Market",
      fullAnswer: "Rosewood Bakery is in Salem.",
      claim: "Rosewood Bakery is in Salem.",
      engineQuote: "Rosewood Bakery is in Salem.",
      term: "Salem",
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it("knows our name from a 'reviews' query", async () => {
    const r = await run({
      siteText: "Stay near the Salem waterfront, all week.",
      query: "Rosewood Market reviews",
      fullAnswer: "Rosewood Market is based in Salem.",
      claim: "Rosewood Market is based in Salem.",
      engineQuote: "Rosewood Market is based in Salem.",
      term: "Salem",
    });
    expect(r?.unverifiedReason).toBe(
      'Your site does say "Salem", so we have not called this wrong.',
    );
  });

  it("does not count the term where it is only part of our own name on the page", async () => {
    const r = await run({
      siteText: "Welcome to Austin Family Dental. Our office is at 12 Oak St, Round Rock.",
      query: "who is Austin Family Dental",
      fullAnswer: "Austin Family Dental is located in downtown Austin.",
      claim: "Austin Family Dental is located in downtown Austin.",
      engineQuote: "Austin Family Dental is located in downtown Austin.",
      term: "Austin",
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it.each([
    [
      "Rosewood Market was founded by Dr. Jane Smith.",
      "Dr. Smith",
      "Founded by Dr. Robert Smith. Dr. Smith still sees patients.",
    ],
    [
      "Rosewood Market is based in St. Paul, near the river.",
      "St. Louis",
      "Two shops, in St. Louis and in Kansas City.",
    ],
  ])("keeps a name after an abbreviation's period asserted: %s", async (claim, term, siteText) => {
    const r = await run({
      siteText,
      query: "who is Rosewood Market",
      fullAnswer: claim,
      claim,
      engineQuote: claim,
      term,
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it("does not doubt a claim that asserts no name, on the model's own counter-evidence", async () => {
    const r = await run({
      siteText: "Fresh flowers arranged daily for weddings and events.",
      query: "who is Rosewood Market",
      fullAnswer: "The business is a bakery known for sourdough bread.",
      claim: "The business is a bakery known for sourdough bread.",
      engineQuote: "The business is a bakery known for sourdough bread.",
      term: "fresh flowers",
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it.each([
    [
      "Texas-based Rosewood Market delivers across Oregon.",
      "Oregon",
      "Rosewood Market, Portland, Oregon. Family-run since 2004.",
    ],
    [
      "Jane Smith founded Rosewood Market in 2010.",
      "Smith",
      "Rosewood Market. Meet the team: Tom Smith, head florist.",
    ],
  ])("counts a name that opens the claim: %s", async (claim, term, siteText) => {
    const r = await run({
      siteText,
      query: "who is Rosewood Market",
      fullAnswer: claim,
      claim,
      engineQuote: claim,
      term,
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it("does not find a name at the start of a longer word", async () => {
    const r = await run({
      siteText: "Stay near Salemtown all week.",
      query: "who is Rosewood Market",
      fullAnswer: "Rosewood Market is based in Salem.",
      claim: "Rosewood Market is based in Salem.",
      engineQuote: "Rosewood Market is based in Salem.",
      term: "Salem",
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it("does not find a name inside another word", async () => {
    const r = await run({
      siteText: "Seasonal Jerusalem artichoke bouquets, all week.",
      query: "who is Rosewood Market",
      fullAnswer: "Rosewood Market is based in Salem.",
      claim: "Rosewood Market is based in Salem.",
      engineQuote: "Rosewood Market is based in Salem.",
      term: "Salem",
    });
    expect(r?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
  });

  it("downgrades when the claim's only other name is the term, quoting the site's own text", async () => {
    const r = await run({
      siteText: "\u0130\u0130\u0130\u0130 Stay near the Salem waterfront, all week.",
      query: "who is Rosewood Market",
      fullAnswer: "Rosewood Market is based in Salem.",
      claim: "Rosewood Market is based in Salem.",
      engineQuote: "Rosewood Market is based in Salem.",
      term: "salem",
    });
    expect(r).toMatchObject({
      verdict: "unverified",
      siteQuote: expect.stringContaining("Salem waterfront"),
      unverifiedReason: 'Your site does say "Salem", so we have not called this wrong.',
    });
  });
});

describe("a negated claim is never downgraded on the site using its term", () => {
  const site = crawl([
    page("https://acme.example/", "HQ mailing address: 1 Main St, Fair Oaks Ranch, TX."),
    page("https://acme.example/about", "We are near the Los Angeles metro area."),
  ]);
  const answer = branded({
    query: "who is Acme Design",
    citedDomains: [],
    fullAnswer: "Acme Design (Los Angeles-based) is a studio.",
  });
  it.each([
    "Acme Design is not in Los Angeles.",
    "Acme Design isn\u2019t in Los Angeles.",
    "Acme Design isn't in Los Angeles.",
    "Acme Design cannot be found in Los Angeles.",
    "Acme Design has never been in Los Angeles.",
    "Acme Design has no office in Los Angeles.",
    "None of Acme Design's staff are in Los Angeles.",
    "Nobody at Acme Design works in Los Angeles.",
    "Nothing ties Acme Design to Los Angeles.",
    "Acme Design operates without a Los Angeles office.",
    "Acme Design is neither in Los Angeles nor nearby.",
    "Acme Design is in Los Angeles nor nearby.",
  ])("%s", async (claim) => {
    const r = await checkAccuracy("https://acme.example/", site, [answer], [], {
      run: async () => ({
        assertions: [
          {
            claim,
            engineQuote: "Acme Design (Los Angeles-based)",
            verdict: "contradicted",
            // Without the term, so only the negation guard holds.
            siteQuote: "HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.",
            searchTerms: ["Los Angeles"],
          },
        ],
      }),
      ownership: { fetchPage: async () => null },
    });
    expect(r.assertions[0]?.unverifiedReason ?? "").not.toMatch(/^Your site does say/);
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
